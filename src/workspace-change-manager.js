const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { validateRelativePath, rejectSymlinkPath, rejectUnsafeTarget, isCredentialRoot, decodeUtf8, hashBytes } = require('./patch-applier');

const BINARY_FILE = /\.(?:exe|dll|so|dylib|bin|db|sqlite|zip|vsix|png|jpe?g|gif|webp|ico|pdf|mp[34]|wav|woff2?|ttf|otf)$/i;
const MAX_FILES = 100;
const MAX_FILE_BYTES = 200000;
const MAX_TOTAL_BYTES = 1000000;
// Las instantáneas de Undo se guardan en workspaceState (state.vscdb) y VS Code reescribe la
// clave entera en cada entrega: sin tope, borrar un .csv de decenas de MB lo inflaba.
const MAX_SNAPSHOT_FILE_BYTES = 1000000;
const MAX_SNAPSHOT_TOTAL_BYTES = 2000000;
const MAX_UNDO_ENTRIES = 5;
const MAX_UNDO_STACK_CHARS = 4000000;
const UNDO_KEY = 'bscl_ai_workspace_undo_stack';
const CASE_INSENSITIVE_FS = process.platform !== 'linux';

class WorkspaceChangeManager {
  static configure(workspaceState) { this.workspaceState = workspaceState; }

  static async applyFiles(files, scopePath = null, options = {}) {
    return this.applyChanges({ files }, scopePath, options);
  }

  /**
   * `options.baseHashes` (Map u objeto ruta relativa → sha256) son las huellas de los archivos
   * que el modelo leyó; cada entrada de `files` puede traer además su propio `baseHash`.
   */
  static async applyChanges({ files = [], delete: deletePaths = [], rename = [] } = {}, scopePath = null, options = {}) {
    if (this.busy) throw new Error('Ya hay otra implementación guardándose; espera a que termine.');
    this.busy = true;
    try { return await this.applyValidatedChanges({ files, delete: deletePaths, rename }, scopePath, options); }
    finally { this.busy = false; }
  }

