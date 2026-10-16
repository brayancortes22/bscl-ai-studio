// Subagentes: sin enlaces inventados y con la cancelación propagada.
const test = require('node:test');
const assert = require('node:assert/strict');
const { SubagentRunner, MAX_SUBAGENTS } = require('../src/agents/subagent-runner');

const tasks = (count) => Array.from({ length: count }, (_, index) => ({ title: `T${index + 1}`, description: `D${index + 1}` }));

test('PROMPT-1: en modo sin costo no se piden fuentes ni enlaces', async () => {
  const seen = [];
  const client = { sendMessage: async (opts) => { seen.push(opts); return { content: 'ok' }; } };
  await SubagentRunner.run({ client, tasks: tasks(1), prompt: 'p', model: 'smart-router', webSearch: true });
  assert.doesNotMatch(seen[0].systemPrompt, /conserva las fuentes/);
  assert.doesNotMatch(seen[0].messages[0].content, /incluye enlaces/);
  assert.match(seen[0].systemPrompt, /no incluyas enlaces/);
});

test('solo se ejecutan MAX_SUBAGENTS subtareas', async () => {
  const ids = new Set();
  const client = { sendMessage: async () => ({ content: 'ok' }) };
  const results = await SubagentRunner.run({ client, tasks: tasks(30), prompt: 'p', model: 'smart-router', onProgress: (p) => ids.add(p.agentId) });
  assert.equal(results.length, MAX_SUBAGENTS);
  assert.equal(ids.size, MAX_SUBAGENTS);
});

test('una cancelación se relanza, no se reintenta y cierra las filas en curso', async () => {
  const abort = Object.assign(new Error('Solicitud cancelada.'), { name: 'AbortError' });
  let calls = 0;
  const client = { sendMessage: async () => { calls += 1; throw abort; } };
  const events = [];
  await assert.rejects(SubagentRunner.run({ client, tasks: tasks(6), prompt: 'p', model: 'smart-router', onProgress: (p) => events.push(p) }),
    (error) => error === abort);
  assert.ok(calls <= 3, `no debe seguir arrancando subtareas (${calls} llamadas)`);
  const last = new Map(events.map((event) => [event.agentId, event.state]));
  for (const [agentId, stateName] of last) assert.notEqual(stateName, 'working', agentId);
});

test('los errores normales siguen contando como subtarea fallida', async () => {
  const client = { sendMessage: async () => { throw new Error('HTTP 400'); } };
  const results = await SubagentRunner.run({ client, tasks: tasks(2), prompt: 'p', model: 'smart-router' });
  assert.equal(results.length, 2);
  assert.ok(results.every((item) => item.failed));
});
