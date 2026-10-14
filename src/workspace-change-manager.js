const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { randomUUID, createHash } = require('crypto');

const BLOCKED_DIRS = new Set(['.git', '.svn', '.hg', 'node_modules']);
const SECRET_FILE = /(^\.env(?:\..*)?$|secret|credential|token|^id_(?:rsa|ed25519)|\.(?:pem|key|p12|pfx)$)/i;
const BINARY_FILE = /\.(?:exe|dll|so|dylib|bin|db|sqlite|zip|vsix|png|jpe?g|gif|webp|ico|pdf|mp[34]|wav|woff2?|ttf|otf)$/i;
const MAX_FILES = 100;
const MAX_TOTAL_BYTES = 1000000;
const UNDO_KEY = 'bscl_ai_workspace_undo_stack';

class WorkspaceChangeManager {
  static configure(workspaceState) { this.workspaceState = workspaceState; }

  static async applyFiles(files, scopePath = null) {
    return this.applyChanges({ files }, scopePath);
  }

  static async applyChanges({ files = [], delete: deletePaths = [], rename = [] } = {}, scopePath = null) {
    if (this.busy) throw new Error('Ya hay otra implementación guardándose; espera a que termine.');
    this.busy = true;
    try { return await this.applyValidatedChanges({ files, delete: deletePaths, rename }, scopePath); }
    finally { this.busy = false; }
  }

