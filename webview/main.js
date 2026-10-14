(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const modelSelect = $('modelSelect'), modeSelect = $('modeSelect'), skillSelect = $('skillSelect');
  const messagesList = $('messagesList'), promptInput = $('promptInput');
  const btnSend = $('btnSend'), btnAttach = $('btnAttach'), btnMic = $('btnMic'), btnWebSearch = $('btnWebSearch'), mediaFileInput = $('mediaFileInput');
  const mediaPreview = $('mediaPreview'), welcomeMessage = $('welcomeMessage');
  const swarmTimeline = $('swarmTimeline');
  const folderDropChip = $('folderDropChip'), folderDropName = $('folderDropName'), btnClearFolder = $('btnClearFolder');
  const btnRecommendLocalModel = $('btnRecommendLocalModel'), btnInstallLocalModel = $('btnInstallLocalModel');
  const btnNewChat = $('btnNewChat'), btnHistory = $('btnHistory'), btnSettings = $('btnSettings');

  let currentSessionId = 'session_' + Date.now();
  let conversationHistory = [], attachedMedia = [], isRecording = false, recognition = null, webSearchEnabled = false;
  const pendingAudioRequests = new Map();

  function resizePromptInput() {
    const maxHeight = Math.max(56, Math.min(144, Math.floor(window.innerHeight * 0.28)));
    promptInput.style.height = 'auto';
    const contentHeight = promptInput.scrollHeight;
    promptInput.style.height = `${Math.min(contentHeight, maxHeight)}px`;
    promptInput.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
  }

  window.MessageView?.init({
    chatContainer: $('chatContainer'), messagesList, swarmTimeline: $('swarmTimeline'),
    swarmStepBadge: $('swarmStepBadge'), swarmStepText: $('swarmStepText'),
    loadingIndicator: $('loadingIndicator'), postMessage: (message) => vscode.postMessage(message)
  });

  // Inicialización de submódulos Refero AAA
  if (window.HistoryView) {
    window.HistoryView.init({
      onSelectSession: (s) => restoreSession(s),
      onDeleteSession: (id) => vscode.postMessage({ type: 'deleteChat', payload: { id } }),
      onClearAll: () => vscode.postMessage({ type: 'clearAllChats' })
    });
  }
  if (window.SettingsView) {
    window.SettingsView.init({
    onSaveConfig: (cfg) => vscode.postMessage({ type: 'saveApiConfig', payload: cfg }),
      onTestProviders: () => vscode.postMessage({ type: 'testProviders' }),
      onRecommendLocalModel: () => vscode.postMessage({ type: 'recommendLocalModel' }),
      onInstallLocalModel: (model) => model && vscode.postMessage({ type: 'installLocalModel', payload: { model } })
    });
  }
  window.DiffActions?.init({ postMessage: (message) => vscode.postMessage(message), onError: appendErrorMessage });

  vscode.postMessage({ type: 'ready' });

  window.addEventListener('message', ({ data: { type, payload } }) => {
    if (type === 'modelsList') renderModels(payload.models, payload.defaultModel);
    if (type === 'activeContext') {
      window.WorkspaceView?.update(payload);
      setSelectedFolder(payload?.selectedFolderPath ? { name: payload.selectedFolder, path: payload.selectedFolderPath } : null);
    }
    if (type === 'historyList') window.HistoryView?.render(payload.sessions);
    if (type === 'apiConfig') window.SettingsView?.populate(payload);
    if (type === 'testProvidersResult') window.SettingsView?.renderTestResults(payload);
    if (type === 'folderSelected') setSelectedFolder(payload);
    if (type === 'filesImported') handleImportedFiles(payload);
    if (type === 'localModelRecommendation') window.SettingsView?.showLocalModelRecommendation(payload);
    if (type === 'localModelProgress') window.SettingsView?.showLocalModelProgress(payload);
    if (type === 'undoResult') {
      window.MessageView?.markUndoUsed(payload.undoId, payload.success);
      window.MessageView?.appendAssistant(payload.content, payload.success ? 'BSCL AI · Reversión' : 'BSCL AI · No se pudo revertir');
    }
    if (type === 'activeSelection') handleSelection(payload);
    if (type === 'aiResponse') handleAiResponse(payload);
    if (type === 'swarmProgress') window.MessageView?.updateProgress(payload);
    if (type === 'taskPlan') window.MessageView?.showTaskPlan(payload);
    if (type === 'audioTranscript') handleAudioTranscript(payload);
    if (type === 'audioStatus') $('loadingIndicator').querySelector('.thinking-label').textContent = payload.text || 'Razonando con el modelo...';
    if (typeof type === 'string' && type.startsWith('diff')) window.DiffActions?.handle(type, payload);
    if (type === 'status') window.MessageView?.toggleLoading(payload.loading);
    if (type === 'error') {
      appendErrorMessage(payload.message);
      if (payload.requestId) pendingAudioRequests.delete(payload.requestId);
    }
  });

  function renderModels(models = [], defaultModel) {
    if (!models.length) return;
    modelSelect.innerHTML = '';
    models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.name || m.id;
      if (m.id === defaultModel || (!defaultModel && m.id === 'smart-router')) opt.selected = true;
      modelSelect.appendChild(opt);
    });
  }

  function restoreSession(session) {
    vscode.postMessage({ type: 'discardAllDiffs' });
    currentSessionId = session.id;
    conversationHistory = [...(session.messages || [])];
    messagesList.innerHTML = '';
    if (welcomeMessage) welcomeMessage.classList.add('hidden');
    if (session.model) {
      modelSelect.value = session.model === 'huihui_ai/qwen2.5-coder-abliterate:7b' ? 'smart-router' : session.model;
    }
    conversationHistory.forEach((msg) => {
      if (msg.role === 'user') window.MessageView?.appendUser(msg.content);
      else window.MessageView?.appendAssistant(msg.content, session.model);
    });
  }

  function startNewChat() {
    vscode.postMessage({ type: 'discardAllDiffs' });
    currentSessionId = 'session_' + Date.now();
    conversationHistory = [];
    pendingAudioRequests.clear();
    messagesList.innerHTML = '';
    if (welcomeMessage) welcomeMessage.classList.remove('hidden');
    swarmTimeline.classList.add('hidden');
    window.MessageView?.resetTaskPlan();
    promptInput.value = '';
    resizePromptInput();
    promptInput.focus();
  }

  function sendPrompt(customText) {
    const text = typeof customText === 'string' ? customText : promptInput.value.trim();
    if (!text && attachedMedia.length === 0) return;
    if (welcomeMessage) welcomeMessage.classList.add('hidden');

    const mediaForRequest = [...attachedMedia];
    const displayText = text || mediaForRequest.map((item) => `${mediaIcon(item.category)} ${item.name || 'Adjunto'}`).join('\n');
    const requestId = `request_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const userRow = window.MessageView?.appendUser(displayText);
    promptInput.value = '';
    resizePromptInput();
    const userEntry = { role: 'user', content: text };
    conversationHistory.push(userEntry);
    if (mediaForRequest.some((item) => item.category === 'audio' || item.category === 'text')) {
      pendingAudioRequests.set(requestId, { userRow, userEntry });
    }

    const isSwarmMode = modeSelect.value === 'swarm';
    swarmTimeline.classList.toggle('hidden', !isSwarmMode && !webSearchEnabled);
    window.MessageView?.resetTaskPlan();
    if (isSwarmMode || webSearchEnabled) window.SwarmGraph?.begin();

    vscode.postMessage({
      type: 'sendMessage',
      payload: {
        sessionId: currentSessionId,
        requestId,
        model: modelSelect.value,
        messages: conversationHistory,
        skillKey: skillSelect.value,
        isSwarmMode,
        mediaItems: mediaForRequest,
        autoContext: window.WorkspaceView?.isAutoContextEnabled() ?? true,
        webSearchEnabled
      }
    });

    attachedMedia = [];
    renderMediaPreview();
  }

  function handleAiResponse(payload) {
    if (payload.revertedUndoId) window.MessageView?.markUndoUsed(payload.revertedUndoId, true);
    const pending = payload.requestId ? pendingAudioRequests.get(payload.requestId) : null;
    if (payload.transcribedPrompt && pending) {
      pending.userEntry.content = payload.transcribedPrompt;
    } else if (payload.transcribedPrompt && conversationHistory.length && conversationHistory[conversationHistory.length - 1].role === 'user') {
      conversationHistory[conversationHistory.length - 1].content = payload.transcribedPrompt;
    }
    conversationHistory.push({ role: 'assistant', content: payload.content });
    if (payload.requestId) pendingAudioRequests.delete(payload.requestId);
    window.MessageView?.appendAssistant(payload.content, payload.provider, {
      files: payload.fileChanges || [], undoId: payload.undoId || ''
    });
  }

  function handleAudioTranscript(payload = {}) {
    const pending = pendingAudioRequests.get(payload.requestId);
    if (!pending || !payload.text) return;
    const bubble = pending.userRow?.querySelector('.user-bubble');
    if (bubble) bubble.textContent = payload.displayText || payload.text;
    pending.userEntry.content = payload.text;
  }

  function appendErrorMessage(msg) {
    window.MessageView?.appendError(msg);
  }

  function handleSelection({ selectedText, language, actionType }) {
    if (!selectedText) {
      appendErrorMessage('Selecciona código en el editor antes de usar esta acción.');
      return;
    }
    const instructions = {
      explain: 'Explica este código y señala su propósito y posibles riesgos.',
      refactor: 'Refactoriza este código, conserva su comportamiento y explica los cambios.',
      fix: 'Busca errores en este código y propone una versión corregida.'
    };
    promptInput.value = `${instructions[actionType] || instructions.explain}\n\n\`\`\`${language || ''}\n${selectedText}\n\`\`\``;
    resizePromptInput();
    promptInput.focus();
  }

  function toggleVoiceDictation() {
    if (isRecording) {
      recognition?.stop();
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      appendErrorMessage('Este Webview no ofrece reconocimiento de voz. Puedes escribir o pegar el texto.');
      return;
    }
    const prefix = promptInput.value.trim();
    recognition = new SpeechRecognition();
    recognition.lang = 'es-CO';
    recognition.interimResults = true;
    recognition.onstart = () => { isRecording = true; btnMic.classList.add('mic-recording'); };
    recognition.onresult = (event) => {
      let confirmed = '', interim = '';
      for (let index = 0; index < event.results.length; index += 1) {
        const transcript = event.results[index][0].transcript.trim();
        if (event.results[index].isFinal) confirmed += `${transcript} `;
        else interim += `${transcript} `;
      }
      promptInput.value = [prefix, confirmed.trim(), interim.trim()].filter(Boolean).join(' ');
      resizePromptInput();
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        appendErrorMessage('VS Code bloqueó el acceso al micrófono en este Webview. Usa el dictado de Windows o escribe el mensaje; la transcripción cloud está desactivada para evitar cargos.');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        appendErrorMessage(`Dictado por voz: ${event.error}. Puedes escribir el mensaje; la transcripción cloud está desactivada para evitar cargos.`);
      }
    };
    recognition.onend = () => { isRecording = false; btnMic.classList.remove('mic-recording'); };
    try { recognition.start(); } catch (error) { appendErrorMessage(`No se pudo iniciar el dictado: ${error.message}`); }
  }

  function renderMediaPreview() {
    mediaPreview.innerHTML = '';
    mediaPreview.classList.toggle('hidden', attachedMedia.length === 0);
    attachedMedia.forEach((m, i) => {
      const tag = document.createElement('span'); tag.className = 'media-tag';
      tag.textContent = `${mediaIcon(m.category)} ${m.name || (m.category === 'audio' ? 'Audio' : m.category === 'text' ? 'Archivo' : 'Imagen')} ✕`;
      tag.onclick = () => { attachedMedia.splice(i, 1); renderMediaPreview(); };
      mediaPreview.appendChild(tag);
    });
  }

  // Event Listeners y Triggers
  btnAttach.onclick = () => mediaFileInput.click();
  btnRecommendLocalModel.onclick = () => vscode.postMessage({ type: 'recommendLocalModel' });
  btnInstallLocalModel.onclick = () => {
    const model = btnInstallLocalModel.dataset.model;
    if (model) vscode.postMessage({ type: 'installLocalModel', payload: { model } });
  };
  btnClearFolder.onclick = (event) => {
    event.stopPropagation();
    vscode.postMessage({ type: 'clearWorkspaceFolder' });
    setSelectedFolder(null);
  };
  folderDropChip.onclick = () => {
    if (!folderDropChip.dataset.path) vscode.postMessage({ type: 'pickWorkspaceFolder' });
  };

  function setSelectedFolder(folder) {
    const selected = Boolean(folder?.path);
    folderDropChip.classList.toggle('folder-selected', selected);
    folderDropChip.dataset.path = selected ? folder.path : '';
    folderDropName.textContent = selected
      ? `📂 Carpeta de tarea: ${folder.name}`
      : '📂 Arrastra una carpeta aquí para elegir el proyecto';
    folderDropChip.title = selected ? folder.path : 'Arrastra una carpeta local hasta aquí para usarla como contexto de lectura y escritura. También puedes pulsar para elegirla.';
    btnClearFolder.classList.toggle('hidden', !selected);
  }

  function filePathToUri(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    if (!normalized) return '';
    const segments = normalized.split('/').filter(Boolean);
    if (/^[a-z]:$/i.test(segments[0] || '')) segments[0] = segments[0].toUpperCase();
    return `file:///${segments.map((segment, index) => index === 0 && /^[A-Z]:$/.test(segment) ? segment : encodeURIComponent(segment)).join('/')}`;
  }

  function collectDroppedUris(value, output) {
    if (typeof value === 'string') {
      if (value.startsWith('file://')) output.add(value);
      else {
        const matches = value.match(/file:\/\/[^\s"'<>]+/g) || [];
        matches.forEach((uri) => output.add(uri.replace(/[),;]+$/, '')));
      }
      return;
    }
    if (Array.isArray(value)) { value.forEach((item) => collectDroppedUris(item, output)); return; }
    if (value && typeof value === 'object') {
      if (value.scheme === 'file' && typeof value.path === 'string') output.add(filePathToUri(value.fsPath || value.path));
      Object.values(value).forEach((item) => collectDroppedUris(item, output));
    }
  }

  function extractDroppedUris(dataTransfer) {
    const uris = new Set();
    const uriList = dataTransfer.getData('text/uri-list');
    uriList.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('file://')).forEach((uri) => uris.add(uri));
    const explorerData = dataTransfer.getData('application/vnd.code.tree.explorer');
    if (explorerData) {
      try { collectDroppedUris(JSON.parse(explorerData), uris); } catch { collectDroppedUris(explorerData, uris); }
    }
    const plainText = dataTransfer.getData('text/plain').trim();
    if (/^(?:[a-z]:\\|\\\\)/i.test(plainText)) uris.add(filePathToUri(plainText));
    return [...uris].slice(0, 20);
  }

  function mediaIcon(category) {
    return category === 'audio' ? '🎧' : category === 'text' ? '📄' : '🖼️';
  }

  const textExtensions = new Set([
    'c','cc','cpp','cs','css','dockerfile','go','gradle','gitignore','h','html','ini','java','js','jsx','json','kt','kts','makefile','md','php',
    'properties','ps1','py','rs','scss','sh','sql','svelte','toml','ts','tsx','txt','vue','xml','yaml','yml'
  ]);
  const audioMimeByExtension = {
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/m4a', aac: 'audio/aac',
    ogg: 'audio/ogg', flac: 'audio/flac', aiff: 'audio/aiff', aif: 'audio/aiff',
    webm: 'audio/webm', opus: 'audio/opus'
  };
  const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const sensitiveName = /(?:^\.env(?:\..*)?$|^local\.properties$|secret|credential|token|^id_(?:rsa|ed25519)|\.(?:pem|key|p12|pfx|jks|keystore)$)/i;

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  async function addFileAttachments(files) {
    const items = Array.from(files || []);
    let audioTotal = attachedMedia.filter((item) => item.category === 'audio').reduce((sum, item) => sum + (item.size || 0), 0);
    let textTotal = attachedMedia.filter((item) => item.category === 'text').reduce((sum, item) => sum + (item.size || 0), 0);
    let mediaTotal = attachedMedia.filter((item) => ['audio', 'image'].includes(item.category)).reduce((sum, item) => sum + (item.size || 0), 0);
    for (const file of items.slice(0, 12)) {
      const name = String(file.name || 'archivo').split(/[\\/]/).pop();
      const extension = name.split('.').pop().toLowerCase();
      if (sensitiveName.test(name)) { appendErrorMessage(`Por seguridad no adjunté «${name}» porque parece contener credenciales.`); continue; }
      const mimeType = audioMimeByExtension[extension] || file.type || '';
      if (textExtensions.has(extension) || /^text\//i.test(mimeType) || ['application/json','application/xml'].includes(mimeType)) {
        if (file.size > 64 * 1024 || textTotal + file.size > 160 * 1024) {
          appendErrorMessage('Los archivos de texto pueden pesar hasta 64 KB cada uno y 160 KB en conjunto.');
          continue;
        }
        try {
          const content = await file.text();
          if (content.includes('\u0000')) { appendErrorMessage(`No adjunté «${name}» porque parece binario.`); continue; }
          attachedMedia.push({ category: 'text', mimeType: mimeType || 'text/plain', content, name, size: file.size });
          textTotal += file.size;
        } catch (error) { appendErrorMessage(error.message); }
        continue;
      }
      const category = mimeType.startsWith('audio/') ? 'audio' : 'image';
      const validType = category === 'audio'
        ? Object.values(audioMimeByExtension).includes(mimeType)
        : imageTypes.has(mimeType);
      const maxBytes = category === 'audio' ? 12 * 1024 * 1024 : 8 * 1024 * 1024;
      if (!validType || file.size > maxBytes || (category === 'audio' && audioTotal + file.size > maxBytes) || mediaTotal + file.size > 20 * 1024 * 1024) {
        appendErrorMessage(category === 'audio'
          ? 'Adjunta audio MP3, WAV, M4A, AAC, OGG, FLAC, AIFF, WebM u Opus. El audio total debe ser de hasta 12 MB y los medios juntos hasta 20 MB.'
          : `No reconozco «${name}». Adjunta código/documentos de texto, imágenes PNG/JPEG/WebP/GIF o audio compatible.`);
        continue;
      }
      try {
        const data = await readAsDataUrl(file);
        attachedMedia.push({ mimeType, data, name, size: file.size, category });
        if (category === 'audio') audioTotal += file.size;
        mediaTotal += file.size;
      } catch (error) { appendErrorMessage(error.message); }
    }
    if (items.length > 12) appendErrorMessage('Adjunté solo los primeros 12 archivos de la selección.');
    renderMediaPreview();
  }

  function handleImportedFiles(payload = {}) {
    for (const item of payload.files || []) {
      if (item?.category === 'text' && typeof item.content === 'string') attachedMedia.push(item);
      else if (['image', 'audio'].includes(item?.category) && typeof item.data === 'string') attachedMedia.push(item);
    }
    renderMediaPreview();
    if (payload.directories?.length) {
      setSelectedFolder(payload.directories[0]);
    }
    if (payload.skipped?.length) appendErrorMessage(payload.skipped.join('\n'));
  }

  [document, folderDropChip, $('chatContainer')].forEach((target) => {
    if (!target) return;
    target.addEventListener('dragover', (event) => {
      const types = Array.from(event.dataTransfer?.types || []);
      if (types.some((type) => /uri-list|tree\.explorer|Files/i.test(type)) || event.dataTransfer?.files?.length) {
        event.preventDefault();
        folderDropChip.classList.add('folder-drop-active');
      }
    });
    target.addEventListener('dragleave', (event) => {
      if (!target.contains(event.relatedTarget)) folderDropChip.classList.remove('folder-drop-active');
    });
    target.addEventListener('drop', (event) => {
      folderDropChip.classList.remove('folder-drop-active');
      const transfer = event.dataTransfer;
      const containsFolder = Array.from(transfer?.items || []).some((item) => {
          try { return item.webkitGetAsEntry?.()?.isDirectory; } catch { return false; }
      });
      const files = Array.from(transfer?.files || []);
      const fileUris = extractDroppedUris(transfer);
      if (files.length && !containsFolder) {
        event.preventDefault(); event.stopPropagation();
        addFileAttachments(files);
        return;
      }
      if (fileUris.length) {
        event.preventDefault(); event.stopPropagation();
        vscode.postMessage({ type: 'importDroppedItems', payload: { uris: fileUris } });
        return;
      }
      if (!containsFolder) return;
      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({ type: 'pickWorkspaceFolder' });
    });
  });
  mediaFileInput.onchange = async (e) => {
    await addFileAttachments(e.target.files);
    mediaFileInput.value = '';
  };

  btnSend.onclick = () => sendPrompt();
  btnMic.onclick = toggleVoiceDictation;
  btnWebSearch.onclick = () => {
    webSearchEnabled = !webSearchEnabled;
    btnWebSearch.setAttribute('aria-pressed', String(webSearchEnabled));
    btnWebSearch.title = 'Búsqueda web desactivada en modo sin costo; esta solicitud no consultará Internet';
  };
  promptInput.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); } };
  promptInput.addEventListener('input', resizePromptInput);
  window.addEventListener('resize', resizePromptInput);
  resizePromptInput();
  btnNewChat.onclick = startNewChat;
  btnHistory.onclick = () => window.HistoryView?.toggle(true);
  btnSettings.onclick = () => window.SettingsView?.toggle(true);
})();
