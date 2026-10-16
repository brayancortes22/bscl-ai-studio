// Archivos arrastrados al chat: filtro de credenciales común, redacción, BOM y audio.
// También comprueba que system-tools ya no expone la ejecución en terminal.
const { vscode } = require('./helpers/vscode-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DroppedFileImporter } = require('../src/dropped-file-importer');

let root;
const uri = (...parts) => vscode.Uri.file(path.join(root, ...parts)).toString();
test.before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bscl-drop-')));
  fs.writeFileSync(path.join(root, 'nota.mp3'), Buffer.alloc(32, 1));
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=abcdef123456\n');
  fs.writeFileSync(path.join(root, 'token.service.ts'), 'export const tokenService = {};\n');
  fs.writeFileSync(path.join(root, 'app.yml'), 'password: hunter2222\nport: 8080\n');
  fs.writeFileSync(path.join(root, 'bom.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hola', 'utf8')]));
  fs.mkdirSync(path.join(root, '.aws'));
  fs.writeFileSync(path.join(root, '.aws', 'config.txt'), 'region = eu-west-1');
  fs.mkdirSync(path.join(root, '.docker', 'contexts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.docker', 'config.json'), '{"auths": {"r": {"auth": "dXNlcjpwYXNz"}}}');
  fs.mkdirSync(path.join(root, 'proyecto'));
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('omite los audios con un motivo porque la transcripción está desactivada', () => {
  const result = DroppedFileImporter.read([uri('nota.mp3')]);
  assert.deepEqual(result.files, []);
  assert.match(result.skipped[0], /nota\.mp3.*transcripción está desactivada/);
});

test('omite credenciales por nombre o por carpeta, pero no token.service.ts', () => {
  const result = DroppedFileImporter.read([uri('.env'), uri('.aws', 'config.txt'), uri('token.service.ts')]);
  assert.deepEqual(result.files.map((file) => file.name), ['token.service.ts']);
  assert.equal(result.skipped.length, 2);
  for (const line of result.skipped) assert.match(line, /sensible/);
});

test('no acepta como carpeta de trabajo una carpeta de credenciales ni una subcarpeta suya', () => {
  const result = DroppedFileImporter.read([uri('.docker'), uri('.aws'), uri('.docker', 'contexts'), uri('proyecto')]);
  assert.deepEqual(result.directories.map((dir) => dir.name), ['proyecto']);
  assert.equal(result.skipped.length, 3);
  for (const line of result.skipped) assert.match(line, /carpeta de credenciales/);
});

test('redacta secretos con las reglas de sensitive-data y quita el BOM', () => {
  const result = DroppedFileImporter.read([uri('app.yml'), uri('bom.txt')]);
  const yml = result.files.find((file) => file.name === 'app.yml');
  assert.match(yml.content, /password: \[REDACTADO\]/);
  assert.match(yml.content, /port: 8080/);
  const bom = result.files.find((file) => file.name === 'bom.txt');
  assert.equal(bom.content, 'hola');
});

test('system-tools ya no expone executeInTerminal ni lecturas sin filtro', () => {
  const systemTools = require('../src/system-tools');
  assert.equal(systemTools.SystemTools, undefined);
  assert.deepEqual(Object.keys(systemTools), []);
});
