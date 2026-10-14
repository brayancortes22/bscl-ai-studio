/**
 * Aplicador de parches quirúrgicos (SEARCH / REPLACE) para edición eficiente sin reescribir archivos completos.
 * Convierte bloques de parche en contenido final validado compatible con el historial de reversión (Undo).
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
const fs = require('fs');
const path = require('path');

class PatchApplier {
  static normalizeRelativePath(input = '') {
    return String(input || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
  }

  static applySingleBlock(sourceContent, searchBlock, replaceBlock) {
    const src = String(sourceContent ?? '');
    const search = String(searchBlock ?? '');
    const replace = String(replaceBlock ?? '');
    if (!search) return { applied: false, content: src };

    // 1. Coincidencia exacta directa
    if (src.includes(search)) {
      return { applied: true, content: src.replace(search, () => replace) };
    }

    // 2. Coincidencia normalizando saltos de línea CRLF / LF
    const usesCrlf = src.includes('\r\n');
    const srcLf = src.replace(/\r\n/g, '\n');
    const searchLf = search.replace(/\r\n/g, '\n');
    const replaceLf = replace.replace(/\r\n/g, '\n');

    if (srcLf.includes(searchLf)) {
      const updatedLf = srcLf.replace(searchLf, () => replaceLf);
      return {
        applied: true,
        content: usesCrlf ? updatedLf.replace(/\n/g, '\r\n') : updatedLf
      };
    }

    // 3. Coincidencia tolerante a espacios al final de línea
    const srcLines = srcLf.split('\n');
    const searchLines = searchLf.trim().split('\n').map((l) => l.trimEnd());
    if (searchLines.length > 0 && searchLines.length <= srcLines.length) {
      for (let i = 0; i <= srcLines.length - searchLines.length; i += 1) {
        let matches = true;
        for (let j = 0; j < searchLines.length; j += 1) {
          if (srcLines[i + j].trimEnd() !== searchLines[j]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          const updatedLines = [
            ...srcLines.slice(0, i),
            ...replaceLf.split('\n'),
            ...srcLines.slice(i + searchLines.length)
          ];
          const joined = updatedLines.join(usesCrlf ? '\r\n' : '\n');
          return { applied: true, content: joined };
        }
      }
    }

    return { applied: false, content: src };
  }

  /**
   * Convierte una lista de parches [{ path, search, replace }] en entradas de archivos completos
   * leyendo el archivo actual desde rootPath y aplicando cada parche en orden.
   */
  static resolvePatches({ patches = [], files = [], rootPath = null } = {}) {
    const fileMap = new Map();
    for (const file of Array.isArray(files) ? files : []) {
      if (file?.path && typeof file?.content === 'string') {
        fileMap.set(this.normalizeRelativePath(file.path), file.content);
      }
    }

    const patchList = Array.isArray(patches) ? patches : [];
    if (!patchList.length || !rootPath) {
      return {
        files: [...fileMap.entries()].map(([filePath, content]) => ({ path: filePath, content })),
        failedPatches: []
      };
    }

    const failedPatches = [];
    for (const patch of patchList) {
      const relPath = this.normalizeRelativePath(patch?.path);
      const searchBlock = patch?.search ?? patch?.target ?? patch?.old;
      const replaceBlock = patch?.replace ?? patch?.replacement ?? patch?.new ?? '';
      if (!relPath || typeof searchBlock !== 'string') continue;

      let currentContent = fileMap.get(relPath);
      if (typeof currentContent !== 'string') {
        const absPath = path.resolve(rootPath, ...relPath.split('/'));
        const relCheck = path.relative(path.resolve(rootPath), absPath);
        if (relCheck.startsWith('..') || path.isAbsolute(relCheck) || !fs.existsSync(absPath)) {
          failedPatches.push(`${relPath} (archivo no encontrado para aplicar parche)`);
          continue;
        }
        try {
          currentContent = fs.readFileSync(absPath, 'utf8');
        } catch {
          failedPatches.push(`${relPath} (no se pudo leer el archivo original)`);
          continue;
        }
      }

      const { applied, content: nextContent } = this.applySingleBlock(currentContent, searchBlock, replaceBlock);
      if (applied) {
        fileMap.set(relPath, nextContent);
      } else {
        failedPatches.push(`${relPath} (no coincidió el bloque search)`);
      }
    }

    return {
      files: [...fileMap.entries()].map(([filePath, content]) => ({ path: filePath, content })),
      failedPatches
    };
  }
}

module.exports = { PatchApplier };
