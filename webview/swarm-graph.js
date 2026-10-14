(function () {
  const stateLabels = {
    queued: 'En espera', working: 'Trabajando', completed: 'Completado',
    failed: 'Falló', skipped: 'Omitido', idle: 'En espera'
  };

  function update({ agentId, state, status, model }) {
    if (!agentId || agentId === 'router') return;
    const node = document.querySelector(`[data-agent-id="${agentId}"]`);
    if (!node) return;
    const safeState = stateLabels[state] ? state : 'queued';
    node.dataset.state = safeState;
    node.dataset.action = status || '';
    node.querySelector('.swarm-node-state').textContent = stateLabels[safeState];
    if (model) node.querySelector('.swarm-node-model').textContent = model;
    node.setAttribute('aria-label', `${node.querySelector('.swarm-node-heading').textContent}: ${stateLabels[safeState]}`);
    const detail = document.getElementById('swarmAgentDetails');
    detail.textContent = `${node.querySelector('.swarm-node-heading').textContent}: ${status || stateLabels[safeState]}${model ? ` · ${model}` : ''}`;
  }

  function begin() {
    document.querySelectorAll('.swarm-node').forEach((node) => {
      node.dataset.state = 'queued';
      node.dataset.action = 'En espera de su turno.';
      node.querySelector('.swarm-node-state').textContent = stateLabels.queued;
      node.querySelector('.swarm-node-model').textContent = 'Modelo pendiente';
    });
    document.getElementById('swarmAgentDetails').textContent = 'El enjambre inició. Selecciona un agente para ver su estado.';
  }

  document.querySelectorAll('.swarm-node').forEach((node) => {
    node.addEventListener('click', () => {
      const model = node.querySelector('.swarm-node-model').textContent;
      const detail = document.getElementById('swarmAgentDetails');
      detail.textContent = `${node.querySelector('.swarm-node-heading').textContent}: ${node.dataset.action || 'En espera.'} · ${model}`;
    });
  });

  window.SwarmGraph = { begin, update };
})();
