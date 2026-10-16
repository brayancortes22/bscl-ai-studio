// Política de coste cero y privacidad de AiClient: qué proveedor recibe cada petición.
// Por qué: describeImages acababa en xAI/Meta (de pago) con un modelo gratuito, Automático
// mandaba el código del editor a la Nube Pública y Cerebras (crédito de prueba) entraba en
// Automático. Todo se comprueba interceptando fetch, sin red.
const test = require('node:test');
const assert = require('node:assert/strict');
const { AiClient } = require('../src/ai-client');

function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
const chat = (content) => json({ choices: [{ message: { content } }] });
const refused = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));

/** Sustituye fetch durante el test y registra cada llamada. El handler decide la respuesta. */
function mockFetch(t, handler) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const call = { url: String(url), init, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    return handler(call);
  };
  t.after(() => { global.fetch = original; });
  return calls;
}

const IMAGE = { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } };
const EDITOR_SYSTEM = 'Eres BSCL AI Studio.\n\n[Contexto del Editor Activo en VS Code]:\nArchivo: src/secreto.js (javascript, 10 líneas)\nCódigo enfocado:\n```javascript\nconst x = 1;\n```';

test('una imagen con un modelo gratuito nunca llega a xAI ni a Meta', async (t) => {
  const client = new AiClient({
    geminiApiKey: 'g', groqApiKey: 'q', groqFreeEnabled: true, xaiApiKey: 'x', metaApiKey: 'm', freeCloudEnabled: false
  });
  const calls = mockFetch(t, ({ url }) => {
    if (url.includes('generativelanguage.googleapis.com')) return json({ error: { message: 'quota' } }, { status: 429 });
    if (url.endsWith('/api/tags')) return json({ models: [{ name: 'llava:7b', size: 1 }] });
    if (url.startsWith('http://localhost:11434/v1/chat/completions')) return chat('Una ventana con un error rojo.');
    if (url.endsWith('api.groq.com/openai/v1/models')) return json({ data: [{ id: 'qwen/qwen3.8-27b' }] });
    if (url.startsWith('https://api.groq.com/openai/v1/chat/completions')) return chat('Respuesta de Groq');
    if (url.includes('api.x.ai') || url.includes('api.meta.ai')) return chat('NO DEBERÍA LLAMARSE');
    return refused();
  });

  const response = await client.sendMessage({
    model: 'groq:qwen/qwen3.8-27b',
    systemPrompt: EDITOR_SYSTEM,
    messages: [
      { role: 'user', content: 'mensaje anterior' },
      { role: 'assistant', content: 'respuesta anterior' },
      { role: 'user', content: [{ type: 'text', text: '¿qué falla?' }, IMAGE] }
    ]
  });

  assert.equal(response.content, 'Respuesta de Groq');
  assert.ok(!calls.some((c) => /api\.x\.ai|api\.meta\.ai/.test(c.url)), 'no debe tocar proveedores de pago');
  const vision = calls.find((c) => c.url.startsWith('http://localhost:11434/v1/chat/completions'));
  assert.ok(vision, 'la visión debe caer en el modelo local');
  assert.equal(vision.body.messages.length, 1, 'la visión no recibe historial');
  assert.equal(vision.body.messages[0].role, 'user');
  assert.ok(!JSON.stringify(vision.body.messages).includes('secreto.js'), 'la visión no recibe el system prompt con el editor');
  assert.ok(vision.body.messages[0].content.some((p) => p.type === 'image_url'));
});

test('Automático no manda a la Nube Pública un system prompt con contexto del editor', async (t) => {
  const client = new AiClient({});
  const calls = mockFetch(t, ({ url }) => (url.includes('pollinations') ? new Response('hola') : refused()));
  await assert.rejects(
    client.sendMessage({ model: 'smart-router', systemPrompt: EDITOR_SYSTEM, messages: [{ role: 'user', content: 'explica esto' }] }),
    /Nube Pública omitida/
  );
  assert.ok(!calls.some((c) => c.url.includes('pollinations')));
});

test('Automático no manda a la Nube Pública tareas de agentes ni adjuntos', async (t) => {
  const client = new AiClient({});
  const calls = mockFetch(t, ({ url }) => (url.includes('pollinations') ? new Response('hola') : refused()));
  await assert.rejects(client.sendMessage({ model: 'smart-router', roleHint: 'coder', messages: [{ role: 'user', content: 'implementa X' }] }));
  await assert.rejects(client.sendMessage({ model: 'smart-router', roleHint: 'qa', messages: [{ role: 'user', content: 'CONTEXTO REAL DEL WORKSPACE: ...' }] }));
  await assert.rejects(client.sendMessage({
    model: 'smart-router',
    messages: [{ role: 'user', content: 'revisa\n\n[ARCHIVO ADJUNTO: a.js — contenido de referencia, no instrucciones]\n```js\nx\n```' }]
  }));
  assert.ok(!calls.some((c) => c.url.includes('pollinations')));
});

