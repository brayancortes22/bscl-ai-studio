const { NeuralRouter } = require('../neural-router');
const { TaskPlanner } = require('./task-planner');
const { AGENTS, isAbortError } = require('./agent-registry');
const { SwarmWorkflows } = require('./swarm-workflows');

/**
 * Envuelve onProgress para recordar qué agentes siguen en 'working'. Si el enjambre termina,
 * falla o se cancela, cierra los que quedaron abiertos: antes el Programador podía quedarse
 * en "Trabajando" con la respuesta ya entregada.
 */
function createProgressTracker(onProgress) {
  const working = new Map();
  const emit = (payload) => {
    if (!payload?.agentId) return;
    if (payload.state === 'working') working.set(payload.agentId, payload);
    else working.delete(payload.agentId);
    onProgress?.(payload);
  };
  const closeAll = (state, status) => {
    for (const [agentId, last] of [...working.entries()]) {
      emit({ agentId, agent: last.agent, state, status, model: last.model });
    }
  };
  return { emit, closeAll };
}

class ParallelSwarm {
  constructor(aiClient) {
    this.client = aiClient;
  }

  emit(onProgress, id, state, action, model = AGENTS[id]?.model) {
    onProgress?.({ agentId: id, agent: AGENTS[id]?.name || 'Router neuronal', state, status: action, model });
  }

  skipUnneededAgents(onProgress, reason, ids = ['researcher', 'architect', 'coder', 'critic', 'qa']) {
    ids.forEach((id) => this.emit(onProgress, id, 'skipped', reason));
  }

  async runAgent(onProgress, id, action, model, task) {
    this.emit(onProgress, id, 'working', action, model);
    try {
      const result = await task();
      this.emit(onProgress, id, 'completed', `${AGENTS[id].name}: terminado.`, model);
      return result;
    } catch (error) {
      // Una cancelación no es un fallo del agente: se marca como omitido y se propaga.
      if (isAbortError(error)) this.emit(onProgress, id, 'skipped', 'Cancelado.', model);
      else this.emit(onProgress, id, 'failed', `${AGENTS[id].name}: ${error?.message || String(error)}`, model);
      throw error;
    }
  }

  // El intent del planificador decide el flujo; el del regex solo es el punto de partida.
  static applyPlanIntent(triage, planIntent) {
    if (planIntent === 'coding_implementation') {
      return { ...triage, intent: 'coding_implementation', bypassSwarm: false, needsCoderAgent: true, needsQaAgent: true };
    }
    if (planIntent === 'architecture_design') return { ...triage, intent: planIntent, bypassSwarm: false, needsArchitectAgent: true };
    if (planIntent === 'code_review') return { ...triage, intent: planIntent, bypassSwarm: false, needsQaAgent: true };
    if (planIntent === 'web_research') {
      return { ...triage, intent: planIntent, bypassSwarm: false, needsResearcherAgent: true, requiresWebSearch: true };
    }
    // 'answer' o 'visual_analysis' (respuesta sobre una imagen): si el regex ya iba a respuesta
    // directa se mantiene (también 'conversation', que el host recibe como intent); si iba al
    // enjambre, el regex manda (pedía cambios o una revisión).
    if (triage.bypassSwarm) {
      return { ...triage, intent: ['visual_analysis', 'conversation'].includes(triage.intent) ? triage.intent : 'general_reasoning' };
    }
    return triage;
  }

  static flowFor(triage) {
    if (triage.bypassSwarm) return 'direct';
    if (['web_research', 'architecture_design', 'code_review'].includes(triage.intent)) return triage.intent;
    return 'coding_implementation';
  }

  async runSwarm(options) {
    const tracker = createProgressTracker(options.onProgress);
    try {
      const result = await this.orchestrate({ ...options, onProgress: tracker.emit });
      tracker.closeAll('completed', 'Terminado.');
      return result;
    } catch (error) {
      if (isAbortError(error)) tracker.closeAll('skipped', 'Cancelado.');
      else tracker.closeAll('failed', `Interrumpido: ${error?.message || String(error)}`);
      throw error;
    }
  }

