// Compatibilidad con el nombre anterior del orquestador.
const { ParallelSwarm } = require('./agents/parallel-swarm');

module.exports = { AgentSwarm: ParallelSwarm, ParallelSwarm };
