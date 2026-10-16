// Frontera webview ↔ extensión: CSP, cola de comandos, validación de mensajes y cancelación.
const { state, reset, createExtensionContext } = require('./helpers/vscode-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BsclChatViewProvider } = require('../src/view-provider');

function setup() {
  reset();
  const context = createExtensionContext();
  const provider = new BsclChatViewProvider(context.extensionUri, context);
  // Sin red en los tests: la lista de modelos es fija.
  provider.aiClient.listAllModels = async () => [{ id: 'smart-router', name: 'Automático' }];
  provider.reveal = async () => {};
  const sent = [];
  const view = {
    visible: true,
    webview: {
      options: {}, html: '', cspSource: 'https://webview.test',
      asWebviewUri: (uri) => ({ toString: () => `https://webview.test/${path.basename(uri.fsPath)}` }),
      postMessage: (message) => { sent.push(message); return Promise.resolve(true); },
      onDidReceiveMessage: () => ({ dispose() {} })
    },
    onDidDispose: () => ({ dispose() {} }),
    onDidChangeVisibility: () => ({ dispose() {} })
  };
  return { provider, view, sent, context };
}

const ofType = (sent, type) => sent.filter((message) => message.type === type);

test('el HTML usa un nonce en la CSP y en cada script, sin marcadores pendientes', () => {
  const { provider, view } = setup();
  const html = provider.getHtmlForWebview(view.webview);
  const nonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
  assert.ok(nonce && nonce.length >= 16, 'falta el nonce en la CSP');
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  assert.ok(scripts.length > 3);
  scripts.forEach((tag) => assert.ok(tag.includes(`nonce="${nonce}"`), tag));
  assert.ok(!/\{\{[^}]+\}\}/.test(html), 'quedan marcadores {{…}} sin sustituir');
  assert.ok(!html.includes("'unsafe-inline'"), 'la CSP no debe permitir estilos o scripts en línea');
  const assets = [...html.matchAll(/(?:src|href)="(https:\/\/webview\.test\/[^"]+)"/g)].map((match) => path.basename(match[1]));
  assets.forEach((file) => assert.ok(fs.existsSync(path.join(__dirname, '..', 'webview', file)), `falta webview/${file}`));
});

test('un comando antes de que el webview esté listo se entrega al recibir "ready"', async () => {
  const { provider, view, sent } = setup();
  await provider.runCommand('history');
  provider.resolveWebviewView(view);
  assert.equal(ofType(sent, 'command').length, 0, 'no se envía antes de ready');
  await provider.handleMessage({ type: 'ready' });
  assert.deepEqual(ofType(sent, 'command').map((message) => message.payload.action), ['history']);
});

test('solo abre enlaces http(s) y mailto', async () => {
  const { provider } = setup();
  await provider.handleMessage({ type: 'openExternal', payload: { url: 'javascript:alert(1)' } });
  await provider.handleMessage({ type: 'openExternal', payload: { url: 'command:workbench.action.terminal.new' } });
  await provider.handleMessage({ type: 'openExternal', payload: { url: 'https://code.visualstudio.com/api' } });
  assert.deepEqual(state.openedExternal, ['https://code.visualstudio.com/api']);
});

test('no abre archivos fuera de la carpeta de trabajo', async () => {
  const { provider, view, sent } = setup();
  provider.resolveWebviewView(view);
  await provider.handleMessage({ type: 'ready' });
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bscl-'));
  const root = path.join(base, 'proyecto');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'hola');
  fs.writeFileSync(path.join(base, 'fuera.txt'), 'secreto');
  provider.workspaceScope = fs.realpathSync(root);
  await provider.handleMessage({ type: 'openFile', payload: { path: '../fuera.txt' } });
  await provider.handleMessage({ type: 'openFile', payload: { path: 'a.txt' } });
  assert.equal(state.openedDocuments.length, 1);
  assert.ok(state.openedDocuments[0].endsWith('a.txt'));
  assert.ok(ofType(sent, 'notice').some((message) => /fuera\.txt/.test(message.payload.message)));
});

