// Punto de entrada público del enjambre: view-provider depende de `AgentSwarm` desde este
// módulo. La implementación vive en agents/parallel-swarm.js junto al resto de agentes.
const { ParallelSwarm } = require('./agents/parallel-swarm');

module.exports = { AgentSwarm: ParallelSwarm, ParallelSwarm };
