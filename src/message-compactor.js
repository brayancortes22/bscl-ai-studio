/**
 * Utilidades de compactación de contexto y lectura de cabeceras de cuota.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
const { LocalModelManager } = require('./local-model-manager');

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

function summarizeProviderError(value) {
  const message = String(value || 'sin detalles')
    .replace(/The operation was aborted due to timeout|operation timed out|request timed out|timeout/gi, 'se agotó el tiempo de espera')
    .replace(/Failed to fetch|fetch failed/gi, 'no se pudo conectar con el servicio')
    .replace(/aborted/gi, 'solicitud cancelada');
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [oculto]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[clave Google oculta]')
    .replace(/(?:sk-or-v1-|sk-|gsk_|csk-)[A-Za-z0-9_-]{12,}/gi, '[clave oculta]')
    .replace(/\s+/g, ' ')
    .slice(0, 360);
}

function parseDurationMs(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/g)];
  if (parts.length) {
    return parts.reduce((sum, part) => sum + Number(part[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[part[2]]), 0);
  }
  const seconds = Number(text);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

function readQuotaHeaders(headers) {
  if (!headers?.get) return null;
  const readNumber = (name) => {
    const value = headers.get(name);
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const quota = {
    requestsRemaining: readNumber('x-ratelimit-remaining-requests'),
    tokensRemaining: readNumber('x-ratelimit-remaining-tokens'),
    requestsResetMs: parseDurationMs(headers.get('x-ratelimit-reset-requests')),
    tokensResetMs: parseDurationMs(headers.get('x-ratelimit-reset-tokens'))
  };
  return Object.values(quota).some((value) => value != null) ? quota : null;
}

function retryDelayFromBody(error) {
  for (const detail of Array.isArray(error?.details) ? error.details : []) {
    const delay = parseDurationMs(detail?.retryDelay || detail?.retry_after || detail?.retryAfter);
    if (delay) return delay;
  }
  return null;
}

function trimAround(content, length) {
  if (content.length <= length) return content;
  if (length < 80) return content.slice(0, length);
  const start = Math.ceil(length * 0.58);
  const end = length - start;
  return `${content.slice(0, start)}\n[… contexto reducido por memoria disponible …]\n${content.slice(-end)}`;
}

function compactMessages(messages, maxChars = 24000, maxSystem = 5000, maxUser = 12000) {
  const asText = (content) => (typeof content === 'string' ? content : JSON.stringify(content || ''));
  const kept = new Map();
  let remaining = maxChars;
  const systemIndexes = messages.map((m, i) => (m.role === 'system' ? i : -1)).filter((i) => i >= 0);
  const lastUserIndex = messages.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0).at(-1);
  for (const index of systemIndexes) {
    const slice = asText(messages[index].content).slice(0, Math.min(maxSystem, remaining));
    kept.set(index, slice);
    remaining -= slice.length;
  }
  if (lastUserIndex != null && remaining > 0) {
    const slice = trimAround(asText(messages[lastUserIndex].content), Math.min(maxUser, remaining));
    kept.set(lastUserIndex, slice);
    remaining -= slice.length;
  }
  for (let index = messages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    if (kept.has(index) || systemIndexes.includes(index)) continue;
    const slice = trimAround(asText(messages[index].content), Math.min(2500, remaining));
    if (slice) { kept.set(index, slice); remaining -= slice.length; }
  }
  return messages.map((m, i) => (kept.has(i) ? { role: m.role, content: kept.get(i) } : null)).filter(Boolean);
}

function compactLocalMessages(messages) {
  const limit = LocalModelManager.maxInputChars();
  return compactMessages(messages, limit, 2200, Math.max(1200, Math.floor(limit * 0.72)));
}

module.exports = {
  isLoopbackUrl,
  summarizeProviderError,
  parseDurationMs,
  readQuotaHeaders,
  retryDelayFromBody,
  trimAround,
  compactMessages,
  compactLocalMessages
};
