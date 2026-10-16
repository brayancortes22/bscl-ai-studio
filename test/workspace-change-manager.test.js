// WorkspaceChangeManager sobre un disco real: Undo byte a byte, raíz de la instantánea,
// límites, rutas bloqueadas, huellas de base y evaluación de riesgo.
const { vscode, reset } = require('./helpers/vscode-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');

// ---------- Emulación mínima de VS Code sobre el disco ----------
// El stub compartido no implementa operaciones de archivo; aquí se emulan con la misma
// semántica que importa para estos tests: el documento no incluye el BOM y, al guardar, VS
// Code lo vuelve a poner si el archivo ya lo tenía.
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const dirty = new Set();
const key = (p) => path.resolve(p).toLowerCase();

function docText(fsPath) {
  return new TextDecoder('utf-8').decode(fs.readFileSync(fsPath));
}
function makeDoc(fsPath) {
  const text = fs.existsSync(fsPath) ? docText(fsPath) : '';
  return {
    uri: vscode.Uri.file(fsPath),
    fileName: fsPath,
    get isDirty() { return dirty.has(key(fsPath)); },
    version: 1,
    getText: () => text,
    positionAt: (offset) => new vscode.Position(0, offset),
    save: async () => { dirty.delete(key(fsPath)); return true; }
  };
}
function writeText(fsPath, text) {
  const hadBom = fs.existsSync(fsPath) && fs.readFileSync(fsPath).subarray(0, 3).equals(BOM);
  fs.writeFileSync(fsPath, Buffer.concat([hadBom ? BOM : Buffer.alloc(0), Buffer.from(text, 'utf8')]));
}

class FakeWorkspaceEdit {
  constructor() { this.ops = []; }
  replace(uri, range, text) { this.ops.push({ type: 'replace', uri, text }); }
  insert(uri, position, text) { this.ops.push({ type: 'insert', uri, text }); }
  createFile(uri, options) { this.ops.push({ type: 'createFile', uri, options }); }
  deleteFile(uri, options) { this.ops.push({ type: 'deleteFile', uri, options }); }
  renameFile(from, to, options) { this.ops.push({ type: 'renameFile', from, to, options }); }
  // Igual que en VS Code: delete() borra TEXTO y exige un Range.
  delete(uri, range) {
    if (!(range instanceof vscode.Range)) throw new Error('Illegal argument: range');
    this.ops.push({ type: 'replace', uri, text: '' });
  }
}

const log = [];
vscode.WorkspaceEdit = FakeWorkspaceEdit;
vscode.workspace.openTextDocument = async (uri) => makeDoc(uri.fsPath);
vscode.workspace.applyEdit = async (edit) => {
  for (const op of edit.ops) {
    log.push(op);
    if (op.type === 'createFile') {
      if (fs.existsSync(op.uri.fsPath) && !op.options?.overwrite) return false;
      fs.writeFileSync(op.uri.fsPath, '');
    } else if (op.type === 'insert' || op.type === 'replace') {
      writeText(op.uri.fsPath, op.text);
    } else if (op.type === 'deleteFile') {
      if (!fs.existsSync(op.uri.fsPath)) { if (!op.options?.ignoreIfNotExists) return false; continue; }
      fs.unlinkSync(op.uri.fsPath);
    } else if (op.type === 'renameFile') {
      fs.renameSync(op.from.fsPath, op.to.fsPath);
    }
  }
  return true;
};
vscode.workspace.fs = {
  createDirectory: async (uri) => { fs.mkdirSync(uri.fsPath, { recursive: true }); },
  writeFile: async (uri, bytes) => { log.push({ type: 'writeFile', uri }); fs.writeFileSync(uri.fsPath, bytes); },
  delete: async (uri) => { fs.unlinkSync(uri.fsPath); },
  readFile: async (uri) => fs.readFileSync(uri.fsPath),
  stat: async () => ({})
};
Object.defineProperty(vscode.workspace, 'textDocuments', {
  configurable: true,
  get: () => [...dirty].map((p) => makeDoc(p))
});

const { WorkspaceChangeManager } = require('../src/workspace-change-manager');

// ---------- Utilidades ----------
const tempDirs = [];
function tempDir() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bscl-wcm-')));
  tempDirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true }); });

