/**
 * Vista de historial: búsqueda, agrupación por fecha y borrado.
 *
 * Recibe solo resúmenes (id, título, modelo, nº de mensajes, fecha); los mensajes de
 * una sesión se piden a la extensión al abrirla. Antes se enviaban las 50 sesiones
 * completas en cada respuesta.
 */
window.HistoryView = (function () {
  'use strict';
  const { el, icon } = window.UI;

  const view = document.getElementById('historyView');
  const listNode = document.getElementById('historySessionList');
  const search = document.getElementById('historySearch');
  const clearAll = document.getElementById('btnClearAllHistory');

  let sessions = [];
  let currentId = '';
  let callbacks = {};
  let modelName = (id) => id;

  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function groupOf(timestamp) {
    const date = new Date(timestamp || 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = 864e5;
    if (date >= today) return 'Hoy';
    if (date >= new Date(today - day)) return 'Ayer';
    if (date >= new Date(today - 6 * day)) return 'Últimos 7 días';
    if (date >= new Date(today - 29 * day)) return 'Últimos 30 días';
    return 'Anteriores';
  }

  function describe(session) {
    const count = Number(session.messageCount ?? session.messages?.length ?? 0);
    const when = new Date(session.updatedAt || session.createdAt || Date.now());
    const sameDay = when.toDateString() === new Date().toDateString();
    const time = sameDay
      ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : when.toLocaleDateString([], { day: 'numeric', month: 'short' });
    return [`${count} ${count === 1 ? 'mensaje' : 'mensajes'}`, modelName(session.model || 'smart-router'), time].filter(Boolean).join(' · ');
  }

  function row(session) {
    const open = el('button', { type: 'button', class: 'history-open', title: session.title || '' }, [
      el('span', { class: 'history-title', text: session.title || 'Conversación sin título' }),
      el('span', { class: 'history-meta', text: describe(session) })
    ]);
    open.addEventListener('click', () => { callbacks.onSelect?.(session.id); close(); });
    const label = `Borrar «${session.title || 'conversación'}»`;
    const remove = el('button', { type: 'button', class: 'icon-btn history-delete', 'aria-label': label, title: 'Borrar' }, [icon('trash')]);
    // El primer clic arma el borrado y el segundo, antes de 3 s, lo confirma: sin diálogos modales.
    let armed = null;
    remove.addEventListener('click', () => {
      if (armed) { clearTimeout(armed); callbacks.onDelete?.(session.id); return; }
      remove.classList.add('is-armed');
      window.UI.setIcon(remove, 'check');
      remove.setAttribute('aria-label', 'Pulsa otra vez para confirmar el borrado');
      remove.title = 'Pulsa otra vez para borrar';
      armed = setTimeout(() => {
        armed = null;
        remove.classList.remove('is-armed');
        window.UI.setIcon(remove, 'trash');
        remove.setAttribute('aria-label', label);
        remove.title = 'Borrar';
      }, 3000);
    });
    return el('div', { class: `history-row${session.id === currentId ? ' is-current' : ''}`, role: 'listitem' }, [open, remove]);
  }

  function draw() {
    const query = normalize(search.value.trim());
    const visible = sessions.filter((session) => !query || normalize(session.title).includes(query));
    clearAll.disabled = sessions.length === 0;
    if (!visible.length) {
      listNode.replaceChildren(el('p', { class: 'empty-note', text: sessions.length ? 'Ninguna conversación coincide con la búsqueda.' : 'Aún no hay conversaciones guardadas.' }));
      return;
    }
    const nodes = [];
    let lastGroup = '';
    visible.forEach((session) => {
      const group = groupOf(session.updatedAt || session.createdAt);
      if (group !== lastGroup) { nodes.push(el('p', { class: 'history-group', text: group })); lastGroup = group; }
      nodes.push(row(session));
    });
    listNode.replaceChildren(...nodes);
  }

  function render(list = [], activeId = currentId) {
    sessions = (Array.isArray(list) ? list : []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    currentId = activeId || '';
    draw();
  }

  function open() { draw(); window.UI.openOverlay(view, { initialFocus: '#historySearch' }); }
  function close() { window.UI.closeOverlay(view); }
  function isOpen() { return !view.hidden; }

  function init(cbs = {}) {
    callbacks = cbs;
    if (cbs.modelName) modelName = cbs.modelName;
    search.addEventListener('input', draw);
    clearAll.addEventListener('click', () => callbacks.onClearAll?.());
  }

  return { init, render, open, close, isOpen };
})();
