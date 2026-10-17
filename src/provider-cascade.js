/**
 * Ejecutor de cascada multi-modelo para Gemini, Groq, Z.ai, Cerebras y OpenRouter en BSCL AI Studio.
 * Inspirado en gemini-provider.js y ai-service.js de Figma AI Copilot.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 *
 * Contrato de cada cascada: devuelve { result, failure } y nunca lanza por un fallo del
 * proveedor. Sí lanza si la llamada se canceló o venció su plazo global: tragarse ese error lo
 * convertía en "proveedor en enfriamiento" y la cascada seguía gastando tiempo.
 */
const {
  GEMINI_2026_MODELS,
  CEREBRAS_FREE_MODELS,
  geminiModelsForRole,
  groqModelsForRole,
  ZAI_BASE_URL,
  ZAI_FREE_MODELS,
  ZAI_FREE_VISION_MODEL,
  ZAI_FREE_IDS
} = require('./free-cloud-fallback');
const { compactMessages, summarizeProviderError } = require('./message-compactor');
const { cancellationError, throwIfCancelled } = require('./provider-cooldown');

function maxTokensForRole(roleHint = '') {
  if (roleHint === 'coder' || roleHint === 'architect') return 8192;
  if (roleHint === 'planner' || roleHint === 'subagent') return 1800;
  return 4096;
}

// Solo dos fallos son del proveedor entero: la clave rechazada y no poder conectar (DNS, conexión
// rechazada, proxy que no deja pasar). El timeout por petición no entra: la conexión se hizo y lo
// lento fue ese modelo generando, así que se enfría ese modelo y se sigue con el siguiente; el
// plazo global de sendMessage acota el total. Antes un timeout dejaba fuera a Gemini 3 min,
// incluso para otro modelo elegido a mano.
const isConnectionFailure = (error) => Boolean(error?.connectionFailed);
const isAuthFailure = (error) => [401, 403].includes(Number(error?.status));

/**
 * Motivo para no llamar al proveedor, o ''. Con un modelo elegido a mano (explicit) no se mira el
 * enfriamiento de red: un fallo de conexión cuesta milisegundos (o ~10 s si nadie contesta) y la
 * persona pidió ese modelo, así que se prueba en vez de contestar "omitido" sin intentarlo. La
 * clave rechazada sí se respeta: con la misma clave el 401 se repetiría (cambiarla limpia el
 * enfriamiento en updateConfig).
 */
function providerSkipReason(client, provider, label, { explicit = false } = {}) {
  const keys = explicit ? [`${provider}:auth`] : [`${provider}:auth`, `${provider}:net`];
  for (const key of keys) {
    const cooldown = client.providerCooldown.get(key);
    if (cooldown) return `${label} omitido (${cooldown.reason}; reintento en ${Math.ceil(cooldown.retryInMs / 1000)} s)`;
  }
  return '';
}

/**
 * Registra el fallo donde toca y devuelve true si hay que dejar de probar este proveedor.
 * sameKey es false si la clave cambió durante la llamada: ese fallo no dice nada de la nueva.
 */
function recordCascadeFailure(client, provider, modelId, error, sameKey = true) {
  const auth = isAuthFailure(error);
  const providerWide = auth || isConnectionFailure(error);
  const key = providerWide ? `${provider}:${auth ? 'auth' : 'net'}` : `${provider}:${modelId}`;
  if (sameKey) client.providerCooldown.recordFailure(key, error);
  return providerWide;
}

/** Una respuesta buena demuestra que la red llega: Automático deja de saltarse el proveedor. */
function recordCascadeSuccess(client, provider, modelId, result) {
  client.providerCooldown.forget(`${provider}:net`);
  client.providerCooldown.recordQuota(`${provider}:${modelId}`, result.quota);
}

/**
 * Bucle común de las cascadas: prueba los candidatos en orden, salta los modelos en
 * enfriamiento y se detiene ante un fallo de todo el proveedor (clave o conexión).
 * send(modelId) hace la petición; revision() da la revisión de la clave en ese momento.
 */