function memento() {
  const store = new Map();
  return { get: (k, fallback) => (store.has(k) ? store.get(k) : fallback), update: async (k, v) => { store.set(k, v); }, store };
}
function fresh() {
  reset();
  dirty.clear();
  log.length = 0;
  WorkspaceChangeManager.busy = false;
  WorkspaceChangeManager.memoryUndoStack = undefined;
  const workspaceState = memento();
  WorkspaceChangeManager.configure(workspaceState);
  return workspaceState;
}
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const LATIN1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x61, 0xf1, 0x6f, 0x0a]); // «café año» en Windows-1252

// ---------- Undo byte a byte (FS-3) ----------
test('borrar y deshacer devuelve los bytes exactos de un archivo Windows-1252', async () => {
  fresh();
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'legacy.sql'), LATIN1);
  const applied = await WorkspaceChangeManager.applyChanges({ delete: ['legacy.sql'] }, root);
  assert.deepEqual(applied.files, [{ path: 'legacy.sql', action: 'borrado' }]);
  assert.equal(fs.existsSync(path.join(root, 'legacy.sql')), false);

  await WorkspaceChangeManager.rollbackLast(applied.undoId, root);
  assert.deepEqual(fs.readFileSync(path.join(root, 'legacy.sql')), LATIN1);
});

test('renombrar y deshacer conserva los bytes y quita el destino', async () => {
  fresh();
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'viejo.php'), LATIN1);
  const applied = await WorkspaceChangeManager.applyChanges({ rename: [{ from: 'viejo.php', to: 'lib/nuevo.php' }] }, root);
  assert.deepEqual(fs.readFileSync(path.join(root, 'lib', 'nuevo.php')), LATIN1);
  await WorkspaceChangeManager.rollbackLast(applied.undoId);
  assert.deepEqual(fs.readFileSync(path.join(root, 'viejo.php')), LATIN1);
  assert.equal(fs.existsSync(path.join(root, 'lib', 'nuevo.php')), false);
});

test('no edita un archivo que no es UTF-8 (sus acentos se convertirían en U+FFFD)', async () => {
  fresh();
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'legacy.sql'), LATIN1);
  await assert.rejects(
    WorkspaceChangeManager.applyChanges({ files: [{ path: 'legacy.sql', content: 'caf\ufffd a\ufffdo\n' }] }, root),
    /no está en UTF-8/
  );
  assert.deepEqual(fs.readFileSync(path.join(root, 'legacy.sql')), LATIN1);
});

test('editar un archivo con BOM no duplica el BOM y el Undo devuelve los bytes originales', async () => {
  fresh();
  const root = tempDir();
  const original = Buffer.concat([BOM, Buffer.from('namespace App;\r\n', 'utf8')]);
  fs.writeFileSync(path.join(root, 'Program.cs'), original);
  // El contenido llega con U+FEFF delante, como cuando se leyó con 'utf8' de Node.
  const applied = await WorkspaceChangeManager.applyChanges({ files: [{ path: 'Program.cs', content: '\ufeffnamespace App2;\r\n' }] }, root);
  const written = fs.readFileSync(path.join(root, 'Program.cs'));
  assert.deepEqual(written.subarray(0, 6), Buffer.from([0xef, 0xbb, 0xbf, 0x6e, 0x61, 0x6d]), 'un solo BOM');

  await WorkspaceChangeManager.rollbackLast(applied.undoId);
  assert.deepEqual(fs.readFileSync(path.join(root, 'Program.cs')), original);
});

test('los borrados usan deleteFile (delete() exige un Range y lanzaba)', async () => {
  fresh();
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'a.txt'), 'hola');
  await WorkspaceChangeManager.applyChanges({ delete: ['a.txt'] }, root);
  assert.ok(log.some((op) => op.type === 'deleteFile'));
});

test('lee instantáneas antiguas guardadas como texto', async () => {
  const workspaceState = fresh();
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'nuevo.js'), 'creado por el agente');
  const after = [{ path: 'nuevo.js', exists: true, hash: sha(fs.readFileSync(path.join(root, 'nuevo.js'))) },
    { path: 'viejo.js', exists: false, hash: null }];
  await workspaceState.update('bscl_ai_workspace_undo_stack', [{
    id: 'legacy', root,
    snapshots: [{ path: 'nuevo.js', exists: false, content: '' }, { path: 'viejo.js', exists: true, content: 'contenido previo' }],
    after
  }]);
  await WorkspaceChangeManager.rollbackLast('legacy');
  assert.equal(fs.readFileSync(path.join(root, 'viejo.js'), 'utf8'), 'contenido previo');
  assert.equal(fs.existsSync(path.join(root, 'nuevo.js')), false);
});

