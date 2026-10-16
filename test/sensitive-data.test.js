// Redacción de secretos: debe tapar claves reales y NO tocar código normal.
const test = require('node:test');
const assert = require('node:assert/strict');
const { redactSecrets, isSensitiveFileName, isSensitivePath, safeFileContent, REDACTED } = require('../src/sensitive-data');

test('no altera código normal que menciona password/token', () => {
  const code = [
    'if (password === confirm) return true;',
    'const token = getToken();',
    'const isTokenValid = token => token.length > 0;',
    "headers.Authorization = `Bearer ${key}`;",
    'function setPassword(password) { this.password = password; }',
    'const tokens = text.split(" ");',
    'password = getPassword();',
    'const user = { token: this.token, password: userPassword };',
    'password = new_password'
  ].join('\n');
  assert.equal(redactSecrets(code), code);
});

test('redacta variables de entorno con nombre de secreto', () => {
  const env = 'OPENAI_KEY=abc123def456\nAWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG"\nPORT=3000\nDB_PASSWORD=$FROM_VAULT';
  const out = redactSecrets(env);
  assert.match(out, new RegExp(`OPENAI_KEY=\\${REDACTED.slice(0, -1)}`));
  assert.ok(!out.includes('abc123def456'));
  assert.ok(!out.includes('wJalrXUtnFEMI'));
  assert.match(out, /PORT=3000/);
  assert.match(out, /DB_PASSWORD=\$FROM_VAULT/, 'las referencias a variables no se tocan');
});

test('redacta literales asignados a claves con nombre de secreto', () => {
  const out = redactSecrets('const apiKey = "AbCdEf123456";\n{"client_secret": "zzzzzzzzzz"}\npassword: hunter2222', { fileName: 'config.yml' });
  assert.ok(!out.includes('AbCdEf123456'));
  assert.ok(!out.includes('zzzzzzzzzz'));
  assert.ok(!out.includes('hunter2222'));
  assert.match(out, /const apiKey = "\[REDACTADO\]";/);
});

test('redacta tokens con formato reconocible y credenciales en URLs', () => {
  const out = redactSecrets([
    'key AIzaSyA1234567890abcdefghijklmnopqrstuv',
    'gh: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'or: sk-or-v1-abcdefghijklmnopqrstuvwxyz012345',
    'DATABASE_URL=postgres://admin:s3cr3tP4ss@db.example.com:5432/app',
    'url: https://user:hunter2@example.com/path'
  ].join('\n'));
  assert.ok(!/AIzaSy|ghp_|sk-or-v1-|s3cr3tP4ss|hunter2@/.test(out), out);
  assert.match(out, /https:\/\/user:\[REDACTADO\]@example\.com/);
});

test('redacta bloques PEM de clave privada', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nabc\n-----END RSA PRIVATE KEY-----';
  const out = redactSecrets(`antes\n${pem}\ndespués`);
  assert.ok(!out.includes('MIIEowIBAAKCAQEA'));
  assert.match(out, /antes\n-----BEGIN PRIVATE KEY-----\n\[REDACTADO\]\n-----END PRIVATE KEY-----\ndespués/);
});

test('nombres de archivo sensibles, sin falsos positivos habituales', () => {
  for (const name of ['.env', '.env.local', '.env.production', 'id_rsa', 'server.pem', 'cert.key', 'credentials.json', 'secrets.yaml', '.npmrc', 'local.properties', 'service-account-prod.json']) {
    assert.ok(isSensitiveFileName(name), name);
  }
  for (const name of ['.env.example', '.env.template', 'token.service.ts', 'tokenizer.js', 'secret-santa.md', 'id_rsa.pub', 'keyboard.ts', 'password-strength.js']) {
    assert.ok(!isSensitiveFileName(name), name);
  }
});

test('rutas dentro de carpetas sensibles', () => {
  assert.ok(isSensitivePath('home/.ssh/config'));
  assert.ok(isSensitivePath('.aws\\credentials'));
  assert.ok(!isSensitivePath('src/auth/token.service.ts'));
});

test('safeFileContent devuelve null para archivos sensibles y redacta el resto', () => {
  assert.equal(safeFileContent('.env', 'A=1'), null);
  assert.equal(safeFileContent('src/a.js', 'const a = 1;'), 'const a = 1;');
});

test('la regla sin comillas solo se aplica a archivos de configuración', () => {
  assert.equal(redactSecrets('password: hunter2222', { fileName: 'app.js' }), 'password: hunter2222');
  assert.equal(redactSecrets('password: hunter2222', { fileName: 'app.yaml' }), 'password: [REDACTADO]');
  assert.equal(redactSecrets('db.password=hunter2222', { fileName: 'app.properties' }), 'db.password=[REDACTADO]');
});