async function runCandidates(client, { provider, label, exhaustedLabel = label, candidates, preferredModel = '', revision = () => 0, send, mapResult = (result) => result, signal }) {
  const failures = [];
  let attempted = 0;
  const attempt = async (modelId) => {
    attempted += 1;
    const credentialRevision = revision();
    try {
      const result = await send(modelId);
      recordCascadeSuccess(client, provider, modelId, result);
      return { result: mapResult(result, modelId), failure: '' };
    } catch (error) {
      if (signal?.aborted) throw cancellationError(signal);
      if (recordCascadeFailure(client, provider, modelId, error, credentialRevision === revision())) {
        return { result: null, failure: `${label}: ${summarizeProviderError(error.message)}` };
      }
      failures.push(`${modelId}: ${summarizeProviderError(error.message)}`);
      return null;
    }
  };

  for (const modelId of candidates) {
    throwIfCancelled(signal);
    if (client.providerCooldown.get(`${provider}:${modelId}`)) continue;
    const outcome = await attempt(modelId);
    if (outcome) return outcome;
  }
  // Con un modelo elegido a mano y todos los candidatos en enfriamiento se prueba al menos ese:
  // contestar "en enfriamiento" sin intentar nada no le dice a la persona si ya funciona. Si
  // queda otro modelo libre se usa ese, para no repetir la espera de uno que acaba de fallar.
  if (!attempted && preferredModel) {
    throwIfCancelled(signal);
    const outcome = await attempt(preferredModel);
    if (outcome) return outcome;
  }
  return {
    result: null,
    failure: failures.length ? `${exhaustedLabel} (${failures.slice(0, 2).join('; ')})` : `${label} en enfriamiento temporal`
  };
}

class ProviderCascade {
  static skipReason(client, provider, label, options) {
    return providerSkipReason(client, provider, label, options);
  }

  static async tryGeminiCascade(client, messages, roleHint = '', preferredModel = '', { signal } = {}) {
    if (!client.geminiApiKey) return { result: null, failure: '' };
    const skipped = providerSkipReason(client, 'gemini', 'Gemini', { explicit: Boolean(preferredModel) });
    if (skipped) return { result: null, failure: skipped };

    const releaseSlot = await client.providerCooldown.acquire('gemini', 3, signal);
    try {
      const candidates = preferredModel
        ? [preferredModel, ...geminiModelsForRole(roleHint).filter((m) => m !== preferredModel)]
        : geminiModelsForRole(roleHint);
      return await runCandidates(client, {
        provider: 'gemini', label: 'Gemini', exhaustedLabel: 'Cascada Gemini agotada', candidates, preferredModel, signal,
        revision: () => client.geminiCredentialRevision,
        mapResult: (result, modelId) => ({ ...result, model: `google/${modelId}` }),
        send: (modelId) => client.sendCompatibleRequest({
          model: modelId,
          messages,
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: client.geminiApiKey,
          providerName: `Gemini Free (${modelId})`,
          timeoutMs: 45000,
          signal
        })
      });
    } finally {
      releaseSlot();
    }
  }

  // Solo se llega aquí con un modelo cerebras: elegido por el usuario; Automático no lo usa.
  static async tryCerebrasCascade(client, messages, roleHint = '', preferredModel = '', { signal } = {}) {
    if (!client.cerebrasApiKey) return { result: null, failure: '' };
    const skipped = providerSkipReason(client, 'cerebras', 'Cerebras', { explicit: Boolean(preferredModel) });
    if (skipped) return { result: null, failure: skipped };
    const release = client.providerCooldown.tryAcquire('cerebras', 2);
    if (!release) return { result: null, failure: 'Cerebras ocupado' };
    try {
      const baseIds = CEREBRAS_FREE_MODELS.map((m) => m.id);
      const candidates = preferredModel ? [preferredModel, ...baseIds.filter((m) => m !== preferredModel)] : baseIds;
      const compacted = compactMessages(messages, 28000);
      // Antes todo fallo salía como "enfriamiento temporal": un 401 de una clave heredada que el
      // usuario no puede ver en la UI quedaba oculto. runCandidates muestra la causa real.
      return await runCandidates(client, {
        provider: 'cerebras', label: 'Cerebras', candidates, preferredModel, signal,
        mapResult: (result, modelId) => ({ ...result, model: `cerebras:${modelId}` }),
        send: (modelId) => client.sendCompatibleRequest({
          model: modelId,
          messages: compacted,
          baseUrl: 'https://api.cerebras.ai/v1',
          apiKey: client.cerebrasApiKey,
          providerName: `Cerebras · ${modelId}`,
          timeoutMs: 30000,
          maxCompletionTokens: maxTokensForRole(roleHint),
          signal
        })
      });
    } finally {
      release();
    }
  }

