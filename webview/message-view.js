/**
 * Hilo de la conversación: mensajes del usuario, respuestas, progreso de los agentes,
 * errores y archivos cambiados.
 *
 * Decisión de diseño: el progreso de los agentes vive DENTRO de la respuesta en curso
 * (una tarjeta plegable), no en una tarjeta fija sobre el chat. La versión anterior
 * fijaba el enjambre arriba y tapaba la mitad del hilo; ahora se pliega sola al
 * terminar y queda como registro de lo que hizo cada agente.
 */
window.MessageView = (function () {
  'use strict';
  const { el, icon, formatTime } = window.UI;

  const AGENT_LABELS = {
    researcher: 'Investigador', architect: 'Arquitecto', coder: 'Programador', critic: 'Crítico visual', qa: 'Auditor QA'
  };
  const STATE_ICON = { queued: 'circle', working: 'spinner', completed: 'check', failed: 'error', skipped: 'skip' };
  const STATE_LABEL = { queued: 'En espera', working: 'Trabajando', completed: 'Listo', failed: 'Falló', skipped: 'Omitido' };
  const CHANGE_KIND = { creado: 'A', created: 'A', editado: 'M', modificado: 'M', modified: 'M', borrado: 'D', eliminado: 'D', deleted: 'D', renombrado: 'R', renamed: 'R' };
  const CHANGE_LABEL = { A: 'Creado', M: 'Modificado', D: 'Borrado', R: 'Renombrado' };

  let container = null;
  let list = null;
  let post = () => {};
  let pending = null;
  const rawContent = new WeakMap();

  function init({ chatContainer, messagesList, postMessage }) {
    container = chatContainer;
    list = messagesList;
    post = postMessage;
  }

  // ---------- Scroll: seguir el final solo si el usuario ya estaba abajo ----------

  function nearBottom() {
    return container.scrollHeight - container.scrollTop - container.clientHeight < 96;
  }
  function scrollToBottom() { container.scrollTop = container.scrollHeight; }
  function keepPinned(update) {
    const pinned = nearBottom();
    const result = update();
    if (pinned) scrollToBottom();
    return result;
  }

  // ---------- Mensajes ----------

  function attachmentChip(item) {
    const kind = item.category === 'image' ? 'image' : 'file';
    return el('span', { class: 'chip', title: item.name || '' }, [icon(kind), el('span', { text: item.name || 'Adjunto' })]);
  }

  function appendUser(text, attachments = []) {
    return keepPinned(() => {
      const row = el('div', { class: 'msg msg-user' }, [
        el('div', { class: 'msg-bubble', text: text || '' })
      ]);
      if (!text) row.firstChild.hidden = true;
      if (attachments.length) row.append(el('div', { class: 'msg-attachments' }, attachments.map(attachmentChip)));
      list.append(row);
      scrollToBottom();
      return row;
    });
  }

  function setUserText(row, text) {
    const bubble = row?.querySelector('.msg-bubble');
    if (!bubble) return;
    bubble.textContent = text;
    bubble.hidden = !text;
  }

  function assistantShell(provider, timestamp) {
    const copyButton = el('button', { type: 'button', class: 'icon-btn', title: 'Copiar respuesta', 'aria-label': 'Copiar respuesta' }, [icon('copy')]);
    const actions = el('span', { class: 'msg-actions' }, [copyButton]);
    const header = el('div', { class: 'msg-header' }, [
      el('span', { class: 'msg-avatar', 'aria-hidden': 'true' }, [icon('logo')]),
      el('span', { class: 'msg-author', text: 'BSCL AI' }),
      el('span', { class: 'msg-provider', text: provider ? `· ${provider}` : '' }),
      el('span', { class: 'msg-time', text: formatTime(timestamp) }),
      actions
    ]);
    const body = el('div', { class: 'msg-body' });
    const row = el('article', { class: 'msg msg-assistant', 'aria-label': 'Respuesta de BSCL AI' }, [header, body]);
    copyButton.addEventListener('click', () => copyResponse(row, copyButton));
    return { row, header, body };
  }

  async function copyResponse(row, button) {
    const text = rawContent.get(row) || row.querySelector('.msg-body')?.innerText || '';
    try { await navigator.clipboard.writeText(text); }
    catch { post({ type: 'copyToClipboard', payload: { text } }); }
    window.UI.setIcon(button, 'check');
    setTimeout(() => window.UI.setIcon(button, 'copy'), 1200);
  }

  function renderBody(body, content) {
    body.innerHTML = window.renderMarkdownToHtml ? window.renderMarkdownToHtml(content || '') : '';
    if (!window.renderMarkdownToHtml) body.textContent = content || '';
  }

  function setProvider(shell, provider) {
    const node = shell.header.querySelector('.msg-provider');
    if (node) node.textContent = provider ? `· ${provider}` : '';
  }

  function changesCard(files, undoId) {
    const items = files.map((file) => {
      const kind = CHANGE_KIND[String(file.action || '').toLowerCase()] || 'M';
      const target = String(file.path || '').split(' → ').pop();
      const pathNode = kind === 'D'
        ? el('span', { class: 'change-path', title: file.path, text: file.path })
        : el('button', { type: 'button', class: 'change-path', title: `Abrir ${target}`, 'data-open-file': target, text: file.path });
      return el('li', {}, [el('span', { class: 'change-badge', 'data-kind': kind, title: CHANGE_LABEL[kind], text: kind }), pathNode]);
    });
    const header = el('div', { class: 'changes-header' }, [
      el('span', { text: files.length === 1 ? '1 archivo cambiado' : `${files.length} archivos cambiados` })
    ]);
    if (undoId) {
      const undo = el('button', { type: 'button', class: 'text-btn undo-change-btn', 'data-undo-id': undoId, title: 'Restaurar los archivos tal como estaban antes de esta respuesta' }, [
        icon('undo', 'icon-sm'), el('span', { text: ' Revertir' })
      ]);
      undo.addEventListener('click', () => {
        undo.disabled = true;
        undo.lastChild.textContent = ' Revirtiendo…';
        post({ type: 'undoChanges', payload: { undoId } });
      });
      header.append(undo);
    }
    return el('section', { class: 'changes-card', 'aria-label': 'Archivos cambiados' }, [header, el('ul', { class: 'changes-list' }, items)]);
  }

  /** action opcional: { label, onClick } dibuja un botón dentro del aviso (p. ej. «Abrir ajustes»). */
  function callout(message, kind = 'error', action = null) {
    const iconName = kind === 'warning' ? 'warning' : kind === 'info' ? 'info' : 'error';
    const button = action ? el('button', { type: 'button', class: 'btn secondary callout-action', onclick: action.onClick }, [action.label]) : null;
    return el('div', { class: `callout ${kind === 'error' ? '' : kind}`.trim(), role: kind === 'error' ? 'alert' : 'status' }, [
      icon(iconName), el('span', { class: 'callout-text' }, [el('span', { text: message }), button])
    ]);
  }

  function appendAssistant(content, provider, { files = [], undoId = '', warning = '', timestamp } = {}) {
    return keepPinned(() => {
      const shell = assistantShell(provider, timestamp);
      renderBody(shell.body, content);
      rawContent.set(shell.row, content || '');
      if (warning) shell.row.append(callout(warning, 'warning'));
      if (files.length) shell.row.append(changesCard(files, undoId));
      list.append(shell.row);
      return shell.row;
    });
  }

  function appendNotice(message, kind = 'error', action = null) {
    return keepPinned(() => {
      const row = el('div', { class: 'msg msg-notice' }, [callout(message, kind, action)]);
      list.append(row);
      return row;
    });
  }

  // ---------- Respuesta en curso ----------

  function beginPending() {
    finishDangling();
    return keepPinned(() => {
      const shell = assistantShell('', Date.now());
      const status = el('div', { class: 'msg-status', role: 'status', 'data-state': 'working' }, [
        el('span', { class: 'state-icon' }, [icon('spinner', 'spin')]),
        el('span', { class: 'msg-status-text', text: 'Pensando…' })
      ]);
      shell.body.append(status);
      list.append(shell.row);
      pending = { ...shell, status, runCard: null, agents: new Map(), subagents: new Map(), startedAt: Date.now() };
      scrollToBottom();
      return shell.row;
    });
  }

  function setStatus(text) {
    if (!pending) return;
    const node = pending.status?.querySelector('.msg-status-text');
    if (node && text) node.textContent = text;
  }

  function ensureRunCard() {
    if (!pending) return null;
    if (pending.runCard) return pending.runCard;
    const summaryIcon = el('span', { class: 'state-icon', 'data-run-icon': '' }, [icon('spinner', 'spin')]);
    const summary = el('summary', { 'data-state': 'working' }, [
      icon('chevron-right', 'chevron icon-sm'),
      summaryIcon,
      el('span', { class: 'run-title', text: 'Plan de trabajo' }),
      el('span', { class: 'run-count' })
    ]);
    const body = el('div', { class: 'run-body' }, [
      el('p', { class: 'run-goal', hidden: true }),
      el('ol', { class: 'run-steps', hidden: true }),
      el('p', { class: 'run-label', text: 'Agentes', hidden: true }),
      el('ul', { class: 'agent-list', 'data-list': 'agents' }),
      el('p', { class: 'run-label', text: 'Subtareas', hidden: true }),
      el('ul', { class: 'agent-list', 'data-list': 'subagents' })
    ]);
    const card = el('details', { class: 'run-card', open: true, 'data-state': 'working' }, [summary, body]);
    pending.row.insertBefore(card, pending.body);
    pending.runCard = card;
    return card;
  }

  function agentRow(label) {
    const row = el('li', { class: 'agent-row', 'data-state': 'queued' }, [
      el('span', { class: 'state-icon' }, [icon('circle')]),
      el('span', { class: 'agent-name', text: label }),
      el('span', { class: 'agent-model' }),
      el('span', { class: 'agent-status' })
    ]);
    return row;
  }

  function applyState(row, { state, status, model }) {
    const safe = STATE_ICON[state] ? state : 'queued';
    row.dataset.state = safe;
    const stateIcon = row.querySelector('.state-icon');
    stateIcon.replaceChildren(icon(STATE_ICON[safe], safe === 'working' ? 'spin' : ''));
    stateIcon.title = STATE_LABEL[safe];
    if (model) row.querySelector('.agent-model').textContent = model;
    row.querySelector('.agent-status').textContent = status || (safe === 'queued' ? '' : STATE_LABEL[safe]);
  }

  function updateCount() {
    if (!pending?.runCard) return;
    const rows = [...pending.agents.values(), ...pending.subagents.values()].filter((row) => row.dataset.state !== 'skipped');
    const done = rows.filter((row) => ['completed', 'failed'].includes(row.dataset.state)).length;
    pending.runCard.querySelector('.run-count').textContent = rows.length ? `${done}/${rows.length}` : '';
    const labels = pending.runCard.querySelectorAll('.run-label');
    labels[0].hidden = pending.agents.size === 0;
    labels[1].hidden = pending.subagents.size === 0;
  }

  function showTaskPlan(plan = {}) {
    if (!pending) beginPending();
    const card = ensureRunCard();
    if (!card) return;
    keepPinned(() => {
      card.querySelector('.run-title').textContent = plan.title || 'Plan de trabajo';
      const goal = card.querySelector('.run-goal');
      goal.textContent = plan.goal || '';
      goal.hidden = !plan.goal;
      const steps = card.querySelector('.run-steps');
      const stepItems = (Array.isArray(plan.steps) ? plan.steps : []).slice(0, 6).map((step) => el('li', { text: String(step || '') }));
      steps.replaceChildren(...stepItems);
      steps.hidden = stepItems.length === 0;
      const subList = card.querySelector('[data-list="subagents"]');
      subList.replaceChildren();
      pending.subagents.clear();
      (Array.isArray(plan.subtasks) ? plan.subtasks : []).forEach((task, index) => {
        const row = agentRow(`${index + 1}. ${task?.title || 'Subtarea'}`);
        pending.subagents.set(`subagent-${index + 1}`, row);
        subList.append(row);
      });
      updateCount();
    });
  }

  function updateProgress(payload = {}) {
    if (payload.route === 'direct') return;
    if (!payload.agentId || payload.agentId === 'router') {
      if (payload.status) setStatus(payload.status);
      return;
    }
    if (!pending) beginPending();
    const card = ensureRunCard();
    keepPinned(() => {
      if (payload.agentId.startsWith('subagent-')) {
        let row = pending.subagents.get(payload.agentId);
        if (!row) {
          row = agentRow(payload.agent || payload.agentId);
          pending.subagents.set(payload.agentId, row);
          card.querySelector('[data-list="subagents"]').append(row);
        }
        if (payload.agent) row.querySelector('.agent-name').textContent = payload.agent;
        applyState(row, payload);
      } else {
        let row = pending.agents.get(payload.agentId);
        // Un agente omitido que nunca llegó a aparecer no aporta nada: no se dibuja.
        if (!row && payload.state === 'skipped') return;
        if (!row) {
          row = agentRow(AGENT_LABELS[payload.agentId] || payload.agent || payload.agentId);
          pending.agents.set(payload.agentId, row);
          card.querySelector('[data-list="agents"]').append(row);
        }
        applyState(row, payload);
      }
      if (payload.state === 'working' && payload.status) setStatus(payload.status);
      updateCount();
    });
  }

  function closeRunCard(finalState) {
    const card = pending?.runCard;
    if (!card) return;
    card.dataset.state = finalState;
    card.open = false;
    const iconName = finalState === 'failed' ? 'error' : finalState === 'cancelled' ? 'skip' : 'check';
    card.querySelector('[data-run-icon]').replaceChildren(icon(iconName));
    card.querySelector('summary').dataset.state = finalState === 'cancelled' ? 'skipped' : finalState;
    // Lo que seguía "trabajando" ya no lo está: se marca para no dejar spinners eternos.
    [...pending.agents.values(), ...pending.subagents.values()].forEach((row) => {
      if (row.dataset.state === 'working' || row.dataset.state === 'queued') {
        applyState(row, { state: finalState === 'completed' ? 'skipped' : finalState === 'cancelled' ? 'skipped' : 'failed', status: finalState === 'cancelled' ? 'Detenido' : '' });
      }
    });
    updateCount();
  }

  function finishPending({ content, provider, files = [], undoId = '', warning = '' } = {}) {
    if (!pending) return appendAssistant(content, provider, { files, undoId, warning });
    return keepPinned(() => {
      const current = pending;
      closeRunCard('completed');
      current.status.remove();
      setProvider(current, provider);
      renderBody(current.body, content);
      rawContent.set(current.row, content || '');
      if (warning) current.row.append(callout(warning, 'warning'));
      if (files.length) current.row.append(changesCard(files, undoId));
      pending = null;
      return current.row;
    });
  }

  function failPending(message, kind = 'error', action = null) {
    if (!pending) return appendNotice(message, kind, action);
    return keepPinned(() => {
      const current = pending;
      closeRunCard('failed');
      current.status.remove();
      current.body.append(callout(message, kind, action));
      pending = null;
      return current.row;
    });
  }

  function cancelPending(message = 'Detenido. Puedes reformular la petición o enviarla de nuevo.') {
    if (!pending) return null;
    return keepPinned(() => {
      const current = pending;
      closeRunCard('cancelled');
      current.status.remove();
      current.body.append(callout(message, 'info'));
      pending = null;
      return current.row;
    });
  }

  // Si quedó una respuesta a medias (p. ej. se restauró otra sesión), no se deja girando.
  function finishDangling() {
    if (pending) cancelPending('Respuesta interrumpida.');
  }

  function hasPending() { return Boolean(pending); }

  function markUndoUsed(undoId, success = true) {
    if (!undoId) return;
    list.querySelectorAll('.undo-change-btn').forEach((button) => {
      if (button.dataset.undoId !== undoId) return;
      button.disabled = success;
      button.lastChild.textContent = success ? ' Revertido' : ' Reintentar';
      window.UI.setIcon(button, success ? 'check' : 'undo');
    });
  }

  function clear() {
    pending = null;
    list.replaceChildren();
  }

  return {
    init, appendUser, setUserText, appendAssistant, appendNotice,
    beginPending, setStatus, showTaskPlan, updateProgress, finishPending, failPending, cancelPending, hasPending,
    markUndoUsed, clear, scrollToBottom
  };
})();
