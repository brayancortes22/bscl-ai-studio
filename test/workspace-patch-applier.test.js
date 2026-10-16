// PatchApplier: bloques ambiguos, rutas que no deben leerse, codificación y huella de base.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { PatchApplier, decodeUtf8 } = require('../src/patch-applier');

const tempDirs = [];
function tempDir() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bscl-patch-')));
  tempDirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true }); });

const TWO_FUNCTIONS = [
  'function a() {',
  '  if (!x) {',
  '    return null;',
  '  }',
  '}',
  'function b() {',
  '  if (!y) {',
  '    return null;',
  '  }',
  '}',
  ''
].join('\n');

// ---------- Ambigüedad (FS-9) ----------
test('no aplica un bloque search que aparece varias veces', () => {
  const result = PatchApplier.applySingleBlock(TWO_FUNCTIONS, '    return null;\n  }', '    return 0;\n  }');
  assert.equal(result.applied, false);
  assert.equal(result.content, TWO_FUNCTIONS);
  assert.match(result.reason, /aparece 2 veces/);
});

test('detecta la ambigüedad también en los modos CRLF y tolerante a espacios', () => {
  const crlf = TWO_FUNCTIONS.replace(/\n/g, '\r\n');
  assert.match(PatchApplier.applySingleBlock(crlf, '    return null;\n  }', 'x').reason, /aparece 2 veces/);
  const trailing = TWO_FUNCTIONS.replace(/return null;/g, 'return null;   ');
  assert.match(PatchApplier.applySingleBlock(trailing, '    return null;\n  }', 'x').reason, /aparece 2 veces/);
});

test('cuenta coincidencias solapadas', () => {
  assert.equal(PatchApplier.applySingleBlock('aaa', 'aa', 'b').applied, false);
});

test('aplica un bloque único', () => {
  const result = PatchApplier.applySingleBlock(TWO_FUNCTIONS, '  if (!y) {\n    return null;', '  if (!y) {\n    return 0;');
  assert.equal(result.applied, true);
  assert.match(result.content, /function b\(\) {\n {2}if \(!y\) {\n {4}return 0;/);
  assert.match(result.content, /function a\(\) {\n {2}if \(!x\) {\n {4}return null;/);
});

test('el modo tolerante respeta la sangría de la primera línea', () => {
  const source = 'function a() {\n    const v = 1;   \n    return v;\n}\n';
  const result = PatchApplier.applySingleBlock(source, '\n    const v = 1;\n    return v;\n', '    const v = 2;\n    return v;');
  assert.equal(result.applied, true);
  assert.equal(result.content, 'function a() {\n    const v = 2;\n    return v;\n}\n');
});

test('resolvePatches informa del parche ambiguo en failedPatches', () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'a.js'), TWO_FUNCTIONS);
  const { files, failedPatches } = PatchApplier.resolvePatches({
    rootPath: root,
    patches: [{ path: 'a.js', search: 'return null;', replace: 'return 0;' }]
  });
  assert.deepEqual(files, []);
  assert.equal(failedPatches.length, 1);
  assert.match(failedPatches[0], /^a\.js \(el bloque search aparece 2 veces/);
});

// ---------- Rutas que no deben leerse (FS-8) ----------
test('no lee el .env real aunque el bloque search coincida', () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, '.env'), 'PORT=3000\nSTRIPE_KEY=sk_live_abcdefghijklmnop1234\n');
  const { files, failedPatches } = PatchApplier.resolvePatches({
    rootPath: root,
    patches: [{ path: '.env', search: 'PORT=3000', replace: 'PORT=3000\nNEW=1' }]
  });
  assert.deepEqual(files, []);
  assert.match(failedPatches[0], /credenciales/);
  assert.ok(!JSON.stringify({ files, failedPatches }).includes('sk_live'));
});

test('no lee rutas fuera de la raíz ni dentro de .vscode o node_modules', () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, '.vscode'));
  fs.writeFileSync(path.join(root, '.vscode', 'settings.json'), '{"a": 1}');
  const { files, failedPatches } = PatchApplier.resolvePatches({
    rootPath: root,
    patches: [
      { path: '../fuera.js', search: 'a', replace: 'b' },
      { path: '.vscode/settings.json', search: '"a": 1', replace: '"a": 2' },
      { path: 'node_modules/x/index.js', search: 'a', replace: 'b' }
    ]
  });
  assert.deepEqual(files, []);
  assert.equal(failedPatches.length, 3);
});

