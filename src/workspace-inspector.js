const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * Inspector de Entorno, Espacio de Trabajo y Archivos
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
class WorkspaceInspector {
  static getWorkspaceRoot() {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
  }

  static getActiveEditorInfo() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const doc = editor.document;
    const root = this.getWorkspaceRoot();
    const fullPath = doc.uri.fsPath;
    const relPath = root ? path.relative(root, fullPath) : path.basename(fullPath);
    const selection = editor.selection;
    const selectedText = doc.getText(selection);
    const text = doc.getText();

    return {
      fileName: path.basename(fullPath),
      relativePath: relPath,
      language: doc.languageId,
      lineCount: doc.lineCount,
      selectedText: selectedText || null,
      selectionRange: selection.isEmpty ? null : {
        start: selection.start.line + 1,
        end: selection.end.line + 1
      },
      contentSnippet: text.length > 4000 ? text.slice(0, 4000) + '\n... [Truncado para contexto]' : text
    };
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

  static readFile(relativePath) {
    const root = this.getWorkspaceRoot();
    if (!root) throw new Error('No hay workspace abierto');
    const targetPath = path.resolve(root, relativePath);
    if (!targetPath.startsWith(root)) throw new Error('Acceso no permitido fuera del workspace');
    if (!fs.existsSync(targetPath)) throw new Error(`El archivo ${relativePath} no existe`);
    return fs.readFileSync(targetPath, 'utf8');
  }

  static searchWorkspaceFiles(query = '', maxLimit = 30) {
    const root = this.getWorkspaceRoot();
    if (!root) return [];
    const results = [];
    const q = query.toLowerCase();

    function scan(dir, depth = 0) {
      if (depth > 4 || results.length >= maxLimit) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(root, fullPath);
          if (entry.isDirectory()) {
            scan(fullPath, depth + 1);
          } else if (!q || relPath.toLowerCase().includes(q)) {
            results.push({ name: entry.name, path: relPath });
            if (results.length >= maxLimit) break;
          }
        }
      } catch {}
    }

    scan(root);
    return results;
  }
}

module.exports = { WorkspaceInspector };
