/**
 * Catálogos de cascada gratuita (Gemini 2026, Groq LPU, Cerebras y Nube Gratuita Pública).
 * Inspirado en gemini-provider.js y free-cloud.js de Figma AI Copilot.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */

const GEMINI_2026_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-3.8-flash'
];

const GROQ_FREE_MODELS = [
  { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (Código & Razonamiento)' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (Flagship MoE)' },
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile (500 t/s)' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (1000 t/s · Agentes rápidos)' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (14.4k RPD)' }
];

const CEREBRAS_FREE_MODELS = [
  { id: 'llama-3.3-70b', label: 'Llama 3.3 70B (2600 t/s · 1M tok/día)' },
  { id: 'llama3.1-8b', label: 'Llama 3.1 8B Instant (Cerebras)' }
];

const FREE_CLOUD_MODELS = ['openai', 'mistral'];

function geminiModelsForRole(roleHint = '', availableIds = []) {
  const ordered = (roleHint === 'planner' || roleHint === 'subagent')
    ? ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-3.8-flash']
    : (roleHint === 'coder' || roleHint === 'architect')
      ? ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.0-flash']
      : GEMINI_2026_MODELS;
  if (!availableIds.length) return ordered;
  const matched = ordered.filter((id) => availableIds.includes(id));
  return matched.length ? matched : ordered;
}

function groqModelsForRole(roleHint = '', availableIds = []) {
  const ids = GROQ_FREE_MODELS.map((m) => m.id);
  const ordered = (roleHint === 'planner' || roleHint === 'subagent')
    ? ['openai/gpt-oss-20b', 'llama-3.1-8b-instant', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile']
    : ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
  if (!availableIds.length) return ordered;
  const matched = ordered.filter((id) => availableIds.includes(id));
  return matched.length ? matched : ids.filter((id) => availableIds.includes(id));
}

async function callFreeCloudDirect(messages = [], preferredModel = 'openai', timeoutMs = 35000) {
  const normalizedMessages = messages.map((msg) => ({
    role: ['system', 'user', 'assistant'].includes(msg?.role) ? msg.role : 'user',
    content: typeof msg?.content === 'string'
      ? msg.content
      : Array.isArray(msg?.content)
        ? msg.content.map((p) => (p?.type === 'text' ? p.text : '')).filter(Boolean).join('\n')
        : String(msg?.content || '')
  }));

  const modelsToTry = preferredModel === 'mistral' ? ['mistral', 'openai'] : ['openai', 'mistral'];
  let lastErr = null;
  for (const model of modelsToTry) {
    try {
      const res = await fetch('https://text.pollinations.ai/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: normalizedMessages,
          model,
          seed: Math.floor(Math.random() * 100000)
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text && text.length >= 2) {
          return {
            content: text,
            model: `free-cloud:${model}`,
            provider: `Nube Gratuita Pública (${model.toUpperCase()} · Sin API Key)`
          };
        }
      } else {
        lastErr = new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('La Nube Gratuita Pública no respondió.');
}

module.exports = {
  GEMINI_2026_MODELS,
  GROQ_FREE_MODELS,
  CEREBRAS_FREE_MODELS,
  FREE_CLOUD_MODELS,
  geminiModelsForRole,
  groqModelsForRole,
  callFreeCloudDirect
};
