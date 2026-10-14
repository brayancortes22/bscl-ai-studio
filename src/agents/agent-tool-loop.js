/**
 * Motor de herramientas agénticas bajo demanda (ReAct Tool Loop) y autoverificación sintáctica.
 * Permite leer archivos específicos, buscar código (grep), listar subdirectorios y verificar sintaxis JS/JSON.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { extractJsonObject } = require('../json-repair');

const SKIP_DIRS = new Set(['.git', '.svn', '.hg', 'node_modules', 'dist', 'build', 'out', '.next', '.venv', 'venv', 'vendor', 'target']);
const SECRET_PATTERN = /(["']?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|passwd|authorization|private[-_]?key|secret|token)["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^,\s}]+)/gi;

class AgentToolLoop {
  static isWithinRoot(rootPath, candidatePath) {
    const rel = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
  }

  static executeReadFile(rootPath, relPath, startLine = 1, endLine = 250) {
    if (!rootPath || !relPath) return 'Ruta no especificada.';
    const cleanRel = String(relPath).trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (/(^\.env|secret|credential|token|\.pem$|\.key$)/i.test(path.basename(cleanRel))) {
      return `Acceso denegado por seguridad a archivo sensible: ${cleanRel}`;
    }
    const target = path.resolve(rootPath, ...cleanRel.split('/'));
    if (!this.isWithinRoot(rootPath, target) || !fs.existsSync(target)) {
      return `Archivo no encontrado: ${cleanRel}`;
    }
    try {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 150000) return `Archivo no legible o demasiado grande: ${cleanRel}`;
      const raw = fs.readFileSync(target, 'utf8').replace(SECRET_PATTERN, '$1"[REDACTADO]"');
      const lines = raw.split(/\r?\n/);
      const from = Math.max(1, Number(startLine) || 1);
      const to = Math.min(lines.length, Math.max(from, Number(endLine) || from + 220));
      const slice = lines.slice(from - 1, to).map((line, idx) => `${from + idx}: ${line}`).join('\n');
      return `### ${cleanRel} (líneas ${from}-${to} de ${lines.length})\n\`\`\`\n${slice}\n\`\`\``;
    } catch (err) {
      return `Error leyendo ${cleanRel}: ${err.message}`;
    }
  }

  static executeSearchCode(rootPath, query) {
    if (!rootPath || !query || String(query).trim().length < 2) return 'Consulta de búsqueda demasiado corta.';
    const needle = String(query).trim().toLowerCase();
    const matches = [];
    const walk = (dir, relDir = '', depth = 0) => {
      if (depth > 6 || matches.length >= 25) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (matches.length >= 25) break;
        if (entry.isDirectory()) {
          if (!entry.isSymbolicLink() && !SKIP_DIRS.has(entry.name.toLowerCase()) && !entry.name.startsWith('.')) {
            walk(path.join(dir, entry.name), path.posix.join(relDir, entry.name), depth + 1);
          }
        } else if (entry.isFile() && /\.(?:js|jsx|ts|tsx|json|py|php|html|css|md|sql|go|rs|java|vue)$/i.test(entry.name)) {
          const full = path.join(dir, entry.name);
          try {
            const stat = fs.statSync(full);
            if (stat.size > 80000) continue;
            const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
            for (let i = 0; i < lines.length; i += 1) {
              if (lines[i].toLowerCase().includes(needle)) {
                matches.push(`${path.posix.join(relDir, entry.name)}:${i + 1}: ${lines[i].trim().slice(0, 140)}`);
                if (matches.length >= 25) break;
              }
            }
          } catch {}
        }
      }
    };
    walk(rootPath);
    return matches.length ? matches.join('\n') : `Sin coincidencias para "${query}".`;
  }

  static executeListFiles(rootPath, subDir = '') {
    if (!rootPath) return 'Sin carpeta raíz.';
    const cleanSub = String(subDir || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
    const target = cleanSub ? path.resolve(rootPath, ...cleanSub.split('/')) : rootPath;
    if (!this.isWithinRoot(rootPath, target) || !fs.existsSync(target)) return `Directorio no encontrado: ${cleanSub || '.'}`;
    try {
      const entries = fs.readdirSync(target, { withFileTypes: true })
        .filter((e) => !SKIP_DIRS.has(e.name.toLowerCase()))
        .slice(0, 80)
        .map((e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${cleanSub ? `${cleanSub}/` : ''}${e.name}`);
      return entries.join('\n') || '(Directorio vacío)';
    } catch (err) {
      return `Error listando directorio: ${err.message}`;
    }
  }

  static async gatherExtraContext({ client, prompt, workspaceContext = '', rootPath = null, model = 'smart-router', onProgress }) {
    if (!rootPath) return '';
    try {
      const toolRes = await client.sendMessage({
        model,
        roleHint: 'subagent',
        messages: [{
          role: 'user',
          content: `SOLICITUD:\n${prompt}\n\nCONTEXTO INICIAL ADJUNTO:\n${workspaceContext.slice(0, 6000)}\n\nSi necesitas inspeccionar archivos adicionales o buscar dónde está definida una función/ruta antes de programar, devuelve JSON: {"tools":[{"tool":"read_file","path":"ruta/archivo.js","startLine":1,"endLine":200},{"tool":"search_code","query":"termino"},{"tool":"list_files","path":"subcarpeta"}]}. Si ya tienes todo lo necesario en el contexto inicial, devuelve {"tools":[]}. Máximo 4 herramientas.`
        }],
        systemPrompt: 'Eres el explorador de herramientas de BSCL AI Studio. Devuelve únicamente JSON válido con la clave "tools".'
      });
      const parsed = extractJsonObject(toolRes?.content || '');
      const tools = Array.isArray(parsed?.tools) ? parsed.tools.slice(0, 4) : [];
      if (!tools.length) return '';

      onProgress?.({ agentId: 'coder', agent: 'Explorador de código', state: 'working', status: `Ejecutando ${tools.length} herramienta(s) sobre el proyecto...`, model });
      const outputs = tools.map((call) => {
        if (call?.tool === 'read_file') return this.executeReadFile(rootPath, call.path, call.startLine, call.endLine);
        if (call?.tool === 'search_code') return `### Búsqueda: ${call.query}\n${this.executeSearchCode(rootPath, call.query)}`;
        if (call?.tool === 'list_files') return `### Listado: ${call.path || '.'}\n${this.executeListFiles(rootPath, call.path)}`;
        return '';
      }).filter(Boolean);
      return outputs.length ? `\n\n[RESULTADOS DE HERRAMIENTAS DE EXPLORACIÓN DEL PROYECTO]:\n${outputs.join('\n\n')}` : '';
    } catch {
      return '';
    }
  }

  /**
   * Verifica sintácticamente los archivos JS/CJS/JSON propuestos por el CoderAgent antes de guardarlos.
   */
  static verifyProposedFiles(files = []) {
    const errors = [];
    for (const file of Array.isArray(files) ? files : []) {
      const ext = path.extname(String(file?.path || '')).toLowerCase();
      if (ext === '.json') {
        try { JSON.parse(file.content); } catch (err) { errors.push(`${file.path}: JSON inválido (${err.message})`); }
      } else if (ext === '.js' || ext === '.cjs') {
        const tmpFile = path.join(os.tmpdir(), `bscl_check_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
        try {
          fs.writeFileSync(tmpFile, file.content, 'utf8');
          execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe', timeout: 4000 });
        } catch (err) {
          const stderr = String(err?.stderr || err?.message || '').split(/\r?\n/).slice(0, 4).join(' ');
          if (!/import\s+.*from|export\s+(?:const|default|function|async)/i.test(file.content)) {
            errors.push(`${file.path}: Error de sintaxis JS (${stderr.slice(0, 220)})`);
          }
        } finally {
          try { fs.unlinkSync(tmpFile); } catch {}
        }
      }
    }
    return errors;
  }
}

module.exports = { AgentToolLoop };
