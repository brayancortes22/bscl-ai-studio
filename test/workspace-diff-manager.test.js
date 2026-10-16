// DiffManager: contrato de mensajes con el webview (diffPrepared / diffResolved / diffError).
const { vscode, state, reset, makeUri } = require('./helpers/vscode-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const { DiffManager } = require('../src/diff-manager');

const languages = [];
vscode.languages.setTextDocumentLanguage = async (doc, language) => {
  languages.push(language);
  if (language === 'no-existe') throw new Error('Unknown language id');
  return doc;
};

function webview() {
  const messages = [];
  return { messages, postMessage: (message) => { messages.push(message); return true; } };
}
function setEditor({ scheme = 'untitled', languageId = 'plaintext', text = 'abc' } = {}) {
  state.activeTextEditor = {
    document: {
      uri: makeUri('Untitled-1', scheme), fileName: 'Untitled-1', languageId, version: 1,
      getText: () => text, offsetAt: (position) => position.character
    },
    selection: new vscode.Selection(new vscode.Position(0, 1), new vscode.Position(0, 2))
  };
}

test('rechaza preparar un Diff sobre la vista previa de otra propuesta', async () => {
  reset();
  setEditor({ scheme: 'bscl-ai-proposal' });
  const manager = new DiffManager({ subscriptions: [] });
  const view = webview();
  await manager.handleMessage('prepareDiff', { code: 'x', codeKey: 'k1' }, view);
  assert.equal(view.messages[0].type, 'diffError');
  assert.equal(view.messages[0].payload.codeKey, 'k1');
  assert.match(view.messages[0].payload.message, /Diff de otra propuesta/);
});

test('acepta celdas de notebook y ajustes de usuario; rechaza solo los esquemas de solo lectura', async () => {
  // Como en VS Code: git: tiene un proveedor de archivos de solo lectura; las celdas de
  // notebook y untitled no tienen proveedor (undefined); vscode-userdata es escribible.
  const writable = { git: false, 'vscode-userdata': true, file: true };
  vscode.workspace.fs.isWritableFileSystem = (scheme) => writable[scheme];
  try {
    const manager = new DiffManager({ subscriptions: [] });
    const results = {};
    for (const scheme of ['vscode-notebook-cell', 'vscode-userdata', 'vscode-remote', 'git']) {
      reset();
      setEditor({ scheme });
      const view = webview();
      await manager.handleMessage('prepareDiff', { code: 'x', codeKey: scheme }, view);
      results[scheme] = view.messages[0].type;
      if (scheme === 'git') assert.match(view.messages[0].payload.message, /solo lectura \(git\)/);
    }
    assert.deepEqual(results, {
      'vscode-notebook-cell': 'diffPrepared',
      'vscode-userdata': 'diffPrepared',
      'vscode-remote': 'diffPrepared',
      git: 'diffError'
    });
  } finally {
    delete vscode.workspace.fs.isWritableFileSystem;
  }
});

test('usa el lenguaje del bloque para la vista previa de un documento en texto plano', async () => {
  reset();
  languages.length = 0;
  setEditor();
  const manager = new DiffManager({ subscriptions: [] });
  const view = webview();
  await manager.handleMessage('prepareDiff', { code: 'print(1)', codeKey: 'k2', language: 'py' }, view);
  assert.equal(view.messages[0].type, 'diffPrepared');
  assert.equal(view.messages[0].payload.codeKey, 'k2');
  assert.ok(view.messages[0].payload.proposalId);
  assert.deepEqual(languages, ['python']);
});

test('conserva el lenguaje del documento y no falla si el languageId no existe', async () => {
  reset();
  languages.length = 0;
  setEditor({ languageId: 'javascript' });
  const manager = new DiffManager({ subscriptions: [] });
  const view = webview();
  await manager.handleMessage('prepareDiff', { code: 'x', codeKey: 'k3', language: 'py' }, view);
  assert.deepEqual(languages, ['javascript']);

  setEditor();
  await manager.handleMessage('prepareDiff', { code: 'x', codeKey: 'k4', language: 'no-existe' }, view);
  assert.equal(view.messages[1].type, 'diffPrepared');
});

test('descartar una propuesta ya cerrada devuelve el codeKey del mensaje', async () => {
  reset();
  setEditor();
  const manager = new DiffManager({ subscriptions: [] });
  const view = webview();
  await manager.handleMessage('prepareDiff', { code: 'x', codeKey: 'k5' }, view);
  const { proposalId } = view.messages[0].payload;
  await manager.handleMessage('discardDiff', { proposalId, codeKey: 'k5' }, view);
  await manager.handleMessage('discardDiff', { proposalId, codeKey: 'k5' }, view);
  assert.deepEqual(view.messages.slice(1).map((message) => message.payload), [
    { codeKey: 'k5', outcome: 'discarded' },
    { codeKey: 'k5', outcome: 'discarded' }
  ]);
});