// ---------- Raíz de la instantánea (FS-4 / BOUN-M2) ----------
test('rollbackLast usa la raíz de la entrega aunque ahora esté seleccionada otra carpeta', async () => {
  fresh();
  const parent = tempDir();
  const api = path.join(parent, 'api');
  const tienda = path.join(parent, 'tienda');
  fs.mkdirSync(api);
  fs.mkdirSync(tienda);
  const applied = await WorkspaceChangeManager.applyChanges({ files: [{ path: 'server.js', content: 'listen()' }] }, api);
  const result = await WorkspaceChangeManager.rollbackLast(applied.undoId, tienda);
  assert.deepEqual(result.files, ['server.js']);
  assert.equal(fs.existsSync(path.join(api, 'server.js')), false);
});

test('rollbackLast explica cuándo una entrega ya no se puede revertir', async () => {
  fresh();
  await assert.rejects(WorkspaceChangeManager.rollbackLast(undefined), /No hay ninguna entrega/);
  const root = tempDir();
  await WorkspaceChangeManager.applyChanges({ files: [{ path: 'a.js', content: '1' }] }, root);
  await assert.rejects(WorkspaceChangeManager.rollbackLast('no-existe'), /ya no se puede revertir/);
});

// ---------- Buffers sin guardar (FS-10) ----------
test('Deshacer no borra un archivo creado por el agente que tiene cambios sin guardar', async () => {
  fresh();
  const root = tempDir();
  const applied = await WorkspaceChangeManager.applyChanges({ files: [{ path: 'utils/fecha.js', content: 'export {}' }] }, root);
  const target = path.join(root, 'utils', 'fecha.js');
  dirty.add(key(target));
  await assert.rejects(WorkspaceChangeManager.rollbackLast(applied.undoId), /Guarda o descarta/);
  assert.equal(fs.existsSync(target), true);
  dirty.clear();
  await WorkspaceChangeManager.rollbackLast(applied.undoId);
  assert.equal(fs.existsSync(target), false);
});

// ---------- Rutas bloqueadas (FS-11, WORK-M2) ----------
test('bloquea .vscode, .git y node_modules', () => {
  for (const blocked of ['.vscode/settings.json', '.VSCode/tasks.json', 'sub/.vscode/launch.json', '.git/config', 'node_modules/x/index.js']) {
    assert.throws(() => WorkspaceChangeManager.validateRelativePath(blocked), /No se permite escribir/, blocked);
  }
});

test('el filtro de credenciales no bloquea token.service.ts ni tokenizer.js', () => {
  for (const allowed of ['src/auth/token.service.ts', 'tokenizer.js', 'hooks/useToken.js', 'csrf-token.js', 'secret-santa.md', '.env.example']) {
    assert.equal(WorkspaceChangeManager.validateRelativePath(allowed), allowed);
  }
  for (const blocked of ['.env', 'config/.env.local', 'credentials.json', 'certs/server.pem', 'id_rsa', '.aws/config']) {
    assert.throws(() => WorkspaceChangeManager.validateRelativePath(blocked), /credenciales/, blocked);
  }
});

test('las carpetas .docker, .azure y .kube de un repo se pueden editar salvo su archivo de credenciales', () => {
  for (const allowed of ['.docker/nginx/default.conf', '.docker/php/Dockerfile', '.azure/main.bicep', '.kube/deployment.yaml', '.azure/dev/config.json']) {
    assert.equal(WorkspaceChangeManager.validateRelativePath(allowed), allowed);
  }
  for (const blocked of ['.docker/config.json', 'infra/.kube/config', '.azure/dev/.env', '.ssh/authorized_keys', '.gnupg/pubring.kbx', 'deploy/.aws/credentials']) {
    assert.throws(() => WorkspaceChangeManager.validateRelativePath(blocked), /credenciales/, blocked);
  }
});

test('una entrega con .docker/nginx/default.conf se guarda', async () => {
  fresh();
  const root = tempDir();
  const applied = await WorkspaceChangeManager.applyChanges({ files: [{ path: '.docker/nginx/default.conf', content: 'server {}' }] }, root);
  assert.deepEqual(applied.files, [{ path: '.docker/nginx/default.conf', action: 'creado' }]);
  assert.equal(fs.readFileSync(path.join(root, '.docker', 'nginx', 'default.conf'), 'utf8'), 'server {}');
});

