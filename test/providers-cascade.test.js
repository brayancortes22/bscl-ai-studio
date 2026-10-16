// Cascada de AiClient: cancelación, plazo global, fallos de red, OpenRouter, Ollama y cuotas.
// Por qué: un proveedor colgado podía bloquear minutos sin forma de cancelar, una cancelación
// se convertía en "proveedor en enfriamiento", y varios errores se perdían por el camino.
const test = require('node:test');
const assert = require('node:assert/strict');
const { AiClient, SEND_DEADLINE_MS } = require('../src/ai-client');
const { ProviderCooldown, classifyFailure } = require('../src/provider-cooldown');

function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
const chat = (content) => json({ choices: [{ message: { content } }] });
const refused = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
/** Petición que nunca contesta: solo termina cuando su señal se aborta, como un proxy mudo. */
const hang = ({ init }) => new Promise((resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
});

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

const isGeminiChat = (url) => url.startsWith('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
const user = (content) => [{ role: 'user', content }];
// Forma real del rechazo de fetch cuando vence AbortSignal.timeout (sonda en Node 25.8):
// DOMException TimeoutError, sin cause. La conexión se hizo; el modelo tardó en generar.
const timedOut = () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

test('con la señal ya abortada sendMessage lanza AbortError sin tocar la red', async (t) => {
  const client = new AiClient({ geminiApiKey: 'g' });
  const calls = mockFetch(t, () => chat('no'));
  const controller = new AbortController();
  controller.abort();
  client.setAbortSignal(controller.signal);
  await assert.rejects(client.sendMessage({ messages: user('hola') }), { name: 'AbortError', message: 'Solicitud cancelada.' });
  assert.equal(calls.length, 0);
  client.setAbortSignal(null);
});

test('cancelar a mitad de la cascada corta la petición y no deja enfriamientos', { timeout: 5000 }, async (t) => {
  const client = new AiClient({ geminiApiKey: 'g' });
  const controller = new AbortController();
  const calls = mockFetch(t, (call) => {
    if (isGeminiChat(call.url)) { setImmediate(() => controller.abort()); return hang(call); }
    return refused();
  });
  client.setAbortSignal(controller.signal);
  await assert.rejects(client.sendMessage({ messages: user('hola') }), { name: 'AbortError', message: 'Solicitud cancelada.' });
  assert.equal(calls.length, 1, 'tras cancelar no se prueba ningún otro modelo ni proveedor');
  assert.equal(client.providerCooldown.entries.size, 0, 'una cancelación no es un fallo del proveedor');
});

test('el plazo global corta un proveedor colgado y se informa como plazo vencido', { timeout: 5000 }, async (t) => {
  const client = new AiClient({ geminiApiKey: 'g', sendDeadlineMs: 80 });
  mockFetch(t, (call) => (isGeminiChat(call.url) ? hang(call) : refused()));
  const started = Date.now();
  await assert.rejects(client.sendMessage({ messages: user('hola') }), { name: 'TimeoutError', code: 'BSCL_DEADLINE' });
  assert.ok(Date.now() - started < 2000, 'no espera al timeout de 45 s del proveedor');
  assert.equal(client.providerCooldown.entries.size, 0);
});

test('el plazo global por defecto cabe entre 150 y 180 s y el enfriamiento por timeout lo supera', () => {
  assert.ok(SEND_DEADLINE_MS >= 150000 && SEND_DEADLINE_MS <= 180000);
  const failure = classifyFailure({ code: 'TimeoutError', message: 'Gemini no respondió: se agotó el tiempo de espera' });
  assert.ok(failure.cooldownMs > SEND_DEADLINE_MS, `${failure.cooldownMs}`);
});

test('un fallo de red deja de probar los demás modelos del mismo proveedor', async (t) => {
  const client = new AiClient({ geminiApiKey: 'g', freeCloudEnabled: false });
  const calls = mockFetch(t, () => refused());
  await assert.rejects(client.sendMessage({ messages: user('hola') }), /Gemini/);
  assert.equal(calls.filter((c) => isGeminiChat(c.url)).length, 1, 'antes se probaban los 8 modelos de Gemini');
  assert.ok(client.providerCooldown.get('gemini:net'));
});

test('un timeout por petición enfría solo ese modelo y la cascada sigue con el siguiente', async (t) => {
  const client = new AiClient({ geminiApiKey: 'g', freeCloudEnabled: false });
  const calls = mockFetch(t, ({ url, body }) => {
    if (!isGeminiChat(url)) return refused();
    return body.model === 'gemini-3.6-flash' ? timedOut() : chat(`desde ${body.model}`);
  });
  const first = await client.sendMessage({ model: 'gemini:gemini-3.6-flash', messages: user('hola') });
  assert.equal(first.content, 'desde gemini-3.5-flash');
  assert.deepEqual([...client.providerCooldown.entries.keys()], ['gemini:gemini-3.6-flash'],
    'antes quedaba gemini:net y todo Gemini fuera 3 min');

  // Otro modelo elegido a mano se prueba de verdad; antes salía "Gemini omitido" sin llamar.
  const second = await client.sendMessage({ model: 'gemini:gemini-2.5-flash-lite', messages: user('otra') });
  assert.equal(second.content, 'desde gemini-2.5-flash-lite');
  assert.equal(calls.filter((c) => isGeminiChat(c.url)).length, 3);
});

test('con todos los modelos enfriados, el elegido a mano se intenta al menos una vez', async (t) => {
  const client = new AiClient({ geminiApiKey: 'g', freeCloudEnabled: false });
  let healthy = false;
  const calls = mockFetch(t, ({ url, body }) => {
    if (!isGeminiChat(url)) return refused();
    return healthy ? chat(`desde ${body.model}`) : timedOut();
  });
  await assert.rejects(client.sendMessage({ model: 'gemini:gemini-3.6-flash', messages: user('hola') }), /Cascada Gemini agotada/);
  const geminiCalls = () => calls.filter((c) => isGeminiChat(c.url)).length;
  const afterFirst = geminiCalls();
  assert.equal(client.providerCooldown.get('gemini:net'), null);

  healthy = true;
  // Automático respeta los enfriamientos por modelo: no hay nada libre y no llama.
  await assert.rejects(client.sendMessage({ messages: user('auto') }), /Gemini en enfriamiento temporal/);
  assert.equal(geminiCalls(), afterFirst);

  const response = await client.sendMessage({ model: 'gemini:gemini-2.5-flash-lite', messages: user('a mano') });
  assert.equal(response.content, 'desde gemini-2.5-flash-lite');
  assert.equal(geminiCalls(), afterFirst + 1);
});

test('un modelo elegido a mano se prueba aunque el proveedor esté en enfriamiento de red', async (t) => {
  const client = new AiClient({ geminiApiKey: 'g', freeCloudEnabled: false });
  let online = false;
  const calls = mockFetch(t, ({ url, body }) => {
    if (!isGeminiChat(url) || !online) return refused();
    return chat(`desde ${body.model}`);
  });
  await assert.rejects(client.sendMessage({ messages: user('hola') }));
  assert.ok(client.providerCooldown.get('gemini:net'), 'conexión rechazada: enfriamiento de proveedor');

  online = true;
  const geminiCalls = () => calls.filter((c) => isGeminiChat(c.url)).length;
  await assert.rejects(client.sendMessage({ messages: user('auto') }), /Gemini omitido/);
  assert.equal(geminiCalls(), 1, 'Automático sí se salta el proveedor sin red');

  const response = await client.sendMessage({ model: 'gemini:gemini-2.5-flash', messages: user('a mano') });
  assert.equal(response.content, 'desde gemini-2.5-flash');
  assert.equal(client.providerCooldown.get('gemini:net'), null, 'una respuesta buena demuestra que hay red');
  const auto = await client.sendMessage({ messages: user('auto otra vez') });
  assert.match(auto.content, /^desde gemini-/);
});

test('solo los fallos de conexión se marcan como caída del proveedor', async (t) => {
  const client = new AiClient({});
  const reject = (error) => () => Promise.reject(error);
  const cases = [
    { name: 'timeout por petición', fail: timedOut, connection: false, code: 'TimeoutError' },
    { name: 'IP que no contesta', fail: reject(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) })), connection: true },
    { name: 'localhost rechazado', fail: reject(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new AggregateError([Object.assign(new Error('a'), { code: 'ECONNREFUSED' })]), { code: 'ECONNREFUSED' }) })), connection: true },
    { name: 'DNS', fail: reject(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }) })), connection: true },
    { name: 'socket cortado', fail: reject(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) })), connection: false }
  ];
  for (const item of cases) {
    mockFetch(t, item.fail);
    const error = await client.sendCompatibleRequest({ model: 'm', messages: user('hola'), baseUrl: 'https://example.invalid/v1', providerName: 'P' }).catch((e) => e);
    assert.equal(error.connectionFailed, item.connection, item.name);
    if (item.code) assert.equal(error.code, item.code, item.name);
  }
});

