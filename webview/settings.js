/**
 * Vista de ajustes: claves, proveedores locales, modelo local y estado de conexiones.
 *
 * Las claves nunca llegan al webview: la extensión solo dice si cada una está
 * configurada y sus últimos 4 caracteres. Al guardar se envía un parche con las claves
 * nuevas que el usuario escribió y las que pidió borrar; lo que no se toca, se conserva.
 */
window.SettingsView = (function () {
  'use strict';
  const { el } = window.UI;

  const view = document.getElementById('settingsView');
  const form = document.getElementById('settingsForm');
  const saveState = document.getElementById('settingsSaveState');
  const saveButton = document.getElementById('btnSaveSettings');
  const groqToggle = document.getElementById('cfgGroqFreeEnabled');
  const freeCloudToggle = document.getElementById('cfgFreeCloudEnabled');
  const ollamaUrl = document.getElementById('cfgOllamaUrl');
  const testButton = document.getElementById('btnTestProviders');
  const testResults = document.getElementById('testResults');
  const recommendButton = document.getElementById('btnRecommendLocalModel');
  const installButton = document.getElementById('btnInstallLocalModel');
  const localStatus = document.getElementById('localModelStatus');
  const legacySection = document.getElementById('legacySecrets');
  const legacyText = document.getElementById('legacySecretsText');
  const legacyClear = document.getElementById('cfgClearLegacy');
  let legacyKeys = [];

  const secretFields = [...form.querySelectorAll('[data-secret]')].map((field) => ({
    key: field.dataset.secret,
    field,
    input: field.querySelector('input'),
    badge: field.querySelector('[data-configured]'),
    clear: field.querySelector('[data-clear-secret]'),
    toggle: field.querySelector('[data-toggle-visibility]'),
    defaultPlaceholder: field.querySelector('input').getAttribute('placeholder') || '',
    configured: false,
    hint: '',
    pendingClear: false
  }));

  let callbacks = {};

  function setError(name, message) {
    const node = form.querySelector(`[data-error-for="${name}"]`);
    if (node) node.textContent = message || '';
  }

  function isLoopback(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    } catch { return false; }
  }


  function syncSecret(entry) {
    entry.badge.hidden = !entry.configured || entry.pendingClear;
    entry.clear.hidden = !entry.configured;
    entry.input.disabled = entry.pendingClear;
    entry.input.placeholder = entry.pendingClear
      ? 'Se borrará al guardar'
      : entry.configured ? `Guardada (…${entry.hint}). Escribe para reemplazarla` : entry.defaultPlaceholder;
    window.UI.setIcon(entry.clear, entry.pendingClear ? 'undo' : 'trash');
    entry.clear.setAttribute('aria-label', entry.pendingClear ? 'No borrar la clave' : 'Borrar la clave guardada');
    entry.clear.title = entry.clear.getAttribute('aria-label');
  }

  function populate(config = {}) {
    const secrets = config.secrets || {};
    secretFields.forEach((entry) => {
      const info = secrets[entry.key] || {};
      entry.configured = Boolean(info.configured);
      entry.hint = info.hint || '';
      entry.pendingClear = false;
      entry.input.value = '';
      entry.input.type = 'password';
      window.UI.setIcon(entry.toggle, 'eye');
      syncSecret(entry);
    });
    legacyKeys = Array.isArray(config.legacySecrets) ? config.legacySecrets : [];
    legacySection.hidden = legacyKeys.length === 0;
    legacyClear.checked = false;
    if (legacyKeys.length) {
      legacyText.textContent = `Hay claves guardadas de proveedores que esta versión ya no ofrece en Automático: ${legacyKeys.map((item) => item.label).join(', ')}. Siguen en el almacén seguro hasta que las borres.`;
    }
    groqToggle.checked = Boolean(config.groqFreeEnabled);
    freeCloudToggle.checked = config.freeCloudEnabled !== false;
    ollamaUrl.value = config.ollamaUrl || 'http://localhost:11434';
    setError('ollamaUrl', '');
    saveState.textContent = '';
  }

  function collect() {
    const patch = { secrets: {}, clearSecrets: [], groqFreeEnabled: groqToggle.checked, freeCloudEnabled: freeCloudToggle.checked };
    secretFields.forEach((entry) => {
      const value = entry.input.value.trim();
      if (entry.pendingClear) patch.clearSecrets.push(entry.key);
      else if (value) patch.secrets[entry.key] = value;
    });
    if (legacyClear.checked) patch.clearSecrets.push(...legacyKeys.map((item) => item.key));
    patch.ollamaUrl = ollamaUrl.value.trim() || 'http://localhost:11434';
    return patch;
  }

  function validate(patch) {
    let ok = true;
    if (!isLoopback(patch.ollamaUrl)) { setError('ollamaUrl', 'Solo se admite Ollama en este equipo (http://localhost o 127.0.0.1).'); ok = false; } else setError('ollamaUrl', '');
    return ok;
  }

  function onSubmit(event) {
    event.preventDefault();
    const patch = collect();
    if (!validate(patch)) return;
    saveButton.disabled = true;
    saveState.textContent = 'Guardando…';
    callbacks.onSave?.(patch);
  }

  function showSaveResult(result = {}) {
    saveButton.disabled = false;
    if (result.success) {
      saveState.textContent = '';
      close();
      window.UI.toast('Ajustes guardados.', { kind: 'success' });
      return;
    }
    saveState.textContent = '';
    if (result.field) setError(result.field, result.message);
    else window.UI.toast(result.message || 'No se pudieron guardar los ajustes.', { kind: 'error', timeout: 6000 });
  }

  // ---------- Estado de conexiones ----------

  const PROVIDERS = [
    ['gemini', 'Gemini'], ['groq', 'Groq'], ['openrouter', 'OpenRouter :free'], ['ollama', 'Ollama'],
    ['zai', 'Z.ai'], ['grok', 'xAI Grok'], ['meta', 'Meta Muse'], ['freeCloud', 'Nube pública sin clave']
  ];

  function describeStatus(result = {}) {
    const status = String(result.status || '');
    if (status === 'online') return ['ok', 'Conectado'];
    if (status === 'configured') return ['ok', 'Clave guardada'];
    if (status.startsWith('error-')) {
      const code = status.slice(6);
      return ['error', code === '401' || code === '403' ? `Clave rechazada (${code})` : `Error ${code}`];
    }
    if (status === 'model-unavailable') return ['warn', 'Modelo no disponible'];
    if (status === 'offline') return ['error', 'No responde'];
    if (status.startsWith('checking')) return ['warn', 'Sin verificar'];
    if (status === 'not-enabled' || status === 'disabled') return ['off', 'Desactivado'];
    if (status === 'not-configured' || result.configured === false) return ['off', 'Sin clave'];
    return ['off', status || 'Sin datos'];
  }

  function renderTestResults(results = {}) {
    testButton.disabled = false;
    const rows = PROVIDERS.filter(([key]) => results[key]).map(([key, name]) => {
      const [kind, text] = describeStatus(results[key]);
      return el('li', {}, [
        el('span', { class: 'status-dot', 'data-status': kind, 'aria-hidden': 'true' }),
        el('span', { class: 'status-name', text: name }),
        el('span', { class: 'status-text', text })
      ]);
    });
    testResults.replaceChildren(...rows);
  }

  // ---------- Modelo local ----------

  function showLocalModelRecommendation(result = {}) {
    recommendButton.disabled = false;
    localStatus.textContent = result.message || 'No se pudo estimar un modelo local.';
    installButton.dataset.model = result.model || '';
    installButton.disabled = !result.model || Boolean(result.installed);
    installButton.textContent = result.installed ? `${result.model} ya está instalado` : `Descargar ${result.model || 'recomendado'}`;
  }

  function showLocalModelProgress(progress = {}) {
    localStatus.textContent = progress.message || progress.status || 'Ollama está trabajando…';
    installButton.disabled = progress.status !== 'failed';
    if (progress.status === 'success') installButton.textContent = 'Descarga terminada';
    else if (progress.status === 'failed') installButton.textContent = 'Reintentar descarga';
    else installButton.textContent = progress.progress == null ? 'Descargando…' : `Descargando ${progress.progress} %`;
  }

  // ---------- Ciclo de vida ----------

  function open() { window.UI.openOverlay(view); }
  function close() { window.UI.closeOverlay(view); }
  function isOpen() { return !view.hidden; }

  function init(cbs = {}) {
    callbacks = cbs;
    form.addEventListener('submit', onSubmit);
    secretFields.forEach((entry) => {
      entry.toggle.addEventListener('click', () => {
        entry.input.type = entry.input.type === 'password' ? 'text' : 'password';
        window.UI.setIcon(entry.toggle, entry.input.type === 'password' ? 'eye' : 'eye-off');
      });
      entry.clear.addEventListener('click', () => {
        entry.pendingClear = !entry.pendingClear;
        if (entry.pendingClear) entry.input.value = '';
        syncSecret(entry);
      });
    });
    testButton.addEventListener('click', () => {
      testButton.disabled = true;
      testResults.replaceChildren(el('li', {}, [el('span', { class: 'status-text', text: 'Comprobando…' })]));
      callbacks.onTest?.();
    });
    recommendButton.addEventListener('click', () => {
      recommendButton.disabled = true;
      localStatus.textContent = 'Analizando el equipo…';
      callbacks.onRecommend?.();
    });
    installButton.addEventListener('click', () => {
      if (installButton.dataset.model) callbacks.onInstall?.(installButton.dataset.model);
    });
    // Cerrar sin guardar descarta lo escrito: al reabrir se ve el estado real.
    view.addEventListener('overlayclose', () => callbacks.onClosed?.());
  }

  return { init, open, close, isOpen, populate, showSaveResult, renderTestResults, showLocalModelRecommendation, showLocalModelProgress };
})();
