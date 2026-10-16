// WorkspaceScopeResolver: la carpeta elegida por el usuario manda y la autodetección solo
// reacciona al nombre completo de un sub-proyecto (FS-4, BUG-1, PROJ-M1).
const { state, reset, makeUri } = require('./helpers/vscode-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkspaceScopeResolver } = require('../src/workspace-scope-resolver');

let root;
// Raíz donde TODAS las subcarpetas son sub-proyecto: así un caso de subcadena solo puede
// pasar por la coincidencia de palabra completa y no por el filtro de isProjectDirectory.
let projectsRoot;
test.before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bscl-scope-')));
  // Sub-proyectos (con package.json) y carpetas normales de un proyecto (sin marcador).
  for (const name of ['api', 'tienda', 'front', 'back', 'app', 'bscl-ai-studio']) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'package.json'), '{}');
  }
  for (const name of ['test', 'media', 'lib']) fs.mkdirSync(path.join(root, name));

  projectsRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bscl-scope-all-')));
  for (const name of ['api', 'test', 'media', 'lib', 'app']) {
    fs.mkdirSync(path.join(projectsRoot, name));
    fs.writeFileSync(path.join(projectsRoot, name, 'package.json'), '{}');
  }
});
test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(projectsRoot, { recursive: true, force: true });
});

function resolve(prompt, explicitScope = null, workspace = root) {
  reset();
  state.workspaceFolders = [workspace];
  return WorkspaceScopeResolver.resolve({ prompt, explicitScope });
}

test('la carpeta elegida por el usuario gana aunque el prompt nombre otra', () => {
  const tienda = path.join(root, 'tienda');
  const result = resolve('arregla el login de la api', tienda);
  assert.equal(result.scopePath, tienda);
  assert.equal(result.autoDetected, false);
});

test('no detecta carpetas por subcadena: «rápido» no es api, «contesta» no es test, «multimedia» no es media', () => {
  // Control: en esta raíz cada carpeta SÍ se detecta cuando se nombra como palabra completa,
  // así que si los casos de abajo vuelven a fallar es por la coincidencia, no por el marcador.
  for (const name of ['api', 'test', 'media', 'lib', 'app']) {
    assert.equal(resolve(`revisa ${name} ahora`, null, projectsRoot).scopePath, path.join(projectsRoot, name), name);
  }
  for (const prompt of ['hazlo más rápido', 'contesta en español y corrige el bug', 'añade soporte multimedia', 'usa una librería libre', 'responde por whatsapp']) {
    const result = resolve(prompt, null, projectsRoot);
    assert.equal(result.scopePath, projectsRoot, prompt);
    assert.equal(result.autoDetected, false, prompt);
  }
});

test('detecta un sub-proyecto nombrado como palabra completa', () => {
  const result = resolve('arregla el login de la API.');
  assert.equal(result.scopePath, path.join(root, 'api'));
  assert.equal(result.autoDetected, true);
  assert.equal(resolve('mejora bscl-ai-studio').scopePath, path.join(root, 'bscl-ai-studio'));
  assert.equal(resolve('revisa api/server.js').scopePath, path.join(root, 'api'));
});

test('un nombre de archivo no cuenta como carpeta: «app.js» no elige app/', () => {
  assert.equal(resolve('edita app.js').scopePath, root);
});

test('carpetas que no son proyecto (test/, media/) no cambian el alcance', () => {
  assert.equal(resolve('añade un test para el parser').scopePath, root);
  assert.equal(resolve('optimiza las imágenes de media').scopePath, root);
});

test('si el prompt nombra varios sub-proyectos se usa la raíz que los contiene', () => {
  const result = resolve('conecta el back con el front');
  assert.equal(result.scopePath, root);
  assert.equal(result.autoDetected, false);
});

test('sin mención, el editor activo dentro de un sub-proyecto sigue eligiéndolo', () => {
  reset();
  state.workspaceFolders = [root];
  state.activeTextEditor = { document: { uri: makeUri(path.join(root, 'tienda', 'index.js')) } };
  const result = WorkspaceScopeResolver.resolve({ prompt: 'arregla el bug' });
  assert.equal(result.scopePath, path.join(root, 'tienda'));
  assert.equal(result.autoDetected, true);
});

test('sin workspace ni carpeta elegida devuelve null', () => {
  reset();
  assert.equal(WorkspaceScopeResolver.resolve({ prompt: 'api' }).scopePath, null);
});