  static async applyValidatedChanges({ files, delete: deletePaths, rename }, scopePath) {
    const root = this.resolveRoot(scopePath);
    if (!Array.isArray(files) || !Array.isArray(deletePaths) || !Array.isArray(rename)) {
      throw new Error('El agente devolvió operaciones de archivos con formato no válido.');
    }
    const operationCount = files.length + deletePaths.length + rename.length * 2;
    if (!operationCount || operationCount > MAX_FILES) throw new Error(`La implementación debe incluir entre 1 y ${MAX_FILES} rutas como máximo.`);

    const seen = new Set();
    const snapshots = new Map();
    const preparedFiles = [];
    const preparedDeletes = [];
    const preparedRenames = [];
    let totalBytes = 0;

    const inspectPath = async (input, { requireExisting = false } = {}) => {
      const relative = this.validateRelativePath(input);
      if (BINARY_FILE.test(relative)) throw new Error(`Solo se permiten cambios a archivos de texto: ${relative}`);
      const key = relative.toLowerCase();
      if (seen.has(key)) throw new Error(`La respuesta repite o combina operaciones sobre ${relative}.`);
      seen.add(key);
      const target = path.resolve(root, ...relative.split('/'));
      this.rejectSymlinkPath(root, relative, target);
      let stat = null;
      try { stat = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (stat && !stat.isFile()) throw new Error(`${relative} no es un archivo normal.`);
      if (requireExisting && !stat) throw new Error(`No se puede operar: ${relative} no existe.`);
      if (stat && fs.lstatSync(target).isSymbolicLink()) throw new Error(`No se permiten enlaces simbólicos: ${relative}`);
      this.ensureWritable(root, target, Boolean(stat));

      let document = null;
      if (stat) {
        document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
        if (document.isDirty) throw new Error(`Guarda o descarta los cambios sin guardar de ${relative} antes de continuar.`);
      }
      const entry = { relative, target, exists: Boolean(stat), document, version: document?.version };
      snapshots.set(relative, stat ? { path: relative, exists: true, content: fs.readFileSync(target, 'utf8') } :
        { path: relative, exists: false, content: '' });
      return entry;
    };

    for (const item of files) {
      if (typeof item?.content !== 'string' || item.content.includes('\u0000')) {
        throw new Error(`El contenido de ${item?.path || 'un archivo'} no es texto válido.`);
      }
      totalBytes += Buffer.byteLength(item.content, 'utf8');
      if (Buffer.byteLength(item.content, 'utf8') > 200000 || totalBytes > MAX_TOTAL_BYTES) {
        throw new Error('La implementación supera el límite de tamaño permitido. Divide la tarea en partes.');
      }
      preparedFiles.push({ ...(await inspectPath(item.path)), content: item.content });
    }

    for (const input of deletePaths) preparedDeletes.push(await inspectPath(input, { requireExisting: true }));
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
      this.rejectSymlinkPath(root, item.relative, item.target);
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
        edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), item.document.positionAt(item.document.getText().length)), item.content);
      }
    }
    for (const item of preparedDeletes) edit.delete(vscode.Uri.file(item.target), { recursive: false, ignoreIfNotExists: false });
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
      return { path: relative, exists: Boolean(content), hash: content ? this.hash(content) : null };
    });
    const undoId = randomUUID();
    const stack = this.getUndoStack();
    stack.push({ id: undoId, root, snapshots: [...snapshots.values()], after });
    await this.saveUndoStack(stack.slice(-5));

    const changedFiles = [
      ...preparedFiles.map(({ relative, exists }) => ({ path: relative, action: exists ? 'editado' : 'creado' })),
      ...preparedDeletes.map(({ relative }) => ({ path: relative, action: 'borrado' })),
      ...preparedRenames.map(({ source, target }) => ({ path: `${source.relative} → ${target.relative}`, action: 'renombrado' }))
    ];
    return { files: changedFiles, undoId };
  }

  static async rollbackLast(undoId, scopePath = null) {
    if (this.busy) throw new Error('Espera a que termine la operación actual antes de revertir.');
    this.busy = true;
    try {
      const stack = this.getUndoStack();
      const snapshot = stack[stack.length - 1];
      if (!snapshot || (undoId && snapshot.id !== undoId)) {
        throw new Error('Para proteger cambios posteriores, revierte primero la última entrega del chat.');
      }
      const root = this.resolveRoot(scopePath || snapshot.root);
      if (path.resolve(root) !== path.resolve(snapshot.root)) throw new Error('La carpeta seleccionada no coincide con la carpeta de la entrega que intentas revertir.');

      for (const expected of snapshot.after) {
        const target = path.resolve(root, ...expected.path.split('/'));
        this.rejectSymlinkPath(root, expected.path, target);
        let content = null;
        try { content = fs.readFileSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (Boolean(content) !== expected.exists || (content && this.hash(content) !== expected.hash)) {
          throw new Error(`${expected.path} cambió después de la entrega. No se revirtió para conservar tus cambios recientes.`);
        }
      }

      await this.restoreSnapshots(root, snapshot.snapshots, true);
      stack.pop();
      await this.saveUndoStack(stack);
      return { undoId: snapshot.id, files: snapshot.snapshots.map(({ path: relative }) => relative) };
    } finally { this.busy = false; }
  }

  static async restoreSnapshots(root, originals, checkDirty = false) {
    const edit = new vscode.WorkspaceEdit();
    const filesToSave = [];
    for (const original of originals) {
      const target = path.resolve(root, ...original.path.split('/'));
      this.rejectSymlinkPath(root, original.path, target);
      let exists = false;
      try { exists = fs.lstatSync(target).isFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const uri = vscode.Uri.file(target);
      if (original.exists) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target)));
        if (exists) {
          const document = await vscode.workspace.openTextDocument(uri);
          if (checkDirty && document.isDirty) throw new Error(`Guarda o descarta los cambios sin guardar de ${original.path} antes de revertir.`);
          edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), document.positionAt(document.getText().length)), original.content);
        } else {
          edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
          edit.insert(uri, new vscode.Position(0, 0), original.content);
        }
        filesToSave.push(target);
      } else if (exists) edit.delete(uri, { recursive: false, ignoreIfNotExists: false });
    }
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code rechazó la restauración de los archivos.');
    for (const target of filesToSave) {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      if (!await document.save()) throw new Error(`No se pudo guardar la restauración de ${path.relative(root, target)}.`);
    }
  }

  static resolveRoot(scopePath) {
    const fallback = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    const requested = scopePath || fallback;
    if (!requested) throw new Error('Abre una carpeta o arrastra una carpeta al chat antes de pedir cambios.');
    let root;
    try {
      const stat = fs.lstatSync(requested);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error();
      root = fs.realpathSync(requested);
    } catch { throw new Error('La carpeta elegida no está disponible o no es una carpeta local normal.'); }
    return root;
  }

  static validateRelativePath(input) {
    if (typeof input !== 'string' || !input.trim() || input.length > 240 || /[\u0000-\u001f]/.test(input)) throw new Error('El agente devolvió una ruta de archivo no válida.');
    const normalized = input.trim().replace(/\\/g, '/');
    const parts = normalized.split('/');
    if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || parts.some((part) => !part || part === '.' || part === '..' || part.includes(':') || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))) throw new Error(`Solo se permiten rutas relativas seguras: ${input}`);
    if (parts.some((part) => BLOCKED_DIRS.has(part.toLowerCase()))) throw new Error(`No se permite escribir dentro de ${input}.`);
    if (SECRET_FILE.test(parts[parts.length - 1]) && !/^\.env\.(?:example|template)$/i.test(parts[parts.length - 1])) throw new Error(`Se bloqueó una ruta de credenciales: ${input}`);
    return parts.join('/');
  }

  static rejectSymlinkPath(root, relative, target) {
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

  static ensureWritable(root, target, exists) {
    let candidate = exists ? target : path.dirname(target);
    while (candidate !== root && !fs.existsSync(candidate)) candidate = path.dirname(candidate);
    try { fs.accessSync(candidate, fs.constants.W_OK); }
    catch { throw new Error(`No hay permiso de escritura en la ruta necesaria para ${path.relative(root, target)}.`); }
  }

  static hash(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
  static getUndoStack() { return this.workspaceState?.get(UNDO_KEY, []) || this.memoryUndoStack || []; }
  static async saveUndoStack(stack) {
    this.memoryUndoStack = stack;
    if (this.workspaceState) await this.workspaceState.update(UNDO_KEY, stack);
  }
}

module.exports = { WorkspaceChangeManager };
