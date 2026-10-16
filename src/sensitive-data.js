/**
 * Detección de archivos sensibles y redacción de secretos antes de enviar texto a un modelo.
 *
 * Por qué un módulo único: el mismo regex estaba copiado en cinco archivos y fallaba en
 * los dos sentidos. Redactaba código normal (`if (password === confirm)`, `token => …`,
 * `const token = getToken()`) y dejaba pasar claves reales (`OPENAI_KEY=sk-…`, bloques
 * PEM, credenciales dentro de URLs). Aquí solo se redactan valores LITERALES (cadenas
 * entre comillas o tokens con formato reconocible), nunca expresiones de código.
 */
const path = require('path');

const REDACTED = '[REDACTADO]';

// El patrón de nombres vive en webview/sensitive-names.js para que el webview (que no
// puede importar módulos de la extensión) y la extensión apliquen exactamente la misma regla.
const { SENSITIVE_FILE_NAME: SENSITIVE_NAME } = require('../webview/sensitive-names');

const SENSITIVE_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker']);

function isSensitiveFileName(name) {
  return SENSITIVE_NAME.test(String(name || '').trim());
}

/** Ruta relativa o absoluta: mira el nombre y las carpetas que la contienen. */
function isSensitivePath(filePath) {
  const parts = String(filePath || '').split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return false;
  if (parts.slice(0, -1).some((part) => SENSITIVE_DIRS.has(part.toLowerCase()))) return true;
  return isSensitiveFileName(parts[parts.length - 1]);
}

// ---------- Redacción ----------

const SECRET_WORD = '(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|private[_-]?key|access[_-]?key|client[_-]?secret|auth[_-]?token|credentials?)';

const RULES = [
  // Bloques de clave privada completos.
  {
    pattern: /-----BEGIN ((?:[A-Z]+ )*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
    replace: () => `-----BEGIN PRIVATE KEY-----\n${REDACTED}\n-----END PRIVATE KEY-----`
  },
  // Credenciales dentro de una URL: esquema://usuario:contraseña@host
  { pattern: /\b([a-z][\w+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi, replace: (all, before, secret, at) => `${before}${REDACTED}${at}` },
  // Tokens con formato reconocible, estén donde estén.
  {
    pattern: new RegExp([
      '\\bAKIA[0-9A-Z]{16}\\b',
      '\\bgh[pousr]_[A-Za-z0-9]{30,}\\b',
      '\\bgithub_pat_[A-Za-z0-9_]{40,}\\b',
      '\\bsk-(?:proj-|or-v1-|ant-)?[A-Za-z0-9_-]{20,}\\b',
      '\\bAIza[0-9A-Za-z_-]{35}\\b',
      '\\bxox[abprs]-[A-Za-z0-9-]{10,}\\b',
      '\\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\\b',
      '\\bgsk_[A-Za-z0-9]{20,}\\b',
      '\\bxai-[A-Za-z0-9]{20,}\\b',
      '\\bhf_[A-Za-z0-9]{30,}\\b',
      '\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b'
    ].join('|'), 'g'),
    replace: () => REDACTED
  },
  // Variables de entorno: NOMBRE_CON_KEY=valor (estilo .env / shell).
  {
    pattern: /^(\s*(?:export\s+)?[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIALS?)[A-Z0-9_]*\s*=\s*)(?!\$|\s*$)(["']?)([^\r\n"']+)\2\s*$/gm,
    replace: (all, before, quote) => `${before}${quote}${REDACTED}${quote}`
  },
  // Asignaciones o claves JSON/YAML con nombre de secreto y valor literal entre comillas.
  // `=(?![=>])` evita comparaciones (===) y funciones flecha (=>).
  {
    pattern: new RegExp(`((["']?)[\\w.-]*${SECRET_WORD}[\\w.-]*\\2\\s*(?:=(?![=>])|:)\\s*)(["'\`])([^"'\`\\r\\n]{6,})\\3`, 'gi'),
    replace: (all, before, nameQuote, quote) => `${before}${quote}${REDACTED}${quote}`
  }
];

// YAML/INI/properties sin comillas: `password: hunter22`. Solo en archivos de
// configuración: en código, `token: this.token` o `password = nueva` son expresiones.
// No toca referencias (${…}, {{…}}).
const CONFIG_RULE = {
  pattern: new RegExp(`^(\\s*[\\w.-]*${SECRET_WORD}[\\w.-]*\\s*[:=]\\s*)([^\\s#'"\`$({\\[][^\\s#]{5,})\\s*$`, 'gim'),
  replace: (all, before) => `${before}${REDACTED}`
};
const CONFIG_FILE = /(?:^\.env(?:\..+)?|\.(?:ya?ml|ini|properties|cfg|conf|toml|env))$/i;

/**
 * Devuelve el texto con los secretos sustituidos por [REDACTADO].
 * Es deliberadamente conservador con el código: solo reemplaza literales.
 * `fileName` activa además la regla de valores sin comillas en archivos de configuración.
 */
function redactSecrets(text, { fileName = '' } = {}) {
  let output = String(text ?? '');
  for (const rule of RULES) output = output.replace(rule.pattern, rule.replace);
  if (CONFIG_FILE.test(path.basename(String(fileName || '')))) output = output.replace(CONFIG_RULE.pattern, CONFIG_RULE.replace);
  return output;
}

function containsSecrets(text, options) {
  return redactSecrets(text, options) !== String(text ?? '');
}

/** Texto apto para enviar a un modelo: null si el archivo es sensible, redactado si no. */
function safeFileContent(filePath, content) {
  if (isSensitivePath(filePath)) return null;
  return redactSecrets(content, { fileName: filePath });
}

module.exports = {
  REDACTED,
  isSensitiveFileName,
  isSensitivePath,
  redactSecrets,
  containsSecrets,
  safeFileContent,
  basename: (filePath) => path.basename(String(filePath || ''))
};
