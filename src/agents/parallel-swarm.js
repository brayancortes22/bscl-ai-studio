const { NeuralRouter } = require('../neural-router');
const { TaskPlanner } = require('./task-planner');
const { AGENTS } = require('./agent-registry');
const { SwarmWorkflows } = require('./swarm-workflows');

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
      this.emit(onProgress, id, 'failed', `${AGENTS[id].name}: ${error?.message || String(error)}`, model);
      throw error;
    }
  }

  async runSwarm({
    prompt, contextEnhancement = '', messages = [], model = 'smart-router', systemPrompt = '',
    workspaceContext = '', rootPath = null, mediaItems = [], webSearchEnabled = false, onTaskPlan, onProgress
  }) {
    this.emit(onProgress, 'router', 'working', 'Interpretando la solicitud y decidiendo qué equipo necesita.');
    let triage = NeuralRouter.classifyTask(prompt, mediaItems, { webSearchEnabled });
    let requiresWebSearch = Boolean(webSearchEnabled || triage.requiresWebSearch || NeuralRouter.requestsWebSearch(prompt));
    const trivial = NeuralRouter.isSmallTalk(prompt) || NeuralRouter.asksWorkspaceInventory(prompt);
    let plan = TaskPlanner.fallback(prompt, triage, requiresWebSearch);
    const actionable = !triage.bypassSwarm || requiresWebSearch || NeuralRouter.isLikelyActionRequest(prompt) ||
      TaskPlanner.isTaskContinuation(prompt, messages);
    const shouldInterpret = !trivial && (actionable || (!mediaItems.length && triage.bypassSwarm));

    if (shouldInterpret) {
      plan = await TaskPlanner.plan({
        client: this.client, prompt, triage, model, messages, requiresWebSearch,
        contextEnhancement: `${contextEnhancement}\n${workspaceContext.slice(0, 5000)}`
      });
      requiresWebSearch = requiresWebSearch || plan.requiresWebSearch || plan.intent === 'web_research';
      if (plan.intent === 'coding_implementation') {
        triage = { ...triage, intent: plan.intent, bypassSwarm: false,
          recommendedModel: triage.needsCoderAgent ? triage.recommendedModel : AGENTS.coder.model,
          needsCoderAgent: true, needsQaAgent: true };
      } else if (plan.intent === 'architecture_design') {
        triage = { ...triage, intent: plan.intent, bypassSwarm: false,
          recommendedModel: triage.intent === 'architecture_design' ? triage.recommendedModel : AGENTS.architect.model,
          needsArchitectAgent: true };
      } else if (plan.intent === 'code_review') {
        triage = { ...triage, intent: plan.intent, bypassSwarm: false,
          recommendedModel: triage.intent === 'code_review' ? triage.recommendedModel : AGENTS.qa.model,
          needsQaAgent: true };
      } else if (plan.intent === 'web_research') {
        triage = { ...triage, intent: plan.intent, bypassSwarm: false, needsResearcherAgent: true, requiresWebSearch: true };
      } else if (plan.intent === 'answer' && triage.bypassSwarm) {
        triage = { ...triage, intent: 'general_reasoning', bypassSwarm: true };
      }
    }

    if (requiresWebSearch) {
      triage.requiresWebSearch = true;
      if (triage.bypassSwarm) triage = { ...triage, intent: 'web_research', bypassSwarm: false, needsResearcherAgent: true };
      plan = { ...plan, requiresWebSearch: true,
        agents: [...TaskPlanner.getAgentNames(triage.intent, true, triage.needsVisionAgent),
          ...(plan.subtasks?.length ? [`Subagentes (${plan.subtasks.length})`] : [])] };
    }

    this.emit(onProgress, 'router', 'completed', `Intención detectada: ${triage.intent}. Equipo: ${plan.subtasks?.length || 0} subagentes.`);
    const taskPrompt = `${prompt || ''}${contextEnhancement}`.trim();
    if (!triage.bypassSwarm) onTaskPlan?.({ ...plan, intent: triage.intent });

    if (triage.bypassSwarm && !requiresWebSearch) {
      onProgress?.({ agentId: 'router', agent: 'Chat directo', state: 'completed',
        status: 'Esta solicitud puede responderse directamente.', route: 'direct' });
      const selectedModel = triage.recommendedModel === 'smart-router' ? model : triage.recommendedModel;
      const response = await this.client.sendMessage({ model: selectedModel,
        messages: messages.length ? messages : [{ role: 'user', content: prompt }], systemPrompt });
      return { ...response, provider: response.provider || 'BSCL AI · respuesta directa' };
    }

    const workflow = { swarm: this, taskPrompt, triage, requiresWebSearch, plan, workspaceContext, rootPath, mediaItems, onProgress, selectedModel: model };
    if (triage.intent === 'web_research') return SwarmWorkflows.research(workflow);
    if (triage.intent === 'architecture_design') return SwarmWorkflows.architecture(workflow);
    if (triage.intent === 'code_review') return SwarmWorkflows.codeReview(workflow);
    return SwarmWorkflows.implementation(workflow);
  }
}

module.exports = { ParallelSwarm };
