/**
 * Componente UI para Configuración de APIs y Cuentas (Modal Refero AAA)
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
window.SettingsView = (function () {
  const modal = document.getElementById('settingsModal');
  const btnClose = document.getElementById('btnCloseSettings');
  const btnSave = document.getElementById('btnSaveSettings');
  const btnTest = document.getElementById('btnTestProviders');
  const btnRecommendLocalModel = document.getElementById('btnRecommendLocalModel');
  const btnInstallLocalModel = document.getElementById('btnInstallLocalModel');
  const localModelStatus = document.getElementById('localModelStatus');
  const testResultsBadge = document.getElementById('testResultsBadge');

  const fields = {
    gemini: document.getElementById('cfgGeminiKey'),
    groq: document.getElementById('cfgGroqKey'),
    groqFreeEnabled: document.getElementById('cfgGroqFreeEnabled'),
    openrouter: document.getElementById('cfgOpenRouterKey'),
    xai: document.getElementById('cfgXaiKey'),
    sambanova: document.getElementById('cfgSambaNovaKey'),
    smartRouterUrl: document.getElementById('cfgSmartRouterUrl'),
    ollamaUrl: document.getElementById('cfgOllamaUrl'),
    customApiName: document.getElementById('cfgCustomApiName'),
    customApiModel: document.getElementById('cfgCustomApiModel'),
    customApiBaseUrl: document.getElementById('cfgCustomApiBaseUrl'),
    customApiKey: document.getElementById('cfgCustomApiKey'),
    openCodeUrl: document.getElementById('cfgOpenCodeUrl'),
    openCodeUsername: document.getElementById('cfgOpenCodeUsername'),
    openCodePassword: document.getElementById('cfgOpenCodePassword')
  };

  let callbacks = {};

  function init(cbs = {}) {
    callbacks = cbs;
    if (btnClose) btnClose.onclick = () => toggle(false);
    if (btnSave) btnSave.onclick = save;
    if (btnTest) btnTest.onclick = () => callbacks.onTestProviders?.();
    if (btnRecommendLocalModel) btnRecommendLocalModel.onclick = () => callbacks.onRecommendLocalModel?.();
    if (btnInstallLocalModel) btnInstallLocalModel.onclick = () => callbacks.onInstallLocalModel?.(btnInstallLocalModel.dataset.model);

    document.querySelectorAll('.btn-toggle-eye').forEach(btn => {
      btn.onclick = () => {
        const input = btn.previousElementSibling;
        if (input && input.tagName === 'INPUT') {
          input.type = input.type === 'password' ? 'text' : 'password';
          btn.textContent = input.type === 'password' ? '👁️' : '🔒';
        }
      };
    });
  }

  function toggle(open) {
    if (!modal) return;
    modal.classList.toggle('modal-open', open);
  }

  function populate(config = {}) {
    if (fields.gemini) fields.gemini.value = config.geminiApiKey || '';
    if (fields.groq) fields.groq.value = config.groqApiKey || '';
    if (fields.groqFreeEnabled) fields.groqFreeEnabled.checked = Boolean(config.groqFreeEnabled);
    if (fields.openrouter) fields.openrouter.value = config.openRouterApiKey || '';
    if (fields.xai) fields.xai.value = config.xaiApiKey || '';
    if (fields.sambanova) fields.sambanova.value = config.sambanovaApiKey || '';
    if (fields.smartRouterUrl) fields.smartRouterUrl.value = config.smartRouterUrl || 'http://localhost:3000';
    if (fields.ollamaUrl) fields.ollamaUrl.value = config.ollamaUrl || 'http://localhost:11434';
    if (fields.customApiName) fields.customApiName.value = config.customApiName || 'API compatible';
    if (fields.customApiModel) fields.customApiModel.value = config.customApiModel || '';
    if (fields.customApiBaseUrl) fields.customApiBaseUrl.value = config.customApiBaseUrl || '';
    if (fields.customApiKey) fields.customApiKey.value = config.customApiKey || '';
    if (fields.openCodeUrl) fields.openCodeUrl.value = config.openCodeUrl || '';
    if (fields.openCodeUsername) fields.openCodeUsername.value = config.openCodeUsername || 'opencode';
    if (fields.openCodePassword) fields.openCodePassword.value = config.openCodePassword || '';
  }

  function save() {
    const payload = {
      geminiApiKey: fields.gemini?.value.trim() || '',
      groqApiKey: fields.groq?.value.trim() || '',
      groqFreeEnabled: Boolean(fields.groqFreeEnabled?.checked),
      openRouterApiKey: fields.openrouter?.value.trim() || '',
      xaiApiKey: fields.xai?.value.trim() || '',
      sambanovaApiKey: fields.sambanova?.value.trim() || '',
      smartRouterUrl: fields.smartRouterUrl?.value.trim() || 'http://localhost:3000',
      ollamaUrl: fields.ollamaUrl?.value.trim() || 'http://localhost:11434',
      customApiName: fields.customApiName?.value.trim() || 'API compatible',
      customApiModel: fields.customApiModel?.value.trim() || '',
      customApiBaseUrl: fields.customApiBaseUrl?.value.trim() || '',
      customApiKey: fields.customApiKey?.value.trim() || '',
      openCodeUrl: fields.openCodeUrl?.value.trim() || '',
      openCodeUsername: fields.openCodeUsername?.value.trim() || 'opencode',
      openCodePassword: fields.openCodePassword?.value.trim() || ''
    };
    callbacks.onSaveConfig?.(payload);
    toggle(false);
  }

  function renderTestResults(results) {
    if (!testResultsBadge) return;
    const sStatus = results.smartRouter?.status === 'online' ? '🟢 Router: Online' : '🔴 Router: Offline';
    const oStatus = results.ollama?.status === 'online' ? '🟢 Ollama: Online' : '🔴 Ollama: Offline';
    const gStatus = results.gemini?.status === 'online' ? '🟢 Gemini Cascade: Activo' : results.gemini?.configured ? '🟠 Gemini: revisa clave' : '⚪ Gemini: sin configurar';
    const groqStatus = results.groq?.status === 'online' ? '🟢 Groq LPU: Activo' : results.groq?.enabled ? '🟠 Groq: revisa cuenta' : '⚪ Groq: desactivado';
    const freeApiStatus = results.openrouter?.status === 'online' ? '🟢 OpenRouter :free' : results.openrouter?.configured ? '🟠 OpenRouter: revisa clave' : '⚪ OpenRouter :free';
    const grokStatus = results.grok?.status === 'online' ? '🟢 Grok (xAI): Activo' : results.grok?.configured ? '🟠 Grok: revisa clave' : '⚪ Grok: sin configurar';
    const freeCloudStatus = results.freeCloud?.status === 'online' ? '🟢 Nube Pública: Lista' : '⚪ Nube Pública: Off';
    testResultsBadge.innerHTML = `<span class="badge-tag">🛡️ Cascada Gratis Pro</span> <span class="badge-tag">${sStatus}</span> <span class="badge-tag">${gStatus}</span> <span class="badge-tag">${groqStatus}</span> <span class="badge-tag">${freeApiStatus}</span> <span class="badge-tag">${grokStatus}</span> <span class="badge-tag">${freeCloudStatus}</span> <span class="badge-tag">${oStatus}</span>`;
  }

  function showLocalModelRecommendation(result = {}) {
    if (!localModelStatus) return;
    localModelStatus.textContent = result.message || 'No se pudo estimar un modelo local.';
    if (btnInstallLocalModel) {
      btnInstallLocalModel.dataset.model = result.model || '';
      btnInstallLocalModel.disabled = !result.model || result.installed;
      btnInstallLocalModel.textContent = result.installed ? `${result.model} ya está instalado` : `Descargar ${result.model || 'recomendado'}`;
    }
  }

  function showLocalModelProgress(progress = {}) {
    if (localModelStatus) localModelStatus.textContent = progress.message || progress.status || 'Ollama está trabajando…';
    if (btnInstallLocalModel) {
      btnInstallLocalModel.disabled = progress.status !== 'failed';
      if (progress.status === 'success') btnInstallLocalModel.textContent = 'Descarga terminada';
      else if (progress.status === 'failed') btnInstallLocalModel.textContent = 'Reintentar descarga';
      else btnInstallLocalModel.textContent = progress.progress == null ? 'Descargando…' : `Descargando ${progress.progress}%`;
    }
  }

  return { init, toggle, populate, renderTestResults, showLocalModelRecommendation, showLocalModelProgress };
})();
