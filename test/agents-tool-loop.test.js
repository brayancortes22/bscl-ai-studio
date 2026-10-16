// Herramientas del explorador: ni secretos ni salidas de la raíz; verificación sintáctica real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AgentToolLoop } = require('../src/agents/agent-tool-loop');

const KEY = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bscl-tools-'));
  fs.mkdirSync(path.join(root, 'src', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ apiKey: KEY, port: 3000 }, null, 2));
  fs.writeFileSync(path.join(root, 'secrets.json'), JSON.stringify({ apiKey: 'otra-clave-muy-secreta' }));
  fs.writeFileSync(path.join(root, 'src', 'config', 'db.js'), "module.exports = {\n  user: 'app',\n  password: 'Sup3rS3cret'\n};\n");
  fs.writeFileSync(path.join(root, 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n');
  return root;
}

test('SEC-2: search_code redacta valores y salta archivos sensibles', () => {
  const root = project();
  const apiKey = AgentToolLoop.executeSearchCode(root, 'apiKey');
  assert.match(apiKey, /config\.json:2:/);
  assert.ok(!apiKey.includes(KEY), 'la clave no debe salir');
  assert.ok(!apiKey.includes('secrets.json'), 'secrets.json no se busca');
  const password = AgentToolLoop.executeSearchCode(root, 'password');
  assert.match(password, /src\/config\/db\.js:3:/);
  assert.ok(!password.includes('Sup3rS3cret'));
});

test('FS-5: read_file deniega claves privadas', () => {
  const root = project();
  assert.match(AgentToolLoop.executeReadFile(root, 'id_rsa'), /denegado/);
  assert.match(AgentToolLoop.executeReadFile(root, 'secrets.json'), /denegado/);
  const db = AgentToolLoop.executeReadFile(root, 'src/config/db.js');
  assert.ok(!db.includes('Sup3rS3cret'));
  assert.match(db, /líneas 1-/);
});

test('FS-5: read_file no sale de la raíz por un directorio enlazado', (t) => {
  const root = project();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bscl-outside-'));
  fs.writeFileSync(path.join(outside, 'x.txt'), 'contenido externo');
  try {
    fs.symlinkSync(outside, path.join(root, 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`no se pudo crear el enlace: ${error.code}`);
    return;
  }
  const result = AgentToolLoop.executeReadFile(root, 'docs/x.txt');
  assert.ok(!result.includes('contenido externo'), result);
  assert.match(AgentToolLoop.executeListFiles(root, 'docs'), /no encontrado/);
  assert.match(AgentToolLoop.executeReadFile(root, '../' + path.basename(outside) + '/x.txt'), /no encontrado/);
});

test('read_file limita el número de líneas devueltas', () => {
  const root = project();
  fs.writeFileSync(path.join(root, 'largo.txt'), Array.from({ length: 2000 }, (_, i) => `linea ${i + 1}`).join('\n'));
  const result = AgentToolLoop.executeReadFile(root, 'largo.txt', 1, 5000);
  assert.match(result, /líneas 1-400 de 2000/);
});

test('VERIFY-1: los módulos ESM rotos ya no se dan por buenos', () => {
  const errors = AgentToolLoop.verifyProposedFiles([
    { path: 'ok.js', content: 'const a = 1;\nmodule.exports = a;\n' },
    { path: 'esm-ok.js', content: 'import x from "y";\nexport const z = x;\n' },
    { path: 'esm-roto.js', content: 'import x from "y";\nexport const z = (;\n' },
    { path: 'roto.mjs', content: 'export default {' },
    { path: 'cjs-roto.js', content: 'const a = ;' },
    { path: 'jsx.js', content: 'import React from "react";\nexport default function A() { return <div>hola</div>; }\n' },
    { path: 'cli.js', content: '#!/usr/bin/env node\nreturn 1;\n' },
    { path: 'mal.json', content: '{"a":}' }
  ]);
  const files = errors.map((entry) => entry.split(':')[0]).sort();
  assert.deepEqual(files, ['cjs-roto.js', 'esm-roto.js', 'mal.json', 'roto.mjs']);
});

test('VERIFY-1: una comparación sin espacio no se confunde con JSX', () => {
  const errors = AgentToolLoop.verifyProposedFiles([
    { path: 'bucle.js', content: 'for (let i = 0; i <n; i++ {\n}\n' },
    { path: 'jsx-multilinea.js', content: 'import React from "react";\nexport default function A() {\n  return (\n    <div\n      className="a"\n    >hola</div>\n  );\n}\n' },
    { path: 'jsx-cjs.js', content: 'const React = require("react");\nmodule.exports = () => <App />;\n' },
    // Un error real antes del primer JSX sigue saliendo aunque el archivo tenga JSX.
    { path: 'jsx-roto.js', content: 'const React = require("react");\nfunction f() {\n  if (a {\n  }\n}\nmodule.exports = () => <App />;\n' }
  ]);
  const files = errors.map((entry) => entry.split(':')[0]).sort();
  assert.deepEqual(files, ['bucle.js', 'jsx-roto.js']);
});

test('gatherExtraContext relanza la cancelación', async () => {
  const abort = Object.assign(new Error('cancelado'), { name: 'AbortError' });
  const client = { sendMessage: async () => { throw abort; } };
  await assert.rejects(AgentToolLoop.gatherExtraContext({ client, prompt: 'p', rootPath: project() }), (error) => error === abort);
});

test('gatherExtraContext ejecuta herramientas sin filtrar secretos', async () => {
  const root = project();
  const client = { sendMessage: async () => ({ content: JSON.stringify({ tools: [{ tool: 'search_code', query: 'apiKey' }, { tool: 'read_file', path: 'id_rsa' }] }) }) };
  const output = await AgentToolLoop.gatherExtraContext({ client, prompt: 'p', rootPath: root });
  assert.match(output, /RESULTADOS DE HERRAMIENTAS/);
  assert.ok(!output.includes(KEY));
  assert.ok(!output.includes('BEGIN OPENSSH'));
});
