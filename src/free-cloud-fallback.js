/**
 * Catálogos de cascada gratuita (Gemini 2026, Groq LPU, Cerebras y Nube Gratuita Pública).
 * Inspirado en gemini-provider.js y free-cloud.js de Figma AI Copilot.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
const { timeoutSignal, cancellationError, throwIfCancelled } = require('./provider-cooldown');

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
  // Sin "1M tok/día": según ADR-017 esa cifra ya no corresponde a la página de precios de Cerebras.
  { id: 'llama-3.3-70b', label: 'Llama 3.3 70B (2600 t/s)' },
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

// Z.ai (Zhipu, GLM): modelos con precio $0 en entrada y salida según
// https://docs.z.ai/guides/overview/pricing (comprobado el 2026-10-17). Ojo: los "FlashX" y
// GLM-5.3-Flash COBRAN; solo estos tres son gratis. Z.ai no publica un endpoint para listar
// modelos, así que la lista va fija y «Probar conexiones» la confirma con una petición de 1 token.
const ZAI_BASE_URL = 'https://api.z.ai/api/paas/v4';
const ZAI_FREE_MODELS = [
  { id: 'glm-4.7-flash', label: 'GLM-4.7-Flash' },
  { id: 'glm-4.5-flash', label: 'GLM-4.5-Flash' }
];
const ZAI_FREE_VISION_MODEL = { id: 'glm-4.6v-flash', label: 'GLM-4.6V-Flash (visión)' };
const ZAI_FREE_IDS = new Set([...ZAI_FREE_MODELS, ZAI_FREE_VISION_MODEL].map((m) => m.id));

// Marcas con las que el host y los agentes introducen datos del proyecto o del editor. La UI
// promete que la Nube Pública (Pollinations, servicio público sin clave) nunca los recibe.
const CONTEXT_MARKERS = [
  '[Contexto del Editor Activo',
  'CONTEXTO DEL WORKSPACE',
  'CONTEXTO DEL PROYECTO',
  'CONTEXTO DEL EDITOR',
  'CONTEXTO REAL DEL WORKSPACE',
  '[CONTEXTO REAL DE LA CARPETA',
  'CONTEXTO INICIAL ADJUNTO',
  '[ARCHIVO ADJUNTO',
  '[Carpeta de proyecto activa',
  '[Inventario de la carpeta',
  // BrainContext añade al final del prompt base (antes del contexto del editor) hasta 1500
  // caracteres de una nota local del vault del usuario.
  '[Nota de referencia de Obsidian'
];
// Solo el chat directo puede ir a la Nube Pública. Los agentes (coder, architect, qa, critic,
// subagent, planner, researcher…) arman prompts con código o rutas del proyecto y cada uno lo
// etiqueta a su manera: la lista de marcas nunca estará completa para ellos.
const CHAT_ROLE_HINTS = new Set(['', 'chat', 'general']);

function messageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (p?.type === 'text' ? p.text || '' : '')).join('\n');
  return String(content || '');
}

function firstMarkerIndex(text) {
  const positions = CONTEXT_MARKERS.map((marker) => text.indexOf(marker)).filter((index) => index >= 0);
  return positions.length ? Math.min(...positions) : -1;
}

/** Motivo por el que una conversación no puede ir a la Nube Pública, o '' si puede. */
function publicCloudBlockReason(messages = [], roleHint = '') {
  if (!CHAT_ROLE_HINTS.has(String(roleHint || ''))) return `tarea del agente «${roleHint}», que usa datos del proyecto`;
  const marker = CONTEXT_MARKERS.find((item) => messages.some((m) => messageText(m?.content).includes(item)));
  return marker ? `la conversación lleva contexto del workspace o del editor (${marker}…)` : '';
}

/**
 * Quita del system prompt el contexto que añade el host (editor activo, carpeta, inventario).
 * El host lo concatena al final del prompt base, así que se corta en la primera marca: si
 * alguna vez va en medio, se pierde de más, nunca de menos.
 */
function stripSystemContext(messages = []) {
  return messages.map((m) => {
    if (m?.role !== 'system') return m;
    const text = messageText(m.content);
    const cut = firstMarkerIndex(text);
    return cut < 0 ? m : { ...m, content: text.slice(0, cut).trimEnd() };
  }).filter((m) => m?.role !== 'system' || messageText(m.content).trim());
}

/**
 * Lo único que Automático manda a la Nube Pública: los system recortados y el último mensaje
 * del usuario. El historial no viaja porque el contexto del editor llega en el system prompt de
 * cada turno sin dejar marca en el historial, pero las respuestas guardadas del asistente
 * suelen citar ese código: un «gracias» en el turno siguiente lo publicaba entero.
 */
function lastTurnOnly(messages = []) {
  const stripped = stripSystemContext(messages);
  const lastUser = [...stripped].reverse().find((m) => m?.role === 'user');
  return [...stripped.filter((m) => m?.role === 'system'), ...(lastUser ? [lastUser] : [])];
}

async function callFreeCloudDirect(messages = [], preferredModel = 'openai', timeoutMs = 35000, signal) {
  const normalizedMessages = messages.map((msg) => ({
    role: ['system', 'user', 'assistant'].includes(msg?.role) ? msg.role : 'user',
    content: messageText(msg?.content)
  }));
  // Última barrera: aunque un llamador futuro se salte las comprobaciones de AiClient, el
  // contexto del workspace no sale hacia el servicio público.
  const blocked = publicCloudBlockReason(normalizedMessages);
  if (blocked) throw new Error(`La Nube Pública no recibe contexto del workspace ni del editor: ${blocked}.`);

  const modelsToTry = preferredModel === 'mistral' ? ['mistral', 'openai'] : ['openai', 'mistral'];
  let lastErr = null;
  for (const model of modelsToTry) {
    throwIfCancelled(signal);
    try {
      const res = await fetch('https://text.pollinations.ai/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: normalizedMessages,
          model,
          seed: Math.floor(Math.random() * 100000)
        }),
        signal: timeoutSignal(timeoutMs, signal)
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
      if (signal?.aborted) throw cancellationError(signal);
      lastErr = err;
    }
  }
  throw lastErr || new Error('La Nube Gratuita Pública no respondió.');
}

module.exports = {
  GEMINI_2026_MODELS,
  GROQ_FREE_MODELS,
  ZAI_BASE_URL,
  ZAI_FREE_MODELS,
  ZAI_FREE_VISION_MODEL,
  ZAI_FREE_IDS,
  CEREBRAS_FREE_MODELS,
  FREE_CLOUD_MODELS,
  CONTEXT_MARKERS,
  geminiModelsForRole,
  groqModelsForRole,
  publicCloudBlockReason,
  stripSystemContext,
  lastTurnOnly,
  callFreeCloudDirect
};
