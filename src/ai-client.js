/**
 * Cliente HTTP modular y desacoplado para BSCL AI Studio.
 * Conecta con Cascada Gemini 2026, Groq LPU, Smart AI Router, OpenRouter :free, Nube Pública y,
 * solo por selección explícita, Cerebras, Grok (xAI), Muse (Meta) y Ollama.
 *
 * Orden del modo Automático (sendAutomatic):
 *   1. Gemini y después Groq Free (si está activado). planner/subagent invierten el orden.
 *   2. OpenRouter :free verificados (hasta 3) y openrouter/free.
 *   3. Smart AI Router local.
 *   4. Nube Pública (Pollinations), solo chat directo sin contexto del workspace ni del editor,
 *      y solo con el prompt base y el último mensaje del usuario (sin historial).
 * Con imágenes: Gemini y Smart AI Router. Automático nunca usa Ollama, Cerebras, xAI, Meta ni
 * OpenCode. Un proveedor se salta entero solo si rechazó la clave o no se pudo conectar; un
 * modelo lento (timeout por petición) se enfría solo a sí mismo.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
const { LocalModelManager } = require('./local-model-manager');
const {
  ProviderCooldown,
  timeoutSignal,
  deadlineError,
  cancellationError,
  throwIfCancelled,
  fetchFailureCode,
  isConnectionFailureCode
} = require('./provider-cooldown');
const { ModelCatalog } = require('./model-catalog');
const { ProviderCascade, GEMINI_2026_MODELS } = require('./provider-cascade');
const { callFreeCloudDirect, publicCloudBlockReason, stripSystemContext, lastTurnOnly } = require('./free-cloud-fallback');
const {
  isLoopbackUrl,
  summarizeProviderError,
  parseDurationMs,
  readQuotaHeaders,
  retryDelayFromBody,
  compactLocalMessages
} = require('./message-compactor');

// Plazo total de una llamada a sendMessage. El paso individual más largo es el Smart AI Router
// (90 s); 170 s le deja sitio detrás de un proveedor que falle por timeout (45 s) y acota lo que
// antes era la suma de todos los timeouts de la cascada, varios minutos sin poder cancelar.
// El enfriamiento por timeout de provider-cooldown.js (3 min) debe seguir siendo mayor.
const SEND_DEADLINE_MS = 170 * 1000;
const GROUP_ORDER = ['auto', 'free', 'local', 'paid'];
const VISION_PROMPT = 'Describe con detalle en español la(s) imagen(es) adjunta(s). Transcribe literalmente cualquier texto, código o mensaje de error visible y enumera los elementos de interfaz relevantes. Limítate a describir; no respondas a otras preguntas.';

/**
 * Mensaje propio para la descripción de imágenes: solo las imágenes del último mensaje que las
 * trae y una instrucción fija. Sin system prompt (lleva el código del editor) ni historial, que
 * el modelo de visión acababa contestando en lugar de describir la imagen.
 */
function buildVisionMessages(messages = []) {
  const withImages = [...messages].reverse()
    .find((m) => Array.isArray(m?.content) && m.content.some((p) => p?.type === 'image_url'));
  const images = withImages ? withImages.content.filter((p) => p?.type === 'image_url') : [];
  return [{ role: 'user', content: [{ type: 'text', text: VISION_PROMPT }, ...images] }];
}

/**
 * /api/chat de Ollama no entiende las partes image_url de OpenAI: el texto va en content y las
 * imágenes, en base64 sin el prefijo data:, en el campo images del mensaje.
 */
function toOllamaMessages(messages = []) {
  let images = [];
  const textMessages = messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const found = m.content.filter((p) => p?.type === 'image_url')
      .map((p) => String(p.image_url?.url || '').replace(/^data:[^,]*,/, ''))
      .filter(Boolean);
    if (found.length) images = found;
    return { role: m.role, content: m.content.filter((p) => p?.type === 'text').map((p) => p.text || '').join('\n') };
  });
  const compacted = compactLocalMessages(textMessages);
  if (!images.length) return compacted;
  // compactMessages conserva siempre el último mensaje de usuario, que es el que trae las imágenes.
  const lastUser = compacted.map((m) => m.role).lastIndexOf('user');
  if (lastUser >= 0) compacted[lastUser] = { ...compacted[lastUser], images };
  return compacted;
}

