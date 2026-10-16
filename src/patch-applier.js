/**
 * Aplicador de parches quirúrgicos (SEARCH / REPLACE) para edición eficiente sin reescribir archivos completos.
 * Convierte bloques de parche en contenido final validado compatible con el historial de reversión (Undo).
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { isSensitiveFileName, isSensitivePath } = require('./sensitive-data');

// Reglas de rutas del workspace. Viven aquí y no en WorkspaceChangeManager porque este
// módulo no carga `vscode`: así el Programador valida una ruta ANTES de leerla con las
// mismas reglas que el host aplica antes de escribirla, y el contenido de un .env o de un
// enlace a otra carpeta nunca llega a los modelos revisores.
// .vscode está bloqueada porque settings.json y tasks.json cambian el comportamiento del
// editor (p. ej. a dónde se envían las peticiones o qué tarea se ejecuta al abrir la carpeta).
const BLOCKED_DIRS = new Set(['.git', '.svn', '.hg', 'node_modules', '.vscode']);
// Las carpetas de credenciales de sensitive-data (.ssh, .aws, .docker…) piensan en el perfil
// del usuario, pero aquí se validan rutas RELATIVAS a un proyecto. .ssh, .gnupg y .aws solo
// guardan claves; en cambio un repo usa .docker/, .azure/ o .kube/ para Dockerfiles, bicep o
// manifiestos, y bloquearlas enteras abortaba entregas con «.docker/nginx/default.conf». De
// esas tres solo se bloquea el archivo donde la herramienta guarda el token; las del perfil
// real las cubre isInHomeCredentialDir.
const CREDENTIAL_ONLY_DIRS = new Set(['.ssh', '.gnupg', '.aws']);
const TOOL_CREDENTIAL_FILES = new Set(['.docker/config.json', '.kube/config']);
const MAX_PATCH_SOURCE_BYTES = 1000000;
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function isCredentialRelativePath(parts) {
  const lower = parts.map((part) => part.toLowerCase());
  if (isSensitiveFileName(parts[parts.length - 1])) return true;
  if (lower.slice(0, -1).some((part) => CREDENTIAL_ONLY_DIRS.has(part))) return true;
  return lower.length >= 2 && TOOL_CREDENTIAL_FILES.has(lower.slice(-2).join('/'));
}

// Se reutiliza la lista de carpetas de sensitive-data en vez de copiarla: isSensitivePath
// marca una ruta si alguna carpeta que la contiene es de credenciales, así que basta con
// colgarle un nombre de archivo neutro.
function isCredentialDirName(name) {
  return isSensitivePath(path.join(String(name || ''), 'archivo'));
}

/**
 * ¿La carpeta (ruta absoluta) es o está dentro de una carpeta de credenciales? Una carpeta
 * así no sirve como raíz de trabajo: al arrastrar ~/.ssh o ~/.docker al chat, las rutas
 * relativas pasaban a ser «authorized_keys» o «config.json», que por su nombre no parecen
 * credenciales, y su contenido llegaba al modelo o se podía sobrescribir.
 */
function isCredentialRoot(absolutePath) {
  return isSensitivePath(path.join(path.resolve(String(absolutePath || '')), 'archivo'));
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * ¿El destino cae dentro de una carpeta de credenciales del perfil real (~/.docker,
 * ~/.azure, ~/.kube…)? Si la raíz elegida es el perfil o una carpeta que lo contiene,
 * «.docker/daemon.json» es una ruta relativa normal que acaba en la configuración de Docker.
 */
function isInHomeCredentialDir(target) {
  const home = os.homedir();
  if (!home) return false;
  const homes = new Set([path.resolve(home)]);
  try { homes.add(fs.realpathSync(home)); } catch { /* perfil inaccesible: basta la ruta tal cual */ }
  const resolved = path.resolve(target);
  for (const base of homes) {
    if (!isWithin(base, resolved)) continue;
    const [first] = path.relative(base, resolved).split(path.sep);
    if (first && isCredentialDirName(first)) return true;
  }
  return false;
}

function validateRelativePath(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 240 || /[\u0000-\u001f]/.test(input)) throw new Error('El agente devolvió una ruta de archivo no válida.');
  const normalized = input.trim().replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || parts.some((part) => !part || part === '.' || part === '..' || part.includes(':') || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))) throw new Error(`Solo se permiten rutas relativas seguras: ${input}`);
  if (parts.some((part) => BLOCKED_DIRS.has(part.toLowerCase()))) throw new Error(`No se permite escribir dentro de ${input}.`);
  if (isCredentialRelativePath(parts)) throw new Error(`Se bloqueó una ruta de credenciales: ${input}`);
  return parts.join('/');
}

