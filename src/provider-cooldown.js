const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const MIN_RETRY_AFTER_MS = 15 * 1000;

function classifyFailure(error) {
  const message = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  const status = Number(error?.status || message.match(/http\s+(\d{3})/)?.[1] || 0);

  if (status === 404 || /not found|does not exist|model.*not.*available/.test(message)) {
    return { reason: 'modelo no disponible en esta cuenta', cooldownMs: 10 * 60 * 1000 };
  }
  if (status === 429 || /quota|resource_exhausted|rate.?limit|too many requests/.test(message)) {
    const daily = /per day|daily|requests per day|\brpd\b|quota.*day|day.*quota/.test(message);
    const perMinute = /per minute|requests per minute|tokens per minute|\brpm\b|\btpm\b/.test(message);
    return {
      reason: daily ? 'cuota diaria agotada' : 'cuota o límite de solicitudes',
      cooldownMs: daily ? 24 * 60 * 60 * 1000 : perMinute ? 60 * 1000 : 3 * 60 * 1000
    };
  }
  if ([401, 403].includes(status) || /unauthorized|permission denied|invalid api.?key|authentication/.test(message)) {
    return { reason: 'clave o permisos', cooldownMs: 10 * 60 * 1000 };
  }
  if (status >= 500 || /timeout|tiempo de espera|aborted|cancelled|failed to fetch|no se pudo conectar/.test(message)) {
    return { reason: 'servicio temporalmente no disponible', cooldownMs: 45 * 1000 };
  }
  return { reason: 'fallo reciente del proveedor', cooldownMs: 90 * 1000 };
}

function retryAfterFromError(error) {
  const value = Number(error?.retryAfterMs);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, value));
}

class ProviderCooldown {
  constructor() {
    this.entries = new Map();
    this.active = new Map();
    this.waiters = new Map();
  }

  async acquire(provider, maxConcurrent = 1) {
    const active = this.active.get(provider) || 0;
    if (active < maxConcurrent) {
      this.active.set(provider, active + 1);
      return this.createRelease(provider);
    }
    await new Promise((resolve) => {
      const queue = this.waiters.get(provider) || [];
      queue.push(resolve);
      this.waiters.set(provider, queue);
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
    const cooldownMs = retryAfterMs || failure.cooldownMs;
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

  clear(providerPrefix) {
    for (const key of [...this.entries.keys()]) {
      if (key === providerPrefix || key.startsWith(`${providerPrefix}:`)) {
        this.entries.delete(key);
      }
    }
  }
}

module.exports = { ProviderCooldown };