test('rechaza una segunda petición mientras hay otra en curso', async () => {
  const { provider, view, sent } = setup();
  provider.resolveWebviewView(view);
  await provider.handleMessage({ type: 'ready' });
  provider.activeRequest = { id: 'r1', controller: new AbortController() };
  await provider.handleMessage({ type: 'sendMessage', payload: { sessionId: 's', requestId: 'r2', messages: [{ role: 'user', content: 'hola' }] } });
  const errors = ofType(sent, 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].payload.requestId, 'r2');
});

test('cancelRequest aborta solo la petición indicada', async () => {
  const { provider } = setup();
  const controller = new AbortController();
  provider.activeRequest = { id: 'r1', controller };
  await provider.handleMessage({ type: 'cancelRequest', payload: { requestId: 'otra' } });
  assert.equal(controller.signal.aborted, false);
  await provider.handleMessage({ type: 'cancelRequest', payload: { requestId: 'r1' } });
  assert.equal(controller.signal.aborted, true);
});

test('una petición cancelada responde requestCancelled, no error', async () => {
  const { provider, view, sent } = setup();
  provider.resolveWebviewView(view);
  await provider.handleMessage({ type: 'ready' });
  provider.aiClient.sendMessage = ({ }) => new Promise((resolve, reject) => {
    setTimeout(() => provider.activeRequest?.controller.abort(), 5);
    setTimeout(() => { const error = new Error('Solicitud cancelada.'); error.name = 'AbortError'; reject(error); }, 15);
  });
  await provider.handleMessage({ type: 'sendMessage', payload: { sessionId: 's', requestId: 'r9', isSwarmMode: false, autoContext: false, messages: [{ role: 'user', content: 'hola' }] } });
  assert.equal(ofType(sent, 'requestCancelled').length, 1);
  assert.equal(ofType(sent, 'error').length, 0);
  assert.equal(provider.activeRequest, null);
  assert.equal(ofType(sent, 'status').at(-1).payload.loading, false);
});

test('guardar ajustes inválidos responde con el campo y no lanza', async () => {
  const { provider, view, sent } = setup();
  provider.resolveWebviewView(view);
  await provider.handleMessage({ type: 'ready' });
  await provider.handleMessage({ type: 'saveApiConfig', payload: { ollamaUrl: 'http://10.0.0.5:11434' } });
  const [result] = ofType(sent, 'apiConfigSaved');
  assert.equal(result.payload.success, false);
  assert.equal(result.payload.field, 'ollamaUrl');
});

test('vaciar el historial pide confirmación y no borra si se cancela', async () => {
  const { provider } = setup();
  await provider.historyManager.saveSession({ id: 's', messages: [{ role: 'user', content: 'x' }] });
  state.warningAnswer = undefined;
  await provider.handleMessage({ type: 'clearAllChats' });
  assert.equal(provider.historyManager.listSessions().length, 1);
  state.warningAnswer = 'Borrar todo';
  await provider.handleMessage({ type: 'clearAllChats' });
  assert.equal(provider.historyManager.listSessions().length, 0);
});

test('el host ya no acepta execTerminal', async () => {
  const { provider } = setup();
  await provider.handleMessage({ type: 'execTerminal', payload: { cmd: 'rm -rf /' } });
  assert.equal(state.terminals.length, 0);
});