function rejectSymlinkPath(root, relative, target) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    let stat = null;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat?.isSymbolicLink()) throw new Error(`No se permite escribir a través de enlaces simbólicos: ${relative}`);
  }
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Ruta fuera de la carpeta seleccionada: ${relative}`);
}

/**
 * Para leer o escribir lo que propone el modelo: además de enlaces y salidas de la raíz,
 * rechaza destinos dentro de una carpeta de credenciales del perfil del usuario. El Undo usa
 * solo rejectSymlinkPath: devuelve los bytes originales, y bloquearlo impediría deshacer una
 * escritura en ~/.ssh hecha antes de que existiera esta regla.
 */
function rejectUnsafeTarget(root, relative, target) {
  rejectSymlinkPath(root, relative, target);
  if (isInHomeCredentialDir(target)) throw new Error(`Se bloqueó una ruta de credenciales del perfil del usuario: ${relative}`);
}

/**
 * Decodifica bytes UTF-8 sin pérdidas o lanza. Por qué: leer un archivo Windows-1252 con
 * 'utf8' convierte cada acento en U+FFFD y, al reescribirlo, los bytes originales se
 * pierden. El BOM se separa porque VS Code no lo incluye en el texto del documento y lo
 * vuelve a poner al guardar; dejarlo en el contenido acababa en un BOM duplicado.
 */
function decodeUtf8(buffer) {
  const text = UTF8_STRICT.decode(buffer);
  const hasBom = text.charCodeAt(0) === 0xfeff;
  return { text: hasBom ? text.slice(1) : text, hasBom };
}

// Huella de los bytes que sirvieron de base a un cambio; el host la compara con el disco
// antes de escribir para no pisar lo que el usuario guardó mientras el enjambre trabajaba.
function hashBytes(buffer) { return createHash('sha256').update(buffer).digest('hex'); }

// Cuenta también coincidencias solapadas: «aa» aparece dos veces en «aaa», y aplicar la
// primera sería tan arbitrario como con dos apariciones separadas.
function countOccurrences(haystack, needle) {
  let count = 0;
  for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + 1)) count += 1;
  return count;
}

function ambiguous(src, count) {
  return { applied: false, content: src, reason: `el bloque search aparece ${count} veces; hace falta un fragmento único` };
}

class PatchApplier {
  static normalizeRelativePath(input = '') {
    return String(input || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
  }

  static applySingleBlock(sourceContent, searchBlock, replaceBlock) {
    const src = String(sourceContent ?? '');
    const search = String(searchBlock ?? '');
    const replace = String(replaceBlock ?? '');
    if (!search) return { applied: false, content: src };

    // En los tres modos solo se aplica si el bloque es único: con varias coincidencias
    // (un «}» o un «return null;») el cambio caería en otra función sin avisar.
    // 1. Coincidencia exacta directa
    const exactCount = countOccurrences(src, search);
    if (exactCount === 1) return { applied: true, content: src.replace(search, () => replace) };
    if (exactCount > 1) return ambiguous(src, exactCount);

    // 2. Coincidencia normalizando saltos de línea CRLF / LF
    const usesCrlf = src.includes('\r\n');
    const srcLf = src.replace(/\r\n/g, '\n');
    const searchLf = search.replace(/\r\n/g, '\n');
    const replaceLf = replace.replace(/\r\n/g, '\n');

    const lfCount = countOccurrences(srcLf, searchLf);
    if (lfCount === 1) {
      const updatedLf = srcLf.replace(searchLf, () => replaceLf);
      return {
        applied: true,
        content: usesCrlf ? updatedLf.replace(/\n/g, '\r\n') : updatedLf
      };
    }
    if (lfCount > 1) return ambiguous(src, lfCount);

    // 3. Coincidencia tolerante a espacios al final de línea. Solo se descartan las líneas
    // vacías de los extremos: recortar la sangría de la primera línea (trim) impedía que
    // casara cualquier bloque que empezara dentro de una función.
    const srcLines = srcLf.split('\n');
    const searchLines = searchLf.split('\n').map((line) => line.trimEnd());
    while (searchLines.length && !searchLines[0]) searchLines.shift();
    while (searchLines.length && !searchLines[searchLines.length - 1]) searchLines.pop();
    const matches = [];
    if (searchLines.length > 0 && searchLines.length <= srcLines.length) {
      for (let i = 0; i <= srcLines.length - searchLines.length; i += 1) {
        let matchesHere = true;
        for (let j = 0; j < searchLines.length; j += 1) {
          if (srcLines[i + j].trimEnd() !== searchLines[j]) {
            matchesHere = false;
            break;
          }
        }
        if (matchesHere) matches.push(i);
      }
    }
    if (matches.length > 1) return ambiguous(src, matches.length);
    if (matches.length === 1) {
      const [i] = matches;
      const updatedLines = [
        ...srcLines.slice(0, i),
        ...replaceLf.split('\n'),
        ...srcLines.slice(i + searchLines.length)
      ];
      return { applied: true, content: updatedLines.join(usesCrlf ? '\r\n' : '\n') };
    }

    return { applied: false, content: src };
  }

  /**
   * Lee el archivo base de un parche con las mismas reglas que la escritura: ruta permitida,
   * sin enlaces, dentro de la raíz, de tamaño razonable y en UTF-8.
   */
  static readBase(root, relPath) {
    const absPath = path.resolve(root, ...relPath.split('/'));
    try { rejectUnsafeTarget(root, relPath, absPath); } catch (error) { return { error: error.message }; }
    let stat;
    try { stat = fs.lstatSync(absPath); } catch { return { error: 'archivo no encontrado para aplicar parche' }; }
    if (!stat.isFile()) return { error: 'no es un archivo normal' };
    if (stat.size > MAX_PATCH_SOURCE_BYTES) return { error: 'el archivo es demasiado grande para parchearlo' };
    let bytes;
    try {
      const realPath = fs.realpathSync(absPath);
      if (realPath !== root && !realPath.startsWith(`${root}${path.sep}`)) return { error: 'ruta fuera de la carpeta del proyecto' };
      bytes = fs.readFileSync(absPath);
    } catch {
      return { error: 'no se pudo leer el archivo original' };
    }
    try {
      return { text: decodeUtf8(bytes).text, hash: hashBytes(bytes) };
    } catch {
      return { error: 'no está en UTF-8; no se parchea para no dañar sus caracteres' };
    }
  }

  /**
   * Convierte una lista de parches [{ path, search, replace }] en entradas de archivos completos
   * leyendo el archivo actual desde rootPath y aplicando cada parche en orden.
   * Cada archivo leído del disco sale con `baseHash` (sha256 de los bytes leídos) para que
   * WorkspaceChangeManager detecte si cambió antes de guardarse. El `baseHash` de una entrada
   * de `files` se conserva: en la ronda de revisión el Programador reenvía como base los
   * archivos de la ronda anterior, y su huella sigue siendo la del disco que se leyó entonces.
   * Una huella falsa solo puede hacer que el host rechace el archivo, nunca saltarse la
   * comprobación, porque se compara con el disco.
   */
  static resolvePatches({ patches = [], files = [], rootPath = null } = {}) {
    const fileMap = new Map();
    const baseHashes = new Map();
    for (const file of Array.isArray(files) ? files : []) {
      if (file?.path && typeof file?.content === 'string') {
        const filePath = this.normalizeRelativePath(file.path);
        fileMap.set(filePath, file.content);
        if (!baseHashes.has(filePath) && typeof file.baseHash === 'string' && /^[a-f0-9]{64}$/.test(file.baseHash)) {
          baseHashes.set(filePath, file.baseHash);
        }
      }
    }
    const output = () => [...fileMap.entries()].map(([filePath, content]) => (
      baseHashes.has(filePath) ? { path: filePath, content, baseHash: baseHashes.get(filePath) } : { path: filePath, content }
    ));

    const patchList = Array.isArray(patches) ? patches : [];
    if (!patchList.length || !rootPath) return { files: output(), failedPatches: [] };

    let root = null;
    let rootError = 'no se pudo abrir la carpeta del proyecto';
    try { root = fs.realpathSync(rootPath); } catch { root = null; }
    if (root && isCredentialRoot(root)) {
      root = null;
      rootError = 'la carpeta elegida guarda credenciales; no se lee';
    }

    const failedPatches = [];
    for (const patch of patchList) {
      const normalizedPath = this.normalizeRelativePath(patch?.path);
      const searchBlock = patch?.search ?? patch?.target ?? patch?.old;
      const replaceBlock = patch?.replace ?? patch?.replacement ?? patch?.new ?? '';
      if (!normalizedPath || typeof searchBlock !== 'string') continue;

      let relPath;
      try { relPath = validateRelativePath(normalizedPath); } catch (error) {
        failedPatches.push(`${normalizedPath} (${error.message})`);
        continue;
      }

      let currentContent = fileMap.get(relPath);
      if (typeof currentContent !== 'string') {
        if (!root) {
          failedPatches.push(`${relPath} (${rootError})`);
          continue;
        }
        const base = this.readBase(root, relPath);
        if (base.error) {
          failedPatches.push(`${relPath} (${base.error})`);
          continue;
        }
        currentContent = base.text;
        baseHashes.set(relPath, base.hash);
      }

      const { applied, content: nextContent, reason } = this.applySingleBlock(currentContent, searchBlock, replaceBlock);
      if (applied) {
        fileMap.set(relPath, nextContent);
      } else {
        failedPatches.push(`${relPath} (${reason || 'no coincidió el bloque search'})`);
      }
    }

    return { files: output(), failedPatches };
  }
}

module.exports = {
  PatchApplier, validateRelativePath, rejectSymlinkPath, rejectUnsafeTarget, isCredentialRoot, isInHomeCredentialDir,
  decodeUtf8, hashBytes, BLOCKED_DIRS
};
