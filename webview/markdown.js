/** Renderiza el subconjunto Markdown del chat sin permitir HTML arbitrario. */
window.renderMarkdownToHtml = function (rawText) {
  if (!rawText) return '';
  const codeCards = [];
  const marker = `BSCL_SAFE_CODE_${Math.random().toString(36).slice(2)}_`;
  let html = String(rawText).replace(/```([\w+-]*)\n([\s\S]*?)```/g, (_, language = 'code', code) => {
    const clean = code.trim();
    const escaped = escapeHtml(clean);
    const safeLanguage = escapeHtml(language || 'code').toUpperCase();
    const safeCode = encodeURIComponent(clean);
    const codeKey = `code-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const card = `<div class="code-card">
      <div class="code-card-header">
        <span class="code-lang">${safeLanguage}</span>
        <div class="code-actions">
          <button type="button" class="code-btn code-btn-insert" data-code="${safeCode}">Insert at Cursor</button>
          <button type="button" class="code-btn code-btn-copy" data-code="${safeCode}">Copy</button>
          <button type="button" class="code-btn code-btn-diff" data-code-key="${codeKey}" data-code="${safeCode}">Revisar Diff</button>
          <button type="button" class="code-btn code-btn-accept hidden" data-code-key="${codeKey}">Aceptar y aplicar</button>
          <button type="button" class="code-btn code-btn-discard hidden" data-code-key="${codeKey}">Descartar</button>
        </div>
      </div><pre><code>${escaped}</code></pre></div>`;
    const index = codeCards.push(card) - 1;
    return `${marker}${index}__`;
  });

  html = escapeHtml(html);
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="highlight-text">$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/^### (.*$)/gim, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^## (.*$)/gim, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^# (.*$)/gim, '<h2 class="md-h2">$1</h2>');
  html = html.replace(/^&gt; (.*$)/gim, '<blockquote class="md-quote">$1</blockquote>');
  html = html.replace(/^(\d+)\.\s+(.*$)/gim, '<div class="list-item list-ordered"><span class="list-num">$1.</span><span>$2</span></div>');
  html = html.replace(/^[-*]\s+(.*$)/gim, '<div class="list-item list-bullet"><span class="bullet-dot">•</span><span>$1</span></div>');
  html = html.replace(/\n\n+/g, '<div class="md-spacer"></div>').replace(/\n/g, '<br/>');
  codeCards.forEach((card, index) => { html = html.replace(`${marker}${index}__`, () => card); });
  return html;
};

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
