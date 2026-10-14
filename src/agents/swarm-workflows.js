const { AGENTS } = require('./agent-registry');
const { ArchitectAgent } = require('./architect');
const { CoderAgent } = require('./coder');
const { MediaCriticAgent } = require('./media-critic');
const { QaAuditorAgent } = require('./qa-auditor');
const { TaskPlanner } = require('./task-planner');
const { SubagentRunner, isExplicitLocalModel } = require('./subagent-runner');
const { ResearcherAgent } = require('./researcher');
const { AgentToolLoop } = require('./agent-tool-loop');

class SwarmWorkflows {
  static async research({ swarm, taskPrompt, plan, workspaceContext = '', onProgress, selectedModel }) {
    swarm.skipUnneededAgents(onProgress, 'La solicitud requiere información externa; el modo sin costo responderá sin consultar Internet.', ['architect', 'coder', 'critic', 'qa']);
    swarm.emit(onProgress, 'researcher', 'working', 'Preparando una respuesta con modelos gratuitos; búsqueda web desactivada.');
    const tasks = plan.subtasks?.length ? plan.subtasks : TaskPlanner.normalizeSubtasks([], 'web_research');
    const findings = await SubagentRunner.run({
      client: swarm.client, tasks, prompt: taskPrompt, workspaceContext,
      model: selectedModel || AGENTS.researcher.model, webSearch: true, onProgress
    });
    const successful = findings.filter((item) => !item.failed);
    const research = successful.map((item, index) => `### ${index + 1}. ${item.title}\n${item.content}`).join('\n\n');
    swarm.emit(onProgress, 'researcher', successful.length ? 'completed' : 'failed',
      successful.length ? `Respuesta sin consulta web: ${successful.length} subtareas completadas.` : 'No se pudo completar la respuesta con modelos gratuitos.');
    return { content: research || 'No se pudo completar la respuesta con modelos gratuitos.', research, intent: 'web_research', provider: 'BSCL AI · Respuesta sin búsqueda web' };
  }

