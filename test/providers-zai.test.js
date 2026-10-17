// Z.ai (GLM Flash gratuito) en la cascada y retirada del Smart AI Router local.
// Por qué: el router era un proyecto propio que los demás usuarios no tienen y por defecto
// apuntaba a localhost:3000, donde suele haber otra aplicación que recibía las conversaciones.
const test = require('node:test');
const assert = require('node:assert/strict');
const { AiClient, NO_PROVIDER_CODE } = require('../src/ai-client');
const { ModelCatalog } = require('../src/model-catalog');
const { ZAI_FREE_IDS } = require('../src/free-cloud-fallback');

function json(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const chat = (content) => json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
const refused = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
const user = (content) => [{ role: 'user', content }];
const isZai = (url) => url === 'https://api.z.ai/api/paas/v4/chat/completions';

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

test('Automático usa Z.ai cuando es el único proveedor con clave, con un modelo gratuito', async (t) => {
  const client = new AiClient({ zaiApiKey: 'zai-key' });
  const calls = mockFetch(t, ({ url }) => (isZai(url) ? chat('hola desde GLM') : refused()));
  const result = await client.sendMessage({ model: 'smart-router', messages: user('hola'), roleHint: 'coder' });
  assert.equal(result.content, 'hola desde GLM');
  assert.equal(result.model, 'zai:glm-4.7-flash');
  const zaiCalls = calls.filter((c) => isZai(c.url));
  assert.ok(zaiCalls.every((c) => ZAI_FREE_IDS.has(c.body.model)), 'nunca un modelo de pago de Z.ai');
  assert.equal(zaiCalls[0].init.headers.Authorization, 'Bearer zai-key');
});

test('Automático nunca llama al antiguo Smart Router en localhost:3000', async (t) => {
  const client = new AiClient({ geminiApiKey: 'g', zaiApiKey: 'z' });
  const calls = mockFetch(t, () => json({ error: { message: 'fallo' } }, { status: 500 }));
  await assert.rejects(client.sendMessage({ model: 'smart-router', messages: user('hola'), roleHint: 'qa' }));
  assert.ok(!calls.some((c) => c.url.includes('localhost:3000')), calls.map((c) => c.url).join('\n'));
});

test('si el GLM-4.7-Flash falla, prueba GLM-4.5-Flash y nada más', async (t) => {
  const client = new AiClient({ zaiApiKey: 'z' });
  const calls = mockFetch(t, ({ url, body }) => {
    if (!isZai(url)) return refused();
    return body.model === 'glm-4.7-flash' ? json({ error: { message: 'overloaded' } }, { status: 503 }) : chat('ok 4.5');
  });
  const result = await client.sendMessage({ model: 'smart-router', messages: user('hola'), roleHint: 'coder' });
  assert.equal(result.model, 'zai:glm-4.5-flash');
  assert.deepEqual(calls.filter((c) => isZai(c.url)).map((c) => c.body.model), ['glm-4.7-flash', 'glm-4.5-flash']);
});

test('con imágenes, Z.ai usa su modelo de visión gratuito', async (t) => {
  const client = new AiClient({ zaiApiKey: 'z' });
  const calls = mockFetch(t, ({ url }) => (isZai(url) ? chat('veo un gato') : refused()));
  const messages = [{ role: 'user', content: [{ type: 'text', text: '¿qué es?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }];
  const result = await client.sendMessage({ model: 'smart-router', messages });
  assert.equal(result.content, 'veo un gato');
  assert.deepEqual(calls.filter((c) => isZai(c.url)).map((c) => c.body.model), ['glm-4.6v-flash']);
});

test('un modelo zai: de pago elegido a mano se rechaza sin llamar a la API', async (t) => {
  const client = new AiClient({ zaiApiKey: 'z' });
  const calls = mockFetch(t, () => chat('no'));
  await assert.rejects(client.sendMessage({ model: 'zai:glm-5.3-flash', messages: user('hola') }), /no es un modelo gratuito/);
  assert.equal(calls.length, 0);
});

test('sin ninguna clave, Automático lanza el error de «sin proveedor» con su código', async (t) => {
  const client = new AiClient({ freeCloudEnabled: false });
  mockFetch(t, () => refused());
  await assert.rejects(client.sendMessage({ model: 'smart-router', messages: user('hola') }),
    (error) => error.code === NO_PROVIDER_CODE && /Ajustes/.test(error.message) && !/smart-router/.test(error.message));
});

test('los ids router: de conversaciones antiguas pasan a Automático', async (t) => {
  const client = new AiClient({ zaiApiKey: 'z' });
  const calls = mockFetch(t, ({ url }) => (isZai(url) ? chat('ok') : refused()));
  const result = await client.sendMessage({ model: 'router:openrouter/qwen/qwen3-coder:free', messages: user('hola') });
  assert.equal(result.content, 'ok');
  assert.ok(!calls.some((c) => c.url.includes('localhost:3000')));
});

test('el catálogo lista Z.ai como gratis y solo con modelos de precio $0', async () => {
  const client = new AiClient({ zaiApiKey: 'z' });
  client.getLocalModels = async () => [];
  const models = await client.listAllModels();
  const zai = models.filter((m) => m.id.startsWith('zai:'));
  assert.deepEqual(zai.map((m) => m.id), ['zai:glm-4.7-flash', 'zai:glm-4.5-flash', 'zai:glm-4.6v-flash']);
  assert.ok(zai.every((m) => m.group === 'free'));
  assert.ok(!models.some((m) => m.id.startsWith('router:')));
  assert.equal(models[0].id, 'smart-router');
  assert.deepEqual(ModelCatalog.getZaiModels(''), []);
});
