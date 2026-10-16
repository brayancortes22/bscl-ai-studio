// Historial: títulos legibles, límites de tamaño y resúmenes sin mensajes.
const { createExtensionContext } = require('./helpers/vscode-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const { HistoryManager, makeTitle, MAX_SESSIONS, MAX_MESSAGES_PER_SESSION, MAX_STORED_MESSAGE_CHARS } = require('../src/history-manager');

test('el título sale de la primera línea con texto, sin bloques de código', () => {
  assert.equal(makeTitle([{ role: 'user', content: '```js\nconst a = 1;\n```\nArregla el login' }]), 'Arregla el login');
  assert.equal(makeTitle([{ role: 'user', content: '' }]), 'Conversación sin título');
  const long = makeTitle([{ role: 'user', content: 'x'.repeat(200) }]);
  assert.ok(long.length <= 60 && long.endsWith('…'));
});

test('los resúmenes no incluyen mensajes y cuentan cuántos hay', async () => {
  const history = new HistoryManager(createExtensionContext());
  await history.saveSession({ id: 's1', messages: [{ role: 'user', content: 'Hola' }, { role: 'assistant', content: 'Qué tal' }] });
  const [summary] = history.listSummaries();
  assert.equal(summary.messageCount, 2);
  assert.equal(summary.title, 'Hola');
  assert.ok(!('messages' in summary));
});

test('acota sesiones, mensajes por sesión y tamaño de cada mensaje', async () => {
  const history = new HistoryManager(createExtensionContext());
  for (let index = 0; index < MAX_SESSIONS + 5; index += 1) await history.saveSession({ id: `s${index}`, messages: [{ role: 'user', content: `m${index}` }] });
  assert.equal(history.listSessions().length, MAX_SESSIONS);
  assert.equal(history.listSessions()[0].id, `s${MAX_SESSIONS + 4}`, 'la más reciente va primero');

  const many = Array.from({ length: MAX_MESSAGES_PER_SESSION + 10 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `n${index}` }));
  many.push({ role: 'assistant', content: 'y'.repeat(MAX_STORED_MESSAGE_CHARS + 500) });
  const saved = await history.saveSession({ id: 'big', messages: many });
  assert.equal(saved.messages.length, MAX_MESSAGES_PER_SESSION);
  assert.ok(saved.messages.at(-1).content.length < MAX_STORED_MESSAGE_CHARS + 100);
  assert.match(saved.messages.at(-1).content, /recortado/);
});

test('guardar de nuevo conserva título, fecha de creación y carpeta', async () => {
  const history = new HistoryManager(createExtensionContext());
  const first = await history.saveSession({ id: 's', messages: [{ role: 'user', content: 'Primero' }], workspaceScope: 'C:/p' });
  const second = await history.saveSession({ id: 's', messages: [{ role: 'user', content: 'Primero' }, { role: 'assistant', content: 'ok' }] });
  assert.equal(second.title, 'Primero');
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.workspaceScope, 'C:/p');
});

test('descarta mensajes con roles desconocidos y borra sesiones', async () => {
  const history = new HistoryManager(createExtensionContext());
  const saved = await history.saveSession({ id: 's', messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }] });
  assert.deepEqual(saved.messages, [{ role: 'user', content: 'y' }]);
  await history.deleteSession('s');
  assert.equal(history.getSession('s'), null);
});