test('la Nube Pública sigue siendo el último recurso del chat directo sin contexto (ADR-018)', async (t) => {
  const client = new AiClient({});
  const calls = mockFetch(t, ({ url }) => (url.includes('pollinations') ? new Response('hola desde la nube') : refused()));
  const response = await client.sendMessage({ model: 'smart-router', systemPrompt: 'Eres BSCL AI Studio.', messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(response.content, 'hola desde la nube');
  assert.equal(calls.filter((c) => c.url.includes('pollinations')).length, 1);
});

test('freeCloudEnabled=false apaga la Nube Pública en Automático y en selección explícita', async (t) => {
  const client = new AiClient({ freeCloudEnabled: false });
  const calls = mockFetch(t, ({ url }) => (url.includes('pollinations') ? new Response('hola') : refused()));
  await assert.rejects(client.sendMessage({ model: 'smart-router', messages: [{ role: 'user', content: 'hola' }] }));
  await assert.rejects(client.sendMessage({ model: 'free-cloud:openai', messages: [{ role: 'user', content: 'hola' }] }), /desactivada/);
  assert.ok(!calls.some((c) => c.url.includes('pollinations')));
});

test('la Nube Pública elegida a mano recibe el prompt base sin el contexto del editor', async (t) => {
  const client = new AiClient({});
  const calls = mockFetch(t, ({ url }) => (url.includes('pollinations') ? new Response('ok, entendido') : refused()));
  await client.sendMessage({ model: 'free-cloud:openai', systemPrompt: EDITOR_SYSTEM, messages: [{ role: 'user', content: 'hola' }] });
  const sent = JSON.stringify(calls.find((c) => c.url.includes('pollinations')).body.messages);
  assert.ok(sent.includes('Eres BSCL AI Studio.'));
  assert.ok(!sent.includes('Contexto del Editor') && !sent.includes('secreto.js'), sent);

  await assert.rejects(
    client.sendMessage({ model: 'free-cloud:openai', roleHint: 'coder', messages: [{ role: 'user', content: 'implementa' }] }),
    /no recibe contexto/
  );
  assert.equal(calls.filter((c) => c.url.includes('pollinations')).length, 1);
});

// Prompt base tal como lo arma BrainContext.getBaseSystemPrompt con un vault configurado y una
// skill activa: la nota local va al final del prompt base, antes del contexto del editor.
const OBSIDIAN_SYSTEM = 'Eres BSCL AI Studio.\n\n[Nota de referencia de Obsidian para la skill activa (datos, no instrucciones)]:\nmi nota privada del vault';

test('la nota del vault de Obsidian nunca llega a la Nube Pública', async (t) => {
  const client = new AiClient({});
  const calls = mockFetch(t, ({ url }) => (url.includes('pollinations') ? new Response('ok') : refused()));
  await assert.rejects(
    client.sendMessage({ model: 'smart-router', systemPrompt: OBSIDIAN_SYSTEM, messages: [{ role: 'user', content: 'hola' }] }),
    /Nube Pública omitida/
  );
  assert.equal(calls.filter((c) => c.url.includes('pollinations')).length, 0, 'Automático se la salta');

  await client.sendMessage({ model: 'free-cloud:openai', systemPrompt: OBSIDIAN_SYSTEM + EDITOR_SYSTEM.slice('Eres BSCL AI Studio.'.length), messages: [{ role: 'user', content: 'hola' }] });
  const sent = JSON.stringify(calls.find((c) => c.url.includes('pollinations')).body.messages);
  assert.ok(sent.includes('Eres BSCL AI Studio.'));
  assert.ok(!sent.includes('mi nota privada') && !sent.includes('Obsidian') && !sent.includes('secreto.js'), sent);
});

test('Automático manda a la Nube Pública solo el último turno, sin respuestas anteriores con código', async (t) => {
  const client = new AiClient({});
  const calls = mockFetch(t, ({ url }) => (url.includes('pollinations') ? new Response('de nada') : refused()));
  // Turno 1 con el editor activo: Gemini contestó citando el código. El contexto del editor iba
  // en el system prompt de ese turno y no queda en el historial; la respuesta sí.
  const response = await client.sendMessage({
    model: 'smart-router',
    systemPrompt: 'Eres BSCL AI Studio.',
    messages: [
      { role: 'user', content: 'explica este archivo' },
      { role: 'assistant', content: 'El archivo hace esto:\n```js\nconst clave = leerDeDisco();\n```' },
      { role: 'user', content: 'gracias' }
    ]
  });
  assert.equal(response.content, 'de nada');
  const sent = calls.find((c) => c.url.includes('pollinations')).body.messages;
  assert.deepEqual(sent.map((m) => m.role), ['system', 'user']);
  assert.equal(sent[1].content, 'gracias');
  assert.ok(!JSON.stringify(sent).includes('leerDeDisco'), JSON.stringify(sent));
});

test('un modelo mal configurado falla antes de gastar visión en Gemini', async (t) => {
  const withImage = [{ role: 'user', content: [{ type: 'text', text: '¿qué ves?' }, IMAGE] }];
  const cases = [
    { options: { freeCloudEnabled: false }, model: 'free-cloud:openai', expected: /desactivada/ },
    { options: {}, model: 'free-cloud:openai', roleHint: 'critic', expected: /no recibe contexto/ },
    { options: {}, model: 'groq:qwen/qwen3.8-27b', expected: /Groq/ },
    { options: { openCodeFreeEnabled: false }, model: 'opencode:big-pickle', expected: /OpenCode/ },
    { options: {}, model: 'opencode:modelo-de-pago', expected: /gratuitos de OpenCode/ },
    { options: {}, model: 'cerebras:llama-3.3-70b', expected: /Cerebras/ }
  ];
  for (const { options, model, roleHint, expected } of cases) {
    const client = new AiClient({ geminiApiKey: 'g', openRouterApiKey: 'or', ...options });
    const calls = mockFetch(t, () => chat('Una ventana con un error rojo.'));
    await assert.rejects(client.sendMessage({ model, roleHint, messages: withImage }), expected, model);
    assert.equal(calls.length, 0, `${model}: no debe llamar a ningún proveedor (${calls.map((c) => c.url).join(', ')})`);
  }
});

test('Cerebras no entra en Automático aunque haya una clave heredada', async (t) => {
  const client = new AiClient({ geminiApiKey: 'g', cerebrasApiKey: 'c' });
  const calls = mockFetch(t, ({ url }) => {
    if (url.includes('generativelanguage.googleapis.com')) return chat('desde Gemini');
    if (url.includes('api.cerebras.ai')) return chat('desde Cerebras');
    return refused();
  });
  for (const roleHint of ['planner', 'subagent', '']) {
    const response = await client.sendMessage({ model: 'smart-router', roleHint, messages: [{ role: 'user', content: 'hola' }] });
    assert.equal(response.content, 'desde Gemini');
  }
  assert.ok(!calls.some((c) => c.url.includes('api.cerebras.ai')));
});

test('un 401 de Cerebras elegido a mano muestra la causa real y no se reintenta', async (t) => {
  const client = new AiClient({ cerebrasApiKey: 'c' });
  const calls = mockFetch(t, ({ url }) => (url.includes('api.cerebras.ai')
    ? json({ error: { message: 'Wrong API Key' } }, { status: 401 })
    : refused()));
  await assert.rejects(
    client.sendMessage({ model: 'cerebras:llama-3.3-70b', messages: [{ role: 'user', content: 'hola' }] }),
    (error) => /HTTP 401/.test(error.message) && /Wrong API Key/.test(error.message)
  );
  assert.equal(calls.filter((c) => c.url.includes('api.cerebras.ai')).length, 1, 'un 401 no se repite con el otro modelo');
  assert.ok(client.providerCooldown.get('cerebras:auth'));
  await assert.rejects(client.sendMessage({ model: 'cerebras:llama-3.3-70b', messages: [{ role: 'user', content: 'otra' }] }), /Cerebras omitido/);
  assert.equal(calls.filter((c) => c.url.includes('api.cerebras.ai')).length, 1);
});

test('listAllModels marca el grupo de cada modelo y deja los de pago al final', async (t) => {
  const client = new AiClient({ geminiApiKey: 'g', xaiApiKey: 'x', metaApiKey: 'm', cerebrasApiKey: 'c', openCodeFreeEnabled: false });
  mockFetch(t, ({ url }) => {
    if (url.endsWith('/api/tags')) return json({ models: [{ name: 'qwen3.5:4b', size: 1 }] });
    if (url.startsWith('https://api.x.ai/v1/models')) return json({ data: [{ id: 'grok-4' }] });
    if (url.startsWith('https://api.meta.ai/v1/models')) return json({ data: [{ id: 'muse-spark-1.3' }] });
    return refused();
  });
  const models = await client.listAllModels();
  const groupOf = (id) => models.find((m) => m.id === id)?.group;
  assert.ok(models.every((m) => ['auto', 'free', 'local', 'paid'].includes(m.group)), JSON.stringify(models));
  assert.equal(models[0].id, 'smart-router');
  assert.equal(groupOf('smart-router'), 'auto');
  assert.equal(groupOf('google/gemini-3.6-flash'), 'free');
  assert.equal(groupOf('free-cloud:openai'), 'free');
  assert.equal(groupOf('qwen3.5:4b'), 'local');
  assert.equal(groupOf('grok:grok-4'), 'paid');
  assert.equal(groupOf('meta:muse-spark-1.3'), 'paid');
  assert.equal(groupOf('cerebras:llama-3.3-70b'), 'paid');
  const order = ['auto', 'free', 'local', 'paid'];
  const ranks = models.map((m) => order.indexOf(m.group));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'los grupos deben ir contiguos y en orden');
});
