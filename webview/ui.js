/**
 * Utilidades de interfaz compartidas por los módulos del webview.
 *
 * Por qué existe: antes cada módulo construía HTML con innerHTML y cadenas, lo que abrió
 * la puerta a inyección (el título del historial se insertaba sin escapar). Aquí todo
 * nodo se crea con createElement y textContent; nadie más necesita innerHTML salvo el
 * renderizador Markdown, que escapa por su cuenta.
 */
window.UI = (function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function icon(name, extraClass = '') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', `icon ${extraClass}`.trim());
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  /** el('button', { class: 'x', type: 'button', onclick }, [hijos | texto]) */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function setIcon(button, name) {
    const use = button?.querySelector('use');
    if (use) use.setAttribute('href', `#i-${name}`);
  }

  // ---------- Toast ----------

  let toastTimer = null;
  function toast(message, { kind = 'info', timeout = 4000 } = {}) {
    const node = document.getElementById('toast');
    if (!node) return;
    node.replaceChildren(icon(kind === 'error' ? 'error' : kind === 'success' ? 'check' : 'info'), el('span', { text: message }));
    node.dataset.kind = kind;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, timeout);
  }

  // ---------- Vistas superpuestas: foco atrapado, Escape y retorno del foco ----------

  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const openStack = [];

  function openOverlay(overlay, { initialFocus } = {}) {
    if (!overlay || !overlay.hidden) return;
    openStack.push({ overlay, returnFocus: document.activeElement });
    overlay.hidden = false;
    const target = (initialFocus && overlay.querySelector(initialFocus)) || overlay.querySelector(FOCUSABLE);
    requestAnimationFrame(() => target?.focus());
  }

  function closeOverlay(overlay) {
    const index = openStack.findIndex((entry) => entry.overlay === overlay);
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    overlay.dispatchEvent(new CustomEvent('overlayclose'));
    if (index >= 0) {
      const [entry] = openStack.splice(index, 1);
      if (entry.returnFocus && document.contains(entry.returnFocus)) entry.returnFocus.focus();
    }
  }

  function topOverlay() { return openStack.length ? openStack[openStack.length - 1].overlay : null; }

  document.addEventListener('keydown', (event) => {
    const overlay = topOverlay();
    if (!overlay) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeOverlay(overlay);
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...overlay.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  document.addEventListener('click', (event) => {
    const closer = event.target.closest?.('[data-close-overlay]');
    if (closer) closeOverlay(closer.closest('.overlay'));
  });

  // ---------- Formato ----------

  function formatTime(timestamp) {
    return new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return { icon, el, setIcon, toast, openOverlay, closeOverlay, topOverlay, formatTime, formatBytes };
})();
