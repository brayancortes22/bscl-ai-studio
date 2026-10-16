/**
 * Resolvedor inteligente de sub-proyectos dentro de un workspace multi-proyecto.
 * Detecta automáticamente el proyecto objetivo a partir del prompt o del archivo activo en el editor.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  '.git', '.svn', '.hg', '.vscode', '.agents', '.gemini', 'node_modules',
  'dist', 'build', 'out', '.next', 'coverage', '.venv', 'venv', 'vendor', 'target'
]);

const PROJECT_MARKERS = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml',
  'go.mod', 'pom.xml', 'build.gradle', 'composer.json', 'project.godot', '.git'
];

class WorkspaceScopeResolver {
  static normalize(text = '') {
    return String(text || '')
      .toLocaleLowerCase('es')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  static isProjectDirectory(dirPath) {
    try {
      return PROJECT_MARKERS.some((marker) => fs.existsSync(path.join(dirPath, marker)));
    } catch {
      return false;
    }
  }

  /**
   * ¿El prompt nombra la carpeta como palabra completa? Con una subcadena, «rápido» elegía
   * api/, «contesta» test/ y «multimedia» media/. Un punto seguido de letras cuenta como
   * parte de la palabra para que «app.js» no apunte a la carpeta app/.
   */
  static mentions(normalizedPrompt, normalizedName) {
    const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-z0-9_.-])${escaped}(?![a-z0-9_-]|\\.[a-z0-9])`).test(normalizedPrompt);
  }

  /**
   * Resuelve la carpeta de trabajo efectiva para la solicitud actual.
   * Prioridad:
   * 1. Carpeta seleccionada manualmente por el usuario (explicitScope): gana siempre.
   * 2. Sub-proyecto de primer nivel nombrado como palabra completa en el texto que escribió
   *    el usuario (sin adjuntos). Si nombra varios, la raíz los contiene a todos.
   * 3. Sub-proyecto de primer nivel del archivo abierto actualmente en el editor.
   * 4. Raíz del workspace abierto en VS Code.
   */
  static resolve({ prompt = '', explicitScope = null } = {}) {
    // Una carpeta elegida a mano no se cambia en silencio: escribir en otra carpeta sin que
    // el usuario lo sepa es peor que no encontrar la que quería.
    if (explicitScope) {
      return { scopePath: explicitScope, autoDetected: false, projectName: path.basename(explicitScope), reason: 'explicit' };
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || null;
    if (!workspaceRoot) {
      return { scopePath: null, autoDetected: false, projectName: null };
    }

    let subdirs = [];
    try {
      subdirs = fs.readdirSync(workspaceRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !SKIP_DIRS.has(entry.name.toLowerCase()) && !entry.name.startsWith('.'))
        .map((entry) => ({
          name: entry.name,
          fullPath: path.join(workspaceRoot, entry.name),
          normalized: this.normalize(entry.name)
        }));
    } catch {
      subdirs = [];
    }

    // 2. ¿El prompt nombra un sub-proyecto del workspace? Solo cuentan carpetas que son
    // proyecto: test/, media/ o src/ de un proyecto único no son un alcance distinto.
    const normalizedPrompt = this.normalize(prompt);
    if (normalizedPrompt && subdirs.length > 0) {
      const matchedByPrompt = subdirs.filter((dir) => dir.normalized.length >= 3 &&
        this.mentions(normalizedPrompt, dir.normalized) && this.isProjectDirectory(dir.fullPath));
      if (matchedByPrompt.length === 1) {
        const [match] = matchedByPrompt;
        return { scopePath: match.fullPath, autoDetected: true, projectName: match.name, reason: 'prompt' };
      }
      if (matchedByPrompt.length > 1) {
        return { scopePath: workspaceRoot, autoDetected: false, projectName: path.basename(workspaceRoot), reason: 'workspace_root' };
      }
    }

    // 3. Si la raíz no es un proyecto único sino un contenedor de múltiples proyectos,
    // inferir el sub-proyecto a partir del archivo abierto en el editor activo.
    const activeUri = vscode.window.activeTextEditor?.document?.uri;
    if (activeUri?.scheme === 'file' && subdirs.length > 0) {
      const activePath = path.resolve(activeUri.fsPath);
      const matchedByEditor = subdirs.find((dir) => {
        const rel = path.relative(dir.fullPath, activePath);
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
      });
      if (matchedByEditor && this.isProjectDirectory(matchedByEditor.fullPath)) {
        return {
          scopePath: matchedByEditor.fullPath,
          autoDetected: true,
          projectName: matchedByEditor.name,
          reason: 'active_editor'
        };
      }
    }

    return {
      scopePath: workspaceRoot,
      autoDetected: false,
      projectName: path.basename(workspaceRoot),
      reason: 'workspace_root'
    };
  }
}

module.exports = { WorkspaceScopeResolver };
