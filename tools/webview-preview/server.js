#!/usr/bin/env node
/**
 * Servidor de previsualización del webview, sin Extension Development Host.
 *
 * Por qué existe: iterar el diseño del panel exigía recompilar y relanzar VS Code
 * en cada cambio. Este servidor sirve `webview/index.html` con una simulación de
 * `acquireVsCodeApi` y variables `--vscode-*` de los temas Dark/Light Modern, de
 * modo que el panel se ve en un navegador normal tal como lo pintaría VS Code.
 *
 * Uso:  node tools/webview-preview/server.js [puerto]
 * Luego abre http://localhost:5178/?scene=conversation&theme=dark
 *   scene: empty | conversation | settings | history | working
 *   theme: dark | light | hc
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WEBVIEW_DIR = path.join(ROOT, 'webview');
const PREVIEW_DIR = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 5178);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

function readVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
}

// Las mismas sustituciones que hace view-provider.js, pero con rutas HTTP locales.
function renderIndex() {
  let html = fs.readFileSync(path.join(WEBVIEW_DIR, 'index.html'), 'utf8');
  html = html
    .replaceAll('{{cspSource}}', `http://localhost:${PORT}`)
    .replaceAll('{{nonce}}', 'preview')
    .replaceAll('{{appVersion}}', readVersion())
    .replace(/\{\{asset:([\w./-]+)\}\}/g, (_, file) => `/webview/${file}`)
    // Marcadores heredados (index.html anterior a la 1.2.0).
    .replace('{{stylesUri}}', '/webview/styles.css')
    .replace('{{markdownScriptUri}}', '/webview/markdown.js')
    .replace('{{workspaceScriptUri}}', '/webview/workspace-view.js')
    .replace('{{historyScriptUri}}', '/webview/history.js')
    .replace('{{settingsScriptUri}}', '/webview/settings.js')
    .replace('{{swarmScriptUri}}', '/webview/swarm-graph.js')
    .replace('{{diffActionsScriptUri}}', '/webview/diff-actions.js')
    .replace('{{messageViewScriptUri}}', '/webview/message-view.js')
    .replace('{{scriptUri}}', '/webview/main.js');
  // El tema y la API simulada deben existir antes de que corra cualquier script del webview.
  const inject = '<link rel="stylesheet" href="/__preview/themes.css">\n' +
    '<script nonce="preview" src="/__preview/mock-vscode.js"></script>\n';
  return html.replace('</head>', `${inject}</head>`);
}

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveFile(res, baseDir, relative) {
  const target = path.resolve(baseDir, relative);
  if (target !== baseDir && !target.startsWith(baseDir + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(target, (error, data) => {
    if (error) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(target).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '/index.html') {
    try { return send(res, 200, renderIndex(), MIME['.html']); } catch (error) { return send(res, 500, String(error.stack || error), 'text/plain'); }
  }
  if (pathname.startsWith('/webview/')) return serveFile(res, WEBVIEW_DIR, pathname.slice('/webview/'.length));
  if (pathname.startsWith('/media/')) return serveFile(res, path.join(ROOT, 'media'), pathname.slice('/media/'.length));
  if (pathname.startsWith('/__preview/')) return serveFile(res, PREVIEW_DIR, pathname.slice('/__preview/'.length));
  send(res, 404, 'Not found', 'text/plain');
});

server.listen(PORT, () => {
  console.log(`Previsualización del webview en http://localhost:${PORT}/?scene=conversation&theme=dark`);
});