  static async tryGroqCascade(client, messages, roleHint = '', preferredModel = '', hasImages = false, { signal } = {}) {
    if (!client.groqFreeEnabled || !client.groqApiKey || hasImages) return { result: null, failure: '' };
    const skipped = providerSkipReason(client, 'groq', 'Groq', { explicit: Boolean(preferredModel) });
    if (skipped) return { result: null, failure: skipped };

    const release = client.providerCooldown.tryAcquire('groq', 2);
    if (!release) return { result: null, failure: 'Groq ocupado con tareas concurrentes' };
    try {
      const available = await client.fetchGroqModelCatalog(signal);
      throwIfCancelled(signal);
      const ordered = groqModelsForRole(roleHint, available);
      const candidates = preferredModel
        ? [preferredModel, ...ordered.filter((m) => m !== preferredModel)]
        : ordered;

      const compacted = compactMessages(messages, 28000);
      const maxTokens = Math.min(4096, maxTokensForRole(roleHint));
      return await runCandidates(client, {
        provider: 'groq', label: 'Groq', candidates, preferredModel, signal,
        revision: () => client.groqCredentialRevision,
        mapResult: (result, modelId) => ({ ...result, model: `groq:${modelId}` }),
        send: (modelId) => client.sendCompatibleRequest({
          model: modelId,
          messages: compacted,
          baseUrl: 'https://api.groq.com/openai/v1',
          apiKey: client.groqApiKey,
          providerName: `Groq Free · ${modelId}`,
          timeoutMs: 45000,
          maxCompletionTokens: maxTokens,
          signal
        })
      });
    } finally {
      release();
    }
  }

  /**
   * OpenRouter :free en Automático. Antes solo se probaba el primer modelo verificado: si daba
   * 429, el resto de modelos gratuitos y openrouter/free (ADR-014) nunca llegaban a probarse.
   */
  static async tryOpenRouterCascade(client, messages, { signal } = {}) {
    if (!client.openRouterApiKey) return { result: null, failure: '' };
    const skipped = providerSkipReason(client, 'openrouter', 'OpenRouter');
    if (skipped) return { result: null, failure: skipped };

    const verified = await client.fetchVerifiedOpenRouterFreeModels(signal);
    throwIfCancelled(signal);
    const candidates = [...new Set([...verified.slice(0, 3).map((m) => m.id), 'openrouter/free'])];
    return runCandidates(client, {
      provider: 'openrouter', label: 'OpenRouter', candidates, signal,
      revision: () => client.openRouterCredentialRevision,
      send: (modelId) => client.sendCompatibleRequest({
        model: modelId,
        messages,
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: client.openRouterApiKey,
        providerName: `OpenRouter Free (${modelId})`,
        timeoutMs: 35000,
        signal
      })
    });
  }

  /**
   * Z.ai (GLM) con sus modelos de precio $0: GLM-4.7-Flash, GLM-4.5-Flash y, con imágenes,
   * GLM-4.6V-Flash. Nunca se envía un id que no esté en ZAI_FREE_IDS: los FlashX cobran.
   * 60 s por modelo porque los Flash gratuitos son lentos (una medición pública dio 26 s).
   */
  static async tryZaiCascade(client, messages, roleHint = '', preferredModel = '', hasImages = false, { signal } = {}) {
    if (!client.zaiApiKey) return { result: null, failure: '' };
    if (preferredModel && !ZAI_FREE_IDS.has(preferredModel)) {
      return { result: null, failure: `Z.ai: «${preferredModel}» no es un modelo gratuito` };
    }
    const skipped = providerSkipReason(client, 'zai', 'Z.ai', { explicit: Boolean(preferredModel) });
    if (skipped) return { result: null, failure: skipped };

    const release = client.providerCooldown.tryAcquire('zai', 2);
    if (!release) return { result: null, failure: 'Z.ai ocupado con tareas concurrentes' };
    try {
      const textIds = ZAI_FREE_MODELS.map((m) => m.id);
      const base = hasImages ? [ZAI_FREE_VISION_MODEL.id] : textIds;
      const candidates = preferredModel ? [preferredModel, ...base.filter((m) => m !== preferredModel)] : base;
      return await runCandidates(client, {
        provider: 'zai', label: 'Z.ai', candidates, preferredModel, signal,
        revision: () => client.zaiCredentialRevision,
        mapResult: (result, modelId) => ({ ...result, model: `zai:${modelId}` }),
        send: (modelId) => client.sendCompatibleRequest({
          model: modelId,
          messages,
          baseUrl: ZAI_BASE_URL,
          apiKey: client.zaiApiKey,
          providerName: `Z.ai · ${modelId}`,
          // Sin max_completion_tokens: la API de Z.ai documenta max_tokens y no se ha
          // comprobado cómo trata el parámetro de OpenAI.
          timeoutMs: 60000,
          signal
        })
      });
    } finally {
      release();
    }
  }
}

module.exports = { ProviderCascade, GEMINI_2026_MODELS, maxTokensForRole };
