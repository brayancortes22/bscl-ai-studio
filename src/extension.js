const vscode = require('vscode');
const { BsclChatViewProvider } = require('./view-provider');

/**
 * Activación de la extensión BSCL AI Studio v0.8.0
 * Autor: Brayan Stid Cortés Lombana (bscl)
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const provider = new BsclChatViewProvider(context.extensionUri, context);

  // 1. Registro del Webview en la barra de actividades
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('bsclAi.chatView', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // 2. Comandos de la extensión
  const commands = [
    vscode.commands.registerCommand('bsclAi.openChat', () => {
      vscode.commands.executeCommand('workbench.view.extension.bscl-ai-sidebar');
    }),
    vscode.commands.registerCommand('bsclAi.explainSelection', () => {
      vscode.commands.executeCommand('workbench.view.extension.bscl-ai-sidebar');
      provider.sendActiveSelection('explain');
    }),
    vscode.commands.registerCommand('bsclAi.refactorSelection', () => {
      vscode.commands.executeCommand('workbench.view.extension.bscl-ai-sidebar');
      provider.sendActiveSelection('refactor');
    }),
    vscode.commands.registerCommand('bsclAi.fixBugs', () => {
      vscode.commands.executeCommand('workbench.view.extension.bscl-ai-sidebar');
      provider.sendActiveSelection('fix');
    })
  ];

  context.subscriptions.push(...commands);

  // 3. Sincronización en tiempo real del archivo enfocado y pestañas
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => provider.sendActiveContext()),
    vscode.window.onDidChangeVisibleTextEditors(() => provider.sendActiveContext()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('bsclAi')) provider.reloadConfig();
    })
  );

  console.log('✅ [BSCL AI Studio v0.8.0] Extensión activada con éxito.');
}

function deactivate() {
  console.log('🛑 [BSCL AI Studio] Extensión desactivada.');
}

module.exports = { activate, deactivate };
