const vscode = require('vscode');
const { GEMINI_2026_MODELS, GROQ_FREE_MODELS } = require('./free-cloud-fallback');

const SECRET_KEYS = [
  'geminiApiKey', 'groqApiKey', 'openRouterApiKey', 'sambanovaApiKey', 'cerebrasApiKey', 'customApiKey', 'openCodePassword', 'xaiApiKey'
];

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

class ConfigManager {
  constructor(context) {
    this.context = context;
    this.storageKey = 'bscl_ai_api_credentials';
    this.secretPrefix = 'bscl_ai_secret_';
    this.migration = null;
  }

  async getConfig() {
    await this.migrateCredentials();
    const vsConfig = vscode.workspace.getConfiguration('bsclAi');
    const config = {
      smartRouterUrl: vsConfig.get('smartRouterUrl') || 'http://localhost:3000',
      ollamaUrl: isLoopbackUrl(vsConfig.get('ollamaUrl') || 'http://localhost:11434')
        ? (vsConfig.get('ollamaUrl') || 'http://localhost:11434') : 'http://localhost:11434',
      geminiFreeTierEnabled: this.context.globalState.get('bscl_ai_gemini_free_tier_enabled', true),
      groqFreeEnabled: this.context.globalState.get('bscl_ai_groq_free_enabled', true),
      groqAutoEnabled: this.context.globalState.get('bscl_ai_groq_free_enabled', true),
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
    return config;
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

  async saveConfig(newConfig = {}) {
    if (newConfig.ollamaUrl && !isLoopbackUrl(newConfig.ollamaUrl.trim())) {
      throw new Error('El modo sin costo solo permite Ollama en localhost; no se aceptan servidores remotos.');
    }
    const hasGeminiKey = Boolean(String(newConfig.geminiApiKey || '').trim());
    await this.context.globalState.update('bscl_ai_gemini_free_tier_enabled', hasGeminiKey);
    const groqFreeEnabled = Boolean(newConfig.groqFreeEnabled || String(newConfig.groqApiKey || '').trim());
    await this.context.globalState.update('bscl_ai_groq_free_enabled', groqFreeEnabled);
    await this.context.globalState.update('bscl_ai_groq_auto_enabled', groqFreeEnabled);
    if (newConfig.freeCloudEnabled !== undefined) {
      await this.context.globalState.update('bscl_ai_free_cloud_enabled', Boolean(newConfig.freeCloudEnabled));
    }
    if (newConfig.openCodeFreeEnabled !== undefined) {
      await this.context.globalState.update('bscl_ai_opencode_free_enabled', Boolean(newConfig.openCodeFreeEnabled));
    }
    const current = await this.getConfig();
    const merged = { ...current, ...newConfig };
    if (!hasGeminiKey) merged.geminiApiKey = '';
    for (const key of SECRET_KEYS) {
      const value = String(merged[key] || '').trim();
      if (value) await this.context.secrets.store(`${this.secretPrefix}${key}`, value);
      else await this.context.secrets.delete(`${this.secretPrefix}${key}`);
    }

    for (const [key, stateKey] of [
      ['customApiBaseUrl', 'bscl_ai_custom_api_base_url'],
      ['customApiModel', 'bscl_ai_custom_api_model'],
      ['customApiName', 'bscl_ai_custom_api_name'],
      ['openCodeUrl', 'bscl_ai_opencode_url'],
      ['openCodeUsername', 'bscl_ai_opencode_username']
    ]) {
      await this.context.globalState.update(stateKey, String(merged[key] || '').trim());
    }

    const vsConfig = vscode.workspace.getConfiguration('bsclAi');
    if (newConfig.smartRouterUrl) await vsConfig.update('smartRouterUrl', newConfig.smartRouterUrl.trim(), vscode.ConfigurationTarget.Global);
    if (newConfig.ollamaUrl) await vsConfig.update('ollamaUrl', newConfig.ollamaUrl.trim(), vscode.ConfigurationTarget.Global);
    return this.getConfig();
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
      cerebras: { configured: Boolean(cfg.cerebrasApiKey), status: cfg.cerebrasApiKey ? 'checking-free-model' : 'not-configured' },
      groq: { configured: Boolean(cfg.groqApiKey), enabled: Boolean(cfg.groqFreeEnabled), status: cfg.groqFreeEnabled && cfg.groqApiKey ? 'checking-free-model' : 'not-enabled' },
      openrouter: { configured: Boolean(cfg.openRouterApiKey), status: cfg.openRouterApiKey ? 'configured' : 'not-configured' },
      grok: { configured: Boolean(cfg.xaiApiKey), status: cfg.xaiApiKey ? 'checking-model' : 'not-configured' },
      freeCloud: { enabled: Boolean(cfg.freeCloudEnabled), status: cfg.freeCloudEnabled ? 'online' : 'disabled' }
    };

    const checks = [
      fetch(`${cfg.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) }).then((res) => { if (res.ok) results.ollama.status = 'online'; }),
      fetch(`${cfg.smartRouterUrl}/health`, { signal: AbortSignal.timeout(2000) }).then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          results.smartRouter.status = 'online';
          results.smartRouter.providers = data.providers || {};
        }
      })
    ];
    if (cfg.openRouterApiKey) {
      checks.push(fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${cfg.openRouterApiKey}` }, signal: AbortSignal.timeout(5000)
      }).then((res) => { results.openrouter.status = res.ok ? 'online' : `error-${res.status}`; })
        .catch(() => { results.openrouter.status = 'offline'; }));
    }
    if (cfg.xaiApiKey) {
      checks.push(fetch('https://api.x.ai/v1/models', {
        headers: { Authorization: `Bearer ${cfg.xaiApiKey}` }, signal: AbortSignal.timeout(5000)
      }).then((res) => { results.grok.status = res.ok ? 'online' : `error-${res.status}`; })
        .catch(() => { results.grok.status = 'offline'; }));
    }
    if (cfg.geminiApiKey) {
      checks.push(fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', {
        headers: { Authorization: `Bearer ${cfg.geminiApiKey}` }, signal: AbortSignal.timeout(5000)
      }).then(async (res) => {
        if (!res.ok) { results.gemini.status = `error-${res.status}`; return; }
        const data = await res.json();
        const models = data.data || data.models || [];
        results.gemini.status = models.some((m) => geminiTargetIds.has(m.id) || /gemini.*flash/i.test(m.id || ''))
          ? 'online' : 'model-unavailable';
      }).catch(() => { results.gemini.status = 'offline'; }));
    }
    if (cfg.groqApiKey && cfg.groqFreeEnabled) {
      checks.push(fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${cfg.groqApiKey}` }, signal: AbortSignal.timeout(5000)
      }).then(async (res) => {
        if (!res.ok) { results.groq.status = `error-${res.status}`; return; }
        const data = await res.json();
        results.groq.status = (data.data || []).some((m) => groqTargetIds.has(m.id))
          ? 'online' : 'model-unavailable';
      }).catch(() => { results.groq.status = 'offline'; }));
    }
    await Promise.allSettled(checks);
    return results;
  }
}

module.exports = { ConfigManager };
