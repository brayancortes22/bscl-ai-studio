const vscode = require('vscode');
const { GEMINI_2026_MODELS, GROQ_FREE_MODELS } = require('./free-cloud-fallback');

// Claves que se guardan en SecretStorage. Las de proveedores ya retirados de la UI
// (SambaNova, API personalizada, servidor OpenCode, Cerebras) se conservan si existían,
// pero solo se pueden borrar: no se vuelven a pedir.
const SECRET_KEYS = [
  'geminiApiKey', 'groqApiKey', 'openRouterApiKey', 'xaiApiKey', 'metaApiKey',
  'sambanovaApiKey', 'cerebrasApiKey', 'customApiKey', 'openCodePassword'
];
// Las que el webview puede ver (configurada sí/no y últimos 4 caracteres) y cambiar.
const EDITABLE_SECRETS = new Set(['geminiApiKey', 'groqApiKey', 'openRouterApiKey', 'xaiApiKey', 'metaApiKey']);
const LEGACY_SECRET_LABELS = { cerebrasApiKey: 'Cerebras', sambanovaApiKey: 'SambaNova', customApiKey: 'API personalizada', openCodePassword: 'servidor OpenCode' };

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_ROUTER_URL = 'http://localhost:3000';

function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(String(value || '').trim()).protocol); } catch { return false; }
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

class SettingsValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

class ConfigManager {
  constructor(context) {
    this.context = context;
    this.storageKey = 'bscl_ai_api_credentials';
    this.secretPrefix = 'bscl_ai_secret_';
    this.migration = null;
  }

  /**
   * Las URLs locales solo se leen de los ajustes de USUARIO. Por qué: un repositorio
   * podía fijar bsclAi.smartRouterUrl en su .vscode/settings.json y desviar todas las
   * conversaciones (con código del workspace) a un servidor ajeno.
   */
  readUserSetting(key, fallback) {
    const inspected = vscode.workspace.getConfiguration('bsclAi').inspect?.(key);
    if (inspected) return inspected.globalValue ?? inspected.defaultValue ?? fallback;
    return vscode.workspace.getConfiguration('bsclAi').get(key) ?? fallback;
  }

  async getConfig() {
    await this.migrateCredentials();
    const ollamaUrl = this.readUserSetting('ollamaUrl', DEFAULT_OLLAMA_URL);
    const smartRouterUrl = this.readUserSetting('smartRouterUrl', DEFAULT_ROUTER_URL);
    const groqFreeEnabled = this.context.globalState.get('bscl_ai_groq_free_enabled', false);
    const config = {
      smartRouterUrl: isHttpUrl(smartRouterUrl) ? smartRouterUrl : DEFAULT_ROUTER_URL,
      ollamaUrl: isLoopbackUrl(ollamaUrl) ? ollamaUrl : DEFAULT_OLLAMA_URL,
      geminiFreeTierEnabled: this.context.globalState.get('bscl_ai_gemini_free_tier_enabled', true),
      groqFreeEnabled,
      groqAutoEnabled: groqFreeEnabled,
      freeCloudEnabled: this.context.globalState.get('bscl_ai_free_cloud_enabled', true),
      customApiBaseUrl: this.context.globalState.get('bscl_ai_custom_api_base_url', ''),
      customApiModel: this.context.globalState.get('bscl_ai_custom_api_model', ''),
      customApiName: this.context.globalState.get('bscl_ai_custom_api_name', 'API compatible'),
      openCodeUrl: this.context.globalState.get('bscl_ai_opencode_url', ''),
      openCodeUsername: this.context.globalState.get('bscl_ai_opencode_username', 'opencode'),
      openCodeFreeEnabled: this.context.globalState.get('bscl_ai_opencode_free_enabled', true)
    };
    for (const key of SECRET_KEYS) {
      config[key] = await this.context.secrets.get(`${this.secretPrefix}${key}`) || '';
    }
    // Groq en Automático exige la casilla Y una clave: sin clave no hay nada que activar.
    config.groqFreeEnabled = Boolean(groqFreeEnabled && config.groqApiKey);
    config.groqAutoEnabled = config.groqFreeEnabled;
    return config;
  }

