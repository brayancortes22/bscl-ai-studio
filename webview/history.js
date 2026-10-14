/**
 * Componente UI para Historial de Conversaciones (Drawer Refero AAA)
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
window.HistoryView = (function () {
  const drawer = document.getElementById('historyDrawer');
  const sessionList = document.getElementById('historySessionList');
  const btnClose = document.getElementById('btnCloseHistory');
  const btnClearAll = document.getElementById('btnClearAllHistory');
  let callbacks = {};

  function init(cbs = {}) {
    callbacks = cbs;
    if (btnClose) btnClose.onclick = () => toggle(false);
    if (btnClearAll) {
      btnClearAll.onclick = () => {
        if (confirm('¿Vaciar todo el historial de conversaciones?')) {
          callbacks.onClearAll?.();
        }
      };
    }
  }

  function toggle(open) {
    if (!drawer) return;
    drawer.classList.toggle('drawer-open', open);
  }

  function render(sessions = []) {
    if (!sessionList) return;
    sessionList.innerHTML = '';

    if (sessions.length === 0) {
      sessionList.innerHTML = '<div class="drawer-empty-msg">No hay chats previos guardados.</div>';
      return;
    }

    sessions.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'history-item-card';

      const d = new Date(s.updatedAt || s.createdAt || Date.now());
      const timeStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      card.innerHTML = `
        <div class="history-item-header">
          <span class="history-item-title" title="${s.title}">${s.title}</span>
          <button class="history-item-del" title="Eliminar conversación">✕</button>
        </div>
        <div class="history-item-meta">
          <span>${s.messages?.length || 0} msgs</span>
          <span>•</span>
          <span>${s.model ? s.model.split('/')[1] || s.model : 'auto'}</span>
          <span>•</span>
          <span>${timeStr}</span>
        </div>`;

      card.onclick = (e) => {
        if (e.target.classList.contains('history-item-del')) {
          e.stopPropagation();
          callbacks.onDeleteSession?.(s.id);
          return;
        }
        callbacks.onSelectSession?.(s);
        toggle(false);
      };

      sessionList.appendChild(card);
    });
  }

  return { init, toggle, render };
})();
