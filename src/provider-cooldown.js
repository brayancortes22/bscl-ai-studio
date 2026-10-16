/**
 * Enfriamiento por proveedor/modelo, cupos de concurrencia y utilidades de cancelación
 * compartidas por la cascada de BSCL AI Studio.
 */
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const MIN_RETRY_AFTER_MS = 15 * 1000;
// Lo que no contesta a tiempo hace esperar su timeout entero en cada intento: 30-45 s el modelo
// que tarda en generar (se enfría solo ese modelo) o ~10 s el proveedor al que no se llega a
// conectar (se enfría el proveedor, ver provider-cascade.js). Este enfriamiento supera el plazo
// global de sendMessage (170 s, ai-client.js) para que la siguiente llamada del enjambre no
// vuelva a pagar la misma espera.
const UNRESPONSIVE_COOLDOWN_MS = 3 * 60 * 1000;
const DEADLINE_CODE = 'BSCL_DEADLINE';
// Fallos en los que no se llegó a hablar con el servidor: valen para todos los modelos del
// proveedor. Comprobado con una sonda local en Node 25.8: conexión rechazada → cause.code
// ECONNREFUSED (también en el AggregateError de localhost), DNS → ENOTFOUND, IP que no contesta
// → UND_ERR_CONNECT_TIMEOUT a los ~10 s. El timeout por petición llega en cambio como
// TimeoutError sin cause: la conexión se hizo y el modelo tardó en generar.
const CONNECTION_FAILURE_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH',
  'ENETUNREACH', 'ENETDOWN', 'EHOSTDOWN', 'UND_ERR_CONNECT_TIMEOUT',
  // Un proxy corporativo que intercepta TLS rompe igual todos los modelos del proveedor.
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'
]);

/** Código útil de un rechazo de fetch: el de la causa de undici o, si no hay, el nombre del error. */
function fetchFailureCode(error) {
  const cause = error?.cause;
  // DOMException trae un code numérico heredado (23 para TimeoutError) que no dice nada.
  return cause?.code || cause?.errors?.find((item) => item?.code)?.code ||
    (typeof error?.code === 'string' ? error.code : '') || error?.name || '';
}

function isConnectionFailureCode(code) {
  return CONNECTION_FAILURE_CODES.has(String(code || ''));
}

function classifyFailure(error) {
  const message = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  // El mensaje llega resumido a 360 caracteres; el tipo de cuota (p. ej. el quotaId
  // "GenerateRequestsPerDayPerProjectPerModel" de Gemini) va en los detalles del cuerpo.
  const details = String(error?.rawDetails || '').toLowerCase();
  const status = Number(error?.status || message.match(/http\s+(\d{3})/)?.[1] || 0);

  if (status === 404 || /not found|does not exist|model.*not.*available/.test(message)) {
    return { reason: 'modelo no disponible en esta cuenta', cooldownMs: 10 * 60 * 1000 };
  }
  if (status === 429 || /quota|resource_exhausted|rate.?limit|too many requests/.test(message)) {
    const daily = /per day|daily|requests per day|\brpd\b|quota.*day|day.*quota/.test(message) || /per_?day|per day/.test(details);
    const perMinute = /per minute|requests per minute|tokens per minute|\brpm\b|\btpm\b/.test(message) || /per_?minute|per minute/.test(details);
    return {
      reason: daily ? 'cuota diaria agotada' : 'cuota o límite de solicitudes',
      cooldownMs: daily ? 24 * 60 * 60 * 1000 : perMinute ? 60 * 1000 : 3 * 60 * 1000,
      daily
    };
  }
  if ([401, 403].includes(status) || /unauthorized|permission denied|invalid api.?key|authentication/.test(message)) {
    return { reason: 'clave o permisos', cooldownMs: 10 * 60 * 1000 };
  }
  if (status >= 500) {
    return { reason: 'servicio temporalmente no disponible', cooldownMs: 45 * 1000 };
  }
  if (/timeout|tiempo de espera/.test(message)) {
    return { reason: 'el servicio no respondió a tiempo', cooldownMs: UNRESPONSIVE_COOLDOWN_MS };
  }
  // Conexión rechazada o DNS: falla en milisegundos, así que reintentar pronto sale barato.
  if (/aborted|cancelled|failed to fetch|fetch failed|no se pudo conectar|econnrefused|enotfound|econnreset/.test(message)) {
    return { reason: 'servicio temporalmente no disponible', cooldownMs: 45 * 1000 };
  }
  return { reason: 'fallo reciente del proveedor', cooldownMs: 90 * 1000 };
}

function retryAfterFromError(error) {
  const value = Number(error?.retryAfterMs);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, value));
}

/** Plazo propio de una petición combinado con la señal de la llamada (cancelación o plazo global). */
function timeoutSignal(timeoutMs, signal) {
  const own = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([own, signal]) : own;
}

function deadlineError(deadlineMs) {
  const error = new Error(`Se agotó el plazo total de ${Math.round(deadlineMs / 1000)} s para esta solicitud; se detuvo la cascada de proveedores.`);
  error.name = 'TimeoutError';
  error.code = DEADLINE_CODE;
  return error;
}

