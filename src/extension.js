const vscode = require('vscode');
const { BsclChatViewProvider } = require('./view-provider');

/**
 * Activación de BSCL AI Studio.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const provider = new BsclChatViewProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('bsclAi.chatView', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Los comandos abren el panel si hace falta; el proveedor guarda el mensaje hasta que
  // el webview esté listo, así que funcionan aunque la barra lateral nunca se haya abierto.
  const commands = {
    'bsclAi.openChat': () => provider.reveal(),
    'bsclAi.newChat': () => provider.runCommand('newChat'),
    'bsclAi.showHistory': () => provider.runCommand('history'),
    'bsclAi.openSettings': () => provider.runCommand('settings'),
    'bsclAi.explainSelection': () => provider.sendActiveSelection('explain'),
    'bsclAi.refactorSelection': () => provider.sendActiveSelection('refactor'),
    'bsclAi.fixBugs': () => provider.sendActiveSelection('fix')
  };
  for (const [id, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => provider.sendActiveContext()),
    vscode.window.onDidChangeTextEditorSelection(() => provider.sendActiveContext()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('bsclAi')) provider.reloadConfig().then(() => provider.sendModelsList()).catch(() => {});
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