test('un cupo de Gemini en espera se libera al cancelar', async () => {
  const cooldown = new ProviderCooldown();
  const release = await cooldown.acquire('gemini', 1);
  const controller = new AbortController();
  const waiting = cooldown.acquire('gemini', 1, controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(cooldown.waiters.has('gemini'), false, 'la espera cancelada sale de la cola');
  release();
  assert.equal(cooldown.active.has('gemini'), false);
});

test('un modelo de Ollama elegido a mano va directo a Ollama y muestra su error', async (t) => {
  const client = new AiClient({});
  const calls = mockFetch(t, ({ url }) => (url === 'http://localhost:11434/api/chat'
    ? json({ error: 'model "qwen3.5:4b" not found, try pulling it first' }, { status: 404 })
    : refused()));
  await assert.rejects(
    client.sendMessage({ model: 'qwen3.5:4b', messages: user('hola') }),
    (error) => /HTTP 404/.test(error.message) && /not found/.test(error.message)
  );
  assert.ok(!calls.some((c) => c.url.startsWith('http://localhost:3000')), 'no debe pasar por el Smart Router');
});

test('Ollama sin texto es un error, no una respuesta vacía', async (t) => {
  const client = new AiClient({});
  mockFetch(t, ({ url }) => (url === 'http://localhost:11434/api/chat' ? json({ message: { role: 'assistant', content: '' } }) : refused()));
  await assert.rejects(client.sendMessage({ model: 'qwen3.5:4b', messages: user('hola') }), /sin texto/);
});

test('las imágenes llegan a un modelo local en el campo images de Ollama', async (t) => {
  const client = new AiClient({});
  const calls = mockFetch(t, ({ url }) => (url === 'http://localhost:11434/api/chat' ? json({ message: { content: 'veo un botón' } }) : refused()));
  const response = await client.sendMessage({
    model: 'llava:7b',
    messages: [{ role: 'user', content: [{ type: 'text', text: '¿qué ves?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }] }]
  });
  assert.equal(response.content, 'veo un botón');
  const last = calls[0].body.messages.at(-1);
  assert.deepEqual(last.images, ['QUJD']);
  assert.equal(last.content, '¿qué ves?');
});

test('OpenRouter en Automático pasa al siguiente :free tras un 429 y cachea el catálogo', async (t) => {
  const client = new AiClient({ openRouterApiKey: 'or', freeCloudEnabled: false });
  const free = (id) => ({ id, name: id, pricing: { prompt: '0', completion: '0' } });
  const calls = mockFetch(t, ({ url, body }) => {
    if (url === 'https://openrouter.ai/api/v1/models') {
      return json({ data: [free('qwen/qwen3-coder:free'), free('deepseek/deepseek-r1:free'), free('meta-llama/llama-3.3-70b-instruct:free')] });
    }
    if (url === 'https://openrouter.ai/api/v1/chat/completions') {
      return body.model === 'qwen/qwen3-coder:free'
        ? json({ error: { message: 'Rate limit exceeded: too many requests' } }, { status: 429 })
        : chat(`respuesta de ${body.model}`);
    }
    return refused();
  });

  const first = await client.sendMessage({ messages: user('hola') });
  assert.equal(first.content, 'respuesta de deepseek/deepseek-r1:free');
  assert.ok(client.providerCooldown.get('openrouter:qwen/qwen3-coder:free'));

  const second = await client.sendMessage({ messages: user('otra') });
  assert.equal(second.content, 'respuesta de deepseek/deepseek-r1:free');
  assert.equal(calls.filter((c) => c.url === 'https://openrouter.ai/api/v1/models').length, 1, 'catálogo cacheado');
  assert.equal(calls.filter((c) => c.body?.model === 'qwen/qwen3-coder:free').length, 1, 'el modelo en enfriamiento no se repite');
});

test('cuota diaria de Gemini en array: el retryDelay del cuerpo no la acorta a segundos', async (t) => {
  const client = new AiClient({ geminiApiKey: 'g' });
  // El quotaId diario va después de un mensaje largo, más allá de los 360 caracteres del resumen.
  const longMessage = `You exceeded your current quota, please check your plan and billing details. ${'x'.repeat(400)} Please retry in 41s.`;
  mockFetch(t, () => json([{
    error: {
      code: 429, message: longMessage, status: 'RESOURCE_EXHAUSTED',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '41s' }
      ]
    }
  }], { status: 429 }));
  const error = await client.sendCompatibleRequest({
    model: 'gemini-2.5-flash', messages: user('hola'), baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'g', providerName: 'Gemini'
  }).catch((e) => e);
  assert.equal(error.status, 429);
  assert.equal(error.code, 'RESOURCE_EXHAUSTED', 'el cuerpo en array se normaliza');
  assert.equal(error.retryAfterMs, 41000);
  assert.equal(error.retryAfterSource, 'body');
  const { reason, retryInMs } = client.providerCooldown.recordFailure('gemini:gemini-2.5-flash', error);
  assert.equal(reason, 'cuota diaria agotada');
  assert.ok(retryInMs > 23 * 60 * 60 * 1000, `${retryInMs}`);
});

test('un Retry-After de cabecera se respeta aunque el límite sea diario', async (t) => {
  const client = new AiClient({});
  mockFetch(t, () => json(
    { error: { message: 'Rate limit reached on requests per day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 1m26s.' } },
    { status: 429, headers: { 'retry-after': '86' } }
  ));
  const error = await client.sendCompatibleRequest({
    model: 'llama-3.1-8b-instant', messages: user('hola'), baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'q', providerName: 'Groq'
  }).catch((e) => e);
  assert.equal(error.retryAfterSource, 'header');
  const { retryInMs } = client.providerCooldown.recordFailure('groq:llama-3.1-8b-instant', error);
  assert.ok(retryInMs > 80000 && retryInMs <= 86000, `${retryInMs}`);
});
