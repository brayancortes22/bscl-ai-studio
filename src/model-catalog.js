/**
 * Descubrimiento y clasificación de modelos gratuitos para BSCL AI Studio.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
const { GEMINI_2026_MODELS, GROQ_FREE_MODELS, CEREBRAS_FREE_MODELS, ZAI_FREE_MODELS, ZAI_FREE_VISION_MODEL } = require('./free-cloud-fallback');
const { timeoutSignal } = require('./provider-cooldown');

const ZERO_COST_OPENROUTER_EXCLUDE = /embed|rerank|moderation|transcri/i;
const XAI_BASE_URL = 'https://api.x.ai/v1';
const META_BASE_URL = 'https://api.meta.ai/v1';
const META_FALLBACK_MODELS = [
  { id: 'muse-wonder-1.0', label: 'Muse Wonder 1.0 (Código y agentes · 1M ctx)' },
  { id: 'muse-spark-1.3', label: 'Muse Spark 1.3 (Código agéntico)' },
  { id: 'muse-spark-1.2', label: 'Muse Spark 1.2 (Código agéntico)' },
  { id: 'muse-spark-1.3-contributor', label: 'Muse Spark 1.3 Contributor (Descuento)' },
  { id: 'muse-spark-1.1', label: 'Muse Spark 1.1 (Código agéntico)' }
];
const XAI_FALLBACK_MODELS = [
  { id: 'grok-4.7', label: 'Grok 4.7 (Flagship · código y agentes)' },
  { id: 'grok-4', label: 'Grok 4 (Razonamiento general)' },
  { id: 'grok-3', label: 'Grok 3 (Conversación general)' },
  { id: 'grok-3-mini', label: 'Grok 3 Mini (Rápido y económico)' },
  { id: 'grok-code-fast-1', label: 'Grok Code Fast 1 (Código rápido)' },
  { id: 'grok-2-vision-latest', label: 'Grok 2 Vision (Acepta imágenes)' }
];
// Proveedores que facturan o gastan crédito: Cerebras arranca con crédito de prueba (ADR-017) y su
// clave no se puede ver ni borrar en ⚙️ APIs. Solo se usan si el usuario elige uno de sus modelos.
const PAID_PROVIDERS = new Set(['xai', 'meta', 'cerebras']);
const PAID_ID = /^(?:grok:|xai:|meta:|cerebras:)/i;
// La consulta del catálogo de OpenRouter tiene un timeout de 8 s y Automático la repetía en cada petición.
const OPENROUTER_CATALOG_TTL_MS = 5 * 60 * 1000;
const PREFERRED_FREE_FAMILIES = [
  /qwen/i, /deepseek/i, /llama-3\.3-70b|gpt-oss-120b|nemotron/i,
  /minimax|moonshot|kimi|codestral|mistral/i, /z-ai|\bglm\b|gemma-3-27b/i,
  /stepfun|\bstep\b/i, /baidu|ernie/i, /tencent|hunyuan/i
];

function freeModelFamilyRank(model) {
  const label = `${model.id} ${model.name || ''}`;
  const rank = PREFERRED_FREE_FAMILIES.findIndex((pattern) => pattern.test(label));
  return rank < 0 ? PREFERRED_FREE_FAMILIES.length : rank;
}

class ModelCatalog {
  /** Grupo del selector: 'auto' | 'free' | 'local' | 'paid'. */
  static groupFor(model = {}) {
    const id = String(model.id || '');
    if (model.provider === 'auto' || id === 'smart-router') return 'auto';
    if (model.provider === 'ollama' || model.isLocal) return 'local';
    if (PAID_PROVIDERS.has(model.provider) || PAID_ID.test(id)) return 'paid';
    return 'free';
  }

  static async getLocalModels(ollamaUrl, signal) {
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`, { signal: timeoutSignal(2500, signal) });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || []).map((m) => ({
        id: m.name,
        name: `💻 ${m.name} (Local Manual · usa tu PC)`,
        provider: 'ollama',
        isLocal: true,
        size: m.size
      }));
    } catch { return []; }
  }

  static getGeminiModels(geminiApiKey) {
    if (!geminiApiKey) return [];
    return GEMINI_2026_MODELS.map((id) => ({
      id: `google/${id}`,
      name: `✨ Gemini · ${id} (Google AI Studio Free)`,
      provider: 'google'
    }));
  }

  static async fetchGroqModelCatalog(groqApiKey, groqFreeEnabled, cache, signal) {
    if (!groqApiKey || !groqFreeEnabled) return [];
    if (Date.now() - cache.checkedAt < 120000 && cache.ids.length) return cache.ids;
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${groqApiKey}` },
        signal: timeoutSignal(5000, signal)
      });
      if (!response.ok) return [];
      const data = await response.json();
      const ids = (data.data || []).map((item) => item.id).filter((id) => typeof id === 'string');
      cache.checkedAt = Date.now();
      cache.ids = ids;
      return ids;
    } catch {
      return [];
    }
  }

  static async getGroqModels(groqApiKey, groqFreeEnabled, cache) {
    if (!groqApiKey || !groqFreeEnabled) return [];
    const available = await this.fetchGroqModelCatalog(groqApiKey, groqFreeEnabled, cache);
    const matches = available.length
      ? GROQ_FREE_MODELS.filter((m) => available.includes(m.id))
      : GROQ_FREE_MODELS;
    return matches.map((m) => ({
      id: `groq:${m.id}`,
      name: `⚡ Groq · ${m.label}`,
      provider: 'groq'
    }));
  }

  /** Solo los modelos con precio $0 de Z.ai (ver ZAI_FREE_MODELS). */
  static getZaiModels(zaiApiKey) {
    if (!zaiApiKey) return [];
    return [...ZAI_FREE_MODELS, ZAI_FREE_VISION_MODEL].map((m) => ({
      id: `zai:${m.id}`,
      name: `Z.ai · ${m.label} (gratis)`,
      provider: 'zai'
    }));
  }

  static getCerebrasModels(cerebrasApiKey) {
    if (!cerebrasApiKey) return [];
    return CEREBRAS_FREE_MODELS.map((m) => ({
      id: `cerebras:${m.id}`,
      name: `🧠 Cerebras · ${m.label} (crédito de prueba)`,
      provider: 'cerebras'
    }));
  }

  static getFreeCloudModels(freeCloudEnabled = true) {
    if (!freeCloudEnabled) return [];
    return [
      { id: 'free-cloud:openai', name: '🌐 Nube Gratuita Pública · OpenAI (Sin API Key)', provider: 'free-cloud' },
      { id: 'free-cloud:mistral', name: '🌐 Nube Gratuita Pública · Mistral (Sin API Key)', provider: 'free-cloud' }
    ];
  }

  static async fetchVerifiedOpenRouterFreeModels(openRouterApiKey, cache, signal) {
    if (!openRouterApiKey) return [];
    if (cache && Date.now() - (cache.checkedAt || 0) < OPENROUTER_CATALOG_TTL_MS && cache.models?.length) return cache.models;
    // Pasado el TTL no se sirve la lista vieja si falla la consulta: ADR-014 exige precio $0
    // confirmado y una caché caducada ya no lo confirma.
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${openRouterApiKey}` }, signal: timeoutSignal(8000, signal)
      });
      if (!res.ok) return [];
      const data = await res.json();
      const models = (data.data || [])
        .filter((item) => item.id && /:free$/i.test(item.id) &&
          Number(item.pricing?.prompt) === 0 && Number(item.pricing?.completion) === 0 &&
          !ZERO_COST_OPENROUTER_EXCLUDE.test(item.id))
        .map((item) => ({ id: item.id, name: item.name || item.id }))
        .sort((a, b) => freeModelFamilyRank(a) - freeModelFamilyRank(b));
      if (cache) { cache.checkedAt = Date.now(); cache.models = models; }
      return models;
    } catch { return []; }
  }

  static async getOpenRouterModels(openRouterApiKey, cache) {
    if (!openRouterApiKey) return [];
    const freeModels = (await this.fetchVerifiedOpenRouterFreeModels(openRouterApiKey, cache)).slice(0, 80);
    return [
      { id: 'openrouter:openrouter/free', name: '🆓 OpenRouter: Enrutador gratuito automático', provider: 'openrouter' },
      ...freeModels.map((item) => ({ id: `openrouter:${item.id}`, name: `🆓 OpenRouter: ${item.name || item.id}`, provider: 'openrouter' }))
    ];
  }

  static async fetchXaiModelCatalog(xaiApiKey, cache) {
    if (!xaiApiKey) return [];
    if (Date.now() - (cache?.checkedAt || 0) < 120000 && cache?.ids?.length) return cache.ids;
    try {
      const res = await fetch(`${XAI_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${xaiApiKey}` },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return cache?.ids?.length ? cache.ids : [];
      const data = await res.json();
      const ids = [...new Set((data.data || []).map((item) => item.id).filter((id) => typeof id === 'string'))];
      if (cache) { cache.checkedAt = Date.now(); cache.ids = ids; }
      return ids;
    } catch {
      return cache?.ids?.length ? cache.ids : [];
    }
  }

  static async getXaiModels(xaiApiKey, cache) {
    if (!xaiApiKey) return [];
    const available = await this.fetchXaiModelCatalog(xaiApiKey, cache);
    const matches = available.length
      ? XAI_FALLBACK_MODELS.filter((m) => available.includes(m.id))
      : XAI_FALLBACK_MODELS;
    const list = matches.length ? matches : XAI_FALLBACK_MODELS;
    return list.map((m) => ({
      id: `grok:${m.id}`,
      name: `𝕏 Grok · ${m.label} (xAI · de pago)`,
      provider: 'xai'
    }));
  }

  static async fetchMetaModelCatalog(metaApiKey, cache) {
    if (!metaApiKey) return [];
    if (Date.now() - (cache?.checkedAt || 0) < 120000 && cache?.ids?.length) return cache.ids;
    try {
      const res = await fetch(`${META_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${metaApiKey}` },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return cache?.ids?.length ? cache.ids : [];
      const data = await res.json();
      const chatCapable = new Set(META_FALLBACK_MODELS.map((m) => m.id));
      const ids = [...new Set((data.data || []).map((item) => item.id).filter((id) => typeof id === 'string' && chatCapable.has(id)))];
      if (cache) { cache.checkedAt = Date.now(); cache.ids = ids; }
      return ids;
    } catch {
      return cache?.ids?.length ? cache.ids : [];
    }
  }

  static async getMetaModels(metaApiKey, cache) {
    if (!metaApiKey) return [];
    const available = await this.fetchMetaModelCatalog(metaApiKey, cache);
    const matches = available.length
      ? META_FALLBACK_MODELS.filter((m) => available.includes(m.id))
      : META_FALLBACK_MODELS;
    const list = matches.length ? matches : META_FALLBACK_MODELS;
    return list.map((m) => ({
      id: `meta:${m.id}`,
      name: `🔵 Meta · ${m.label} (de pago)`,
      provider: 'meta'
    }));
  }

  static isOpenCodeFreeId(id = '') {
    return typeof id === 'string' && (id === 'big-pickle' || /-free$/i.test(id));
  }

  static getOpenCodeFreeFallbackIds() {
    return [
      'big-pickle', 'deepseek-v4-flash-free', 'mimo-v2.5-free', 'mimo-v2.6-flash-free',
      'cat-jam-free', 'ling-3.1-flash-free', 'nemotron-3.5-lightning-free', 'ling-3.0-flash-fin-free',
      'longcat-2.5-preview-free', 'space-bunny-free', 'jev-1.13-free', 'step-5-preview-free',
      'muse-spark-1.2-contributor-free', 'muse-spark-1.3-contributor-free',
      'nemotron-3-super-free', 'mimo-v2-omni-free'
    ];
  }

  static async fetchOpenCodeModelCatalog(cache) {
    if (Date.now() - (cache?.checkedAt || 0) < 300000 && cache?.ids?.length) return cache.ids;
    const fallback = this.getOpenCodeFreeFallbackIds();
    try {
      const res = await fetch('https://opencode.ai/zen/v1/models', {
        headers: { 'Accept': 'application/json', 'User-Agent': 'opencode/2.0.3' },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return cache?.ids?.length ? cache.ids : fallback;
      const data = await res.json();
      const ids = [...new Set((data.data || []).map((item) => item.id).filter((id) => this.isOpenCodeFreeId(id)))];
      const resolved = ids.length ? ids : (cache?.ids?.length ? cache.ids : fallback);
      if (cache) { cache.checkedAt = Date.now(); cache.ids = resolved; }
      return resolved;
    } catch {
      return cache?.ids?.length ? cache.ids : fallback;
    }
  }

  static async getOpenCodeModels(cache) {
    const ids = await this.fetchOpenCodeModelCatalog(cache);
    return ids.map((id) => ({ id: `opencode:${id}`, name: `🤖 OpenCode Zen · ${id} (Gratis)`, provider: 'opencode' }));
  }
}

module.exports = { ModelCatalog };
