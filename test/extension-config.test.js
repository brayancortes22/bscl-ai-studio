// Ajustes: las claves nunca llegan al webview y guardar un parche no borra lo que no toca.
const { state, reset, createExtensionContext } = require('./helpers/vscode-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfigManager, SettingsValidationError } = require('../src/config-manager');

const PREFIX = 'bscl_ai_secret_';

async function managerWith(secrets = {}) {
  reset();
  const context = createExtensionContext();
  for (const [key, value] of Object.entries(secrets)) await context.secrets.store(`${PREFIX}${key}`, value);
  return { context, manager: new ConfigManager(context) };
}

test('el webview recibe si cada clave está configurada y sus 4 últimos caracteres, nunca la clave', async () => {
  const { manager } = await managerWith({ geminiApiKey: 'AIzaSECRETO1234', xaiApiKey: 'xai-zzzz9876' });
  const view = await manager.getWebviewConfig();
  assert.deepEqual(view.secrets.geminiApiKey, { configured: true, hint: '1234' });
  assert.deepEqual(view.secrets.groqApiKey, { configured: false });
  assert.ok(!JSON.stringify(view).includes('AIzaSECRETO'), 'la clave completa no debe viajar al webview');
  assert.ok(!('cerebrasApiKey' in view.secrets), 'las claves retiradas de la UI no se exponen');
});

test('guardar un parche sin claves conserva las claves existentes', async () => {
  const { context, manager } = await managerWith({ geminiApiKey: 'AIzaKEEP', openRouterApiKey: 'sk-or-v1-keep' });
  await manager.applySettingsPatch({ groqFreeEnabled: false, ollamaUrl: 'http://localhost:11434', smartRouterUrl: 'http://localhost:3000' });
  assert.equal(await context.secrets.get(`${PREFIX}geminiApiKey`), 'AIzaKEEP');
  assert.equal(await context.secrets.get(`${PREFIX}openRouterApiKey`), 'sk-or-v1-keep');
});

test('el parche añade, reemplaza y borra claves de forma explícita', async () => {
  const { context, manager } = await managerWith({ geminiApiKey: 'old', xaiApiKey: 'xai-old' });
  await manager.applySettingsPatch({ secrets: { geminiApiKey: '  new-key  ', groqApiKey: 'gsk_new' }, clearSecrets: ['xaiApiKey'] });
  assert.equal(await context.secrets.get(`${PREFIX}geminiApiKey`), 'new-key');
  assert.equal(await context.secrets.get(`${PREFIX}groqApiKey`), 'gsk_new');
  assert.equal(await context.secrets.get(`${PREFIX}xaiApiKey`), undefined);
});

test('la casilla de Groq manda: con clave pero desmarcada, Groq no entra en Automático', async () => {
  const { manager } = await managerWith({ groqApiKey: 'gsk_key' });
  await manager.applySettingsPatch({ groqFreeEnabled: false });
  assert.equal((await manager.getConfig()).groqFreeEnabled, false);
  await manager.applySettingsPatch({ groqFreeEnabled: true });
  assert.equal((await manager.getConfig()).groqFreeEnabled, true);
});

test('sin guardar nada, Groq viene desactivado aunque exista la clave', async () => {
  const { manager } = await managerWith({ groqApiKey: 'gsk_key' });
  assert.equal((await manager.getConfig()).groqFreeEnabled, false);
});

test('rechaza Ollama remoto y URLs inválidas sin escribir nada', async () => {
  const { context, manager } = await managerWith({ geminiApiKey: 'keep' });
  await assert.rejects(
    manager.applySettingsPatch({ secrets: { geminiApiKey: 'nueva' }, ollamaUrl: 'http://192.168.1.20:11434' }),
    (error) => error instanceof SettingsValidationError && error.field === 'ollamaUrl'
  );
  assert.equal(await context.secrets.get(`${PREFIX}geminiApiKey`), 'keep', 'una validación fallida no debe guardar a medias');
  await assert.rejects(manager.applySettingsPatch({ smartRouterUrl: 'ftp://x' }), (error) => error.field === 'smartRouterUrl');
  await assert.rejects(manager.applySettingsPatch({ secrets: { inventada: 'x' } }), SettingsValidationError);
});

test('las URLs locales se leen solo de los ajustes de usuario', async () => {
  const { manager } = await managerWith();
  // El stub expone inspect() solo si existe; sin él se usa get(): aquí basta con comprobar el valor por defecto.
  state.configuration.ollamaUrl = 'http://evil.example:11434';
  const config = await manager.getConfig();
  assert.equal(config.ollamaUrl, 'http://localhost:11434', 'un Ollama remoto se ignora');
});

test('un .vscode/settings.json del repositorio no puede cambiar la URL del Smart Router', async () => {
  const { manager } = await managerWith();
  state.workspaceConfiguration.smartRouterUrl = 'https://exfiltra.example.com';
  state.configuration.smartRouterUrl = 'http://localhost:3001';
  assert.equal((await manager.getConfig()).smartRouterUrl, 'http://localhost:3001');
  delete state.configuration.smartRouterUrl;
  assert.equal((await manager.getConfig()).smartRouterUrl, 'http://localhost:3000', 'sin valor de usuario se usa el predeterminado, no el del repo');
});

test('las claves heredadas se listan sin valor y se pueden borrar', async () => {
  const { context, manager } = await managerWith({ cerebrasApiKey: 'csk-legacy-123', geminiApiKey: 'g' });
  const view = await manager.getWebviewConfig();
  assert.deepEqual(view.legacySecrets, [{ key: 'cerebrasApiKey', label: 'Cerebras' }]);
  assert.ok(!JSON.stringify(view).includes('csk-legacy'));
  await manager.applySettingsPatch({ clearSecrets: ['cerebrasApiKey'] });
  assert.equal(await context.secrets.get(`${PREFIX}cerebrasApiKey`), undefined);
  assert.equal(await context.secrets.get(`${PREFIX}geminiApiKey`), 'g');
});
