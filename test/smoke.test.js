// Comprueba que cada módulo de src/ carga sin errores de sintaxis ni de dependencias.
// Por qué: no hay build; un require roto solo se descubría al activar la extensión.
require('./helpers/vscode-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');

function listModules(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listModules(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

for (const file of listModules(SRC)) {
  test(`carga ${path.relative(SRC, file).replace(/\\/g, '/')}`, () => {
    assert.doesNotThrow(() => require(file));
  });
}

test('extension.js exporta activate y deactivate', () => {
  const extension = require(path.join(SRC, 'extension.js'));
  assert.equal(typeof extension.activate, 'function');
  assert.equal(typeof extension.deactivate, 'function');
});
