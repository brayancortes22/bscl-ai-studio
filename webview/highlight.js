/**
 * Resaltado de sintaxis ligero para los bloques de código del chat.
 *
 * Por qué no una librería: el webview no tiene build ni dependencias, y un tokenizador
 * de una pasada (comentarios, cadenas, números, palabras clave, llamadas) cubre lo que
 * se lee en un chat. Los colores salen de variables del tema de VS Code (ver styles.css),
 * así que el bloque cambia con el tema del usuario.
 *
 * Entrada: código sin escapar. Salida: HTML escapado con <span class="tok-*">.
 */
(function (root) {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

  const words = (list) => new Set(list.split(/\s+/).filter(Boolean));

  const JS_KEYWORDS = words(`abstract as async await break case catch class const continue debugger declare default delete do
    else enum export extends false finally for from function get if implements import in instanceof interface let namespace new
    null of private protected public readonly return satisfies set static super switch this throw true try type typeof undefined
    var void while with yield`);
  const PY_KEYWORDS = words(`and as assert async await break class continue def del elif else except False finally for from global
    if import in is lambda None nonlocal not or pass raise return self True try while with yield match case`);
  const C_KEYWORDS = words(`abstract as async await auto bool boolean break byte case catch char class const constexpr continue
    crate default defer delete do double dyn else enum explicit extern false final finally float fn for func go goto if impl
    implements import in inline int interface internal let long loop match mod module mut namespace new nil null object override
    package private protected pub public readonly ref return self Self short signed sizeof static struct super switch template
    this throw throws trait true try type typedef typename union unsafe unsigned use using val var virtual void volatile when where
    while yield fun suspend data sealed companion lateinit init string`);
  const SHELL_KEYWORDS = words(`if then else elif fi for while until do done case esac in function return export local readonly
    echo exit set unset source alias cd sudo npm npx node git pnpm yarn Get-ChildItem Set-Location New-Item Remove-Item Write-Host
    param foreach`);
  const SQL_KEYWORDS = words(`select from where and or not insert into values update set delete create table alter drop index
    join left right inner outer full on group by order having limit offset as distinct union all case when then else end null
    is in like between exists primary key foreign references default unique view with returning`);
  const CSS_KEYWORDS = words(`important inherit initial unset auto none var calc min max clamp rgb rgba hsl hsla url`);

  const FAMILIES = {
    js: { keywords: JS_KEYWORDS, lineComment: '//', blockComment: true, templates: true, types: true },
    py: { keywords: PY_KEYWORDS, lineComment: '#', blockComment: false, tripleStrings: true },
    c: { keywords: C_KEYWORDS, lineComment: '//', blockComment: true, types: true },
    shell: { keywords: SHELL_KEYWORDS, lineComment: '#', blockComment: false, variables: true, dashIdentifiers: 'shell' },
    sql: { keywords: SQL_KEYWORDS, lineComment: '--', blockComment: true, caseInsensitive: true },
    css: { keywords: CSS_KEYWORDS, lineComment: null, blockComment: true, dashIdentifiers: 'css' },
    yaml: { keywords: words('true false null yes no on off'), lineComment: '#', blockComment: false },
    generic: { keywords: new Set(), lineComment: null, blockComment: false }
  };

  const LANGUAGE_FAMILY = {
    js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', typescript: 'js', tsx: 'js', json: 'js', jsonc: 'js',
    vue: 'js', svelte: 'js',
    py: 'py', python: 'py', python3: 'py',
    c: 'c', h: 'c', cpp: 'c', 'c++': 'c', cc: 'c', hpp: 'c', cs: 'c', csharp: 'c', java: 'c', kt: 'c', kotlin: 'c', kts: 'c',
    go: 'c', golang: 'c', rs: 'c', rust: 'c', swift: 'c', php: 'c', dart: 'c', scala: 'c', gradle: 'c', groovy: 'c',
    sh: 'shell', bash: 'shell', zsh: 'shell', shell: 'shell', console: 'shell', ps1: 'shell', powershell: 'shell', pwsh: 'shell',
    bat: 'shell', cmd: 'shell', dockerfile: 'shell', makefile: 'shell',
    sql: 'sql', mysql: 'sql', postgresql: 'sql', postgres: 'sql', sqlite: 'sql',
    css: 'css', scss: 'css', less: 'css', sass: 'css',
    yaml: 'yaml', yml: 'yaml', toml: 'yaml', ini: 'yaml', properties: 'yaml', env: 'yaml'
  };

  function familyFor(language) {
    const key = String(language || '').toLowerCase();
    if (['html', 'xml', 'svg', 'xhtml', 'vue-html'].includes(key)) return 'markup';
    return FAMILIES[LANGUAGE_FAMILY[key] || 'generic'] ? (LANGUAGE_FAMILY[key] || 'generic') : 'generic';
  }

  const span = (kind, text) => `<span class="tok-${kind}">${escapeHtml(text)}</span>`;

  function highlightMarkup(code) {
    // Etiquetas, atributos y comentarios; el contenido de texto se deja tal cual.
    const pattern = /(<!--[\s\S]*?-->)|(<\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?>)/g;
    let output = '';
    let last = 0;
    let match;
    while ((match = pattern.exec(code))) {
      output += escapeHtml(code.slice(last, match.index));
      if (match[1]) output += span('comment', match[1]);
      else {
        output += escapeHtml(match[2]) + span('tag', match[3]);
        output += match[4].replace(/([^\s=]+)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s>]+)?|\s+/g, (all, name, eq, value) => {
          if (!name) return escapeHtml(all);
          return span('attr', name) + (eq ? escapeHtml(eq) : '') + (value ? span('string', value) : '');
        });
        output += escapeHtml(match[5]);
      }
      last = pattern.lastIndex;
    }
    return output + escapeHtml(code.slice(last));
  }

  function buildPattern(family) {
    const parts = [];
    if (family.blockComment) parts.push('\\/\\*[\\s\\S]*?(?:\\*\\/|$)');
    if (family.lineComment === '//') parts.push('\\/\\/[^\\n]*');
    if (family.lineComment === '#') parts.push('#[^\\n]*');
    if (family.lineComment === '--') parts.push('--[^\\n]*');
    const comments = parts.length ? `(${parts.join('|')})` : '(\\b\\B)';
    const strings = [
      family.tripleStrings ? '"""[\\s\\S]*?(?:"""|$)|\'\'\'[\\s\\S]*?(?:\'\'\'|$)' : null,
      '"(?:\\\\[\\s\\S]|[^"\\\\\\n])*"?',
      "'(?:\\\\[\\s\\S]|[^'\\\\\\n])*'?",
      family.templates ? '`(?:\\\\[\\s\\S]|[^`\\\\])*`?' : null
    ].filter(Boolean).join('|');
    const numbers = '\\b0[xX][\\da-fA-F_]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?[a-zA-Z]{0,2}\\b';
    const variables = family.variables ? '|(\\$\\{?[A-Za-z_][\\w]*\\}?)' : '|(\\b\\B)';
    // El guion solo forma parte del nombre en CSS (propiedades) y shell (Get-ChildItem);
    // en JS o C partiría `a-b` en un único identificador.
    const identifiers = family.dashIdentifiers === 'css' ? '([@A-Za-z_-][\\w-]*)'
      : family.dashIdentifiers === 'shell' ? '([A-Za-z_][\\w-]*)'
        : '([A-Za-z_$][\\w$]*)';
    return new RegExp(`${comments}|(${strings})|(${numbers})${variables}|${identifiers}`, 'g');
  }

  const PATTERNS = {};

  function highlight(code, language) {
    const source = String(code ?? '');
    const familyName = familyFor(language);
    if (familyName === 'markup') return highlightMarkup(source);
    const family = FAMILIES[familyName];
    if (familyName === 'generic') return escapeHtml(source);
    const pattern = PATTERNS[familyName] || (PATTERNS[familyName] = buildPattern(family));
    pattern.lastIndex = 0;
    let output = '';
    let last = 0;
    let match;
    while ((match = pattern.exec(source))) {
      if (match[0] === '') { pattern.lastIndex += 1; continue; }
      output += escapeHtml(source.slice(last, match.index));
      const [token, comment, string, number, variable, identifier] = match;
      if (comment) output += span('comment', token);
      else if (string) output += span('string', token);
      else if (number) output += span('number', token);
      else if (variable) output += span('variable', token);
      else if (identifier) {
        const lookup = family.caseInsensitive ? identifier.toLowerCase() : identifier;
        const next = source.slice(pattern.lastIndex).match(/^\s*\(/);
        if (family.keywords.has(lookup)) output += span('keyword', token);
        else if (next && !/[-@]/.test(identifier)) output += span('function', token);
        else if (family.types && /^[A-Z][a-z0-9]\w*$/.test(identifier)) output += span('type', token);
        else output += escapeHtml(token);
      } else output += escapeHtml(token);
      last = pattern.lastIndex;
    }
    return output + escapeHtml(source.slice(last));
  }

  const api = { highlight, escapeHtml, familyFor };
  root.BsclHighlight = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
