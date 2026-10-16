/**
 * Nombres de archivo que nunca se adjuntan, leen ni escriben (claves, .env, certificados).
 *
 * Fuente única para el webview (que no puede importar módulos de la extensión) y para
 * src/sensitive-data.js, que lo carga con require. Así las dos capas no divergen.
 * Se evita la subcadena suelta ("token", "secret"): bloqueaba token.service.ts o tokenizer.js.
 */
(function (root) {
  'use strict';
  const SENSITIVE_FILE_NAME = new RegExp([
    '^\\.env(?:\\.(?!(?:example|sample|template|dist|defaults)$)[\\w.-]+)?$',
    '^\\.(?:npmrc|pypirc|netrc|git-credentials|pgpass|htpasswd)$',
    '^id_(?:rsa|dsa|ecdsa|ed25519)$',
    '^(?:secrets?|credentials?)(?:\\.[\\w-]+)?\\.(?:json|ya?ml|toml|ini|env|txt|xml)$',
    '^credentials$',
    '^local\\.properties$',
    '^service[-_]?account.*\\.json$',
    '\\.(?:pem|key|p12|pfx|jks|keystore|kdbx|ppk|asc|gpg)$'
  ].join('|'), 'i');

  const api = { SENSITIVE_FILE_NAME, isSensitiveFileName: (name) => SENSITIVE_FILE_NAME.test(String(name || '').trim()) };
  root.BsclSensitiveNames = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