  /** Lo que ve el webview: nunca las claves, solo si están configuradas y su final. */
  async getWebviewConfig() {
    const config = await this.getConfig();
    const secrets = {};
    for (const key of EDITABLE_SECRETS) {
      const value = String(config[key] || '');
      secrets[key] = value ? { configured: true, hint: value.slice(-4) } : { configured: false };
    }
    // Claves de proveedores retirados: solo se informa de que existen para poder borrarlas.
    const legacySecrets = Object.keys(LEGACY_SECRET_LABELS)
      .filter((key) => config[key])
      .map((key) => ({ key, label: LEGACY_SECRET_LABELS[key] }));
    return {
      secrets,
      legacySecrets,
      groqFreeEnabled: Boolean(this.context.globalState.get('bscl_ai_groq_free_enabled', false)),
      freeCloudEnabled: config.freeCloudEnabled,
      ollamaUrl: config.ollamaUrl,
      smartRouterUrl: config.smartRouterUrl
    };
  }

  async migrateCredentials() {
    if (this.migration) return this.migration;
    this.migration = (async () => {
      const legacy = this.context.globalState.get(this.storageKey, {});
      let changed = false;
      for (const key of SECRET_KEYS) {
        const existing = await this.context.secrets.get(`${this.secretPrefix}${key}`);
        if (!existing && legacy?.[key]) {
          await this.context.secrets.store(`${this.secretPrefix}${key}`, String(legacy[key]));
          changed = true;
        }
      }
      if (changed) await this.context.globalState.update(this.storageKey, {});
    })();
    return this.migration;
  }

  /**
   * Aplica un parche de ajustes del webview:
   * { secrets: { clave: 'valor nuevo' }, clearSecrets: ['clave'], groqFreeEnabled, freeCloudEnabled, ollamaUrl, smartRouterUrl }
   * Lo que no viene en el parche no se toca. Por qué: antes se reescribía todo con lo
   * que hubiera en el formulario, y guardar antes de que cargara borraba las claves.
   * Valida todo antes de escribir nada; lanza SettingsValidationError con el campo.
   */
  async applySettingsPatch(patch = {}) {
    const secrets = patch.secrets && typeof patch.secrets === 'object' ? patch.secrets : {};
    const clearSecrets = Array.isArray(patch.clearSecrets) ? patch.clearSecrets : [];

    if (patch.ollamaUrl !== undefined && !isLoopbackUrl(patch.ollamaUrl)) {
      throw new SettingsValidationError('ollamaUrl', 'Solo se admite Ollama en este equipo (http://localhost, 127.0.0.1 o [::1]).');
    }
    if (patch.smartRouterUrl !== undefined && !isHttpUrl(patch.smartRouterUrl)) {
      throw new SettingsValidationError('smartRouterUrl', 'Escribe una URL http:// o https:// válida.');
    }
    for (const key of [...Object.keys(secrets), ...clearSecrets]) {
      if (!SECRET_KEYS.includes(key)) throw new SettingsValidationError(null, `Clave de ajustes desconocida: ${key}`);
    }
    for (const [key, value] of Object.entries(secrets)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      if (/\s/.test(value.trim()) || value.trim().length > 512) throw new SettingsValidationError(null, `La clave de ${key.replace(/ApiKey$/, '')} no parece válida: no debe tener espacios.`);
    }

    for (const key of clearSecrets) await this.context.secrets.delete(`${this.secretPrefix}${key}`);
    for (const [key, value] of Object.entries(secrets)) {
      const clean = String(value || '').trim();
      if (clean) await this.context.secrets.store(`${this.secretPrefix}${key}`, clean);
    }

    const geminiKey = await this.context.secrets.get(`${this.secretPrefix}geminiApiKey`);
    await this.context.globalState.update('bscl_ai_gemini_free_tier_enabled', Boolean(geminiKey));
    if (patch.groqFreeEnabled !== undefined) {
      await this.context.globalState.update('bscl_ai_groq_free_enabled', Boolean(patch.groqFreeEnabled));
      await this.context.globalState.update('bscl_ai_groq_auto_enabled', Boolean(patch.groqFreeEnabled));
    }
    if (patch.freeCloudEnabled !== undefined) {
      await this.context.globalState.update('bscl_ai_free_cloud_enabled', Boolean(patch.freeCloudEnabled));
    }

    const vsConfig = vscode.workspace.getConfiguration('bsclAi');
    if (patch.smartRouterUrl !== undefined) await vsConfig.update('smartRouterUrl', String(patch.smartRouterUrl).trim(), vscode.ConfigurationTarget.Global);
    if (patch.ollamaUrl !== undefined) await vsConfig.update('ollamaUrl', String(patch.ollamaUrl).trim(), vscode.ConfigurationTarget.Global);
    return this.getWebviewConfig();
  }