/**
 * Error que se propaga cuando la llamada se canceló o venció su plazo global. Se distingue por
 * el motivo de la señal: el plazo global aborta con deadlineError; cualquier otro motivo es una
 * cancelación del usuario.
 */
function cancellationError(signal) {
  const reason = signal?.reason;
  if (reason?.code === DEADLINE_CODE) return reason;
  const error = new Error('Solicitud cancelada.');
  error.name = 'AbortError';
  return error;
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancellationError(signal);
}

class ProviderCooldown {
  constructor() {
    this.entries = new Map();
    this.active = new Map();
    this.waiters = new Map();
  }

  async acquire(provider, maxConcurrent = 1, signal) {
    throwIfCancelled(signal);
    const active = this.active.get(provider) || 0;
    if (active < maxConcurrent) {
      this.active.set(provider, active + 1);
      return this.createRelease(provider);
    }
    // Quien espera turno también debe poder irse: sin esto, una llamada cancelada seguía en la
    // cola hasta que otra liberara el cupo.
    await new Promise((resolve, reject) => {
      const queue = this.waiters.get(provider) || [];
      const onAbort = () => {
        const current = this.waiters.get(provider) || [];
        const index = current.indexOf(grant);
        if (index >= 0) current.splice(index, 1);
        if (!current.length) this.waiters.delete(provider);
        reject(cancellationError(signal));
      };
      const grant = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      queue.push(grant);
      this.waiters.set(provider, queue);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    return this.createRelease(provider);
  }

  tryAcquire(provider, maxConcurrent = 1) {
    const active = this.active.get(provider) || 0;
    const queue = this.waiters.get(provider) || [];
    if (active >= maxConcurrent || queue.length) return null;
    this.active.set(provider, active + 1);
    return this.createRelease(provider);
  }

  createRelease(provider) {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const queue = this.waiters.get(provider) || [];
      const next = queue.shift();
      if (next) {
        if (!queue.length) this.waiters.delete(provider);
        next();
        return;
      }
      const active = (this.active.get(provider) || 1) - 1;
      if (active > 0) this.active.set(provider, active);
      else this.active.delete(provider);
    };
  }

  get(provider) {
    const entry = this.entries.get(provider);
    if (!entry) return null;
    const retryInMs = entry.until - Date.now();
    if (retryInMs <= 0) {
      this.entries.delete(provider);
      return null;
    }
    return { reason: entry.reason, retryInMs };
  }

  recordFailure(provider, error) {
    const failure = classifyFailure(error);
    const retryAfterMs = retryAfterFromError(error);
    // La cabecera Retry-After la calcula el proveedor para esta cuenta y se respeta tal cual.
    // El retryDelay del cuerpo es solo una pista: según el hallazgo PROV-9 (no comprobado en
    // vivo), Gemini lo manda con unos segundos aunque lo agotado sea la cuota diaria, y entonces
    // no puede acortar el enfriamiento diario.
    const bodyHintOnDaily = failure.daily && error?.retryAfterSource === 'body';
    const cooldownMs = bodyHintOnDaily
      ? Math.max(retryAfterMs || 0, failure.cooldownMs)
      : (retryAfterMs || failure.cooldownMs);
    const now = Date.now();
    const previous = this.entries.get(provider);
    const until = Math.max(previous?.until || 0, now + cooldownMs);
    const reason = previous?.until > now + cooldownMs ? previous.reason : failure.reason;
    const entry = { reason, until };
    this.entries.set(provider, entry);
    return { reason: entry.reason, retryInMs: until - now };
  }

  recordQuota(provider, quota) {
    if (!quota) return null;
    const exhausted = [];
    if (quota.requestsRemaining === 0) exhausted.push(quota.requestsResetMs);
    if (quota.tokensRemaining === 0) exhausted.push(quota.tokensResetMs);
    if (!exhausted.length) return null;

    const resetMs = Math.max(...exhausted.filter((value) => Number.isFinite(value) && value > 0));
    const cooldownMs = Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS,
      Number.isFinite(resetMs) ? resetMs : 3 * 60 * 1000));
    const now = Date.now();
    const previous = this.entries.get(provider);
    const until = Math.max(previous?.until || 0, now + cooldownMs);
    const entry = { reason: 'cuota reportada como agotada', until };
    this.entries.set(provider, entry);
    return { reason: entry.reason, retryInMs: until - now };
  }

  /** Borra una sola entrada. clear() barre también los modelos del proveedor, que no viene al caso. */
  forget(key) {
    this.entries.delete(key);
  }

  clear(providerPrefix) {
    for (const key of [...this.entries.keys()]) {
      if (key === providerPrefix || key.startsWith(`${providerPrefix}:`)) {
        this.entries.delete(key);
      }
    }
  }
}

module.exports = {
  ProviderCooldown,
  classifyFailure,
  timeoutSignal,
  deadlineError,
  cancellationError,
  throwIfCancelled,
  fetchFailureCode,
  isConnectionFailureCode,
  UNRESPONSIVE_COOLDOWN_MS
};