  async orchestrate({
    prompt, contextEnhancement = '', messages = [], model = 'smart-router', systemPrompt = '',
    workspaceContext = '', rootPath = null, mediaItems = [], webSearchEnabled = false, onTaskPlan, onProgress
  }) {
    this.emit(onProgress, 'router', 'working', 'Interpretando la solicitud y decidiendo qué equipo necesita.');
    let triage = NeuralRouter.classifyTask(prompt, mediaItems, { webSearchEnabled });
    let requiresWebSearch = Boolean(webSearchEnabled || triage.requiresWebSearch || NeuralRouter.requestsWebSearch(prompt));
    const continuation = TaskPlanner.isTaskContinuation(prompt, messages);
    // "ok" o "de acuerdo" son charla trivial salvo que respondan a una propuesta del asistente
    // (isTaskContinuation los acepta solo en ese caso).
    const trivial = !continuation && (NeuralRouter.isSmallTalk(prompt) || NeuralRouter.asksWorkspaceInventory(prompt));
    let plan = TaskPlanner.fallback(prompt, triage, requiresWebSearch, messages);
    const actionable = !triage.bypassSwarm || requiresWebSearch || NeuralRouter.isLikelyActionRequest(prompt) || continuation;
    const shouldInterpret = !trivial && (actionable || (!mediaItems.length && triage.bypassSwarm));

    if (shouldInterpret) {
      plan = await TaskPlanner.plan({
        client: this.client, prompt, triage, model, messages, requiresWebSearch,
        contextEnhancement: `${contextEnhancement}\n${workspaceContext.slice(0, 5000)}`
      });
      requiresWebSearch = requiresWebSearch || plan.requiresWebSearch || plan.intent === 'web_research';
    }
    // También sin planificador: el fallback ya convierte "hazlo" tras una propuesta de código.
    triage = ParallelSwarm.applyPlanIntent(triage, plan.intent);

    if (requiresWebSearch) {
      triage = { ...triage, requiresWebSearch: true };
      if (triage.bypassSwarm) triage = { ...triage, intent: 'web_research', bypassSwarm: false, needsResearcherAgent: true };
    }
    const flow = ParallelSwarm.flowFor(triage);

    // El plan que ve la persona debe coincidir con lo que se ejecuta: el flujo de arquitectura no
    // lanza subagentes y los demás usan exactamente estas subtareas.
    const subtasks = flow === 'direct' || flow === 'architecture_design'
      ? []
      : TaskPlanner.normalizeSubtasks(plan.subtasks || [], flow);
    const steps = plan.intent === flow ? plan.steps : TaskPlanner.fallback(prompt, { ...triage, intent: flow }, requiresWebSearch).steps;
    plan = {
      ...plan,
      intent: flow,
      steps,
      requiresWebSearch,
      subtasks,
      agents: [...TaskPlanner.getAgentNames(flow, requiresWebSearch, triage.needsVisionAgent),
        ...(subtasks.length ? [`Subagentes (${subtasks.length})`] : [])]
    };

    this.emit(onProgress, 'router', 'completed', `Intención detectada: ${flow}. Equipo: ${subtasks.length} subagentes.`);

    if (flow === 'direct') {
      onProgress?.({ agentId: 'router', agent: 'Chat directo', state: 'completed',
        status: 'Esta solicitud puede responderse directamente.', route: 'direct' });
      const response = await this.client.sendMessage({ model,
        messages: messages.length ? messages : [{ role: 'user', content: prompt }], systemPrompt });
      // El contrato con el host fija { content, provider, intent }: sin intent, el host no puede
      // distinguir una respuesta directa de una entrega del enjambre.
      return { ...response, intent: triage.intent, provider: response.provider || 'BSCL AI · respuesta directa' };
    }

    onTaskPlan?.(plan);
    // La petición de la persona va sola como requerimiento. El contexto del editor (que puede
    // traer comentarios de un repo ajeno) viaja aparte, etiquetado como datos.
    const taskPrompt = continuation
      ? `${String(prompt || '').trim()}\n\nCONVERSACIÓN PREVIA (la petición continúa esta propuesta):\n${TaskPlanner.historyForPrompt(messages.slice(0, -1).slice(-4))}`
      : String(prompt || '').trim();
    const workflow = {
      swarm: this, taskPrompt, editorContext: String(contextEnhancement || '').trim(), triage, requiresWebSearch, plan,
      workspaceContext, rootPath, mediaItems, onProgress, selectedModel: model
    };
    if (flow === 'web_research') return SwarmWorkflows.research(workflow);
    if (flow === 'architecture_design') return SwarmWorkflows.architecture(workflow);
    if (flow === 'code_review') return SwarmWorkflows.codeReview(workflow);
    return SwarmWorkflows.implementation(workflow);
  }
}

module.exports = { ParallelSwarm };
