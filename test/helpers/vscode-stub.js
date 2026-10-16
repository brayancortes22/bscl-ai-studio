/**
 * Sustituto mínimo del módulo `vscode` para ejecutar tests con `node --test`.
 *
 * Por qué: el módulo `vscode` solo existe dentro del Extension Host. Casi todo el código
 * de src/ lo importa aunque la lógica que importa probar (rutas, cascada, parsing) no lo
 * use. Este stub se registra en la caché de `require` antes de cargar cualquier módulo de
 * src/, y expone `state` para que cada test ajuste carpetas, configuración o editor activo.
 *
 * Uso en un test:  const { state, reset } = require('./helpers/vscode-stub');
 */
const Module = require('module');
const path = require('path');

const state = {
  workspaceFolders: [],
  configuration: {},
  // Valores fijados por el .vscode/settings.json del workspace (inspect().workspaceValue).
  workspaceConfiguration: {},
  activeTextEditor: undefined,
  terminals: [],
  messages: [],
  executedCommands: [],
  openedExternal: [],
  openedDocuments: [],
  clipboard: '',
  // Respuesta que devolverán los diálogos showWarningMessage (undefined = cancelar).
  warningAnswer: undefined
};

function reset() {
  state.workspaceFolders = [];
  state.configuration = {};
  state.workspaceConfiguration = {};
  state.activeTextEditor = undefined;
  state.terminals = [];
  state.messages = [];
  state.executedCommands = [];
  state.openedExternal = [];
  state.openedDocuments = [];
  state.clipboard = '';
  state.warningAnswer = undefined;
}

function makeUri(fsPath, scheme = 'file') {
  const normalized = String(fsPath);
  return {
    scheme,
    fsPath: normalized,
    path: normalized.replace(/\\/g, '/'),
    toString() { return `${scheme}://${normalized.replace(/\\/g, '/')}`; },
    with(change = {}) { return makeUri(change.path ?? normalized, change.scheme ?? scheme); }
  };
}

class EventEmitter {
  constructor() { this.listeners = new Set(); this.event = (fn) => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; }; }
  fire(value) { this.listeners.forEach((fn) => fn(value)); }
  dispose() { this.listeners.clear(); }
}

class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(start, end) { this.start = start; this.end = end; } }
class Selection extends Range { get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; } }
class WorkspaceEdit {
  constructor() { this.edits = []; }
  replace(uri, range, text) { this.edits.push({ type: 'replace', uri, range, text }); }
  insert(uri, position, text) { this.edits.push({ type: 'insert', uri, position, text }); }
  createFile(uri, options) { this.edits.push({ type: 'createFile', uri, options }); }
  deleteFile(uri, options) { this.edits.push({ type: 'deleteFile', uri, options }); }
}

const disposable = { dispose() {} };

const vscode = {
  Uri: {
    file: (p) => makeUri(path.resolve(p)),
    parse: (value) => {
      const match = /^([a-z][\w+.-]*):\/\/(.*)$/i.exec(String(value));
      if (!match) return makeUri(String(value), 'file');
      let rest = decodeURIComponent(match[2]);
      if (match[1] === 'file' && /^\/[a-z]:/i.test(rest)) rest = rest.slice(1);
      return makeUri(rest, match[1]);
    },
    from: ({ scheme, path: p }) => makeUri(p, scheme),
    joinPath: (base, ...parts) => makeUri(path.join(base.fsPath, ...parts), base.scheme)
  },
  workspace: {
    get workspaceFolders() { return state.workspaceFolders.length ? state.workspaceFolders.map((p, index) => ({ uri: makeUri(p), name: path.basename(p), index })) : undefined; },
    getConfiguration: () => ({
      // Como VS Code: el valor de workspace gana en get(), pero inspect() los separa.
      get: (key, fallback) => (key in state.workspaceConfiguration ? state.workspaceConfiguration[key]
        : key in state.configuration ? state.configuration[key] : fallback),
      inspect: (key) => ({ key, globalValue: state.configuration[key], workspaceValue: state.workspaceConfiguration[key], defaultValue: undefined }),
      update: async (key, value) => { state.configuration[key] = value; },
      has: (key) => key in state.configuration
    }),
    openTextDocument: async () => ({ getText: () => '', languageId: 'plaintext', lineCount: 0, uri: makeUri('untitled') }),
    applyEdit: async () => true,
    registerTextDocumentContentProvider: () => disposable,
    onDidChangeConfiguration: () => disposable,
    fs: { readFile: async () => new Uint8Array(), writeFile: async () => {}, stat: async () => ({}) }
  },
  window: {
    get activeTextEditor() { return state.activeTextEditor; },
    visibleTextEditors: [],
    get terminals() { return state.terminals; },
    tabGroups: { all: [], close: async () => true },
    createTerminal: (name) => { const terminal = { name, show() {}, sendText(text) { this.sent = (this.sent || []).concat(text); } }; state.terminals.push(terminal); return terminal; },
    showWarningMessage: async (message) => { state.messages.push({ level: 'warning', message }); return state.warningAnswer; },
    showTextDocument: async (uri) => { state.openedDocuments.push(uri.fsPath || String(uri)); return {}; },
    showInformationMessage: async (message) => { state.messages.push({ level: 'info', message }); },
    showErrorMessage: async (message) => { state.messages.push({ level: 'error', message }); },
    showOpenDialog: async () => undefined,
    registerWebviewViewProvider: () => disposable,
    onDidChangeActiveTextEditor: () => disposable,
    onDidChangeTextEditorSelection: () => disposable,
    onDidChangeVisibleTextEditors: () => disposable
  },
  commands: {
    registerCommand: () => disposable,
    executeCommand: async (...args) => { state.executedCommands.push(args); }
  },
  env: {
    openExternal: async (uri) => { state.openedExternal.push(String(uri)); return true; },
    clipboard: { writeText: async (text) => { state.clipboard = text; }, readText: async () => state.clipboard }
  },
  languages: { setTextDocumentLanguage: async (doc) => doc },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ViewColumn: { Active: -1, Beside: -2, One: 1 },
  TabInputTextDiff: class TabInputTextDiff {},
  EventEmitter, Position, Range, Selection, WorkspaceEdit
};

// Registrar el stub para que `require('vscode')` lo resuelva desde cualquier archivo de src/.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  if (request === 'vscode') return 'vscode';
  return originalResolve.call(this, request, ...rest);
};
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscode };

/** Contexto de extensión falso con globalState, workspaceState y secrets en memoria. */
function createExtensionContext() {
  const memento = () => {
    const store = new Map();
    return {
      get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
      update: async (key, value) => { if (value === undefined) store.delete(key); else store.set(key, value); },
      keys: () => [...store.keys()],
      _store: store
    };
  };
  const secretStore = new Map();
  return {
    globalState: memento(),
    workspaceState: memento(),
    secrets: {
      get: async (key) => secretStore.get(key),
      store: async (key, value) => { secretStore.set(key, value); },
      delete: async (key) => { secretStore.delete(key); },
      _store: secretStore
    },
    subscriptions: [],
    extensionUri: makeUri(path.resolve(__dirname, '..', '..')),
    extension: { packageJSON: require('../../package.json') }
  };
}

module.exports = { vscode, state, reset, createExtensionContext, makeUri };