class AiClient {
  constructor(options = {}) {
    this.smartRouterUrl = options.smartRouterUrl || 'http://localhost:3000';
    this.ollamaUrl = isLoopbackUrl(options.ollamaUrl || 'http://localhost:11434')
      ? (options.ollamaUrl || 'http://localhost:11434') : 'http://localhost:11434';
    this.geminiApiKey = options.geminiApiKey || '';
    this.groqApiKey = options.groqApiKey || '';
    this.groqFreeEnabled = Boolean(options.groqFreeEnabled);
    this.groqAutoEnabled = this.groqFreeEnabled;
    this.cerebrasApiKey = options.cerebrasApiKey || '';
    this.openRouterApiKey = options.openRouterApiKey || '';
    this.freeCloudEnabled = options.freeCloudEnabled !== false;
    this.openCodeFreeEnabled = options.openCodeFreeEnabled !== false;
    this.openCodeApiKey = options.openCodeApiKey || '';
    this.xaiApiKey = options.xaiApiKey || '';
    this.metaApiKey = options.metaApiKey || '';
    this.abortSignal = null;
    this.sendDeadlineMs = Number(options.sendDeadlineMs) > 0 ? Number(options.sendDeadlineMs) : SEND_DEADLINE_MS;
    this.providerCooldown = new ProviderCooldown();
    this.geminiCredentialRevision = 0;
    this.groqCredentialRevision = 0;
    this.openRouterCredentialRevision = 0;
    this.xaiCredentialRevision = 0;
    this.metaCredentialRevision = 0;
    this.groqModelCatalog = { checkedAt: 0, ids: [] };
    this.openRouterModelCatalog = { checkedAt: 0, models: [] };
    this.opencodeModelCatalog = { checkedAt: 0, ids: [] };
    this.xaiModelCatalog = { checkedAt: 0, ids: [] };
    this.metaModelCatalog = { checkedAt: 0, ids: [] };
  }

  updateConfig({ smartRouterUrl, ollamaUrl, geminiApiKey, groqApiKey, groqFreeEnabled, cerebrasApiKey, openRouterApiKey, freeCloudEnabled, openCodeFreeEnabled, openCodeApiKey, xaiApiKey, metaApiKey }) {
    const nextGeminiApiKey = geminiApiKey || '';
    if (nextGeminiApiKey !== this.geminiApiKey) {
      this.geminiCredentialRevision += 1;
      this.providerCooldown.clear('gemini');
    }
    const nextGroqApiKey = groqApiKey || '';
    if (nextGroqApiKey !== this.groqApiKey || Boolean(groqFreeEnabled) !== this.groqFreeEnabled) {
      this.groqCredentialRevision += 1;
      this.groqModelCatalog = { checkedAt: 0, ids: [] };
      this.providerCooldown.clear('groq');
    }
    if ((cerebrasApiKey || '') !== this.cerebrasApiKey) this.providerCooldown.clear('cerebras');
    const nextOpenRouterApiKey = openRouterApiKey || '';
    if (nextOpenRouterApiKey !== this.openRouterApiKey) {
      this.openRouterCredentialRevision += 1;
      this.openRouterModelCatalog = { checkedAt: 0, models: [] };
      this.providerCooldown.clear('openrouter');
    }
    if (smartRouterUrl) this.smartRouterUrl = smartRouterUrl;
    if (ollamaUrl && isLoopbackUrl(ollamaUrl)) this.ollamaUrl = ollamaUrl;
    this.geminiApiKey = nextGeminiApiKey;
    this.groqApiKey = nextGroqApiKey;
    this.groqFreeEnabled = Boolean(groqFreeEnabled);
    this.groqAutoEnabled = this.groqFreeEnabled;
    this.cerebrasApiKey = cerebrasApiKey || '';
    this.openRouterApiKey = nextOpenRouterApiKey;
    if (freeCloudEnabled !== undefined) this.freeCloudEnabled = Boolean(freeCloudEnabled);
    if (openCodeFreeEnabled !== undefined && Boolean(openCodeFreeEnabled) !== this.openCodeFreeEnabled) {
      this.openCodeFreeEnabled = Boolean(openCodeFreeEnabled);
      this.opencodeModelCatalog = { checkedAt: 0, ids: [] };
    }
    if (openCodeApiKey !== undefined) this.openCodeApiKey = openCodeApiKey || '';
    const nextXaiApiKey = xaiApiKey !== undefined ? (xaiApiKey || '') : this.xaiApiKey;
    if (nextXaiApiKey !== this.xaiApiKey) {
      this.xaiCredentialRevision += 1;
      this.xaiModelCatalog = { checkedAt: 0, ids: [] };
      this.providerCooldown.clear('grok');
    }
    this.xaiApiKey = nextXaiApiKey;
    const nextMetaApiKey = metaApiKey !== undefined ? (metaApiKey || '') : this.metaApiKey;
    if (nextMetaApiKey !== this.metaApiKey) {
      this.metaCredentialRevision += 1;
      this.metaModelCatalog = { checkedAt: 0, ids: [] };
      this.providerCooldown.clear('meta');
    }
    this.metaApiKey = nextMetaApiKey;
  }

