// Renderizado Markdown del webview: formato correcto y, sobre todo, nada de HTML inyectado.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../webview/highlight.js');
const { render } = require('../webview/markdown.js');

test('escapa HTML crudo en texto, código y enlaces', () => {
  const html = render('<img src=x onerror=alert(1)> **<b>x</b>** `<script>`');
  assert.ok(!html.includes('<img'), html);
  assert.ok(!html.includes('<b>'), html);
  assert.ok(!html.includes('<script>'), html);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('solo acepta enlaces http(s) y mailto', () => {
  const ok = render('[docs](https://code.visualstudio.com/api)');
  assert.match(ok, /<a class="md-link" href="https:\/\/code\.visualstudio\.com\/api"/);
  const bad = render('[clic](javascript:alert(1))');
  assert.ok(!bad.includes('<a'), bad);
  const data = render('[x](data:text/html;base64,PHNjcmlwdD4=)');
  assert.ok(!data.includes('<a'), data);
});

test('una comilla en la URL no rompe el atributo', () => {
  const html = render('[x](https://e.com/"onmouseover="alert(1))');
  assert.ok(!/href="[^"]*"onmouseover/.test(html), html);
});

test('autoenlaza URLs sueltas sin arrastrar la puntuación final', () => {
  const html = render('Mira https://example.com/a_b. Luego sigue.');
  assert.match(html, /href="https:\/\/example\.com\/a_b"/);
});

test('bloque de código con lenguaje, sin cierre final y con botones', () => {
  const html = render('Texto\n```js\nconst a = 1;\n');
  assert.match(html, /class="code-card"/);
  assert.match(html, /<span class="code-lang">js<\/span>/);
  assert.match(html, /tok-keyword">const</);
  assert.match(html, /code-btn-diff/);
});

test('el contenido de un bloque de código no se interpreta como Markdown', () => {
  const html = render('```\n**no** <b>\n```');
  assert.ok(!html.includes('<strong>'), html);
  assert.match(html, /&lt;b&gt;/);
});

test('encabezados, citas, reglas y párrafos', () => {
  const html = render('## Título\n\n> cita\n\n---\n\nUno\ndos');
  assert.match(html, /<h2 class="md-h md-h2">Título<\/h2>/);
  assert.match(html, /<blockquote class="md-quote"><p class="md-p">cita<\/p><\/blockquote>/);
  assert.match(html, /<hr class="md-rule">/);
  assert.match(html, /<p class="md-p">Uno<br>dos<\/p>/);
});

test('listas anidadas, numeradas con inicio y de tareas', () => {
  const html = render('- a\n  - b\n- c\n\n3. tres\n4. cuatro\n\n- [x] hecho\n- [ ] pendiente');
  assert.match(html, /<ul class="md-list"><li>a<ul class="md-list"><li>b<\/li><\/ul><\/li><li>c<\/li><\/ul>/);
  assert.match(html, /<ol class="md-list" start="3">/);
  assert.match(html, /md-checkbox" data-checked="true"/);
  assert.match(html, /md-checkbox" data-checked="false"/);
});

test('tablas GFM con alineación', () => {
  const html = render('| A | B |\n|:--|--:|\n| 1 | `x|y` |');
  assert.match(html, /<table class="md-table">/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<td class="md-align-right">/);
});

test('negrita, cursiva, tachado y snake_case intacto', () => {
  const html = render('**n** *c* _c2_ ~~t~~ mi_variable_larga');
  assert.match(html, /<strong>n<\/strong>/);
  assert.match(html, /<em>c<\/em>/);
  assert.match(html, /<em>c2<\/em>/);
  assert.match(html, /<del>t<\/del>/);
  assert.match(html, /mi_variable_larga/);
});

test('el resaltado escapa y reconoce cadenas, comentarios y números', () => {
  const { highlight } = require('../webview/highlight.js');
  const html = highlight('// <b>\nconst s = "<i>"; let n = 42;', 'ts');
  assert.match(html, /tok-comment">\/\/ &lt;b&gt;</);
  assert.match(html, /tok-string">&quot;&lt;i&gt;&quot;</);
  assert.match(html, /tok-number">42</);
  assert.ok(!html.includes('<b>') && !html.includes('<i>'));
  const markup = highlight('<a href="x" onclick="y">t</a>', 'html');
  assert.match(markup, /tok-tag">a</);
  assert.ok(!markup.includes('<a '), markup);
});

test('la negrita puede envolver código en línea y enlaces', () => {
  const html = render('Usa **`saveConfig`** y **[guía](https://e.com)**');
  assert.match(html, /<strong><code class="md-code">saveConfig<\/code><\/strong>/);
  assert.match(html, /<strong><a class="md-link" href="https:\/\/e\.com"/);
});
