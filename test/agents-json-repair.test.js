// Extracción de JSON de respuestas de modelos: no debe aceptar archivos truncados como completos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJsonResponse, extractJsonObject, repairTruncatedJson } = require('../src/json-repair');

const README = '# Proyecto\n\n```bash\nnpm i\n```\n\nFin del archivo.';

test('JSON-1: un ``` dentro de "content" no corta el bloque ```json', () => {
  const payload = { summary: 's', files: [{ path: 'README.md', content: README }] };
  for (const body of [JSON.stringify(payload), JSON.stringify(payload, null, 2)]) {
    const result = parseJsonResponse('```json\n' + body + '\n```');
    assert.equal(result.value.files[0].content, README);
    assert.equal(result.repaired, false);
    assert.equal(result.truncated, false);
  }
});

test('JSON-1: texto con otra valla y llaves después del JSON', () => {
  const payload = { summary: 's', files: [{ path: 'README.md', content: README }] };
  const text = 'Aquí va:\n```json\n' + JSON.stringify(payload) + '\n```\nEjemplo de uso:\n```js\nfunction a() { return {}; }\n```';
  assert.equal(extractJsonObject(text).files[0].content, README);
});

test('JSON-2: una salida cortada se repara pero queda marcada como truncada', () => {
  const css = 'a { color: red; }\n'.repeat(40);
  const full = JSON.stringify({ summary: 'x', files: [{ path: 'a.css', content: css }] });
  const result = parseJsonResponse(full.slice(0, 200));
  assert.ok(result.value, 'se sigue pudiendo leer');
  assert.equal(result.truncated, true);
  assert.ok(result.value.files[0].content.length < css.length);
});

test('una coma colgante se repara sin marcarse como truncada', () => {
  const result = parseJsonResponse('{"a":[1,2,],}');
  assert.deepEqual(result.value, { a: [1, 2] });
  assert.equal(result.repaired, true);
  assert.equal(result.truncated, false);
});

test('allowRepair:false no devuelve JSON reparado', () => {
  assert.equal(extractJsonObject('{"a": "sin cerrar', { allowRepair: false }), null);
});

test('repairTruncatedJson respeta la barra escapada antes de la comilla', () => {
  // `"x\\"` es una cadena completa (x + barra); el conteo ingenuo la daba por abierta.
  const repaired = repairTruncatedJson('{"a":"x\\\\","b":[1');
  assert.deepEqual(JSON.parse(repaired), { a: 'x\\', b: [1] });
});

test('sin JSON devuelve null', () => {
  assert.equal(extractJsonObject('solo texto'), null);
  assert.equal(extractJsonObject(''), null);
});
