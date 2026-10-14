/**
 * Reparador y extractor de JSON tolerante a fallos para respuestas de LLMs gratuitos.
 * Portado desde dsl-parser.js de Figma AI Copilot.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */

function repairTruncatedJson(str) {
  let s = String(str || '').trim();
  if (!s) return '';

  let quotes = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) quotes += 1;
  }
  if (quotes % 2 !== 0) s += '"';

  // Limpiar coma colgante al final antes de cerrar llaves/corchetes
  s = s.replace(/,\s*$/, '');

  const stack = [];
  let inStr = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '"' && (i === 0 || s[i - 1] !== '\\')) inStr = !inStr;
    if (!inStr) {
      if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' && stack.length && stack[stack.length - 1] === '{') stack.pop();
      else if (c === ']' && stack.length && stack[stack.length - 1] === '[') stack.pop();
    }
  }

  while (stack.length) {
    const openChar = stack.pop();
    s += openChar === '{' ? '}' : ']';
  }
  return s;
}

function extractJsonObject(rawContent) {
  const text = Array.isArray(rawContent)
    ? rawContent.map((part) => part?.text || '').join('\n')
    : String(rawContent || '');
  if (!text.trim()) return null;

  const candidates = [];
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) candidates.push(fencedMatch[1].trim());

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    candidates.push(text.slice(start, end + 1));
  } else if (start >= 0) {
    candidates.push(text.slice(start));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        const cleaned = candidate.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(repairTruncatedJson(cleaned));
      } catch {
        // Probar siguiente candidato
      }
    }
  }
  return null;
}

module.exports = { repairTruncatedJson, extractJsonObject };