test('FS-2: las huellas leídas para el contexto llegan a applyChanges', async () => {
  const { WorkspaceContext } = require('../src/workspace-context');
  const { WorkspaceChangeManager } = require('../src/workspace-change-manager');
  const originals = { build: WorkspaceContext.build, apply: WorkspaceChangeManager.applyChanges, risk: WorkspaceChangeManager.assessRisk };
  const calls = {};
  WorkspaceContext.build = async (prompt, scope, baseHashes) => { calls.buildMap = baseHashes; baseHashes?.set('a.js', 'f'.repeat(64)); return 'CONTEXTO DEL WORKSPACE: a.js'; };
  WorkspaceChangeManager.assessRisk = () => ({ deletes: [], renames: [], shrunk: [] });
  WorkspaceChangeManager.applyChanges = async (ops, scope, options) => { calls.applyOptions = options; return { files: [{ path: 'a.js', action: 'editado' }], undoId: 'u1' }; };
  try {
    const { provider, view, sent } = setup();
    provider.resolveWebviewView(view);
    await provider.handleMessage({ type: 'ready' });
    provider.swarm.runSwarm = async () => ({ intent: 'coding_implementation', content: 'Hecho.', provider: 'test', workspaceFiles: [{ path: 'a.js', content: 'nuevo' }] });
    await provider.handleMessage({ type: 'sendMessage', payload: {
      sessionId: 's', requestId: 'r1', isSwarmMode: true, autoContext: false,
      messages: [{ role: 'user', content: 'Implementa la función suma en a.js y crea el archivo' }]
    } });
    assert.ok(calls.applyOptions?.baseHashes instanceof Map, 'applyChanges debe recibir baseHashes');
    assert.ok(calls.buildMap instanceof Map, 'una implementación debe construir el contexto con una tabla de huellas');
    assert.equal(calls.applyOptions.baseHashes, calls.buildMap, 'debe ser la misma tabla que rellenó build');
    assert.equal(calls.applyOptions.baseHashes.get('a.js'), 'f'.repeat(64));
    const [response] = ofType(sent, 'aiResponse');
    assert.equal(response.payload.undoId, 'u1');
    assert.ok(!('workspaceFiles' in response.payload), 'el contenido de los archivos no viaja al webview');
  } finally {
    WorkspaceContext.build = originals.build;
    WorkspaceChangeManager.applyChanges = originals.apply;
    WorkspaceChangeManager.assessRisk = originals.risk;
  }
});

test('un mensaje que solo traía audio responde con un aviso, no con un fallo del proveedor', async () => {
  const { provider, view, sent } = setup();
  provider.resolveWebviewView(view);
  await provider.handleMessage({ type: 'ready' });
  await provider.handleMessage({ type: 'sendMessage', payload: {
    sessionId: 's', requestId: 'r2', autoContext: false, messages: [{ role: 'user', content: '' }],
    mediaItems: [{ category: 'audio', name: 'nota.mp3', mimeType: 'audio/mpeg', data: 'data:audio/mpeg;base64,AAAA', size: 4 }]
  } });
  const errors = ofType(sent, 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].payload.kind, 'warning');
  assert.match(errors[0].payload.message, /audio/i);
});

test('borrar o renombrar pide confirmación; cancelar no aplica nada', async () => {
  const { WorkspaceChangeManager } = require('../src/workspace-change-manager');
  const originals = { apply: WorkspaceChangeManager.applyChanges, risk: WorkspaceChangeManager.assessRisk };
  let applied = null;
  WorkspaceChangeManager.assessRisk = () => ({ deletes: ['viejo.js'], renames: [], shrunk: [] });
  WorkspaceChangeManager.applyChanges = async (ops) => { applied = ops; return { files: [], undoId: 'u' }; };
  try {
    const { provider } = setup();
    const response = { content: 'ok', intent: 'coding_implementation', workspaceFiles: [{ path: 'a.js', content: 'x' }], workspaceDelete: ['viejo.js'] };
    state.warningAnswer = undefined;
    await provider.applyResponseChanges(response, null, new AbortController().signal, new Map());
    assert.equal(applied, null, 'con la confirmación cancelada no se escribe nada');
    assert.match(response.content, /cancelaste/);
    state.warningAnswer = 'Solo crear y editar';
    await provider.applyResponseChanges({ ...response, content: 'ok' }, null, new AbortController().signal, new Map());
    assert.deepEqual(applied.delete, []);
    assert.equal(applied.files.length, 1);
  } finally {
    WorkspaceChangeManager.applyChanges = originals.apply;
    WorkspaceChangeManager.assessRisk = originals.risk;
  }
});
