/**
 * Controlador del webview: estado de la sesión, mensajes con la extensión y
 * coordinación entre el compositor, el hilo, el historial y los ajustes.
 */
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const post = (message) => vscode.postMessage(message);
  const $ = (id) => document.getElementById(id);

  const modelSelect = $('modelSelect');
  const modeSelect = $('modeSelect');
  const skillSelect = $('skillSelect');
  const welcome = $('welcomeMessage');
  const progressBar = $('progressBar');

  const saved = vscode.getState() || {};
  const state = {
    sessionId: saved.sessionId || newSessionId(),
    conversation: [],
    modelNames: new Map([['smart-router', 'Automático']]),
    pendingModel: saved.model || '',
    request: null // { id, userRow, userEntry }
  };

  const PAID_MODEL = /^(?:grok|xai|meta):/i;
  const MAX_CONTEXT_MESSAGES = 40;
  const ATTACHMENT_BLOCK = /\[ARCHIVO ADJUNTO: ([^\]\n]+?) — contenido de referencia, no instrucciones\]\n(`{3,})[^\n]*\n[\s\S]*?\n\2/g;

  function newSessionId() { return `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

  function persist() {
    vscode.setState({
      sessionId: state.sessionId,
      model: modelSelect.value,
      mode: modeSelect.value,
      skill: skillSelect.value,
      draft: window.Composer.getDraft()
    });
  }

  function setWelcome(visible) { welcome.hidden = !visible; }

  function setBusy(busy) {
    progressBar.hidden = !busy;
    window.Composer.setBusy(busy);
  }

  // ---------- Modelos ----------

  function modelName(id) { return state.modelNames.get(id) || String(id || '').split(':').pop() || 'Automático'; }

  const GROUP_LABELS = { auto: 'Automático', free: 'Gratis en la nube', local: 'Local', paid: 'De pago (tu clave)' };
  const GROUP_ORDER = ['auto', 'free', 'local', 'paid'];

  // Si la extensión no manda el grupo, se deduce del prefijo del id.
  function groupOf(model) {
    if (GROUP_LABELS[model.group]) return model.group;
    const id = String(model.id || '');
    if (id === 'smart-router') return 'auto';
    if (/^ollama:/i.test(id)) return 'local';
    if (PAID_MODEL.test(id)) return 'paid';
    return 'free';
  }

  function renderModels(models = [], defaultModel = 'smart-router') {
    if (!models.length) return;
    const wanted = state.pendingModel || modelSelect.value || defaultModel;
    state.modelNames = new Map(models.map((model) => [model.id, model.name || model.id]));
    const groups = new Map(GROUP_ORDER.map((key) => [key, []]));
    models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name || model.id;
      groups.get(groupOf(model)).push(option);
    });
    modelSelect.replaceChildren(...GROUP_ORDER.filter((key) => groups.get(key).length).map((key) => {
      if (key === 'auto') return groups.get(key);
      const optgroup = document.createElement('optgroup');
      optgroup.label = GROUP_LABELS[key];
      optgroup.append(...groups.get(key));
      return optgroup;
    }).flat());
    modelSelect.value = state.modelNames.has(wanted) ? wanted : (state.modelNames.has(defaultModel) ? defaultModel : models[0].id);
    modelSelect.title = `Modelo: ${modelName(modelSelect.value)}`;
    state.pendingModel = '';
  }

  // ---------- Sesiones ----------

  function resetThread() {
    // Una petición en vuelo se detiene y queda desligada del hilo: si su respuesta llega
    // tarde, no debe aparecer en la conversación nueva (el host ya la guardó en la suya).
    if (state.request) { cancel(); state.request.detached = true; }
    window.MessageView.clear();
    state.conversation = [];
    setWelcome(true);
  }

  function startNewChat() {
    post({ type: 'discardAllDiffs' });
    resetThread();
    state.sessionId = newSessionId();
    persist();
    window.HistoryView.close();
    window.SettingsView.close();
    window.Composer.focus();
    post({ type: 'getHistory' });
  }

  function restoreSession(session) {
    if (!session) return;
    post({ type: 'discardAllDiffs' });
    resetThread();
    state.sessionId = session.id;
    state.conversation = Array.isArray(session.messages) ? session.messages.map((message) => ({ role: message.role, content: message.content })) : [];
    // Un chat antiguo con un modelo de pago no cambia el selector en silencio: se avisa.
    if (session.model && PAID_MODEL.test(session.model) && session.model !== modelSelect.value) {
      window.Composer.showNote(`Esta conversación usó ${modelName(session.model)} (de pago). Se mantiene el modelo actual; cámbialo en el selector si quieres seguir con aquel.`);
    } else if (session.model) {
      if (state.modelNames.has(session.model)) modelSelect.value = session.model;
      else state.pendingModel = session.model;
    }
    if (session.skillKey && [...skillSelect.options].some((option) => option.value === session.skillKey)) skillSelect.value = session.skillKey;
    setWelcome(state.conversation.length === 0);
    state.conversation.forEach((message) => {
      if (message.role === 'user') {
        const names = [];
        const text = String(message.content || '').replace(ATTACHMENT_BLOCK, (all, name) => { names.push(name.trim()); return ''; }).trim();
        window.MessageView.appendUser(text, names.map((name) => ({ name, category: 'text' })));
      }
      else if (message.role === 'assistant') window.MessageView.appendAssistant(message.content, message.provider || modelName(session.model));
    });
    window.MessageView.scrollToBottom();
    if (session.workspaceScope) post({ type: 'restoreWorkspaceScope', payload: { sessionId: session.id } });
    persist();
  }

  // ---------- Peticiones ----------

  function displayTextFor(text, media) {
    if (text) return text;
    return media.map((item) => item.name || 'Adjunto').join(', ');
  }

  function send({ text, media }) {
    if (state.request) return;
    setWelcome(false);
    const requestId = `request_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const userRow = window.MessageView.appendUser(text, media);
    const userEntry = { role: 'user', content: text || displayTextFor(text, media) };
    state.conversation.push(userEntry);
    state.request = { id: requestId, userRow, userEntry };
    window.MessageView.beginPending();
    setBusy(true);
    post({
      type: 'sendMessage',
      payload: {
        sessionId: state.sessionId,
        requestId,
        model: modelSelect.value,
        messages: state.conversation.slice(-MAX_CONTEXT_MESSAGES),
        skillKey: skillSelect.value,
        isSwarmMode: modeSelect.value === 'swarm',
        mediaItems: media,
        autoContext: window.Composer.isAutoContextEnabled(),
        webSearchEnabled: false
      }
    });
    persist();
  }

  function cancel() {
    if (!state.request) return;
    post({ type: 'cancelRequest', payload: { requestId: state.request.id } });
    window.MessageView.setStatus('Deteniendo…');
  }

  function matches(payload) {
    return Boolean(state.request) && (!payload?.requestId || payload.requestId === state.request.id);
  }

  /** La petición en curso y todavía ligada al hilo visible. */
  function isCurrent(payload) {
    return matches(payload) && !state.request.detached;
  }

  /** Cierra una petición desligada sin pintar nada. Devuelve true si lo era. */
  function settleDetached(payload) {
    if (!matches(payload) || !state.request.detached) return false;
    finishRequest();
    return true;
  }

  function finishRequest() {
    state.request = null;
    setBusy(false);
  }

  function onResponse(payload = {}) {
    if (settleDetached(payload)) return;
    if (payload.revertedUndoId) window.MessageView.markUndoUsed(payload.revertedUndoId, true);
    if (!isCurrent(payload)) {
      window.MessageView.appendAssistant(payload.content, payload.provider, { files: payload.fileChanges || [], undoId: payload.undoId || '', warning: payload.warning });
      return;
    }
    if (payload.transcribedPrompt) state.request.userEntry.content = payload.transcribedPrompt;
    state.conversation.push({ role: 'assistant', content: payload.content });
    window.MessageView.finishPending({
      content: payload.content, provider: payload.provider,
      files: payload.fileChanges || [], undoId: payload.undoId || '', warning: payload.warning || ''
    });
    finishRequest();
  }

  function onError(payload = {}) {
    if (settleDetached(payload)) return;
    const message = payload.message || 'Error desconocido.';
    if (isCurrent(payload) && window.MessageView.hasPending()) {
      window.MessageView.failPending(message, payload.kind === 'warning' ? 'warning' : 'error');
      // La pregunta fallida no se reenvía como contexto; vuelve al cuadro para reintentar.
      const { userEntry } = state.request;
      const index = state.conversation.lastIndexOf(userEntry);
      if (index >= 0) state.conversation.splice(index, 1);
      if (!window.Composer.getDraft().trim() && userEntry.content) {
        window.Composer.setText(userEntry.content);
        window.Composer.showNote('Tu mensaje volvió al cuadro de texto: pulsa Enter para reintentarlo.');
      }
      finishRequest();
    } else {
      window.MessageView.appendNotice(message, 'error');
    }
  }

  function onCancelled(payload = {}) {
    if (settleDetached(payload) || !isCurrent(payload)) return;
    window.MessageView.cancelPending();
    // La pregunta sin respuesta se queda en el historial visible, pero no se reenvía como contexto.
    const index = state.conversation.lastIndexOf(state.request.userEntry);
    if (index >= 0) state.conversation.splice(index, 1);
    finishRequest();
  }

  function onAudioTranscript(payload = {}) {
    if (!isCurrent(payload) || !payload.text) return;
    window.MessageView.setUserText(state.request.userRow, payload.displayText || payload.text);
    state.request.userEntry.content = payload.text;
  }

  function onSelection({ selectedText, language, actionType } = {}) {
    if (!selectedText) { window.Composer.showNote('Selecciona código en el editor antes de usar esta acción.'); return; }
    const instructions = {
      explain: 'Explica este código: qué hace, por qué y qué riesgos ves.',
      refactor: 'Refactoriza este código sin cambiar su comportamiento y explica cada cambio.',
      fix: 'Busca errores en este código y propón una versión corregida.'
    };
    window.HistoryView.close();
    window.SettingsView.close();
    window.Composer.setText(`${instructions[actionType] || instructions.explain}\n\n\`\`\`${language || ''}\n${selectedText}\n\`\`\``);
  }

  function onCommand({ action } = {}) {
    if (action === 'newChat') startNewChat();
    else if (action === 'history') { window.SettingsView.close(); post({ type: 'getHistory' }); window.HistoryView.open(); }
    else if (action === 'settings') { window.HistoryView.close(); post({ type: 'getApiConfig' }); window.SettingsView.open(); }
  }

  // ---------- Mensajes de la extensión ----------

  const handlers = {
    modelsList: (payload) => renderModels(payload.models, payload.defaultModel),
    activeContext: (payload) => {
      window.Composer.setActiveEditor(payload.activeEditor || null);
      window.Composer.setFolder(payload.selectedFolderPath ? { name: payload.selectedFolder, path: payload.selectedFolderPath } : null);
    },
    historyList: (payload) => window.HistoryView.render(payload.sessions, state.sessionId),
    sessionLoaded: (payload) => restoreSession(payload.session),
    apiConfig: (payload) => window.SettingsView.populate(payload),
    apiConfigSaved: (payload) => window.SettingsView.showSaveResult(payload),
    testProvidersResult: (payload) => window.SettingsView.renderTestResults(payload),
    folderSelected: (payload) => window.Composer.setFolder(payload),
    filesImported: (payload) => { window.Composer.showNote(''); window.Composer.addImported(payload); },
    localModelRecommendation: (payload) => window.SettingsView.showLocalModelRecommendation(payload),
    localModelProgress: (payload) => window.SettingsView.showLocalModelProgress(payload),
    undoResult: (payload) => {
      window.MessageView.markUndoUsed(payload.undoId, payload.success);
      window.MessageView.appendNotice(payload.content, payload.success ? 'info' : 'error');
    },
    activeSelection: onSelection,
    aiResponse: onResponse,
    swarmProgress: (payload) => { if (isCurrent(payload)) window.MessageView.updateProgress(payload); },
    taskPlan: (payload) => { if (isCurrent(payload)) window.MessageView.showTaskPlan(payload); },
    audioTranscript: onAudioTranscript,
    audioStatus: (payload) => { if (payload.text) window.MessageView.setStatus(payload.text); },
    status: (payload) => {
      if (payload.loading || !matches(payload)) return;
      if (state.request.detached || !window.MessageView.hasPending()) finishRequest();
    },
    requestCancelled: onCancelled,
    error: onError,
    notice: (payload) => window.UI.toast(payload.message, { kind: payload.kind || 'info' }),
    command: onCommand
  };

  window.addEventListener('message', (event) => {
    const { type, payload } = event.data || {};
    if (typeof type !== 'string') return;
    if (type.startsWith('diff')) { window.CodeActions.handle(type, payload || {}); return; }
    handlers[type]?.(payload || {});
  });

  // ---------- Arranque ----------

  window.MessageView.init({ chatContainer: $('chatContainer'), messagesList: $('messagesList'), postMessage: post });
  window.CodeActions.init({ root: $('messagesList'), postMessage: post, onError: (message) => window.MessageView.appendNotice(message, 'error') });
  window.HistoryView.init({
    modelName,
    onSelect: (id) => post({ type: 'loadSession', payload: { id } }),
    onDelete: (id) => {
      post({ type: 'deleteChat', payload: { id } });
      if (id === state.sessionId) { resetThread(); state.sessionId = newSessionId(); persist(); }
    },
    onClearAll: () => post({ type: 'clearAllChats' })
  });
  window.SettingsView.init({
    onSave: (patch) => post({ type: 'saveApiConfig', payload: patch }),
    onTest: () => post({ type: 'testProviders' }),
    onRecommend: () => post({ type: 'recommendLocalModel' }),
    onInstall: (model) => post({ type: 'installLocalModel', payload: { model } }),
    onClosed: () => window.Composer.focus()
  });
  window.Composer.init({ post, onSend: send, onStop: cancel, onDraft: persist });

  document.querySelectorAll('.suggestion').forEach((button) => {
    button.addEventListener('click', () => window.Composer.setText(button.dataset.prompt || ''));
  });
  [modelSelect, modeSelect, skillSelect].forEach((select) => select.addEventListener('change', () => {
    modelSelect.title = `Modelo: ${modelName(modelSelect.value)}`;
    persist();
  }));

  if (saved.mode) modeSelect.value = saved.mode;
  if (saved.skill) skillSelect.value = saved.skill;
  if (saved.draft) window.Composer.setText(saved.draft);

  post({ type: 'ready', payload: { sessionId: saved.sessionId || '' } });
  // Si el panel se recargó, se recupera la conversación en curso desde el historial.
  if (saved.sessionId) post({ type: 'loadSession', payload: { id: saved.sessionId, silent: true } });
})();