  static async architecture({ swarm, taskPrompt, triage, requiresWebSearch, onProgress, selectedModel }) {
    const agentModel = selectedModel || triage.recommendedModel || AGENTS.architect.model;
    swarm.skipUnneededAgents(onProgress, 'Solo hace falta diseñar la arquitectura.', ['coder', 'critic', 'qa']);
    const research = requiresWebSearch
      ? await swarm.runAgent(onProgress, 'researcher', 'Consultando fuentes actuales para apoyar el diseño.', agentModel,
        () => ResearcherAgent.run({ client: swarm.client, prompt: taskPrompt, model: agentModel }))
      : '';
    const architecture = await swarm.runAgent(onProgress, 'architect', 'Diseñando la arquitectura solicitada.', agentModel,
      () => ArchitectAgent.run({ client: swarm.client, prompt: `${taskPrompt}${research ? `\n\nInvestigación web:\n${research}` : ''}`, model: agentModel }));
    return { content: `${research ? `### Investigación web\n${research}\n\n` : ''}${architecture}`, architecture, research, intent: 'architecture_design', provider: 'BSCL AI · Arquitecto' };
  }

  static async codeReview({ swarm, taskPrompt, plan, triage, requiresWebSearch, workspaceContext = '', onProgress, selectedModel }) {
    const reviewModel = selectedModel || triage.recommendedModel || AGENTS.qa.model;
    swarm.skipUnneededAgents(onProgress, 'La solicitud pide una revisión, no cambios de código.', ['architect', 'coder', 'critic']);
    const research = requiresWebSearch
      ? await swarm.runAgent(onProgress, 'researcher', 'Buscando referencias actuales para la revisión solicitada.', reviewModel,
        () => ResearcherAgent.run({ client: swarm.client, prompt: taskPrompt, model: reviewModel }))
      : '';
    if (!requiresWebSearch) swarm.emit(onProgress, 'researcher', 'skipped', 'Esta auditoría usa los archivos del workspace y no necesita búsqueda web.');
    const tasks = plan.subtasks?.length ? plan.subtasks : TaskPlanner.normalizeSubtasks([], 'code_review');
    const findings = await SubagentRunner.run({
      client: swarm.client, tasks, prompt: taskPrompt, workspaceContext,
      model: selectedModel || reviewModel, onProgress, contextLimit: 9000
    });
    const successfulFindings = findings.filter((item) => !item.failed);
    const review = await swarm.runAgent(onProgress, 'qa', 'Integrando las revisiones terminadas con los archivos leídos del workspace.', reviewModel,
      () => QaAuditorAgent.run({
        client: swarm.client,
        prompt: `${taskPrompt}${research ? `\n\nReferencias de investigación web:\n${research}` : ''}`,
        workspaceContext,
        findings: successfulFindings,
        model: reviewModel
      }));
    const subagentSummary = findings.length
      ? `### Revisiones de subagentes (${successfulFindings.length}/${findings.length})\n${findings.map((item) => `- **${item.title}:** ${item.content}`).join('\n')}`
      : '';
    return { content: `${research ? `### Investigación web\n${research}\n\n` : ''}${subagentSummary}${subagentSummary ? '\n\n' : ''}${review}`, research, intent: 'code_review', provider: 'BSCL AI · Auditoría del workspace' };
  }

  static async implementation({ swarm, taskPrompt, triage, requiresWebSearch, plan, workspaceContext, rootPath = null, mediaItems, onProgress, selectedModel }) {
    const taskModel = selectedModel || triage.recommendedModel || AGENTS.coder.model;
    const research = requiresWebSearch
      ? await swarm.runAgent(onProgress, 'researcher', 'Buscando documentación actual para la tarea.', taskModel,
        () => ResearcherAgent.run({ client: swarm.client, prompt: taskPrompt, model: taskModel }))
      : '';
    const researchedPrompt = `${taskPrompt}${research ? `\n\nInvestigación web y fuentes:\n${research}` : ''}`;
    const architectModel = taskModel;
    const architecture = await swarm.runAgent(onProgress, 'architect', 'Diseñando una estrategia para el cambio solicitado.', architectModel,
      () => ArchitectAgent.run({ client: swarm.client, prompt: researchedPrompt, model: architectModel }));
    const coderModel = taskModel;
    const tasks = plan.subtasks?.length ? plan.subtasks : TaskPlanner.normalizeSubtasks([], 'coding_implementation');
    const [findings, extraToolContext] = await Promise.all([
      SubagentRunner.run({
        client: swarm.client, tasks, prompt: researchedPrompt, architecturePlan: architecture,
        workspaceContext, model: selectedModel || coderModel, onProgress
      }),
      AgentToolLoop.gatherExtraContext({
        client: swarm.client, prompt: researchedPrompt, workspaceContext, rootPath, model: selectedModel || coderModel, onProgress
      })
    ]);
    const enrichedWorkspaceContext = `${workspaceContext}${extraToolContext}`;
    const notes = findings.map((item) => `- ${item.title}: ${item.content}`).join('\n');
    let coder = await swarm.runAgent(onProgress, 'coder', 'Preparando cambios concretos (parches quirúrgicos y archivos) para el proyecto.', coderModel,
      () => CoderAgent.run({ client: swarm.client, prompt: `${researchedPrompt}${notes ? `\n\nHALLAZGOS DE LOS SUBAGENTES:\n${notes}` : ''}`, architecturePlan: architecture, workspaceContext: enrichedWorkspaceContext, rootPath, model: coderModel }));
    let code = coder.code || JSON.stringify({ summary: coder.summary, delete: coder.delete, rename: coder.rename });
    const needsCritic = triage.needsVisionAgent || mediaItems.length > 0 || /\b(css|html|ui|ux|style|estilos?|interfaz|diseno|pantalla|video|audio)\b/i.test(code);
    const reviewModel = selectedModel || triage.recommendedModel || AGENTS.qa.model;
    if (!needsCritic) swarm.emit(onProgress, 'critic', 'skipped', 'El cambio no requiere una revisión visual o multimodal.');
    if (!triage.needsQaAgent) swarm.emit(onProgress, 'qa', 'skipped', 'No se solicitó una auditoría de calidad.');

    const runReviews = async (reviewCode, iteration) => {
      const actions = [];
      if (needsCritic) actions.push(() => swarm.runAgent(onProgress, 'critic',
        iteration ? 'Revisando el cambio corregido y esperando el resultado.' : 'Revisando la interfaz y los medios adjuntos.', reviewModel,
        () => MediaCriticAgent.run({ client: swarm.client, code: reviewCode, mediaItems, model: reviewModel })));
      if (triage.needsQaAgent) actions.push(() => swarm.runAgent(onProgress, 'qa',
        iteration ? 'Volviendo a revisar la versión ajustada.' : 'Comprobando la implementación y buscando errores concretos.', reviewModel,
        () => QaAuditorAgent.run({ client: swarm.client, code: reviewCode, model: reviewModel })));
      if (!actions.length) return [];
      swarm.emit(onProgress, 'router', 'working', `Esperando a que termine la revisión ${iteration ? 'final' : 'paralela'} antes de continuar.`);
      if (isExplicitLocalModel(reviewModel)) {
        const sequential = [];
        for (const action of actions) sequential.push(await Promise.resolve().then(action).then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason })));
        return sequential;
      }
      return Promise.all(actions.map((action) => Promise.resolve().then(action)
        .then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }))));
    };

    let reviews = await runReviews(code, 0);
    const syntaxErrors = AgentToolLoop.verifyProposedFiles(coder.files);
    const initialVisualReview = needsCritic && reviews[0]?.status === 'fulfilled' ? reviews[0].value : '';
    const initialQaIndex = needsCritic ? 1 : 0;
    const initialQaReview = triage.needsQaAgent && reviews[initialQaIndex]?.status === 'fulfilled' ? reviews[initialQaIndex].value : '';
    let failedReviews = reviews.filter((item) => item.status === 'rejected');
    const reviewParts = [
      ...(syntaxErrors.length ? [`Errores de verificación sintáctica automática:\n- ${syntaxErrors.join('\n- ')}`] : []),
      ...reviews.filter((item) => item.status === 'fulfilled' && this.hasActionableFindings(item.value))
        .map((item, index) => `Revisión ${index + 1}: ${item.value}`)
    ];
    const reviewFeedback = reviewParts.join('\n\n');
    let visualReview = initialVisualReview;
    let qaReview = initialQaReview;
    let finalReviewStillHasFindings = false;

    if (reviewFeedback) {
      swarm.emit(onProgress, 'coder', 'working', 'Autocorrigiendo código según verificación sintáctica y hallazgos de QA.', coderModel);
      const revised = await CoderAgent.run({
        client: swarm.client, prompt: `${researchedPrompt}${notes ? `\n\nHALLAZGOS DE LOS SUBAGENTES:\n${notes}` : ''}`,
        architecturePlan: architecture, workspaceContext: enrichedWorkspaceContext, rootPath, model: coderModel,
        revision: { feedback: reviewFeedback, previousChanges: { summary: coder.summary, files: coder.files, delete: coder.delete, rename: coder.rename } }
      });
      if (revised.files.length || revised.delete.length || revised.rename.length) {
        coder = revised;
        code = coder.code || JSON.stringify({ summary: coder.summary, delete: coder.delete, rename: coder.rename });
        reviews = await runReviews(code, 1);
        failedReviews = reviews.filter((item) => item.status === 'rejected');
        if (needsCritic && reviews[0]?.status === 'fulfilled') visualReview = reviews[0].value;
        const qaIndex = needsCritic ? 1 : 0;
        if (triage.needsQaAgent && reviews[qaIndex]?.status === 'fulfilled') qaReview = reviews[qaIndex].value;
        finalReviewStillHasFindings = reviews.some((item) => item.status === 'fulfilled' && this.hasActionableFindings(item.value));
      }
    }

    const warnings = [
      failedReviews.length ? 'Una o más revisiones no pudieron completarse.' : '',
      finalReviewStillHasFindings ? 'La última revisión dejó observaciones pendientes; se muestran para que puedas decidir el siguiente ajuste.' : ''
    ].filter(Boolean);
    return {
      content: `${research ? `### Investigación web\n${research}\n\n` : ''}${coder.content}${qaReview ? `\n\n### Revisión de calidad\n${qaReview}` : ''}${visualReview ? `\n\n### Revisión visual\n${visualReview}` : ''}${warnings.length ? `\n\n> ⚠️ ${warnings.join(' ')}` : ''}`,
      workspaceFiles: coder.files, workspaceDelete: coder.delete, workspaceRename: coder.rename,
      codingSummary: coder.summary, intent: triage.intent,
      architecture, research, visualReview, qaReview, provider: 'Enjambre BSCL · Cascada Gratis Pro', warning: warnings.join(' ')
    };
  }

  static hasActionableFindings(value) {
    const text = String(value || '').trim();
    if (!text || /sin hallazgos|no se detectaron (?:errores|problemas)|no hay (?:errores|problemas)|todo (?:está|esta) correcto/i.test(text)) return false;
    return /hallazgo|error|bug|riesgo|mejora|debe|falta|no (?:se|está|esta|incluye)|inconsisten|incorrect|vulner|cr[ií]tic|correg|fallo|issue/i.test(text);
  }
}

module.exports = { SwarmWorkflows };