test('no escribe en una carpeta de credenciales elegida como raíz (~/.ssh, ~/.docker)', async () => {
  fresh();
  const parent = tempDir();
  for (const name of ['.ssh', '.docker']) {
    const credentialRoot = path.join(parent, name);
    fs.mkdirSync(credentialRoot);
    await assert.rejects(
      WorkspaceChangeManager.applyChanges({ files: [{ path: 'authorized_keys', content: 'ssh-ed25519 AAAA atacante' }] }, credentialRoot),
      /guarda credenciales/
    );
    assert.equal(fs.existsSync(path.join(credentialRoot, 'authorized_keys')), false);
  }
});

test('una entrega antigua escrita en ~/.ssh se puede deshacer aunque ahora esa raíz esté bloqueada', async () => {
  const workspaceState = fresh();
  const sshDir = path.join(tempDir(), '.ssh');
  fs.mkdirSync(sshDir);
  const original = Buffer.from('ssh-ed25519 AAAA usuario\n');
  const injected = Buffer.from('ssh-ed25519 AAAA usuario\nssh-ed25519 BBBB atacante\n');
  fs.writeFileSync(path.join(sshDir, 'authorized_keys'), injected);
  fs.writeFileSync(path.join(sshDir, 'config'), 'Host x');
  await workspaceState.update('bscl_ai_workspace_undo_stack', [{
    id: 'previa', root: sshDir,
    snapshots: [
      { path: 'authorized_keys', exists: true, bytes: original.toString('base64') },
      { path: 'config', exists: false }
    ],
    after: [
      { path: 'authorized_keys', exists: true, hash: sha(injected) },
      { path: 'config', exists: true, hash: sha(Buffer.from('Host x')) }
    ]
  }]);
  await WorkspaceChangeManager.rollbackLast('previa');
  assert.deepEqual(fs.readFileSync(path.join(sshDir, 'authorized_keys')), original);
  assert.equal(fs.existsSync(path.join(sshDir, 'config')), false);
});

test('si la raíz es el perfil del usuario, bloquea sus carpetas de credenciales pero no las de un repo', async (t) => {
  fresh();
  const home = tempDir();
  const saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
  // os.homedir() lee USERPROFILE en Windows y HOME en el resto en cada llamada.
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  assert.equal(os.homedir(), home);

  await assert.rejects(
    WorkspaceChangeManager.applyChanges({ files: [{ path: '.docker/daemon.json', content: '{}' }] }, home),
    /credenciales del perfil/
  );
  assert.equal(fs.existsSync(path.join(home, '.docker', 'daemon.json')), false);

  const repo = path.join(home, 'proyectos', 'tienda');
  fs.mkdirSync(repo, { recursive: true });
  const applied = await WorkspaceChangeManager.applyChanges({ files: [{ path: '.docker/daemon.json', content: '{}' }] }, repo);
  assert.deepEqual(applied.files, [{ path: '.docker/daemon.json', action: 'creado' }]);
});

test('una entrega que crea token.service.ts se guarda entera', async () => {
  fresh();
  const root = tempDir();
  const applied = await WorkspaceChangeManager.applyChanges({ files: [
    { path: 'src/auth/token.service.ts', content: 'export class TokenService {}' },
    { path: 'src/app.ts', content: 'import "./auth/token.service";' }
  ] }, root);
  assert.equal(applied.files.length, 2);
  assert.ok(fs.existsSync(path.join(root, 'src', 'auth', 'token.service.ts')));
});

// ---------- Límites de las instantáneas (FS-12) ----------
test('no borra un archivo de más de 1 MB porque su copia de Undo no cabría', async () => {
  fresh();
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'export.csv'), Buffer.alloc(1000001, 0x61));
  await assert.rejects(WorkspaceChangeManager.applyChanges({ delete: ['export.csv'] }, root), /más de 1 MB/);
  assert.ok(fs.existsSync(path.join(root, 'export.csv')));
});

test('limita el total de bytes de instantánea por entrega', async () => {
  fresh();
  const root = tempDir();
  for (const name of ['a.log', 'b.log', 'c.log']) fs.writeFileSync(path.join(root, name), Buffer.alloc(900000, 0x61));
  await assert.rejects(WorkspaceChangeManager.applyChanges({ delete: ['a.log', 'b.log', 'c.log'] }, root), /más de 2 MB/);
  for (const name of ['a.log', 'b.log', 'c.log']) assert.ok(fs.existsSync(path.join(root, name)));
});

