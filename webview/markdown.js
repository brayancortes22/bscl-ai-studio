/**
 * Renderiza el Markdown de las respuestas sin permitir HTML arbitrario.
 *
 * Todo el texto se escapa antes de generar etiquetas; los enlaces solo aceptan http(s) y
 * mailto, y los abre la extensión (no el webview), que vuelve a validar el esquema.
 * Soporta: encabezados, párrafos, listas anidadas y de tareas, citas, tablas GFM, reglas,
 * bloques de código con o sin cierre, código en línea, negrita, cursiva, tachado y enlaces.
 */
(function (root) {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
  const SAFE_URL = /^(?:https?:\/\/|mailto:)/i;
  const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
  const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE = /^\s{0,3}>\s?(.*)$/;
  const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

  let codeBlockCounter = 0;

  function highlight(code, language) {
    const highlighter = root.BsclHighlight;
    return highlighter ? highlighter.highlight(code, language) : escapeHtml(code);
  }

  // ---------- En línea ----------

  function renderLinkLabel(label) {
    return renderEmphasis(escapeHtml(label));
  }

  function renderEmphasis(escaped) {
    return escaped
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  }

  function link(url, labelHtml) {
    const safe = escapeHtml(url);
    return `<a class="md-link" href="${safe}" data-href="${safe}" title="${safe}">${labelHtml}</a>`;
  }

  function renderInline(raw) {
    // El código en línea y los enlaces se apartan con marcadores antes de escapar: así
    // dentro del código no se interpreta nada, las URLs no se rompen y la negrita puede
    // envolver a ambos (**`código`**). Los marcadores se reinsertan al final.
    const held = [];
    const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;
    let text = String(raw).replace(/\u0000/g, '');
    text = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (all, ticks, body) => {
      const code = body.length > 2 && body.startsWith(' ') && body.endsWith(' ') ? body.slice(1, -1) : body;
      return hold(`<code class="md-code">${escapeHtml(code)}</code>`);
    });
    text = text.replace(/\[([^\]\n]+)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"\n]*")?\s*\)/g, (all, label, url) =>
      (SAFE_URL.test(url) ? hold(link(url, renderLinkLabel(label))) : all));
    text = text.replace(/<((?:https?:\/\/|mailto:)[^\s>]+)>/g, (all, url) => hold(link(url, escapeHtml(url))));
    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<\u0000]*[^\s<.,;:!?)\]'"*_\u0000])/g, (all, before, url) => before + hold(link(url, escapeHtml(url))));
    let html = renderEmphasis(escapeHtml(text));
    // Dos pasadas: un enlace puede contener código retenido en su etiqueta.
    for (let pass = 0; pass < 2; pass += 1) html = html.replace(/\u0000(\d+)\u0000/g, (all, index) => held[Number(index)]);
    return html;
  }

  // ---------- Bloques ----------

  function codeBlock(code, language) {
    codeBlockCounter += 1;
    const key = `code-${codeBlockCounter}`;
    const lang = String(language || '').toLowerCase().replace(/[^\w#+.-]/g, '').slice(0, 24);
    const label = lang || 'texto';
    return `<div class="code-card" data-code-key="${key}" data-language="${escapeHtml(lang)}">` +
      '<div class="code-card-header">' +
        `<span class="code-lang">${escapeHtml(label)}</span>` +
        '<div class="code-actions">' +
          '<button type="button" class="icon-btn code-btn-copy" title="Copiar" aria-label="Copiar código"><svg class="icon" aria-hidden="true"><use href="#i-copy"></use></svg></button>' +
          '<button type="button" class="icon-btn code-btn-insert" title="Insertar en el cursor" aria-label="Insertar en el cursor"><svg class="icon" aria-hidden="true"><use href="#i-insert"></use></svg></button>' +
          `<button type="button" class="text-btn code-btn-diff" data-code-key="${key}" title="Comparar con el archivo activo antes de aplicar">Ver diff</button>` +
          `<button type="button" class="text-btn primary code-btn-accept hidden" data-code-key="${key}">Aplicar</button>` +
          `<button type="button" class="text-btn code-btn-discard hidden" data-code-key="${key}">Descartar</button>` +
        '</div>' +
      '</div>' +
      `<pre class="code-pre"><code class="code-body">${highlight(code, lang)}</code></pre>` +
      '</div>';
  }

  function splitRow(line) {
    let row = line.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
    return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
  }

  function table(lines, start) {
    const header = splitRow(lines[start]);
    const aligns = splitRow(lines[start + 1]).map((cell) =>
      (/^:-+:$/.test(cell) ? 'center' : /^-+:$/.test(cell) ? 'right' : ''));
    const rows = [];
    let index = start + 2;
    while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
      rows.push(splitRow(lines[index]));
      index += 1;
    }
    const cell = (tag, content, column) => {
      const align = aligns[column] ? ` class="md-align-${aligns[column]}"` : '';
      return `<${tag}${align}>${renderInline(content || '')}</${tag}>`;
    };
    const head = `<tr>${header.map((content, column) => cell('th', content, column)).join('')}</tr>`;
    const body = rows.map((row) => `<tr>${header.map((_, column) => cell('td', row[column], column)).join('')}</tr>`).join('');
    return { html: `<div class="md-table-wrap"><table class="md-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`, next: index };
  }

  function isTableStart(lines, index) {
    return lines[index].includes('|') && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1]) && lines[index + 1].includes('-');
  }

  function isBlockStart(lines, index) {
    const line = lines[index];
    return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line) || isTableStart(lines, index);
  }

  function list(lines, start) {
    const output = [];
    const stack = [];
    const closeTop = () => {
      const top = stack.pop();
      if (top.itemOpen) output.push('</li>');
      output.push(`</${top.tag}>`);
    };
    let index = start;
    while (index < lines.length) {
      const line = lines[index];
      const match = LIST_ITEM.exec(line);
      if (!match) {
        if (!line.trim()) {
          let next = index + 1;
          while (next < lines.length && !lines[next].trim()) next += 1;
          if (next < lines.length && LIST_ITEM.test(lines[next]) && stack.length) { index = next; continue; }
          break;
        }
        if (stack.length && !isBlockStart(lines, index)) {
          output.push(`<br>${renderInline(line.trim())}`);
          index += 1;
          continue;
        }
        break;
      }
      const indent = match[1].replace(/\t/g, '    ').length;
      const ordered = /\d/.test(match[2]);
      const tag = ordered ? 'ol' : 'ul';
      while (stack.length && indent < stack[stack.length - 1].indent) closeTop();
      const openList = () => {
        const first = ordered ? parseInt(match[2], 10) : 1;
        output.push(`<${tag} class="md-list"${ordered && first !== 1 ? ` start="${first}"` : ''}>`);
        stack.push({ indent, tag, itemOpen: false });
      };
      let top = stack[stack.length - 1];
      if (!top || indent > top.indent) openList();
      else if (top.tag !== tag) { closeTop(); openList(); }
      top = stack[stack.length - 1];
      if (top.itemOpen) output.push('</li>');
      const task = /^\[([ xX])\]\s+(.*)$/.exec(match[3]);
      output.push(task
        ? `<li class="md-task"><span class="md-checkbox" data-checked="${task[1] !== ' '}" aria-hidden="true"></span>${renderInline(task[2])}`
        : `<li>${renderInline(match[3])}`);
      top.itemOpen = true;
      index += 1;
    }
    while (stack.length) closeTop();
    return { html: output.join(''), next: index };
  }

  function renderBlocks(lines) {
    const output = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index += 1; continue; }

      const fence = FENCE.exec(line);
      if (fence) {
        const marker = fence[1];
        const closing = new RegExp(`^\\s{0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
        const body = [];
        index += 1;
        while (index < lines.length && !closing.test(lines[index])) { body.push(lines[index]); index += 1; }
        index += 1;
        output.push(codeBlock(body.join('\n'), fence[2]));
        continue;
      }

      const heading = HEADING.exec(line);
      if (heading) {
        const level = heading[1].length;
        output.push(`<h${level} class="md-h md-h${level}">${renderInline(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      if (RULE.test(line)) { output.push('<hr class="md-rule">'); index += 1; continue; }

      if (QUOTE.test(line)) {
        const quoted = [];
        while (index < lines.length && QUOTE.test(lines[index])) { quoted.push(QUOTE.exec(lines[index])[1]); index += 1; }
        output.push(`<blockquote class="md-quote">${renderBlocks(quoted)}</blockquote>`);
        continue;
      }

      if (isTableStart(lines, index)) {
        const result = table(lines, index);
        output.push(result.html);
        index = result.next;
        continue;
      }

      if (LIST_ITEM.test(line)) {
        const result = list(lines, index);
        output.push(result.html);
        index = result.next;
        continue;
      }

      const paragraph = [];
      while (index < lines.length && lines[index].trim() && !(paragraph.length && isBlockStart(lines, index))) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      output.push(`<p class="md-p">${paragraph.map(renderInline).join('<br>')}</p>`);
    }
    return output.join('');
  }

  function renderMarkdownToHtml(markdown) {
    if (!markdown) return '';
    const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
    return renderBlocks(lines);
  }

  root.renderMarkdownToHtml = renderMarkdownToHtml;
  root.BsclMarkdown = { render: renderMarkdownToHtml, renderInline, escapeHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BsclMarkdown;
})(typeof window !== 'undefined' ? window : globalThis);