  async testProviders() {
    const cfg = await this.getConfig();
    const groqTargetIds = new Set(GROQ_FREE_MODELS.map((m) => m.id));
    const geminiTargetIds = new Set(GEMINI_2026_MODELS.flatMap((id) => [id, `models/${id}`]));
    const results = {
      zeroCostOnly: true,
      ollama: { status: 'offline', label: 'Ollama Local' },
      smartRouter: { status: 'offline', label: 'Smart AI Router' },
      gemini: { configured: Boolean(cfg.geminiApiKey), status: cfg.geminiApiKey ? 'checking-free-model' : 'not-configured' },
      groq: { configured: Boolean(cfg.groqApiKey), enabled: Boolean(cfg.groqFreeEnabled), status: cfg.groqFreeEnabled ? 'checking-free-model' : cfg.groqApiKey ? 'not-enabled' : 'not-configured' },
      openrouter: { configured: Boolean(cfg.openRouterApiKey), status: cfg.openRouterApiKey ? 'configured' : 'not-configured' },
      grok: { configured: Boolean(cfg.xaiApiKey), status: cfg.xaiApiKey ? 'checking-model' : 'not-configured' },
      meta: { configured: Boolean(cfg.metaApiKey), status: cfg.metaApiKey ? 'checking-model' : 'not-configured' },
      // La Nube Pública no tiene un endpoint de estado barato: no se marca como conectada sin comprobarla.
      freeCloud: { enabled: Boolean(cfg.freeCloudEnabled), status: cfg.freeCloudEnabled ? 'checking-public' : 'disabled' }
    };

    const timed = (ms) => AbortSignal.timeout(ms);
    const checks = [
      fetch(`${cfg.ollamaUrl}/api/tags`, { signal: timed(2000) }).then((res) => { if (res.ok) results.ollama.status = 'online'; }),
      fetch(`${cfg.smartRouterUrl}/health`, { signal: timed(2000) }).then(async (res) => {
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        results.smartRouter.status = 'online';
        results.smartRouter.providers = data.providers || {};
      })
    ];
    const listModels = (url, key, target, onData) => checks.push(fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: timed(5000) })
      .then(async (res) => {
        if (!res.ok) { results[target].status = `error-${res.status}`; return; }
        if (onData) await onData(await res.json().catch(() => ({})));
        else results[target].status = 'online';
      })
      .catch(() => { results[target].status = 'offline'; }));

    if (cfg.openRouterApiKey) listModels('https://openrouter.ai/api/v1/models', cfg.openRouterApiKey, 'openrouter');
    if (cfg.xaiApiKey) listModels('https://api.x.ai/v1/models', cfg.xaiApiKey, 'grok');
    if (cfg.metaApiKey) listModels('https://api.meta.ai/v1/models', cfg.metaApiKey, 'meta');
    if (cfg.geminiApiKey) {
      listModels('https://generativelanguage.googleapis.com/v1beta/openai/models', cfg.geminiApiKey, 'gemini', (data) => {
        const models = data.data || data.models || [];
        results.gemini.status = models.some((m) => geminiTargetIds.has(m.id) || /gemini.*flash/i.test(m.id || '')) ? 'online' : 'model-unavailable';
      });
    }
    if (cfg.groqApiKey && cfg.groqFreeEnabled) {
      listModels('https://api.groq.com/openai/v1/models', cfg.groqApiKey, 'groq', (data) => {
        results.groq.status = (data.data || []).some((m) => groqTargetIds.has(m.id)) ? 'online' : 'model-unavailable';
      });
    }
    await Promise.allSettled(checks);
    return results;
  }
}

module.exports = { ConfigManager, SettingsValidationError, isLoopbackUrl, isHttpUrl, SECRET_KEYS };
