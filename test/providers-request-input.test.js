// Preparación de adjuntos (RequestInput) y progreso de descarga de Ollama.
// Por qué: el audio hacía fallar la petición entera, el redactor antiguo corrompía código
// normal (`if (password === confirm)`) y el progreso de Ollama podía pintar "NaN%".
const test = require('node:test');
const assert = require('node:assert/strict');
const { RequestInput, NOTHING_TO_SEND_CODE } = require('../src/request-input');
const { LocalModelManager } = require('../src/local-model-manager');

const aiClient = { transcribeAudio() { throw new Error('no debe llamarse'); } };
const audio = { category: 'audio', name: 'nota.mp3', mimeType: 'audio/mpeg', data: 'AAAA' };
const textFile = (name, content) => ({ category: 'text', name, content });

test('el audio adjunto se descarta con un aviso y la petición sigue con el texto', async () => {
  const prepared = await RequestInput.prepare({ aiClient, messages: [{ role: 'user', content: 'explica esto' }], mediaItems: [audio] });
  assert.equal(prepared.lastUserPrompt, 'explica esto');
  assert.equal(prepared.audioItems.length, 0, 'no hubo transcripción');
  assert.equal(prepared.warnings.length, 1);
  assert.match(prepared.warnings[0], /audio/i);
});

test('un mensaje que solo traía audio explica por qué no se envía, con un error distinguible', async () => {
  // Se lanza en vez de devolver un flag: si quien llama no lo mirase, mandaría un mensaje vacío.
  // El code y warnings permiten mostrarlo como aviso y no como fallo del proveedor.
  const error = await RequestInput.prepare({ aiClient, messages: [{ role: 'user', content: '' }], mediaItems: [audio] }).catch((e) => e);
  assert.ok(error instanceof Error);
  assert.equal(error.code, NOTHING_TO_SEND_CODE);
  assert.equal(NOTHING_TO_SEND_CODE, 'BSCL_NOTHING_TO_SEND');
  assert.match(error.message, /transcripción en la nube está desactivada/);
  assert.deepEqual(error.warnings, [error.message]);
});

test('un mensaje que solo traía un archivo de credenciales tampoco se envía vacío', async () => {
  const error = await RequestInput.prepare({ aiClient, messages: [{ role: 'user', content: '   ' }], mediaItems: [textFile('id_rsa', 'x')] }).catch((e) => e);
  assert.equal(error.code, NOTHING_TO_SEND_CODE);
  assert.match(error.warnings.join(' '), /id_rsa/);
});

test('con una imagen el audio se descarta pero la petición sigue', async () => {
  const image = { category: 'image', name: 'a.png', mimeType: 'image/png', data: 'QUJD' };
  const prepared = await RequestInput.prepare({ aiClient, messages: [{ role: 'user', content: '' }], mediaItems: [audio, image] });
  assert.equal(prepared.imageItems.length, 1);
  assert.equal(prepared.warnings.length, 1);
});

test('el código adjunto llega intacto y los secretos reales se redactan', async () => {
  const code = 'if (password === confirm) return true;\nconst token = getToken();\nuser.password = await bcrypt.hash(pw, 10);';
  const prepared = await RequestInput.prepare({
    aiClient,
    messages: [{ role: 'user', content: 'revisa' }],
    mediaItems: [textFile('auth.js', code), textFile('config.yml', 'OPENAI_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123\nport: 3000')]
  });
  assert.ok(prepared.lastUserPrompt.includes(code), 'el código normal no se altera');
  assert.ok(!prepared.lastUserPrompt.includes('sk-proj-abcdefghijklmnopqrstuvwxyz0123'));
  assert.match(prepared.lastUserPrompt, /OPENAI_KEY=\[REDACTADO\]/);
  assert.match(prepared.lastUserPrompt, /port: 3000/);
});

test('un archivo de credenciales no se adjunta y se avisa', async () => {
  const prepared = await RequestInput.prepare({
    aiClient,
    messages: [{ role: 'user', content: '¿está bien?' }],
    mediaItems: [textFile('.env', 'DB_PASSWORD=hunter2hunter2'), textFile('notas.md', 'hola')]
  });
  assert.ok(!prepared.lastUserPrompt.includes('hunter2'));
  assert.ok(!prepared.lastUserPrompt.includes('ARCHIVO ADJUNTO: .env'));
  assert.ok(prepared.lastUserPrompt.includes('ARCHIVO ADJUNTO: notas.md'));
  assert.deepEqual(prepared.textItems.map((item) => item.name), ['notas.md']);
  assert.match(prepared.warnings.join(' '), /\.env/);
});

test('el progreso de Ollama nunca es NaN', () => {
  const events = [];
  const onProgress = (event) => events.push(event);
  LocalModelManager.consumeProgress(JSON.stringify({ status: 'pulling abc', digest: 'sha256:abc', total: 1000 }), 'qwen3.5:0.8b', onProgress);
  LocalModelManager.consumeProgress(JSON.stringify({ status: 'pulling abc', total: 1000, completed: 500 }), 'qwen3.5:0.8b', onProgress);
  assert.equal(events[0].progress, null);
  assert.equal(events[1].progress, 50);
  assert.ok(events.every((event) => !Number.isNaN(event.progress)));
});
