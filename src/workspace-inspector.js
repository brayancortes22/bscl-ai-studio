const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { isSensitivePath, redactSecrets, REDACTED } = require('./sensitive-data');

const SNIPPET_CHARS = 4000;
// Se redacta una ventana mayor que el extracto: un bloque PEM que empieza antes del corte y
// termina después solo se reconoce si se ve entero.
const REDACTION_WINDOW = 64000;
// redactSecrets deja cada bloque completo como BEGIN / [REDACTADO] / END; cualquier otra
// cabecera BEGIN es un bloque que el corte dejó abierto.
const OPEN_PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----(?!\n\[REDACTADO\]\n-----END PRIVATE KEY-----)/;

/**
 * Inspector de Entorno, Espacio de Trabajo y Archivos
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
class WorkspaceInspector {
  static getWorkspaceRoot() {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
  }

  /**
   * Resumen del editor activo para el prompt. Si el archivo es sensible (.env, id_rsa,
   * credentials.json…) no sale nada de su contenido; si no, sale redactado. Por qué: este
   * texto va al system prompt y a todos los agentes, y era la única vía que se saltaba la
   * política de exclusión que sí aplican WorkspaceContext y los adjuntos.
   */
  static getActiveEditorInfo() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const doc = editor.document;
    const root = this.getWorkspaceRoot();
    const fullPath = doc.uri.fsPath;
    const fileName = path.basename(fullPath);
    const relPath = root ? path.relative(root, fullPath) : fileName;
    const selection = editor.selection;
    const isSensitive = isSensitivePath(fullPath);
    const info = {
      fileName,
      relativePath: relPath,
      language: doc.languageId,
      lineCount: doc.lineCount,
      selectedText: '',
      selectionRange: selection.isEmpty ? null : {
        start: selection.start.line + 1,
        end: selection.end.line + 1
      },
      contentSnippet: '',
      isSensitive
    };
    if (isSensitive) return info;

    const selectedText = this.redact(doc.getText(selection), fileName);
    const text = doc.getText();
    const redacted = this.redact(text.length > REDACTION_WINDOW ? text.slice(0, REDACTION_WINDOW) : text, fileName);
    info.selectedText = selectedText || null;
    info.contentSnippet = redacted.length > SNIPPET_CHARS
      ? this.cutOpenPrivateKey(redacted.slice(0, SNIPPET_CHARS)) + '\n... [Truncado para contexto]'
      : redacted;
    return info;
  }

  static redact(text, fileName) {
    return this.cutOpenPrivateKey(redactSecrets(text || '', { fileName }));
  }

  // Un bloque de clave privada sin su línea END no lo reconoce la redacción: se corta ahí.
  static cutOpenPrivateKey(text) {
    const match = OPEN_PRIVATE_KEY.exec(text);
    return match ? `${text.slice(0, match.index)}${REDACTED}` : text;
  }

  static getOpenEditors() {
    const tabs = [];
    const root = this.getWorkspaceRoot();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input && tab.input.uri) {
          const fsPath = tab.input.uri.fsPath;
          tabs.push({
            label: tab.label,
            relativePath: root ? path.relative(root, fsPath) : path.basename(fsPath),
            isActive: tab.isActive
          });
        }
      }
    }
    return tabs;
  }

  static getWorkspaceDirectories() {
    const root = this.getWorkspaceRoot();
    if (!root) return [];
    try {
      const items = fs.readdirSync(root, { withFileTypes: true });
      return items
        .filter(i => i.isDirectory() && !i.name.startsWith('.') && i.name !== 'node_modules')
        .map(i => i.name)
        .sort((a, b) => a.localeCompare(b, 'es'));
    } catch {
      return [];
    }
  }

  static getWorkspaceTree(maxDepth = 5, limit = 500) {
    const { WorkspaceContext } = require('./workspace-context');
    const root = this.getWorkspaceRoot();
    return root ? WorkspaceContext.getWorkspaceTree(root, maxDepth, limit) : [];
  }
}

module.exports = { WorkspaceInspector };
