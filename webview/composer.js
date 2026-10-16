/**
 * Compositor: texto, adjuntos, arrastrar y soltar y fichas de contexto
 * (carpeta de trabajo y archivo activo).
 *
 * Sin dictado ni audio: VS Code no concede el micrófono a los webviews y la
 * transcripción en la nube está desactivada para no generar costes, así que ambos
 * botones solo producían errores.
 *
 * Los avisos de validación (archivo demasiado grande, tipo no admitido…) van a una
 * línea bajo el compositor en vez de ensuciar el hilo con tarjetas de error.
 */
window.Composer = (function () {
  'use strict';
  const { el, icon } = window.UI;

  const $ = (id) => document.getElementById(id);
  const composer = $('composer');
  const input = $('promptInput');
  const sendButton = $('btnSend');
  const attachButton = $('btnAttach');
  const fileInput = $('mediaFileInput');
  const preview = $('mediaPreview');
  const note = $('composerNote');
  const folderChip = $('folderChip');
  const folderName = $('folderName');
  const clearFolderButton = $('btnClearFolder');
  const fileChip = $('activeFileChip');
  const fileName = $('activeFileName');

  const TEXT_EXTENSIONS = new Set(['c', 'cc', 'cpp', 'cs', 'css', 'dockerfile', 'go', 'gradle', 'gitignore', 'h', 'html', 'ini', 'java', 'js', 'jsx',
    'json', 'kt', 'kts', 'makefile', 'md', 'php', 'properties', 'ps1', 'py', 'rs', 'scss', 'sh', 'sql', 'svelte', 'toml', 'ts', 'tsx', 'txt', 'vue',
    'xml', 'yaml', 'yml']);
  const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'aiff', 'aif', 'webm', 'opus']);
  const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const LIMITS = { files: 12, textEach: 64 * 1024, textTotal: 160 * 1024, image: 8 * 1024 * 1024, media: 20 * 1024 * 1024 };

  let attachments = [];
  let busy = false;
  let autoContext = true;
  let hasActiveEditor = false;
  let callbacks = {};
  let noteTimer = null;

  // ---------- Estado visual ----------

  function showNote(message, timeout = 6000) {
    note.textContent = message || '';
    clearTimeout(noteTimer);
    if (message && timeout) noteTimer = setTimeout(() => { note.textContent = ''; }, timeout);
  }

  function resize() {
    const max = Math.max(72, Math.floor(window.innerHeight * 0.4));
    input.style.height = 'auto';
    const height = Math.min(input.scrollHeight, max);
    input.style.height = `${height}px`;
    input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden';
  }

  function hasContent() { return Boolean(input.value.trim()) || attachments.length > 0; }

  function syncSend() {
    sendButton.classList.toggle('is-stop', busy);
    window.UI.setIcon(sendButton, busy ? 'stop' : 'send');
    sendButton.setAttribute('aria-label', busy ? 'Detener' : 'Enviar');
    sendButton.title = busy ? 'Detener (Esc)' : 'Enviar (Enter)';
    sendButton.disabled = !busy && !hasContent();
  }

  function setBusy(value) {
    busy = Boolean(value);
    syncSend();
  }

  function renderAttachments() {
    preview.hidden = attachments.length === 0;
    preview.replaceChildren(...attachments.map((item, index) => {
      const kind = item.category === 'text' ? 'file' : 'image';
      const remove = el('button', { type: 'button', class: 'chip-remove', 'aria-label': `Quitar ${item.name}`, title: 'Quitar' }, [icon('close')]);
      remove.addEventListener('click', () => { attachments.splice(index, 1); renderAttachments(); input.focus(); });
      return el('span', { class: 'chip-group' }, [
        el('span', { class: 'chip', title: `${item.name} · ${window.UI.formatBytes(item.size)}` }, [icon(kind), el('span', { text: item.name })]),
        remove
      ]);
    }));
    syncSend();
  }

  // ---------- Fichas de contexto ----------

  function setFolder(folder) {
    const selected = Boolean(folder?.path);
    folderChip.classList.toggle('placeholder', !selected);
    folderChip.dataset.path = selected ? folder.path : '';
    folderName.textContent = selected ? folder.name : 'Elegir carpeta';
    folderChip.title = selected ? `Carpeta de trabajo: ${folder.path}\nPulsa para cambiarla.` : 'Elige la carpeta sobre la que trabajarán los agentes (también puedes arrastrarla aquí)';
    clearFolderButton.hidden = !selected;
  }

  function syncFileChip() {
    fileChip.classList.toggle('is-off', hasActiveEditor && !autoContext);
    fileChip.classList.toggle('placeholder', !hasActiveEditor);
    fileChip.setAttribute('aria-pressed', String(autoContext));
    fileChip.disabled = !hasActiveEditor;
  }

  function setActiveEditor(editor) {
    hasActiveEditor = Boolean(editor);
    if (editor) {
      fileName.textContent = editor.hasSelection || editor.selectedText ? `${editor.fileName} (selección)` : editor.fileName;
      fileChip.title = `${editor.relativePath || editor.fileName} · ${editor.language}, ${editor.lineCount} líneas\n` +
        (autoContext ? 'Se incluye como contexto. Pulsa para excluirlo.' : 'Excluido del contexto. Pulsa para incluirlo.');
    } else {
      fileName.textContent = 'Sin archivo activo';
      fileChip.title = 'Abre un archivo en el editor para usarlo como contexto';
    }
    syncFileChip();
  }

  // ---------- Adjuntos ----------

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    const problems = [];
    const sum = (category) => attachments.filter((item) => category.includes(item.category)).reduce((total, item) => total + (item.size || 0), 0);
    let textTotal = sum(['text']);
    let mediaTotal = sum(['image']);
    for (const file of files) {
      if (attachments.length >= LIMITS.files) { problems.push(`Máximo ${LIMITS.files} adjuntos por mensaje.`); break; }
      const name = String(file.name || 'archivo').split(/[\\/]/).pop();
      const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : name.toLowerCase();
      if (window.BsclSensitiveNames.isSensitiveFileName(name)) { problems.push(`«${name}» parece contener credenciales y no se adjuntó.`); continue; }
      if (AUDIO_EXTENSIONS.has(extension) || /^audio\//i.test(file.type || '')) { problems.push(`«${name}»: el audio no se admite (la transcripción está desactivada para no generar costes).`); continue; }
      const mimeType = file.type || '';
      if (TEXT_EXTENSIONS.has(extension) || /^text\//i.test(mimeType) || ['application/json', 'application/xml'].includes(mimeType)) {
        if (file.size > LIMITS.textEach || textTotal + file.size > LIMITS.textTotal) { problems.push(`«${name}» supera el límite de texto (64 KB por archivo, 160 KB en total).`); continue; }
        try {
          const content = await file.text();
          if (content.includes('\u0000')) { problems.push(`«${name}» parece binario.`); continue; }
          attachments.push({ category: 'text', mimeType: mimeType || 'text/plain', content, name, size: file.size });
          textTotal += file.size;
        } catch (error) { problems.push(error.message); }
        continue;
      }
      if (!IMAGE_TYPES.has(mimeType)) { problems.push(`«${name}» no es un tipo admitido (código, texto o imágenes PNG/JPEG/WebP/GIF).`); continue; }
      if (file.size > LIMITS.image || mediaTotal + file.size > LIMITS.media) {
        problems.push(`«${name}» es demasiado grande (8 MB por imagen, 20 MB entre todas).`);
        continue;
      }
      try {
        const data = await readAsDataUrl(file);
        attachments.push({ category: 'image', mimeType, data, name, size: file.size });
        mediaTotal += file.size;
      } catch (error) { problems.push(error.message); }
    }
    renderAttachments();
    if (problems.length) showNote(problems.join(' '));
  }

  /** Archivos y carpetas que la extensión leyó tras un arrastre desde el Explorador. */
  function addImported(payload = {}) {
    for (const item of payload.files || []) {
      if (attachments.length >= LIMITS.files) break;
      if (item?.category === 'text' && typeof item.content === 'string') attachments.push(item);
      else if (item?.category === 'image' && typeof item.data === 'string') attachments.push(item);
    }
    renderAttachments();
    if (payload.directories?.length) setFolder(payload.directories[0]);
    if (payload.skipped?.length) showNote(payload.skipped.join(' '));
  }

  // ---------- Arrastrar y soltar ----------

  function filePathToUri(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    if (!normalized) return '';
    const segments = normalized.split('/').filter(Boolean);
    if (/^[a-z]:$/i.test(segments[0] || '')) segments[0] = segments[0].toUpperCase();
    return `file:///${segments.map((segment, index) => (index === 0 && /^[A-Z]:$/.test(segment) ? segment : encodeURIComponent(segment))).join('/')}`;
  }

  function collectUris(value, output) {
    if (typeof value === 'string') {
      if (value.startsWith('file://')) output.add(value);
      else (value.match(/file:\/\/[^\s"'<>]+/g) || []).forEach((uri) => output.add(uri.replace(/[),;]+$/, '')));
      return;
    }
    if (Array.isArray(value)) { value.forEach((item) => collectUris(item, output)); return; }
    if (value && typeof value === 'object') {
      if (value.scheme === 'file' && typeof value.path === 'string') output.add(filePathToUri(value.fsPath || value.path));
      Object.values(value).forEach((item) => collectUris(item, output));
    }
  }

  function droppedUris(transfer) {
    const uris = new Set();
    transfer.getData('text/uri-list').split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('file://')).forEach((uri) => uris.add(uri));
    const explorer = transfer.getData('application/vnd.code.tree.explorer');
    if (explorer) { try { collectUris(JSON.parse(explorer), uris); } catch { collectUris(explorer, uris); } }
    const plain = transfer.getData('text/plain').trim();
    if (/^(?:[a-z]:\\|\\\\)/i.test(plain)) uris.add(filePathToUri(plain));
    return [...uris].slice(0, 20);
  }

  const acceptsDrop = (event) => {
    const types = Array.from(event.dataTransfer?.types || []);
    return types.some((type) => /uri-list|tree\.explorer|Files/i.test(type)) || Boolean(event.dataTransfer?.files?.length);
  };

  function onDrop(event) {
    composer.classList.remove('drop-active');
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const items = Array.from(transfer.items || []);
    const files = Array.from(transfer.files || []);
    const realFiles = files.some((file) => file.size > 0 || file.type);
    const folder = items.some((item) => { try { return item.webkitGetAsEntry?.()?.isDirectory; } catch { return false; } })
      || files.some((file) => !file.type && file.size === 0);
    const uris = droppedUris(transfer);
    if (files.length && (realFiles || !folder)) {
      event.preventDefault(); event.stopPropagation();
      addFiles(files);
      return;
    }
    if (uris.length) {
      event.preventDefault(); event.stopPropagation();
      showNote('Leyendo lo que arrastraste…', 0);
      callbacks.post({ type: 'importDroppedItems', payload: { uris } });
      return;
    }
    if (folder) {
      event.preventDefault(); event.stopPropagation();
      callbacks.post({ type: 'pickWorkspaceFolder' });
    }
  }

  function wireDragAndDrop() {
    const zones = [document.body];
    zones.forEach((zone) => {
      zone.addEventListener('dragenter', (event) => { if (acceptsDrop(event)) event.preventDefault(); });
      zone.addEventListener('dragover', (event) => {
        if (!acceptsDrop(event)) return;
        event.preventDefault();
        composer.classList.add('drop-active');
      });
      zone.addEventListener('dragleave', (event) => {
        if (!event.relatedTarget || !document.body.contains(event.relatedTarget)) composer.classList.remove('drop-active');
      });
      zone.addEventListener('drop', onDrop);
    });
  }

  // ---------- API ----------

  function submit() {
    if (busy) { callbacks.onStop?.(); return; }
    if (!hasContent()) return;
    const text = input.value.trim();
    const media = attachments;
    attachments = [];
    input.value = '';
    renderAttachments();
    resize();
    callbacks.onSend?.({ text, media });
  }

  function setText(text, { append = false } = {}) {
    input.value = append && input.value.trim() ? `${input.value.trimEnd()}\n\n${text}` : text;
    resize();
    syncSend();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function init(cbs) {
    callbacks = cbs;
    input.addEventListener('input', () => { resize(); syncSend(); callbacks.onDraft?.(input.value); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!busy) submit(); }
      else if (event.key === 'Escape' && busy) { event.preventDefault(); callbacks.onStop?.(); }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && busy && !window.UI.topOverlay()) callbacks.onStop?.();
    });
    sendButton.addEventListener('click', submit);
    attachButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => { await addFiles(fileInput.files); fileInput.value = ''; });
    folderChip.addEventListener('click', () => callbacks.post({ type: 'pickWorkspaceFolder' }));
    clearFolderButton.addEventListener('click', () => { callbacks.post({ type: 'clearWorkspaceFolder' }); setFolder(null); });
    fileChip.addEventListener('click', () => {
      autoContext = !autoContext;
      syncFileChip();
      fileChip.title = autoContext ? 'Se incluye como contexto. Pulsa para excluirlo.' : 'Excluido del contexto. Pulsa para incluirlo.';
    });
    window.addEventListener('resize', resize);
    wireDragAndDrop();
    resize();
    syncSend();
  }

  return {
    init, setBusy, setFolder, setActiveEditor, addImported, setText, showNote, resize,
    isAutoContextEnabled: () => autoContext,
    getDraft: () => input.value,
    focus: () => input.focus()
  };
})();
