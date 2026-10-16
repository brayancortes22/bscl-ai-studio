// `model` es solo el modelo que se muestra por defecto en el progreso: cada agente recibe el
// modelo elegido por la persona. El roleHint lo fija cada agente al llamar al cliente.
const AGENTS = {
  researcher: { name: 'Investigador web', model: 'smart-router' },
  architect: { name: 'Arquitecto', model: 'smart-router' },
  coder: { name: 'Programador', model: 'smart-router' },
  critic: { name: 'Crítico multimodal', model: 'smart-router' },
  qa: { name: 'Auditor QA', model: 'smart-router' }
};

// La cancelación del usuario llega como AbortError desde fetch. Hay que propagarla tal cual:
// si se trata como un fallo más, el enjambre sigue con la revisión y gasta cuota sin nadie esperando.
function isAbortError(error) {
  return error?.name === 'AbortError';
}

module.exports = { AGENTS, isAbortError };
