/**
 * Acciones dentro de las respuestas: copiar, insertar y comparar bloques de código,
 * abrir enlaces y archivos cambiados.
 *
 * Un único listener delegado en el hilo sustituye a los onclick por botón que se
 * reasignaban en cada respuesta. El código se lee del propio bloque (textContent),
 * en vez de duplicarlo codificado en atributos data-*.
 */
window.CodeActions = (function () {
  'use strict';

  let post = () => {};
  let onError = () => {};

  function codeOf(card) {
    return card?.querySelector('.code-body')?.textContent || '';
  }

  function flash(button, iconName, label) {
    if (iconName) {
      window.UI.setIcon(button, iconName);
      setTimeout(() => window.UI.setIcon(button, iconName === 'check' ? 'copy' : iconName), 1200);
    }
    if (label) {
      const previous = button.getAttribute('aria-label');
      button.setAttribute('aria-label', label);
      setTimeout(() => previous && button.setAttribute('aria-label', previous), 1200);
    }
  }

  async function copy(button, text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // El portapapeles del webview puede fallar sin foco; la extensión lo hace por nosotros.
      post({ type: 'copyToClipboard', payload: { text } });
    }
    flash(button, 'check', 'Copiado');
  }

  function setProposalButtons(card, visible) {
    card.querySelectorAll('.code-btn-accept, .code-btn-discard').forEach((button) => {
      button.classList.toggle('hidden', !visible);
      button.disabled = false;
    });
  }

  function onClick(event) {
    const target = event.target;
    const link = target.closest?.('a.md-link');
    if (link) {
      event.preventDefault();
      post({ type: 'openExternal', payload: { url: link.dataset.href || link.getAttribute('href') } });
      return;
    }
    const fileButton = target.closest?.('[data-open-file]');
    if (fileButton) {
      post({ type: 'openFile', payload: { path: fileButton.dataset.openFile } });
      return;
    }
    const button = target.closest?.('button');
    const card = button?.closest('.code-card');
    if (!button || !card) return;
    const codeKey = card.dataset.codeKey;
    if (button.classList.contains('code-btn-copy')) copy(button, codeOf(card));
    else if (button.classList.contains('code-btn-insert')) {
      post({ type: 'insertCode', payload: { code: codeOf(card) } });
      flash(button, null, 'Insertado');
    } else if (button.classList.contains('code-btn-diff')) {
      button.disabled = true;
      button.textContent = 'Abriendo…';
      post({ type: 'prepareDiff', payload: { codeKey, code: codeOf(card), language: card.dataset.language || '' } });
    } else if (button.classList.contains('code-btn-accept') || button.classList.contains('code-btn-discard')) {
      card.querySelectorAll('.code-btn-accept, .code-btn-discard').forEach((action) => { action.disabled = true; });
      post({
        type: button.classList.contains('code-btn-accept') ? 'acceptDiff' : 'discardDiff',
        payload: { proposalId: card.dataset.proposalId, codeKey }
      });
    }
  }

  function findCard(codeKey) {
    return codeKey ? document.querySelector(`.code-card[data-code-key="${CSS.escape(codeKey)}"]`) : null;
  }

  /** Respuestas de diff-manager.js: diffPrepared, diffResolved, diffError. */
  function handle(type, payload = {}) {
    const card = findCard(payload.codeKey);
    if (type === 'diffPrepared') {
      if (!card) {
        post({ type: 'discardDiff', payload: { proposalId: payload.proposalId, codeKey: payload.codeKey } });
        return;
      }
      card.dataset.proposalId = payload.proposalId;
      const diff = card.querySelector('.code-btn-diff');
      diff.textContent = 'Diff abierto';
      setProposalButtons(card, true);
      return;
    }
    if (type === 'diffResolved') {
      if (!card) return;
      setProposalButtons(card, false);
      const diff = card.querySelector('.code-btn-diff');
      const accepted = payload.outcome === 'accepted';
      diff.textContent = accepted ? 'Aplicado' : 'Ver diff';
      diff.disabled = accepted;
      delete card.dataset.proposalId;
      return;
    }
    if (type === 'diffError') {
      onError(payload.message || 'No se pudo preparar el diff.');
      if (!card) return;
      setProposalButtons(card, false);
      const diff = card.querySelector('.code-btn-diff');
      diff.disabled = false;
      diff.textContent = 'Ver diff';
    }
  }

  function init({ root, postMessage, onError: errorHandler }) {
    post = postMessage;
    onError = errorHandler || onError;
    root.addEventListener('click', onClick);
  }

  return { init, handle };
})();
