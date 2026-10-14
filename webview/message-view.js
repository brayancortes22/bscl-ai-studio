(function () {
  let chatContainer, messagesList, swarmTimeline, swarmStepBadge, swarmStepText, loadingIndicator, postMessage;
  const subagentRows = new Map();

  function init(options) {
    ({ chatContainer, messagesList, swarmTimeline, swarmStepBadge, swarmStepText, loadingIndicator, postMessage } = options);
  }

  function appendUser(text) {
    const row = document.createElement('div');
    row.className = 'msg-wrapper user-row';
    const bubble = document.createElement('div');
    bubble.className = 'user-bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesList.appendChild(row);
    scrollToBottom();
    return row;
  }

  function appendAssistant(content, providerName, changeSet = {}) {
    const row = document.createElement('div');
    row.className = 'msg-wrapper ai-row';
    const meta = document.createElement('div');
    meta.className = 'ai-meta-bar';
    const avatar = document.createElement('div');
    avatar.className = 'ai-avatar';
    avatar.textContent = '✦';
    const name = document.createElement('span');
    name.className = 'ai-name';
    name.textContent = providerName || 'BSCL AI';
    const time = document.createElement('span');
    time.className = 'ai-time';
    time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const card = document.createElement('div');
    card.className = 'ai-card';
    card.innerHTML = window.renderMarkdownToHtml ? window.renderMarkdownToHtml(content) : escapeHtml(content);
    meta.append(avatar, name, time);
    row.append(meta, card);
    const changes = Array.isArray(changeSet.files) ? changeSet.files : [];
    if (changes.length) {
      const fileCard = document.createElement('section');
      fileCard.className = 'changed-files-card';
      const heading = document.createElement('strong');
      heading.textContent = `Archivos cambiados (${changes.length})`;
      const list = document.createElement('ul');
      changes.forEach((file) => {
        const item = document.createElement('li');
        const action = document.createElement('span');
        action.className = 'changed-file-action';
        action.textContent = `${file.action}: `;
        const pathLabel = document.createElement('code');
        pathLabel.textContent = file.path;
        item.append(action, pathLabel);
        list.appendChild(item);
      });
      fileCard.append(heading, list);
      if (changeSet.undoId) {
        const undo = document.createElement('button');
        undo.type = 'button';
        undo.className = 'undo-change-btn';
        undo.dataset.undoId = changeSet.undoId;
        undo.textContent = '↶ Revertir esta entrega';
        undo.onclick = () => {
          undo.disabled = true;
          undo.textContent = 'Revirtiendo…';
          postMessage({ type: 'undoChanges', payload: { undoId: changeSet.undoId } });
        };
        fileCard.appendChild(undo);
      }
      row.appendChild(fileCard);
    }
    messagesList.appendChild(row);
    attachCodeEvents(row);
    scrollToBottom();
  }

  function markUndoUsed(undoId, success = true) {
    if (!undoId) return;
    messagesList.querySelectorAll('.undo-change-btn').forEach((button) => {
      if (button.dataset.undoId === undoId) {
        button.disabled = success;
        button.textContent = success ? '✓ Entrega revertida' : '↶ Reintentar reversión';
      }
    });
  }

  function appendError(message) {
    const row = document.createElement('div');
    row.className = 'msg-wrapper ai-row';
    const card = document.createElement('div');
    card.className = 'ai-card error-card';
    card.textContent = `⚠️ Error: ${message}`;
    row.appendChild(card);
    messagesList.appendChild(row);
    scrollToBottom();
  }

  function updateProgress(payload) {
    if (payload.route === 'direct') {
      swarmTimeline.classList.add('hidden');
      return;
    }
    swarmTimeline.classList.remove('hidden');
    if (payload.agent) swarmStepBadge.textContent = payload.agent;
    swarmStepText.textContent = payload.status;
    if (payload.agentId?.startsWith('subagent-')) updateSubagent(payload);
    else window.SwarmGraph?.update(payload);
    scrollToBottom();
  }

  function showTaskPlan(plan = {}) {
    swarmTimeline.classList.remove('hidden');
    window.SwarmGraph?.begin();
    const card = document.getElementById('taskPlanCard');
    const title = document.getElementById('taskPlanTitle');
    const goal = document.getElementById('taskPlanGoal');
    const steps = document.getElementById('taskPlanSteps');
    const agents = document.getElementById('taskPlanAgents');
    if (!card || !title || !goal || !steps || !agents) return;
    title.textContent = plan.title || 'Solicitud interpretada';
    goal.textContent = plan.goal || '';
    steps.replaceChildren();
    (Array.isArray(plan.steps) ? plan.steps : []).slice(0, 5).forEach((step) => {
      const item = document.createElement('li');
      item.textContent = String(step || '');
      steps.appendChild(item);
    });
    agents.replaceChildren();
    (Array.isArray(plan.agents) ? plan.agents : []).forEach((agent) => {
      const chip = document.createElement('span');
      chip.className = 'task-agent-chip';
      chip.textContent = String(agent || '');
      agents.appendChild(chip);
    });
    renderSubagents(Array.isArray(plan.subtasks) ? plan.subtasks : []);
    card.classList.remove('hidden');
    scrollToBottom();
  }

  function resetTaskPlan() {
    document.getElementById('taskPlanCard')?.classList.add('hidden');
    subagentRows.clear();
    document.getElementById('subagentActivityList')?.replaceChildren();
    document.getElementById('subagentActivity')?.classList.add('hidden');
    updateSubagentCount();
  }

  function renderSubagents(tasks) {
    const section = document.getElementById('subagentActivity');
    const list = document.getElementById('subagentActivityList');
    if (!section || !list) return;
    subagentRows.clear();
    list.replaceChildren();
    tasks.forEach((task, index) => {
      const id = `subagent-${index + 1}`;
      const row = document.createElement('div');
      row.className = 'subagent-row';
      row.dataset.state = 'queued';
      const title = document.createElement('span');
      title.className = 'subagent-row-title';
      title.textContent = `${index + 1}. ${task.title || 'Subtarea'}`;
      const state = document.createElement('span');
      state.className = 'subagent-row-state';
      state.textContent = 'En espera';
      row.append(title, state);
      list.appendChild(row);
      subagentRows.set(id, { row, title, state });
    });
    section.classList.toggle('hidden', tasks.length === 0);
    updateSubagentCount();
  }

  function updateSubagent(payload) {
    const entry = subagentRows.get(payload.agentId);
    if (!entry) return;
    entry.row.dataset.state = payload.state || 'queued';
    entry.title.textContent = payload.agent || entry.title.textContent;
    entry.state.textContent = payload.status || payload.state || 'En espera';
    updateSubagentCount();
  }

  function updateSubagentCount() {
    const counter = document.getElementById('subagentCount');
    if (!counter) return;
    const completed = [...subagentRows.values()].filter(({ row }) => ['completed', 'failed'].includes(row.dataset.state)).length;
    counter.textContent = `${completed} / ${subagentRows.size}`;
  }

  function attachCodeEvents(container) {
    container.querySelectorAll('.code-btn-insert').forEach((button) => {
      button.onclick = () => postMessage({ type: 'insertCode', payload: { code: decodeURIComponent(button.dataset.code) } });
    });
    container.querySelectorAll('.code-btn-copy').forEach((button) => {
      button.onclick = () => {
        navigator.clipboard.writeText(decodeURIComponent(button.dataset.code));
        button.textContent = '¡Copiado!';
        setTimeout(() => { button.textContent = 'Copy'; }, 1200);
      };
    });
    window.DiffActions?.attach(container);
  }

  function toggleLoading(loading) {
    loadingIndicator.classList.toggle('hidden', !loading);
    if (loading) scrollToBottom();
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  window.MessageView = { init, appendUser, appendAssistant, appendError, updateProgress, showTaskPlan, resetTaskPlan, toggleLoading, markUndoUsed };
})();