  /**
   * Qué cambios de una entrega pueden perder contenido, sin escribir nada: borrados,
   * renombrados y archivos existentes cuyo contenido nuevo pesa menos de la mitad (señal
   * típica de un modelo que devuelve el archivo truncado). `shrunk[].path` es la misma
   * cadena que llegó en `files[].path`, para poder filtrar la entrega con ella.
   */
  static assessRisk({ files = [], delete: deletePaths = [], rename = [] } = {}, scopePath = null) {
    const deletes = (Array.isArray(deletePaths) ? deletePaths : [])
      .filter((entry) => typeof entry === 'string' && entry.trim());
    const renames = (Array.isArray(rename) ? rename : [])
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({ from: String(entry.from ?? ''), to: String(entry.to ?? '') }));
    const shrunk = [];
    let root = null;
    try { root = this.resolveRoot(scopePath); } catch { root = null; }
    for (const item of root && Array.isArray(files) ? files : []) {
      if (typeof item?.content !== 'string') continue;
      try {
        const relative = this.validateRelativePath(item.path);
        const target = path.resolve(root, ...relative.split('/'));
        this.rejectUnsafeTarget(root, relative, target);
        const stat = fs.lstatSync(target);
        if (!stat.isFile()) continue;
        const beforeBytes = stat.size;
        const afterBytes = Buffer.byteLength(this.stripBom(item.content), 'utf8');
        if (beforeBytes > 0 && afterBytes < beforeBytes / 2) shrunk.push({ path: item.path, beforeBytes, afterBytes });
      } catch {
        // Ruta no válida o archivo nuevo: applyChanges dará el error concreto o lo creará.
      }
    }
    return { deletes, renames, shrunk };
  }

  static async applyValidatedChanges({ files, delete: deletePaths, rename }, scopePath, options = {}) {
    const root = this.resolveRoot(scopePath);
    if (!Array.isArray(files) || !Array.isArray(deletePaths) || !Array.isArray(rename)) {
      throw new Error('El agente devolvió operaciones de archivos con formato no válido.');
    }
    const operationCount = files.length + deletePaths.length + rename.length * 2;
    if (!operationCount || operationCount > MAX_FILES) throw new Error(`La implementación debe incluir entre 1 y ${MAX_FILES} rutas como máximo.`);

    const baseHashes = this.normalizeBaseHashes(options?.baseHashes);
    const seen = new Set();
    const snapshots = new Map();
    const preparedFiles = [];
    const preparedDeletes = [];
    const preparedRenames = [];
    let totalBytes = 0;
    let snapshotBytes = 0;

    const inspectPath = async (input, { requireExisting = false, editsText = false, checkBase = false, baseHash = null } = {}) => {
      const relative = this.validateRelativePath(input);
      if (BINARY_FILE.test(relative)) throw new Error(`Solo se permiten cambios a archivos de texto: ${relative}`);
      const key = relative.toLowerCase();
      if (seen.has(key)) throw new Error(`La respuesta repite o combina operaciones sobre ${relative}.`);
      seen.add(key);
      const target = path.resolve(root, ...relative.split('/'));
      this.rejectUnsafeTarget(root, relative, target);
      let stat = null;
      try { stat = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (stat && stat.isSymbolicLink()) throw new Error(`No se permiten enlaces simbólicos: ${relative}`);
      if (stat && !stat.isFile()) throw new Error(`${relative} no es un archivo normal.`);
      if (requireExisting && !stat) throw new Error(`No se puede operar: ${relative} no existe.`);
      this.ensureWritable(root, target, Boolean(stat));
      // La versión del documento solo cubre los milisegundos de esta llamada; la huella de lo
      // que leyó el modelo cubre los minutos que tarda el enjambre en generar el cambio.
      const expectedHash = baseHash || (checkBase ? baseHashes.get(this.baseKey(relative)) : null);
      const changedMessage = `${relative} cambió durante la generación; vuelve a enviar la tarea.`;

      if (!stat) {
        // Tenía huella, así que existía cuando el modelo lo leyó: no se resucita un archivo
        // que el usuario borró mientras tanto.
        if (expectedHash) throw new Error(changedMessage);
        snapshots.set(relative, { path: relative, exists: false });
        return { relative, target, exists: false, document: null, version: undefined };
      }

      if (stat.size > MAX_SNAPSHOT_FILE_BYTES) {
        throw new Error(`${relative} ocupa más de 1 MB; no se modifica porque su copia para deshacer no cabría.`);
      }
      snapshotBytes += stat.size;
      if (snapshotBytes > MAX_SNAPSHOT_TOTAL_BYTES) {
        throw new Error('Los archivos existentes que tocaría esta entrega ocupan más de 2 MB; su copia para deshacer no cabría. Divide la tarea en partes.');
      }
      const bytes = fs.readFileSync(target);
      if (expectedHash && hashBytes(bytes) !== expectedHash) throw new Error(changedMessage);
      if (editsText) {
        try { decodeUtf8(bytes); } catch { throw new Error(`${relative} no está en UTF-8; no se edita para no dañar sus caracteres.`); }
      }
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      if (document.isDirty) throw new Error(`Guarda o descarta los cambios sin guardar de ${relative} antes de continuar.`);
      // Bytes en base64 y no texto: así el Undo devuelve el archivo exacto aunque no sea
      // UTF-8 o lleve BOM, en vez de una versión decodificada y vuelta a codificar.
      snapshots.set(relative, { path: relative, exists: true, bytes: bytes.toString('base64') });
      return { relative, target, exists: true, document, version: document.version };
    };

    for (const item of files) {
      if (typeof item?.content !== 'string' || item.content.includes('\u0000')) {
        throw new Error(`El contenido de ${item?.path || 'un archivo'} no es texto válido.`);
      }
      // VS Code añade el BOM al guardar si el archivo ya lo tenía; si además va en el texto,
      // el archivo acaba con dos.
      const content = this.stripBom(item.content);
      const size = Buffer.byteLength(content, 'utf8');
      totalBytes += size;
      if (size > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES) {
        throw new Error('La implementación supera el límite de tamaño permitido. Divide la tarea en partes.');
      }
      const baseHash = typeof item.baseHash === 'string' ? item.baseHash : null;
      preparedFiles.push({ ...(await inspectPath(item.path, { editsText: true, checkBase: true, baseHash })), content });
    }

    for (const input of deletePaths) preparedDeletes.push(await inspectPath(input, { requireExisting: true, checkBase: true }));
    for (const item of rename) {
      if (!item || typeof item !== 'object') throw new Error('El agente devolvió un renombrado no válido.');
      const source = await inspectPath(item.from, { requireExisting: true });
      const target = await inspectPath(item.to);
      if (target.exists) throw new Error(`No se sobreescribirá el destino del renombrado: ${target.relative}`);
      if (source.relative.toLowerCase() === target.relative.toLowerCase()) throw new Error('El origen y el destino del renombrado son iguales.');
      preparedRenames.push({ source, target });
    }

    const versions = [...preparedFiles, ...preparedDeletes, ...preparedRenames.flatMap(({ source, target }) => [source, target])];
    for (const item of versions) {
      this.rejectUnsafeTarget(root, item.relative, item.target);
      if (item.document && item.document.version !== item.version) throw new Error(`${item.relative} cambió durante la generación; vuelve a enviar la tarea.`);
    }
    for (const item of [...preparedFiles.filter((entry) => !entry.exists), ...preparedRenames.map(({ target }) => target)]) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(item.target)));
    }

    const edit = new vscode.WorkspaceEdit();
    for (const item of preparedFiles) {
      const uri = vscode.Uri.file(item.target);
      if (!item.exists) {
        edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
        edit.insert(uri, new vscode.Position(0, 0), item.content);
      } else {
        edit.replace(uri, this.fullRange(item.document), item.content);
      }
    }
    // deleteFile, no delete: WorkspaceEdit.delete(uri, range) borra TEXTO y lanza
    // «Illegal argument: range» si recibe opciones en lugar de un Range.
    for (const item of preparedDeletes) edit.deleteFile(vscode.Uri.file(item.target), { recursive: false, ignoreIfNotExists: false });
    for (const { source, target } of preparedRenames) {
      edit.renameFile(vscode.Uri.file(source.target), vscode.Uri.file(target.target), { overwrite: false, ignoreIfExists: false });
    }
    const filesToSave = [
      ...preparedFiles.map((item) => item.target),
      ...preparedRenames.map(({ target }) => target.target)
    ];
    try {
      if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code rechazó los cambios.');
      for (const target of filesToSave) {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
        if (!await document.save()) throw new Error(`VS Code no pudo guardar ${path.relative(root, target)}.`);
      }
    } catch (error) {
      let recoveryError = null;
      try {
        await this.restoreSnapshots(root, [...snapshots.values()]);
      } catch (restoreError) { recoveryError = restoreError; }
      if (recoveryError) throw new Error(`${error.message} VS Code tampoco pudo completar la restauración automática: ${recoveryError.message}`);
      throw new Error(`${error.message} Se restauró el contenido anterior de los archivos.`);
    }

    const after = [...snapshots.keys()].map((relative) => {
      const target = path.resolve(root, ...relative.split('/'));
      let content = null;
      try { content = fs.readFileSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return { path: relative, exists: Boolean(content), hash: content ? hashBytes(content) : null };
    });
    const undoId = randomUUID();
    const stack = this.trimUndoStack([...this.getUndoStack(), { id: undoId, root, snapshots: [...snapshots.values()], after }]);
    await this.saveUndoStack(stack);

    const changedFiles = [
      ...preparedFiles.map(({ relative, exists }) => ({ path: relative, action: exists ? 'editado' : 'creado' })),
      ...preparedDeletes.map(({ relative }) => ({ path: relative, action: 'borrado' })),
      ...preparedRenames.map(({ source, target }) => ({ path: `${source.relative} → ${target.relative}`, action: 'renombrado' }))
    ];
    return { files: changedFiles, undoId };
  }

  /**
   * Revierte la última entrega. `scopePath` es solo informativo: la raíz sale de la propia
   * instantánea, que grabó el host al aplicar. Comparar con la carpeta seleccionada ahora
   * bloqueaba el Undo cuando la entrega se escribió en otra carpeta (autodetectada o de un
   * chat restaurado) y, al ser una pila, también todas las anteriores.
   */
  static async rollbackLast(undoId, scopePath = null) {
    if (this.busy) throw new Error('Espera a que termine la operación actual antes de revertir.');
    this.busy = true;
    try {
      const stack = this.getUndoStack();
      const snapshot = stack[stack.length - 1];
      if (!snapshot) throw new Error('No hay ninguna entrega del chat que revertir.');
      if (undoId && !stack.some((entry) => entry.id === undoId)) {
        throw new Error(`Esa entrega ya no se puede revertir: solo se guardan las últimas ${MAX_UNDO_ENTRIES} y con un tamaño máximo.`);
      }
      if (undoId && snapshot.id !== undoId) {
        throw new Error('Para proteger cambios posteriores, revierte primero la última entrega del chat.');
      }
      if (!snapshot.root) throw new Error('La entrega no indica en qué carpeta se aplicó; no se puede revertir.');
      let root;
      // La instantánea la grabó el host y deshacer solo devuelve bytes originales: se permite
      // aunque la raíz o el archivo estén en una carpeta de credenciales, para poder revertir
      // una escritura ahí hecha antes de que existieran esas reglas.
      try { root = this.resolveRoot(snapshot.root, { allowCredentialRoot: true }); } catch {
        throw new Error(`La carpeta de esa entrega (${snapshot.root}) ya no está disponible; no se puede revertir.`);
      }

      for (const expected of snapshot.after) {
        const target = path.resolve(root, ...expected.path.split('/'));
        this.rejectSymlinkPath(root, expected.path, target);
        let content = null;
        try { content = fs.readFileSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (Boolean(content) !== expected.exists || (content && hashBytes(content) !== expected.hash)) {
          throw new Error(`${expected.path} cambió después de la entrega. No se revirtió para conservar tus cambios recientes.`);
        }
      }

      await this.restoreSnapshots(root, snapshot.snapshots, true);
      stack.pop();
      await this.saveUndoStack(stack);
      return { undoId: snapshot.id, files: snapshot.snapshots.map(({ path: relative }) => relative) };
    } finally { this.busy = false; }
  }

  /**
   * Devuelve cada ruta a su estado de la instantánea. Los archivos que existían se reescriben
   * con sus bytes exactos (workspace.fs), no con texto, para no tocar codificación ni BOM.
   * `checkDirty` (Undo del usuario) se niega a pisar o borrar buffers sin guardar; sin él
   * (recuperación tras un fallo propio) esos buffers contienen el texto del agente y se
   * devuelven al original antes de escribir los bytes.
   */
  static async restoreSnapshots(root, originals, checkDirty = false) {
    const plan = [];
    for (const original of originals) {
      const target = path.resolve(root, ...original.path.split('/'));
      this.rejectSymlinkPath(root, original.path, target);
      let exists = false;
      try { exists = fs.lstatSync(target).isFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const document = this.findOpenDocument(target);
      // También para los archivos que se van a borrar: borrar uno creado por el agente que
      // el usuario editó sin guardar descartaba lo que había escrito.
      if (checkDirty && document?.isDirty) throw new Error(`Guarda o descarta los cambios sin guardar de ${original.path} antes de revertir.`);
      plan.push({ original, target, uri: vscode.Uri.file(target), exists, document, bytes: original.exists ? this.snapshotBytes(original) : null });
    }

    const dirty = plan.filter((item) => item.original.exists && item.exists && item.document?.isDirty);
    if (dirty.length) {
      const edit = new vscode.WorkspaceEdit();
      for (const item of dirty) edit.replace(item.document.uri, this.fullRange(item.document), new TextDecoder('utf-8').decode(item.bytes));
      if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code rechazó la restauración de los archivos.');
      for (const item of dirty) {
        if (!await item.document.save()) throw new Error(`No se pudo guardar la restauración de ${item.original.path}.`);
      }
    }

    const deletions = plan.filter((item) => !item.original.exists && item.exists);
    if (deletions.length) {
      const edit = new vscode.WorkspaceEdit();
      for (const item of deletions) edit.deleteFile(item.uri, { recursive: false, ignoreIfNotExists: true });
      if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code rechazó la restauración de los archivos.');
    }

    for (const item of plan) {
      if (!item.original.exists) continue;
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(item.target)));
      await vscode.workspace.fs.writeFile(item.uri, item.bytes);
    }
  }

  static resolveRoot(scopePath, { allowCredentialRoot = false } = {}) {
    const fallback = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    const requested = scopePath || fallback;
    if (!requested) throw new Error('Abre una carpeta o arrastra una carpeta al chat antes de pedir cambios.');
    let root;
    try {
      const stat = fs.lstatSync(requested);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error();
      root = fs.realpathSync(requested);
    } catch { throw new Error('La carpeta elegida no está disponible o no es una carpeta local normal.'); }
    // Dentro de ~/.ssh o ~/.docker los nombres que hay que proteger (authorized_keys,
    // config.json) no parecen credenciales por sí solos; la única defensa es la carpeta.
    if (!allowCredentialRoot && isCredentialRoot(root)) throw new Error('La carpeta elegida guarda credenciales (.ssh, .aws, .docker…); no se escriben cambios en ella.');
    return root;
  }

  static validateRelativePath(input) { return validateRelativePath(input); }

  static rejectUnsafeTarget(root, relative, target) { return rejectUnsafeTarget(root, relative, target); }

  static rejectSymlinkPath(root, relative, target) { return rejectSymlinkPath(root, relative, target); }

  static ensureWritable(root, target, exists) {
    let candidate = exists ? target : path.dirname(target);
    while (candidate !== root && !fs.existsSync(candidate)) candidate = path.dirname(candidate);
    try { fs.accessSync(candidate, fs.constants.W_OK); }
    catch { throw new Error(`No hay permiso de escritura en la ruta necesaria para ${path.relative(root, target)}.`); }
  }

  static fullRange(document) {
    return new vscode.Range(new vscode.Position(0, 0), document.positionAt(document.getText().length));
  }

  static findOpenDocument(target) {
    const wanted = this.pathKey(target);
    return (vscode.workspace.textDocuments || []).find((document) =>
      document?.uri?.scheme === 'file' && this.pathKey(document.uri.fsPath) === wanted) || null;
  }

  static pathKey(filePath) {
    const resolved = path.resolve(filePath);
    return CASE_INSENSITIVE_FS ? resolved.toLowerCase() : resolved;
  }

  static baseKey(relative) {
    const normalized = String(relative || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
    return CASE_INSENSITIVE_FS ? normalized.toLowerCase() : normalized;
  }

  static normalizeBaseHashes(input) {
    const result = new Map();
    const entries = input instanceof Map ? [...input.entries()] : (input && typeof input === 'object' ? Object.entries(input) : []);
    for (const [relative, hash] of entries) {
      if (typeof hash === 'string' && hash) result.set(this.baseKey(relative), hash);
    }
    return result;
  }

  static stripBom(text) { return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; }

  // Las instantáneas anteriores a la versión con bytes guardaban `content` en texto.
  static snapshotBytes(original) {
    if (typeof original.bytes === 'string') return Buffer.from(original.bytes, 'base64');
    return Buffer.from(String(original.content ?? ''), 'utf8');
  }

  static snapshotSize(entry) {
    return (entry?.snapshots || []).reduce((total, item) =>
      total + (typeof item.bytes === 'string' ? item.bytes.length : String(item.content ?? '').length), 0);
  }

  // Se descartan primero las entregas más antiguas; la última siempre se conserva porque es
  // la única que se puede revertir de inmediato.
  static trimUndoStack(stack) {
    const trimmed = stack.slice(-MAX_UNDO_ENTRIES);
    let total = trimmed.reduce((sum, entry) => sum + this.snapshotSize(entry), 0);
    while (trimmed.length > 1 && total > MAX_UNDO_STACK_CHARS) total -= this.snapshotSize(trimmed.shift());
    return trimmed;
  }

  static hash(buffer) { return hashBytes(buffer); }
  static getUndoStack() { return this.workspaceState?.get(UNDO_KEY, []) || this.memoryUndoStack || []; }
  static async saveUndoStack(stack) {
    this.memoryUndoStack = stack;
    if (this.workspaceState) await this.workspaceState.update(UNDO_KEY, stack);
  }
}

module.exports = { WorkspaceChangeManager };
