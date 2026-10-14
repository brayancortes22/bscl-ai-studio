(function () {
  let sendMessage = () => {};
  let showError = () => {};

  function init(options) {
    sendMessage = options.postMessage;
    showError = options.onError;
  }

  function attach(container) {
    container.querySelectorAll('.code-btn-diff').forEach((button) => {
      button.onclick = () => {
        button.disabled = true;
        button.textContent = 'Abriendo…';
        sendMessage({ type: 'prepareDiff', payload: { codeKey: button.dataset.codeKey, code: decodeURIComponent(button.dataset.code) } });
      };
    });
    container.querySelectorAll('.code-btn-accept').forEach((button) => {
      button.onclick = () => resolveProposal(button, 'acceptDiff');
    });
    container.querySelectorAll('.code-btn-discard').forEach((button) => {
      button.onclick = () => resolveProposal(button, 'discardDiff');
    });
  }

  function resolveProposal(button, type) {
    const card = button.closest('.code-card');
    card.querySelectorAll('.code-btn-accept, .code-btn-discard').forEach((action) => { action.disabled = true; });
    sendMessage({ type, payload: { proposalId: button.dataset.proposalId, codeKey: button.dataset.codeKey } });
  }

  function findCard(codeKey) {
    return [...document.querySelectorAll('.code-card')].find((card) =>
      card.querySelector('.code-btn-diff')?.dataset.codeKey === codeKey
    );
  }

  function handle(type, payload) {
    if (type === 'diffPrepared') {
      const card = findCard(payload.codeKey);
      if (!card) {
        sendMessage({ type: 'discardDiff', payload: { proposalId: payload.proposalId, codeKey: payload.codeKey } });
        return;
      }
      card.querySelector('.code-btn-diff').textContent = 'Diff abierto';
      const accept = card.querySelector('.code-btn-accept');
      const discard = card.querySelector('.code-btn-discard');
      accept.dataset.proposalId = payload.proposalId;
      discard.dataset.proposalId = payload.proposalId;
      accept.classList.remove('hidden');
      discard.classList.remove('hidden');
    }

    if (type === 'diffResolved') {
      const card = findCard(payload.codeKey);
      if (!card) return;
      card.querySelector('.code-btn-accept').classList.add('hidden');
      card.querySelector('.code-btn-discard').classList.add('hidden');
      const preview = card.querySelector('.code-btn-diff');
      preview.textContent = payload.outcome === 'accepted' ? 'Cambio aplicado' : 'Reabrir Diff';
      preview.disabled = payload.outcome === 'accepted';
    }

    if (type === 'diffError') {
      showError(payload.message);
      const card = findCard(payload.codeKey);
      if (!card) return;
      card.querySelector('.code-btn-accept').classList.add('hidden');
      card.querySelector('.code-btn-discard').classList.add('hidden');
      const preview = card.querySelector('.code-btn-diff');
      preview.disabled = false;
      preview.textContent = 'Reabrir Diff';
    }
  }

  window.DiffActions = { init, attach, handle };
})();
