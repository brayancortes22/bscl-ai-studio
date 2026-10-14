/**
 * Descubrimiento y clasificación de modelos gratuitos para BSCL AI Studio.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
const { GEMINI_2026_MODELS, GROQ_FREE_MODELS, CEREBRAS_FREE_MODELS } = require('./free-cloud-fallback');

const ZERO_COST_OPENROUTER_EXCLUDE = /embed|rerank|moderation|transcri/i;
const SAFE_ROUTER_ID = /^router:(?:openrouter\/(?:openrouter\/free|[^\s]+:free)|gemini\/|groq\/|cerebras\/|free-cloud\/)/i;
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
  static isSafeRouterId(id = '') {
    return SAFE_ROUTER_ID.test(id);
  }

  static async getLocalModels(ollamaUrl) {
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
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

  static async fetchGroqModelCatalog(groqApiKey, groqFreeEnabled, cache) {
    if (!groqApiKey || !groqFreeEnabled) return [];
    if (Date.now() - cache.checkedAt < 120000 && cache.ids.length) return cache.ids;
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${groqApiKey}` },
        signal: AbortSignal.timeout(5000)
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

  static getCerebrasModels(cerebrasApiKey) {
    if (!cerebrasApiKey) return [];
    return CEREBRAS_FREE_MODELS.map((m) => ({
      id: `cerebras:${m.id}`,
      name: `🧠 Cerebras · ${m.label}`,
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

  static async fetchVerifiedOpenRouterFreeModels(openRouterApiKey) {
    if (!openRouterApiKey) return [];
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${openRouterApiKey}` }, signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || [])
        .filter((item) => item.id && /:free$/i.test(item.id) &&
          Number(item.pricing?.prompt) === 0 && Number(item.pricing?.completion) === 0 &&
          !ZERO_COST_OPENROUTER_EXCLUDE.test(item.id))
        .map((item) => ({ id: item.id, name: item.name || item.id }))
        .sort((a, b) => freeModelFamilyRank(a) - freeModelFamilyRank(b));
    } catch { return []; }
  }

  static async getOpenRouterModels(openRouterApiKey) {
    if (!openRouterApiKey) return [];
    const freeModels = (await this.fetchVerifiedOpenRouterFreeModels(openRouterApiKey)).slice(0, 80);
    return [
      { id: 'openrouter:openrouter/free', name: '🆓 OpenRouter: Enrutador gratuito automático', provider: 'openrouter' },
      ...freeModels.map((item) => ({ id: `openrouter:${item.id}`, name: `🆓 OpenRouter: ${item.name || item.id}`, provider: 'openrouter' }))
    ];
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
