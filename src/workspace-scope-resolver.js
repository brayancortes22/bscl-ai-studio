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
   * Resuelve la carpeta de trabajo efectiva para la solicitud actual.
   * Prioridad:
   * 1. Subcarpeta mencionada explícitamente por nombre en el prompt.
   * 2. Carpeta seleccionada manualmente por el usuario (explicitScope).
   * 3. Subcarpeta de primer nivel del archivo abierto actualmente en el editor.
   * 4. Raíz del workspace abierto en VS Code.
   */
  static resolve({ prompt = '', explicitScope = null } = {}) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || null;
    if (!workspaceRoot) {
      return { scopePath: explicitScope, autoDetected: false, projectName: explicitScope ? path.basename(explicitScope) : null };
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

    // 1. ¿El prompt menciona explícitamente una subcarpeta del workspace?
    const normalizedPrompt = this.normalize(prompt);
    if (normalizedPrompt && subdirs.length > 0) {
      const matchedByPrompt = subdirs
        .filter((dir) => dir.normalized.length >= 3 && normalizedPrompt.includes(dir.normalized))
        .sort((a, b) => b.normalized.length - a.normalized.length)[0];
      if (matchedByPrompt) {
        return {
          scopePath: matchedByPrompt.fullPath,
          autoDetected: matchedByPrompt.fullPath !== explicitScope,
          projectName: matchedByPrompt.name,
          reason: 'prompt'
        };
      }
    }

    // 2. Si el usuario ya fijó manualmente una carpeta concreta, respetarla
    if (explicitScope && fs.existsSync(explicitScope)) {
      return {
        scopePath: explicitScope,
        autoDetected: false,
        projectName: path.basename(explicitScope),
        reason: 'explicit'
      };
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