  /**
   * Señal de cancelación de la petición en curso (null para quitarla). Cada sendMessage toma la
   * señal vigente al entrar y la combina con su plazo global en todos sus fetch.
   */
  setAbortSignal(signal) {
    this.abortSignal = signal || null;
  }

  transcribeAudio() {
    throw new Error('La transcripción de audio en la nube está desactivada para evitar cargos. Usa el dictado del micrófono de VS Code.');
  }

  getLocalModels(signal) { return ModelCatalog.getLocalModels(this.ollamaUrl, signal); }
  getGeminiModels() { return Promise.resolve(ModelCatalog.getGeminiModels(this.geminiApiKey)); }
  fetchGroqModelCatalog(signal) { return ModelCatalog.fetchGroqModelCatalog(this.groqApiKey, this.groqFreeEnabled, this.groqModelCatalog, signal); }
  getGroqModels() { return ModelCatalog.getGroqModels(this.groqApiKey, this.groqFreeEnabled, this.groqModelCatalog); }
  getCerebrasModels() { return Promise.resolve(ModelCatalog.getCerebrasModels(this.cerebrasApiKey)); }
  getFreeCloudModels() { return Promise.resolve(ModelCatalog.getFreeCloudModels(this.freeCloudEnabled)); }
  fetchVerifiedOpenRouterFreeModels(signal) { return ModelCatalog.fetchVerifiedOpenRouterFreeModels(this.openRouterApiKey, this.openRouterModelCatalog, signal); }
  getOpenRouterModels() { return ModelCatalog.getOpenRouterModels(this.openRouterApiKey, this.openRouterModelCatalog); }
  getOpenCodeModels() { if (!this.openCodeFreeEnabled) return Promise.resolve([]); return ModelCatalog.getOpenCodeModels(this.opencodeModelCatalog); }
  fetchXaiModelCatalog() { return ModelCatalog.fetchXaiModelCatalog(this.xaiApiKey, this.xaiModelCatalog); }
  getXaiModels() { return ModelCatalog.getXaiModels(this.xaiApiKey, this.xaiModelCatalog); }
  fetchMetaModelCatalog() { return ModelCatalog.fetchMetaModelCatalog(this.metaApiKey, this.metaModelCatalog); }
  getMetaModels() { return ModelCatalog.getMetaModels(this.metaApiKey, this.metaModelCatalog); }
  pullLocalModel(model, onProgress) { return LocalModelManager.pull(this.ollamaUrl, model, onProgress); }
  async recommendLocalModel() { return LocalModelManager.recommendation(await this.getLocalModels()); }

