// Qué llega al modelo desde el workspace: WorkspaceContext (archivos de la carpeta) y
// WorkspaceInspector (editor activo). Nada de credenciales, y sin ocultar archivos legítimos.
const { vscode, state, reset, makeUri } = require('./helpers/vscode-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { WorkspaceContext } = require('../src/workspace-context');
const { WorkspaceInspector } = require('../src/workspace-inspector');

const tempDirs = [];
function tempDir() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bscl-ctx-')));
  tempDirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true }); });

function write(root, relative, content) {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

// ---------- WorkspaceContext ----------
test('build excluye credenciales, incluye token.service.ts y redacta valores literales', async () => {
  reset();
  const root = tempDir();
  write(root, '.env', 'DB_PASSWORD=supersecreta123\n');
  write(root, 'credentials.json', '{"key": "abc"}');
  write(root, 'src/auth/token.service.ts', 'export class TokenService { sign() {} }\n');
  write(root, 'src/config.js', 'const apiKey = "AbCdEf123456";\nconst token = getToken();\n');
  const context = await WorkspaceContext.build('revisa el token service', root);

  assert.ok(!context.includes('supersecreta123'));
  assert.ok(!context.includes('### .env'));
  assert.ok(!context.includes('### credentials.json'));
  assert.match(context, /### src\/auth\/token\.service\.ts/);
  assert.match(context, /const apiKey = "\[REDACTADO\]";/);
  assert.match(context, /const token = getToken\(\);/, 'el código normal no se redacta');
  assert.match(context, /\.vscode, \.git o node_modules/);
});

test('build no lee una carpeta de credenciales elegida como raíz (~/.docker)', async () => {
  reset();
  const dockerDir = path.join(tempDir(), '.docker');
  write(dockerDir, 'config.json', '{"auths": {"registry": {"auth": "dXNlcjpwYXNzd29yZA=="}}}');
  const baseHashes = new Map();
  const context = await WorkspaceContext.build('', dockerDir, baseHashes);
  assert.ok(!context.includes('dXNlcjpwYXNzd29yZA'));
  assert.match(context, /guarda credenciales/);
  assert.equal(baseHashes.size, 0);
});

test('build rellena baseHashes con la huella de los bytes de cada archivo adjunto', async () => {
  reset();
  const root = tempDir();
  const bytes = Buffer.from('console.log(1);\n', 'utf8');
  write(root, 'src/app.js', bytes);
  const baseHashes = new Map();
  await WorkspaceContext.build('', root, baseHashes);
  assert.equal(baseHashes.get('src/app.js'), createHash('sha256').update(bytes).digest('hex'));
});

test('build marca como solo lectura un archivo que no es UTF-8', async () => {
  reset();
  const root = tempDir();
  write(root, 'legacy.sql', Buffer.from([0x2d, 0x2d, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x0a]));
  const context = await WorkspaceContext.build('', root);
  assert.match(context, /### legacy\.sql \(no está en UTF-8: solo lectura\)/);
});

test('isTextFileName solo descarta nombres de credenciales reales', () => {
  assert.equal(WorkspaceContext.isTextFileName('token.service.ts'), true);
  assert.equal(WorkspaceContext.isTextFileName('tokenizer.js'), true);
  assert.equal(WorkspaceContext.isTextFileName('secret-santa.md'), true);
  assert.equal(WorkspaceContext.isTextFileName('secrets.json'), false);
  assert.equal(WorkspaceContext.isTextFileName('server.key'), false);
  assert.equal(WorkspaceContext.isTextFileName('app.min.js'), false);
});

// ---------- WorkspaceInspector.getActiveEditorInfo ----------
function setEditor(fsPath, text, selection = [0, 0]) {
  const offsetAt = (position) => position.character;
  state.activeTextEditor = {
    document: {
      uri: makeUri(fsPath),
      languageId: 'plaintext',
      lineCount: text.split('\n').length,
      offsetAt,
      getText: (range) => (range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text)
    },
    selection: new vscode.Selection(new vscode.Position(0, selection[0]), new vscode.Position(0, selection[1]))
  };
}

test('un archivo activo sensible no envía nada de su contenido', () => {
  reset();
  const root = tempDir();
  state.workspaceFolders = [root];
  const text = 'STRIPE_KEY=sk_live_abcdefghijklmnop1234\nPORT=3000\n';
  setEditor(path.join(root, '.env'), text, [0, 20]);
  const info = WorkspaceInspector.getActiveEditorInfo();
  assert.equal(info.isSensitive, true);
  assert.equal(info.selectedText, '');
  assert.equal(info.contentSnippet, '');
  assert.equal(info.fileName, '.env');
  assert.deepEqual(Object.keys(info).sort(), ['contentSnippet', 'fileName', 'isSensitive', 'language', 'lineCount', 'relativePath', 'selectedText', 'selectionRange']);
});

test('id_rsa y archivos dentro de ~/.aws también cuentan como sensibles', () => {
  reset();
  setEditor(path.join(os.homedir(), '.ssh', 'id_rsa'), 'clave');
  assert.equal(WorkspaceInspector.getActiveEditorInfo().isSensitive, true);
  setEditor(path.join(os.homedir(), '.aws', 'credentials'), 'aws_secret_access_key = x');
  assert.equal(WorkspaceInspector.getActiveEditorInfo().contentSnippet, '');
});

test('un archivo normal sale redactado en el extracto y en la selección', () => {
  reset();
  const root = tempDir();
  state.workspaceFolders = [root];
  const text = 'const apiKey = "AbCdEf123456";\nconst token = getToken();\n';
  setEditor(path.join(root, 'src', 'config.js'), text, [0, 30]);
  const info = WorkspaceInspector.getActiveEditorInfo();
  assert.equal(info.isSensitive, false);
  assert.equal(info.selectedText, 'const apiKey = "[REDACTADO]";');
  assert.ok(!info.contentSnippet.includes('AbCdEf123456'));
  assert.match(info.contentSnippet, /const token = getToken\(\);/);
  assert.equal(info.relativePath, path.join('src', 'config.js'));
});

test('una clave privada que cruza el corte de 4000 caracteres no se filtra', () => {
  reset();
  const body = 'MIIEowIBAAKCAQEA' + 'x'.repeat(1600);
  const text = `${'a'.repeat(3900)}\n-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\nfin`;
  setEditor(path.join(tempDir(), 'notas.txt'), text);
  const info = WorkspaceInspector.getActiveEditorInfo();
  assert.ok(!info.contentSnippet.includes('MIIEowIBAAKCAQEA'));
});

test('una clave privada sin línea END se corta en la cabecera', () => {
  reset();
  setEditor(path.join(tempDir(), 'pegado.txt'), 'texto\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n');
  const info = WorkspaceInspector.getActiveEditorInfo();
  assert.ok(!info.contentSnippet.includes('MIIEvQIBADAN'));
  assert.match(info.contentSnippet, /^texto\n\[REDACTADO\]$/);
});

test('se eliminaron readFile y searchWorkspaceFiles (prefijo de ruta vulnerable y sin uso)', () => {
  assert.equal(WorkspaceInspector.readFile, undefined);
  assert.equal(WorkspaceInspector.searchWorkspaceFiles, undefined);
  for (const name of ['getActiveEditorInfo', 'getOpenEditors', 'getWorkspaceRoot', 'getWorkspaceDirectories', 'getWorkspaceTree']) {
    assert.equal(typeof WorkspaceInspector[name], 'function', name);
  }
});
