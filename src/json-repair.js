/**
 * Reparador y extractor de JSON tolerante a fallos para respuestas de LLMs gratuitos.
 * Portado desde dsl-parser.js de Figma AI Copilot.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */

// Recorre el texto respetando cadenas y escapes. Contar comillas sin más fallaba con `\\"`
// (barra escapada seguida del cierre de la cadena), que se tomaba por una comilla escapada.
function scanStructure(text) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if ((c === '}' && stack.at(-1) === '{') || (c === ']' && stack.at(-1) === '[')) stack.pop();
  }
  return { stack, inString, escaped };
}

function repairTruncatedJson(str) {
  let s = String(str || '').trim();
  if (!s) return '';

  const { inString, escaped } = scanStructure(s);
  if (inString) {
    // Un corte justo después de una barra dejaría el cierre de comillas escapado.
    if (escaped) s = s.slice(0, -1);
    s += '"';
  }

  // Coma colgante o clave sin valor justo antes de cerrar llaves/corchetes.
  s = s.replace(/,\s*$/, '');
  if (/:\s*$/.test(s)) s += 'null';

  const { stack } = scanStructure(s);
  while (stack.length) s += stack.pop() === '{' ? '}' : ']';
  return s;
}

/** Índice de la llave que cierra el objeto que empieza en `start`, o -1 si no se cierra. */
function findBalancedEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function toText(rawContent) {
  return Array.isArray(rawContent)
    ? rawContent.map((part) => part?.text || '').join('\n')
    : String(rawContent || '');
}

function collectCandidates(text) {
  const strict = [];
  const starts = [];
  // Bloques ```json …```. El regex perezoso se corta en el primer ``` que haya DENTRO de una
  // cadena (un README con ```bash), así que solo sirve como candidato estricto: si no parsea
  // tal cual, se prueba el objeto equilibrado que empieza en la misma valla.
  for (const match of text.matchAll(/```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)```/g)) {
    if (match[1]?.trim()) strict.push(match[1].trim());
    // Solo si la llave abre justo tras la valla: una valla que va dentro de una cadena JSON
    // (```\n{}\n``` escapado) no debe ofrecer su `{}` como objeto válido.
    const opening = /^```[a-zA-Z]*\s*\{/.exec(text.slice(match.index, match.index + 40));
    if (opening) starts.push(match.index + opening[0].length - 1);
  }
  const first = text.indexOf('{');
  if (first >= 0) starts.unshift(first);

  for (const start of [...new Set(starts)]) {
    const end = findBalancedEnd(text, start);
    if (end > start) strict.push(text.slice(start, end + 1));
  }

  const last = text.lastIndexOf('}');
  const range = first >= 0 && last > first ? text.slice(first, last + 1) : '';
  if (range) strict.push(range);

  // Para reparar, primero el rango completo y después la cola sin cerrar (salida cortada por
  // límite de tokens: no hay llave ni valla de cierre).
  const tail = first >= 0 ? text.slice(first).replace(/\s*```\s*$/, '') : '';
  const repairable = [range, tail, ...strict].filter(Boolean);
  return { strict: [...new Set(strict)], repairable: [...new Set(repairable)] };
}

/**
 * Extrae el primer objeto JSON de una respuesta de modelo.
 * Devuelve { value, repaired, truncated }:
 *  - repaired: hubo que tocar el texto (comas colgantes o cierres añadidos).
 *  - truncated: hubo que cerrar cadenas, llaves o corchetes; la salida estaba cortada y
 *    cualquier contenido largo (un archivo) puede estar incompleto aunque el JSON parsee.
 * Primero se intenta JSON.parse estricto sobre TODOS los candidatos y solo si ninguno
 * parsea se repara: reparar el primer candidato que falla aceptaba archivos truncados.
 */
function parseJsonResponse(rawContent, { allowRepair = true } = {}) {
  const empty = { value: null, repaired: false, truncated: false };
  const text = toText(rawContent);
  if (!text.trim()) return empty;
  const { strict, repairable } = collectCandidates(text);

  for (const candidate of strict) {
    try { return { value: JSON.parse(candidate), repaired: false, truncated: false }; } catch { /* siguiente */ }
  }
  if (!allowRepair) return empty;

  const cleanedCandidates = repairable.map((candidate) => candidate.replace(/,\s*([}\]])/g, '$1'));
  for (const cleaned of cleanedCandidates) {
    try { return { value: JSON.parse(cleaned), repaired: true, truncated: false }; } catch { /* siguiente */ }
  }
  for (const cleaned of cleanedCandidates) {
    const closed = repairTruncatedJson(cleaned);
    try { return { value: JSON.parse(closed), repaired: true, truncated: true }; } catch { /* siguiente */ }
  }
  return empty;
}

/** Compatibilidad: solo el valor. Usa parseJsonResponse cuando importe saber si se reparó. */
function extractJsonObject(rawContent, options) {
  return parseJsonResponse(rawContent, options).value;
}

module.exports = { repairTruncatedJson, extractJsonObject, parseJsonResponse };
