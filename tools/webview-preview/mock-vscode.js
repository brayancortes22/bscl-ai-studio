/*
 * Simulación de `acquireVsCodeApi` para previsualizar el webview en un navegador.
 * Reproduce los mensajes que envía view-provider.js con datos de ejemplo, de modo que
 * cada escena (?scene=...) recorre el mismo código que corre dentro de VS Code.
 */
(function () {
  const params = new URLSearchParams(location.search);
  const scene = params.get('scene') || 'empty';
  const theme = ['dark', 'light', 'hc'].includes(params.get('theme')) ? params.get('theme') : 'dark';
  document.documentElement.dataset.previewTheme = theme;
  if (params.get('frame') === 'sidebar') document.documentElement.dataset.previewFrame = 'sidebar';
  const bodyClass = theme === 'light' ? 'vscode-light' : theme === 'hc' ? 'vscode-high-contrast' : 'vscode-dark';
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add(bodyClass);
    document.body.dataset.vscodeThemeKind = bodyClass;
  });

  const sent = [];
  window.__previewSent = sent;
  const toWebview = (type, payload) => window.postMessage({ type, payload }, '*');
  const later = (ms, fn) => setTimeout(fn, ms);

  const models = [
    { id: 'smart-router', name: 'Automático · cascada gratuita' },
    { id: 'gemini:gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
    { id: 'groq:qwen/qwen3.8-27b', name: 'Groq · Qwen 3.8 27B' },
    { id: 'zai:glm-4.7-flash', name: 'Z.ai · GLM-4.7-Flash (gratis)' },
    { id: 'openrouter:openrouter/free', name: 'OpenRouter · modelo gratuito' },
    { id: 'ollama:qwen2.5-coder:7b', name: 'Ollama · qwen2.5-coder:7b' }
  ];
  const activeContext = {
    activeEditor: { fileName: 'view-provider.js', relativePath: 'src/view-provider.js', language: 'javascript', lineCount: 487, selectedText: '' },
    openEditors: [{ label: 'view-provider.js', isActive: true }, { label: 'styles.css', isActive: false }],
    workspaceDirectories: ['docs', 'media', 'src', 'webview'],
    workspaceFolderTree: ['docs', 'media', 'src', 'src/agents', 'webview'],
    selectedFolder: scene === 'empty' ? null : 'bscl-ai-studio',
    selectedFolderPath: scene === 'empty' ? null : 'C:/Proyectos/bscl-ai-studio'
  };
  const now = Date.now();
  const sessions = [
    { id: 's1', title: 'Refactorizar el cliente de proveedores', model: 'smart-router', messageCount: 8, updatedAt: now - 36e5 },
    { id: 's2', title: '¿Por qué falla la cascada cuando Gemini devuelve 429?', model: 'gemini:gemini-3.8-flash', messageCount: 4, updatedAt: now - 864e5 },
    { id: 's3', title: 'Revisar <b>seguridad</b> del webview & CSP', model: 'ollama:qwen2.5-coder:7b', messageCount: 12, updatedAt: now - 3 * 864e5 },
    { id: 's4', title: 'Plan de tests para workspace-change-manager', model: 'groq:qwen/qwen3.8-27b', messageCount: 2, updatedAt: now - 20 * 864e5 }
  ];
  const fullSessions = {
    s1: { id: 's1', title: sessions[0].title, model: 'smart-router', skillKey: 'clean-code', messages: [
      { role: 'user', content: '¿Puedes separar la cascada de proveedores en funciones más pequeñas?' },
      { role: 'assistant', content: [
        'Sí. Propongo tres funciones:', '',
        '1. `pickProvider()`', '2. `callWithCooldown()`', '3. `fallbackChain()`', '',
        '```js',
        'async function fallbackChain(steps) {',
        '  for (const step of steps) {',
        '    try { return await step(); } catch (error) { /* siguiente */ }',
        '  }',
        "  throw new Error('Ningún proveedor respondió');",
        '}',
        '```'
      ].join('\n') }
    ] }
  };
  const apiConfig = {
    secrets: {
      geminiApiKey: { configured: true, hint: 'x9Qa' }, groqApiKey: { configured: false }, zaiApiKey: { configured: true, hint: '7c2e' }, openRouterApiKey: { configured: true, hint: '41f0' },
      xaiApiKey: { configured: false }, metaApiKey: { configured: false }
    },
    groqFreeEnabled: false, freeCloudEnabled: true, ollamaUrl: 'http://localhost:11434'
  };
  const plan = {
    title: 'Añadir validación al formulario de ajustes', goal: 'Validar las URLs locales antes de guardarlas y avisar del error en línea.',
    intent: 'coding_implementation',
    steps: ['Leer settings.js y config-manager.js', 'Validar URL de Ollama y Smart Router', 'Mostrar el error junto al campo', 'Revisar con QA'],
    agents: ['Arquitecto', 'Programador', 'Auditor QA'],
    subtasks: [{ title: 'Inventario de campos' }, { title: 'Reglas de validación' }, { title: 'Mensajes de error' }]
  };
  const answer = [
    '## Validación de URLs locales',
    '',
    'He añadido una comprobación en **`ConfigManager.saveConfig`** para que solo se acepten URLs `http://localhost` o `127.0.0.1`.',
    '',
    '1. Si la URL no es local, se rechaza y el campo muestra el error.',
    '2. El resto de la configuración se guarda igual.',
    '',
    '- Cubre `ollamaUrl` y `smartRouterUrl`.',
    '- No cambia el formato guardado.',
    '',
    '> Las claves siguen en SecretStorage; esta validación no las toca.',
    '',
    '```javascript',
    'function isLocalUrl(value) {',
    '  const url = new URL(value);',
    "  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);",
    '}',
    '```',
    '',
    'Más detalles en la [guía de configuración](https://code.visualstudio.com/api).'
  ].join('\n');

  function runConversation(finish) {
    const input = document.getElementById('promptInput');
    const sendBtn = document.getElementById('btnSend');
    if (!input || !sendBtn) return;
    input.value = 'Valida las URLs de Ollama y del Smart Router antes de guardarlas';
    input.dispatchEvent(new Event('input'));
    sendBtn.click();
    later(60, () => {
      toWebview('status', { loading: true });
      toWebview('taskPlan', plan);
      toWebview('swarmProgress', { agentId: 'architect', agent: 'Arquitecto', state: 'completed', status: 'Plan listo: 3 archivos.', model: 'Gemini 3.8 Flash' });
      toWebview('swarmProgress', { agentId: 'coder', agent: 'Programador', state: finish ? 'completed' : 'working', status: finish ? 'Cambios generados.' : 'Escribiendo config-manager.js…', model: 'Gemini 3.8 Flash' });
      toWebview('swarmProgress', { agentId: 'subagent-1', agent: 'Inventario de campos', state: 'completed', status: 'Hecho' });
      toWebview('swarmProgress', { agentId: 'subagent-2', agent: 'Reglas de validación', state: finish ? 'completed' : 'working', status: finish ? 'Hecho' : 'Trabajando…' });
      toWebview('swarmProgress', { agentId: 'critic', state: 'skipped', status: 'Sin cambios visuales.' });
      toWebview('swarmProgress', { agentId: 'qa', state: finish ? 'completed' : 'queued', status: finish ? 'Sin hallazgos bloqueantes.' : 'En espera', model: 'Groq · Qwen 3.8 27B' });
      if (!finish) return;
      later(60, () => {
        toWebview('aiResponse', {
          content: answer, provider: 'Gemini 3.8 Flash', requestId: sent.find((m) => m.type === 'sendMessage')?.payload?.requestId,
          fileChanges: [{ action: 'modificado', path: 'src/config-manager.js' }, { action: 'creado', path: 'test/config-manager.test.js' }],
          undoId: 'undo_preview_1'
        });
        toWebview('error', { message: 'Groq devolvió 429 (cuota agotada). Se continuó con OpenRouter :free.' });
        toWebview('status', { loading: false });
      });
    });
  }

  function onReady() {
    toWebview('modelsList', { models, defaultModel: 'smart-router' });
    toWebview('activeContext', activeContext);
    toWebview('historyList', { sessions });
    toWebview('apiConfig', apiConfig);
    later(50, () => {
      if (scene === 'conversation') runConversation(true);
      if (scene === 'working') runConversation(false);
      if (scene === 'settings') toWebview('command', { action: 'settings' });
      if (scene === 'history') toWebview('command', { action: 'history' });
      if (scene === 'restored') toWebview('sessionLoaded', { session: fullSessions.s1 });
    });
  }

  function handle(message) {
    sent.push(message);
    switch (message?.type) {
      case 'ready': later(0, onReady); break;
      case 'testProviders':
        later(300, () => toWebview('testProvidersResult', {
          zai: { status: 'online', configured: true }, ollama: { status: 'online' }, gemini: { status: 'online', configured: true },
          groq: { status: 'offline', enabled: false }, openrouter: { status: 'offline', configured: false },
          grok: { configured: false }, meta: { configured: false }, freeCloud: { status: 'offline' }
        }));
        break;
      case 'saveApiConfig': later(100, () => toWebview('apiConfigSaved', { success: true })); break;
      case 'getHistory': later(0, () => toWebview('historyList', { sessions })); break;
      case 'getApiConfig': later(0, () => toWebview('apiConfig', apiConfig)); break;
      case 'loadSession': if (fullSessions[message.payload?.id]) later(0, () => toWebview('sessionLoaded', { session: fullSessions[message.payload.id] })); break;
      case 'cancelRequest': later(50, () => { toWebview('requestCancelled', { requestId: message.payload?.requestId }); toWebview('status', { loading: false }); }); break;
      case 'recommendLocalModel':
        later(200, () => toWebview('localModelRecommendation', { model: 'qwen2.5-coder:7b', installed: false, message: '16 GB de RAM: qwen2.5-coder:7b cabe con margen.' }));
        break;
      default: break;
    }
  }

  let state;
  window.acquireVsCodeApi = function () {
    return {
      postMessage: (message) => { console.debug('[webview → extensión]', message); handle(message); },
      getState: () => state,
      setState: (value) => { state = value; return value; }
    };
  };
})();
