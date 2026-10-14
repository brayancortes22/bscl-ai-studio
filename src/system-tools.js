const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * Proveedor de Herramientas del Sistema y Conectividad
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
class SystemTools {
  static getWorkspaceRoot() {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
  }

  static async listWorkspaceFiles(maxDepth = 3) {
    const root = this.getWorkspaceRoot();
    if (!root) return [];
    
    const results = [];
    function scan(dir, currentDepth) {
      if (currentDepth > maxDepth) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(root, fullPath);
          if (entry.isDirectory()) {
            scan(fullPath, currentDepth + 1);
          } else {
            results.push(relPath);
          }
        }
      } catch {}
    }
    scan(root, 1);
    return results.slice(0, 50);
  }

  static readFileContent(relativeFilePath) {
    const root = this.getWorkspaceRoot();
    if (!root) throw new Error('No hay workspace abierto');
    const resolvedRoot = fs.realpathSync(root);
    const targetPath = path.resolve(resolvedRoot, relativeFilePath);
    if (!fs.existsSync(targetPath)) throw new Error(`El archivo ${relativeFilePath} no existe`);
    const resolvedTarget = fs.realpathSync(targetPath);
    const relativeTarget = path.relative(resolvedRoot, resolvedTarget);
    if (relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
      throw new Error('Acceso no permitido fuera del workspace');
    }
    return fs.readFileSync(resolvedTarget, 'utf8');
  }

  static executeInTerminal(command) {
    let terminal = vscode.window.terminals.find(t => t.name === 'BSCL AI Studio');
    if (!terminal) {
      terminal = vscode.window.createTerminal('BSCL AI Studio');
    }
    terminal.show();
    terminal.sendText(command);
    return `Comando enviado a la terminal integrada: ${command}`;
  }
}

module.exports = { SystemTools };