test('la pila de Undo descarta primero las entregas antiguas si supera el tope', async () => {
  const workspaceState = fresh();
  const root = tempDir();
  // Cada entrega guarda ~1,2 MB en base64 (900 000 bytes); el tope de la pila es 4 000 000.
  for (let index = 0; index < 4; index += 1) {
    fs.writeFileSync(path.join(root, `f${index}.log`), Buffer.alloc(900000, 0x61 + index));
    await WorkspaceChangeManager.applyChanges({ delete: [`f${index}.log`] }, root);
  }
  const stack = workspaceState.get('bscl_ai_workspace_undo_stack', []);
  const totalChars = stack.reduce((sum, entry) => sum + entry.snapshots.reduce((s, item) => s + (item.bytes || '').length, 0), 0);
  assert.equal(stack.length, 3);
  assert.ok(totalChars <= 4000000, `total ${totalChars}`);
  assert.deepEqual(stack.map((entry) => entry.snapshots[0].path), ['f1.log', 'f2.log', 'f3.log']);
});

// ---------- Huella de la base (FS-2) ----------
test('rechaza sobrescribir un archivo que cambió desde que el modelo lo leyó', async () => {
  fresh();
  const root = tempDir();
  const file = path.join(root, 'app.js');
  fs.writeFileSync(file, 'v1');
  const baseHash = sha(fs.readFileSync(file));
  fs.writeFileSync(file, 'v1 + edición del usuario');
  await assert.rejects(
    WorkspaceChangeManager.applyChanges({ files: [{ path: 'app.js', content: 'v2', baseHash }] }, root),
    /cambió durante la generación/
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'v1 + edición del usuario');

  const baseHashes = new Map([['app.js', baseHash]]);
  await assert.rejects(
    WorkspaceChangeManager.applyChanges({ files: [{ path: 'app.js', content: 'v2' }] }, root, { baseHashes }),
    /cambió durante la generación/
  );
});

test('no vuelve a crear un archivo que el usuario borró durante la generación', async () => {
  fresh();
  const root = tempDir();
  const baseHash = sha(Buffer.from('v1'));
  await assert.rejects(
    WorkspaceChangeManager.applyChanges({ files: [{ path: 'app.js', content: 'v2', baseHash }] }, root),
    /cambió durante la generación/
  );
  assert.equal(fs.existsSync(path.join(root, 'app.js')), false);
});

test('aplica el cambio si la huella coincide con el disco', async () => {
  fresh();
  const root = tempDir();
  const file = path.join(root, 'app.js');
  fs.writeFileSync(file, 'v1');
  const baseHashes = { 'APP.js': sha(fs.readFileSync(file)) };
  const applied = await WorkspaceChangeManager.applyChanges({ files: [{ path: 'app.js', content: 'v2' }] }, root, { baseHashes });
  assert.deepEqual(applied.files, [{ path: 'app.js', action: 'editado' }]);
  assert.equal(fs.readFileSync(file, 'utf8'), 'v2');
});

// ---------- Evaluación de riesgo (FS-6) ----------
test('assessRisk lista borrados, renombrados y archivos que pierden más de la mitad, sin escribir', () => {
  fresh();
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'grande.js'), 'x'.repeat(1000));
  fs.writeFileSync(path.join(root, 'medio.js'), 'x'.repeat(1000));
  fs.writeFileSync(path.join(root, 'borrar.js'), 'x');
  const changes = {
    files: [
      { path: 'grande.js', content: 'x'.repeat(400) },
      { path: 'medio.js', content: 'x'.repeat(600) },
      { path: 'nuevo.js', content: '' }
    ],
    delete: ['borrar.js'],
    rename: [{ from: 'medio.js', to: 'otro.js' }]
  };
  const risk = WorkspaceChangeManager.assessRisk(changes, root);
  assert.deepEqual(risk, {
    deletes: ['borrar.js'],
    renames: [{ from: 'medio.js', to: 'otro.js' }],
    shrunk: [{ path: 'grande.js', beforeBytes: 1000, afterBytes: 400 }]
  });
  assert.equal(fs.readFileSync(path.join(root, 'grande.js'), 'utf8').length, 1000);
  assert.equal(fs.existsSync(path.join(root, 'borrar.js')), true);
  assert.equal(log.length, 0);
});

test('assessRisk conserva en shrunk la ruta tal como llegó y no lanza con rutas inválidas', () => {
  fresh();
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'x'.repeat(100));
  const risk = WorkspaceChangeManager.assessRisk({ files: [
    { path: 'src\\a.js', content: 'x' },
    { path: '../fuera.js', content: '' },
    { path: '.env', content: '' }
  ] }, root);
  assert.deepEqual(risk.shrunk, [{ path: 'src\\a.js', beforeBytes: 100, afterBytes: 1 }]);
});