test('parchea archivos de una carpeta .docker del repo, pero no su config.json', () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, '.docker', 'nginx'), { recursive: true });
  fs.writeFileSync(path.join(root, '.docker', 'nginx', 'default.conf'), 'listen 80;\n');
  fs.writeFileSync(path.join(root, '.docker', 'Dockerfile'), 'FROM php:8.3\n');
  fs.writeFileSync(path.join(root, '.docker', 'config.json'), '{"auths": {"r": {"auth": "dXNlcjpwYXNz"}}}');
  const { files, failedPatches } = PatchApplier.resolvePatches({
    rootPath: root,
    patches: [
      { path: '.docker/nginx/default.conf', search: 'listen 80;', replace: 'listen 8080;' },
      { path: '.docker/Dockerfile', search: 'FROM php:8.3', replace: 'FROM php:8.4' },
      { path: '.docker/config.json', search: '"auths"', replace: '"x"' }
    ]
  });
  assert.deepEqual(files.map((file) => [file.path, file.content]), [
    ['.docker/nginx/default.conf', 'listen 8080;\n'],
    ['.docker/Dockerfile', 'FROM php:8.4\n']
  ]);
  assert.equal(failedPatches.length, 1);
  assert.match(failedPatches[0], /^\.docker\/config\.json \(.*credenciales/);
  assert.ok(!JSON.stringify(files).includes('dXNlcjpwYXNz'));
});

test('no lee nada si la raíz es una carpeta de credenciales', () => {
  const credentialRoot = path.join(tempDir(), '.ssh');
  fs.mkdirSync(credentialRoot);
  fs.writeFileSync(path.join(credentialRoot, 'authorized_keys'), 'ssh-ed25519 AAAA usuario');
  const { files, failedPatches } = PatchApplier.resolvePatches({
    rootPath: credentialRoot,
    patches: [{ path: 'authorized_keys', search: 'usuario', replace: 'atacante' }]
  });
  assert.deepEqual(files, []);
  assert.match(failedPatches[0], /guarda credenciales/);
});

test('no sigue un enlace (junction) a otra carpeta', (t) => {
  const root = tempDir();
  const outside = tempDir();
  fs.writeFileSync(path.join(outside, 'config.js'), 'const a = 1;');
  try { fs.symlinkSync(outside, path.join(root, 'enlace'), 'junction'); } catch (error) {
    t.skip(`no se pudo crear el enlace: ${error.code}`);
    return;
  }
  const { files, failedPatches } = PatchApplier.resolvePatches({
    rootPath: root,
    patches: [{ path: 'enlace/config.js', search: 'const a = 1;', replace: 'const a = 2;' }]
  });
  assert.deepEqual(files, []);
  assert.match(failedPatches[0], /enlaces simbólicos/);
});

// ---------- Codificación (FS-3) ----------
test('no parchea un archivo que no es UTF-8', () => {
  const root = tempDir();
  const latin1 = Buffer.from([0x2d, 0x2d, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x0a, 0x53, 0x45, 0x4c, 0x45, 0x43, 0x54, 0x20, 0x31, 0x3b, 0x0a]);
  fs.writeFileSync(path.join(root, 'q.sql'), latin1);
  const { files, failedPatches } = PatchApplier.resolvePatches({
    rootPath: root,
    patches: [{ path: 'q.sql', search: 'SELECT 1;', replace: 'SELECT 2;' }]
  });
  assert.deepEqual(files, []);
  assert.match(failedPatches[0], /no está en UTF-8/);
});

test('quita el BOM antes de parchear y devuelve la huella de los bytes leídos', () => {
  const root = tempDir();
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('class A {}\n', 'utf8')]);
  fs.writeFileSync(path.join(root, 'A.cs'), bytes);
  const { files, failedPatches } = PatchApplier.resolvePatches({
    rootPath: root,
    patches: [{ path: 'A.cs', search: 'class A {}', replace: 'class B {}' }]
  });
  assert.deepEqual(failedPatches, []);
  assert.equal(files.length, 1);
  assert.equal(files[0].content, 'class B {}\n');
  assert.equal(files[0].content.charCodeAt(0), 0x63, 'sin U+FEFF al principio');
  assert.equal(files[0].baseHash, createHash('sha256').update(bytes).digest('hex'));
});

test('los archivos que no se leyeron del disco no llevan baseHash', () => {
  const { files } = PatchApplier.resolvePatches({
    rootPath: tempDir(),
    files: [{ path: 'nuevo.js', content: 'const a = 1;' }],
    patches: [{ path: 'nuevo.js', search: 'const a = 1;', replace: 'const a = 2;' }]
  });
  assert.deepEqual(files, [{ path: 'nuevo.js', content: 'const a = 2;' }]);
});

test('conserva el baseHash de los archivos base de una ronda anterior', () => {
  const baseHash = 'a'.repeat(64);
  const { files } = PatchApplier.resolvePatches({
    rootPath: tempDir(),
    files: [
      { path: 'src/app.js', content: 'const a = 1;', baseHash },
      // Una entrada posterior de la misma ruta (la del modelo) no reemplaza la huella del disco.
      { path: 'src/app.js', content: 'const a = 1;', baseHash: 'b'.repeat(64) },
      { path: 'otro.js', content: 'x', baseHash: 'no-es-un-sha256' }
    ],
    patches: [{ path: 'src/app.js', search: 'const a = 1;', replace: 'const a = 2;' }]
  });
  assert.deepEqual(files, [
    { path: 'src/app.js', content: 'const a = 2;', baseHash },
    { path: 'otro.js', content: 'x' }
  ]);
});

test('decodeUtf8 separa el BOM y lanza con bytes inválidos', () => {
  assert.deepEqual(decodeUtf8(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), { text: 'a', hasBom: true });
  assert.throws(() => decodeUtf8(Buffer.from([0xe9])));
});