  async getCloudModels() {
    const fallbackList = [{ id: 'smart-router', name: '⚡ Automático · 100% Cloud Gratis (0% PC)', provider: 'auto' }];
    try {
      const res = await fetch(`${this.smartRouterUrl}/api/models`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return fallbackList;
      const data = await res.json();
      const models = Array.isArray(data.models) ? data.models : fallbackList;
      const withoutAuto = models.filter((item) => item?.id && item.id !== 'smart-router' &&
        item.id !== 'auto' && ModelCatalog.isSafeRouterId(item.id));
      return [fallbackList[0], ...withoutAuto];
    } catch { return fallbackList; }
  }

  /**
   * Cada modelo lleva group ('auto' | 'free' | 'local' | 'paid') y la lista sale ordenada por
   * grupo: los de pago van al final, lejos de Automático, para que una flecha en el selector
   * no mande la petición a un proveedor que factura.
   */
  async listAllModels() {
    const [localModels, cloudModels, geminiModels, cerebrasModels, groqModels, openRouterModels, freeCloudModels, openCodeModels, xaiModels, metaModels] = await Promise.all([
      this.getLocalModels(), this.getCloudModels(), this.getGeminiModels(),
      this.getCerebrasModels(), this.getGroqModels(), this.getOpenRouterModels(), this.getFreeCloudModels(), this.getOpenCodeModels(), this.getXaiModels(), this.getMetaModels()
    ]);
    const autoModel = cloudModels.find((m) => m.id === 'smart-router');
    const otherCloud = cloudModels.filter((m) => m.id !== 'smart-router');
    const combined = [autoModel, ...geminiModels, ...groqModels, ...openRouterModels, ...openCodeModels, ...freeCloudModels, ...otherCloud, ...localModels, ...cerebrasModels, ...xaiModels, ...metaModels].filter(Boolean);
    const unique = [...new Map(combined.map((item) => [item.id, item])).values()]
      .map((item) => ({ ...item, group: ModelCatalog.groupFor(item) }));
    return unique.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  }

  async sendCompatibleRequest({ model, messages, baseUrl, apiKey, providerName, timeoutMs = 90000, maxCompletionTokens, signal }) {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, messages, ...(maxCompletionTokens ? { max_completion_tokens: maxCompletionTokens } : {}) }),
        signal: timeoutSignal(timeoutMs, signal)
      });
    } catch (error) {
      if (signal?.aborted) throw cancellationError(signal);
      const requestError = new Error(`${providerName} no respondió: ${summarizeProviderError(error.message)}`);
      requestError.code = fetchFailureCode(error);
      // Solo "no se pudo conectar" afecta a todo el proveedor (provider-cascade.js). Un
      // TimeoutError del plazo por petición queda en false: es un modelo lento, no la red.
      requestError.connectionFailed = isConnectionFailureCode(requestError.code);
      throw requestError;
    }
    if (!response.ok) {
      const rawError = await response.text();
      let parsedError = null;
      try { parsedError = JSON.parse(rawError); } catch {}
      // Gemini puede responder con un array [{ error: {...} }]; sin normalizarlo se perdían
      // details (retryDelay, quotaId) y status.
      const root = Array.isArray(parsedError) ? parsedError[0] : parsedError;
      const providerError = root?.error || root || {};
      const details = summarizeProviderError(providerError.message || rawError);
      const requestError = new Error(`${providerName} respondió HTTP ${response.status}: ${details}`);
      requestError.status = response.status;
      requestError.code = providerError.status || providerError.code || '';
      // El mensaje se recorta a 360 caracteres; ProviderCooldown clasifica la cuota con esto.
      requestError.rawDetails = String(rawError || '').slice(0, 4000);
      requestError.quota = readQuotaHeaders(response.headers);
      const headerDelay = parseDurationMs(response.headers.get('retry-after'));
      const bodyDelay = headerDelay ? null : retryDelayFromBody(providerError);
      const quotaDelay = headerDelay || bodyDelay ? null
        : (requestError.quota?.requestsRemaining === 0 ? requestError.quota.requestsResetMs : null);
      requestError.retryAfterMs = headerDelay || bodyDelay || quotaDelay;
      requestError.retryAfterSource = headerDelay ? 'header' : bodyDelay ? 'body' : quotaDelay ? 'quota' : '';
      throw requestError;
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${providerName} respondió sin texto utilizable.`);
    // finishReason ('length') avisa de una salida cortada por max_tokens: CoderAgent la
    // rechaza en vez de guardar un archivo truncado como si estuviera completo.
    return { content, model, provider: providerName, quota: readQuotaHeaders(response.headers), finishReason: data.choices?.[0]?.finish_reason || '' };
  }

  async sendOpenCodeRequest({ model, messages, timeoutMs = 90000, signal }) {
    const baseUrl = 'https://opencode.ai/zen/v1';
    const sessionId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'opencode/2.0.3',
      'x-opencode-session': sessionId,
      'x-session-id': sessionId,
      'x-opencode-client': 'opencode',
      'x-opencode-project': 'global',
      'x-title': 'BSCL AI Studio'
    };
    if (this.openCodeApiKey) headers.Authorization = `Bearer ${this.openCodeApiKey}`;
    else headers.Authorization = 'Bearer ';
    let response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, stream: false }),
        signal: timeoutSignal(timeoutMs, signal)
      });
    } catch (error) {
      if (signal?.aborted) throw cancellationError(signal);
      const requestError = new Error(`OpenCode Zen no respondió: ${summarizeProviderError(error.message)}`);
      requestError.code = fetchFailureCode(error);
      throw requestError;
    }
    if (!response.ok) {
      const rawError = await response.text();
      let parsedError = null;
      try { parsedError = JSON.parse(rawError); } catch {}
      const providerError = parsedError?.error || parsedError || {};
      const details = summarizeProviderError(providerError.message || rawError || `HTTP ${response.status}`);
      const requestError = new Error(`OpenCode Zen respondió HTTP ${response.status}: ${details}`);
      requestError.status = response.status;
      requestError.code = providerError.status || providerError.code || '';
      throw requestError;
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenCode Zen respondió sin texto utilizable.');
    return { content, model, provider: `OpenCode Zen (${model})`, finishReason: data.choices?.[0]?.finish_reason || '' };
  }

  /**
   * Describe las imágenes para modelos gratuitos sin visión. Política de coste cero: aquí solo
   * llegan modelos opencode:, groq:, cerebras: y free-cloud:, así que la visión no puede caer en
   * xAI ni Meta, que facturan; antes se probaban con solo tener la clave guardada.
   */
  async describeImages(messages = [], { signal } = {}) {
    const visionMessages = buildVisionMessages(messages);
    if (this.geminiApiKey) {
      try {
        const result = await this.sendCompatibleRequest({
          model: 'gemini-2.5-flash',
          messages: visionMessages,
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: this.geminiApiKey,
          providerName: 'Gemini Vision',
          timeoutMs: 45000,
          signal
        });
        if (result?.content) return result.content;
      } catch (error) {
        if (signal?.aborted) throw cancellationError(signal);
      }
    }

    if (this.openRouterApiKey) {
      const visionCandidates = [
        'google/gemini-2.0-flash-exp:free',
        'qwen/qwen2.5-vl-72b-instruct:free',
        'meta-llama/llama-3.2-11b-vision-instruct:free'
      ];
      for (const candidate of visionCandidates) {
        try {
          const result = await this.sendCompatibleRequest({
            model: candidate,
            messages: visionMessages,
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: this.openRouterApiKey,
            providerName: 'OpenRouter Vision',
            timeoutMs: 45000,
            signal
          });
          if (result?.content) return result.content;
        } catch (error) {
          if (signal?.aborted) throw cancellationError(signal);
        }
      }
    }

    const localModels = await this.getLocalModels(signal);
    throwIfCancelled(signal);
    const visionModels = (localModels || []).map((m) => m.id).filter((id) => /llava|vision|bakllava|minicpm-v|qwen.*vl|gemma3/i.test(String(id)));
    for (const candidate of visionModels) {
      try {
        const result = await this.sendCompatibleRequest({
          model: candidate,
          messages: visionMessages,
          baseUrl: `${String(this.ollamaUrl).replace(/\/+$/, '')}/v1`,
          providerName: `Ollama Vision (${candidate})`,
          timeoutMs: 60000,
          signal
        });
        if (result?.content) return result.content;
      } catch (error) {
        if (signal?.aborted) throw cancellationError(signal);
      }
    }

    throw new Error('No hay un modelo con visión disponible para analizar la imagen. Configura una clave Gemini, una clave OpenRouter o instala un modelo local con visión (llava, etc.).');
  }

  /**
   * Comprobaciones sin red de un modelo elegido a mano; lanza si la petición no puede salir.
   * Van antes de describeImages: antes se gastaba la cuota de visión de Gemini u OpenRouter
   * (hasta varias llamadas de 45 s) para acabar en un error de configuración igualmente.
   */
  assertModelReady(model, messages, roleHint) {
    const throwIfSkipped = (provider, label) => {
      const reason = ProviderCascade.skipReason(this, provider, label, { explicit: true });
      if (reason) throw new Error(reason);
    };
    if (model.startsWith('free-cloud:')) {
      if (!this.freeCloudEnabled) throw new Error('La Nube Pública está desactivada en ⚙️ APIs.');
      const blocked = publicCloudBlockReason(stripSystemContext(messages), roleHint);
      if (blocked) throw new Error(`La Nube Pública no recibe contexto del workspace ni del editor (${blocked}). Elige otro modelo para esta tarea.`);
    } else if (model.startsWith('opencode:')) {
      if (!this.openCodeFreeEnabled) throw new Error('Los modelos gratuitos de OpenCode están desactivados en ⚙️ APIs.');
      if (!ModelCatalog.isOpenCodeFreeId(model.slice(9))) throw new Error('Solo se permiten modelos gratuitos de OpenCode.');
    } else if (model.startsWith('google/') || model.startsWith('gemini:')) {
      if (!this.geminiApiKey) throw new Error('Configura tu clave de Gemini en ⚙️ APIs para usar este modelo.');
      throwIfSkipped('gemini', 'Gemini');
    } else if (model.startsWith('groq:')) {
      if (!this.groqFreeEnabled || !this.groqApiKey) throw new Error('Activa Groq Free y guarda tu clave de Groq en ⚙️ APIs para usar este modelo.');
      throwIfSkipped('groq', 'Groq');
    } else if (model.startsWith('cerebras:')) {
      if (!this.cerebrasApiKey) throw new Error('No hay clave de Cerebras configurada (no se gestiona desde ⚙️ APIs). Elige otro modelo.');
      throwIfSkipped('cerebras', 'Cerebras');
    } else if (model.startsWith('meta:')) {
      if (!this.metaApiKey) throw new Error('Configura tu clave de Meta Model API en ⚙️ APIs para usar Muse.');
      if (!model.slice(5).trim()) throw new Error('El identificador del modelo Meta no es válido.');
    } else if (model.startsWith('grok:') || model.startsWith('xai:')) {
      if (!this.xaiApiKey) throw new Error('Configura tu clave de xAI en ⚙️ APIs para usar Grok.');
      if (!model.replace(/^(?:grok:|xai:)/, '').trim()) throw new Error('El identificador del modelo Grok no es válido.');
    } else if (model.startsWith('openrouter:')) {
      if (!this.openRouterApiKey) throw new Error('Configura una clave de OpenRouter en ⚙️ APIs.');
      const freeModel = model.slice(11);
      if (freeModel !== 'openrouter/free' && !/:free$/i.test(freeModel)) throw new Error('Solo se permiten modelos :free.');
    }
  }

  /**
   * Punto de entrada. Si hay una señal de setAbortSignal y se aborta, lanza un Error con
   * name 'AbortError' y message 'Solicitud cancelada.'. Si vence el plazo global, lanza un
   * Error con name 'TimeoutError' y code 'BSCL_DEADLINE'.
   */
  async sendMessage(options = {}) {
    const userSignal = this.abortSignal;
    throwIfCancelled(userSignal);
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(deadlineError(this.sendDeadlineMs)), this.sendDeadlineMs);
    timer.unref?.();
    const signal = userSignal ? AbortSignal.any([userSignal, deadline.signal]) : deadline.signal;
    try {
      return await this.dispatchMessage(options, signal);
    } catch (error) {
      // Un paso que tradujo el aborto a otro error sigue siendo una cancelación para quien llama.
      if (signal.aborted) throw cancellationError(signal);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async dispatchMessage({ model = 'smart-router', messages = [], systemPrompt = '', webSearch = false, roleHint = '' }, signal) {
    if (typeof model !== 'string') throw new Error('El identificador del modelo no es válido.');
    if (model.startsWith('router:') && !ModelCatalog.isSafeRouterId(model)) model = 'smart-router';
    let formattedMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    if (systemPrompt) formattedMessages.unshift({ role: 'system', content: systemPrompt });
    this.assertModelReady(model, formattedMessages, roleHint);
    let hasImages = formattedMessages.some((m) => Array.isArray(m.content) && m.content.some((p) => p?.type === 'image_url'));

    if (hasImages && /^(opencode:|groq:|cerebras:|free-cloud:)/.test(model)) {
      const description = await this.describeImages(formattedMessages, { signal });
      formattedMessages = formattedMessages.map((m) => {
        if (!Array.isArray(m.content)) return m;
        const text = m.content.filter((p) => p?.type === 'text').map((p) => p.text || '').filter(Boolean).join('\n');
        return { role: m.role, content: text };
      });
      let annotated = false;
      for (let i = formattedMessages.length - 1; i >= 0; i -= 1) {
        if (formattedMessages[i].role === 'user') {
          const base = (formattedMessages[i].content || '').toString().trim();
          formattedMessages[i] = {
            role: 'user',
            content: (base ? base + '\n\n' : '') + `[Análisis visual de la imagen adjunta]: ${description}`
          };
          annotated = true;
          break;
        }
      }
      if (!annotated) formattedMessages.push({ role: 'user', content: `[Análisis visual de la imagen adjunta]: ${description}` });
      hasImages = false;
    }
    throwIfCancelled(signal);

    if (hasImages && model.startsWith('opencode:')) {
      throw new Error('El modelo gratuito de OpenCode Zen seleccionado no admite imágenes. Usa un modelo con visión o envía solo texto.');
    }

    if (webSearch) {
      // Misma llamada (misma señal y mismo plazo global), no una nueva.
      const result = await this.dispatchMessage({
        model, roleHint,
        messages: [...formattedMessages, { role: 'system', content: 'No tienes acceso a búsqueda web en este modo sin costo. Responde con conocimiento general y advierte si depende de datos actuales.' }]
      }, signal);
      return { ...result, content: `> Búsqueda web desactivada en modo sin costo.\n\n${result.content}`, provider: `${result.provider} · sin búsqueda web` };
    }

    if (model.startsWith('google/') || model.startsWith('gemini:')) {
      const preferred = model.replace(/^(?:google\/|gemini:)/, '');
      const { result, failure } = await ProviderCascade.tryGeminiCascade(this, formattedMessages, roleHint, GEMINI_2026_MODELS.includes(preferred) ? preferred : 'gemini-3.6-flash', { signal });
      if (result) return result;
      throw new Error(failure || 'No se pudo completar con Google Gemini Free.');
    }
    // Claves, interruptores e ids de estas ramas ya los validó assertModelReady.
    if (model.startsWith('groq:')) {
      const { result, failure } = await ProviderCascade.tryGroqCascade(this, formattedMessages, roleHint, model.slice(5), hasImages, { signal });
      if (result) return result;
      throw new Error(failure || 'No se pudo completar con Groq Free.');
    }
    if (model.startsWith('cerebras:')) {
      const { result, failure } = await ProviderCascade.tryCerebrasCascade(this, formattedMessages, roleHint, model.slice(9), { signal });
      if (result) return result;
      throw new Error(failure || 'No se pudo completar con Cerebras. Su clave no se configura en ⚙️ APIs.');
    }
    if (model.startsWith('meta:')) {
      const metaModel = model.slice(5).trim();
      return this.sendCompatibleRequest({ model: metaModel, messages: formattedMessages, baseUrl: 'https://api.meta.ai/v1', apiKey: this.metaApiKey, providerName: `Meta (${metaModel})`, signal });
    }
    if (model.startsWith('grok:') || model.startsWith('xai:')) {
      const grokModel = model.replace(/^(?:grok:|xai:)/, '').trim();
      return this.sendCompatibleRequest({ model: grokModel, messages: formattedMessages, baseUrl: 'https://api.x.ai/v1', apiKey: this.xaiApiKey, providerName: `Grok (${grokModel})`, signal });
    }
    if (model.startsWith('free-cloud:')) {
      // El contexto del editor y de la carpeta lo añade el host al system prompt sin que el
      // usuario lo pida: se recorta para que el servicio público reciba solo la conversación.
      // Elegida a mano sí lleva el historial: sin él no podría seguir una conversación.
      return callFreeCloudDirect(stripSystemContext(formattedMessages), model.slice(11) || 'openai', 35000, signal);
    }
    if (model.startsWith('opencode:')) {
      return this.sendOpenCodeRequest({ model: model.slice(9), messages: formattedMessages, timeoutMs: 90000, signal });
    }

    if (model.startsWith('openrouter:')) {
      const freeModel = model.slice(11);
      return this.sendCompatibleRequest({ model: freeModel, messages: formattedMessages, baseUrl: 'https://openrouter.ai/api/v1', apiKey: this.openRouterApiKey, providerName: 'OpenRouter Free', signal });
    }

    if (model === 'smart-router' || model === 'auto' || model === 'auto-smart') {
      return this.sendAutomatic(model, formattedMessages, { roleHint, hasImages, signal });
    }
    if (model.startsWith('router:')) {
      const { result, failure } = await this.tryRouter(model, model, formattedMessages, roleHint, signal);
      if (result) return result;
      throw new Error(`No se pudo generar respuesta con «${model}». ${failure}`);
    }
    // Lo que queda son modelos de Ollama elegidos a mano (sus ids no llevan prefijo). Van
    // directos a Ollama: antes pasaban primero por el Smart Router, que podía contestar con un
    // modelo en la nube aunque el usuario hubiera elegido local por privacidad.
    return this.sendToLocalModel(model, formattedMessages, signal);
  }

  async sendAutomatic(model, messages, { roleHint = '', hasImages = false, signal } = {}) {
    const failures = [];
    const gemini = () => ProviderCascade.tryGeminiCascade(this, messages, roleHint, '', { signal });
    const groq = () => ProviderCascade.tryGroqCascade(this, messages, roleHint, '', hasImages, { signal });
    // planner y subagent priorizan la latencia de Groq. Cerebras ya no entra en Automático: su
    // cuenta es de crédito de prueba y su clave no se puede ver ni borrar en ⚙️ APIs.
    const steps = (roleHint === 'planner' || roleHint === 'subagent') ? [groq, gemini] : [gemini, groq];
    if (!hasImages) steps.push(() => ProviderCascade.tryOpenRouterCascade(this, messages, { signal }));
    steps.push(() => this.tryRouter(model, 'auto', messages, roleHint, signal));
    if (!hasImages) steps.push(() => this.tryPublicCloudFallback(messages, roleHint, signal));

    for (const step of steps) {
      throwIfCancelled(signal);
      const { result, failure } = await step();
      if (result) return result;
      if (failure) failures.push(failure);
    }
    throw new Error(`No se pudo generar respuesta con las IAs en la nube («${model}»). ${failures.join(' · ')}`);
  }

  async tryRouter(model, routerModel, messages, roleHint, signal) {
    try {
      const routerRes = await fetch(`${this.smartRouterUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: routerModel, messages, roleHint }),
        signal: timeoutSignal(90000, signal)
      });
      if (!routerRes.ok) return { result: null, failure: `Smart Router: HTTP ${routerRes.status}` };
      const data = await routerRes.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) return { result: null, failure: 'Smart Router: respondió sin texto' };
      return { result: { content, model: data.model || model, provider: data.model || 'Smart AI Router Cloud', finishReason: data.choices?.[0]?.finish_reason || '' }, failure: '' };
    } catch (error) {
      if (signal?.aborted) throw cancellationError(signal);
      return { result: null, failure: `Smart Router: ${summarizeProviderError(error.message)}` };
    }
  }

  /**
   * Último recurso de Automático (ADR-018), solo para chat directo sin contexto del proyecto.
   * La marca se busca en toda la conversación, pero solo sale el último turno (lastTurnOnly).
   */
  async tryPublicCloudFallback(messages, roleHint, signal) {
    if (!this.freeCloudEnabled) return { result: null, failure: '' };
    const blocked = publicCloudBlockReason(messages, roleHint);
    if (blocked) return { result: null, failure: `Nube Pública omitida (${blocked})` };
    try {
      return { result: await callFreeCloudDirect(lastTurnOnly(messages), 'openai', 35000, signal), failure: '' };
    } catch (error) {
      if (signal?.aborted) throw cancellationError(signal);
      return { result: null, failure: `Nube Pública: ${summarizeProviderError(error.message)}` };
    }
  }

  async sendToLocalModel(model, messages, signal) {
    const targetLocalModel = model.replace(/^ollama\//i, '');
    let response;
    try {
      response = await fetch(`${this.ollamaUrl}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: targetLocalModel, messages: toOllamaMessages(messages), stream: false, keep_alive: 0, options: { num_ctx: 4096, num_predict: 1024 } }),
        signal: timeoutSignal(60000, signal)
      });
    } catch (error) {
      if (signal?.aborted) throw cancellationError(signal);
      throw new Error(`No se pudo conectar con Ollama local para «${targetLocalModel}»: ${summarizeProviderError(error.message)}`);
    }
    if (!response.ok) {
      const details = summarizeProviderError((await response.text()).slice(0, 200));
      throw new Error(`Ollama Local respondió HTTP ${response.status} con «${targetLocalModel}»: ${details}`);
    }
    const data = await response.json();
    const content = data.message?.content;
    if (!content) throw new Error(`Ollama Local («${targetLocalModel}») respondió sin texto.`);
    return { content, model: targetLocalModel, provider: `Ollama (${targetLocalModel})`, finishReason: data.done_reason || '' };
  }
}

module.exports = { AiClient, SEND_DEADLINE_MS };
