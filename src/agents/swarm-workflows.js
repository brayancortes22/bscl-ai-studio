const { AGENTS, isAbortError } = require('./agent-registry');
const { ArchitectAgent } = require('./architect');
const { CoderAgent } = require('./coder');
const { MediaCriticAgent } = require('./media-critic');
const { QaAuditorAgent } = require('./qa-auditor');
const { TaskPlanner } = require('./task-planner');
const { SubagentRunner, isExplicitLocalModel } = require('./subagent-runner');
const { ResearcherAgent } = require('./researcher');
const { AgentToolLoop } = require('./agent-tool-loop');

function joinContext(...parts) {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join('\n\n');
}

class SwarmWorkflows {
  static async research({ swarm, taskPrompt, editorContext = '', plan, workspaceContext = '', onProgress, selectedModel }) {
    swarm.skipUnneededAgents(onProgress, 'La solicitud requiere información externa; el modo sin costo responderá sin consultar Internet.', ['architect', 'coder', 'critic', 'qa']);
    swarm.emit(onProgress, 'researcher', 'working', 'Preparando una respuesta con modelos gratuitos; búsqueda web desactivada.');
    const tasks = plan.subtasks?.length ? plan.subtasks : TaskPlanner.normalizeSubtasks([], 'web_research');
    const findings = await SubagentRunner.run({
      client: swarm.client, tasks, prompt: taskPrompt, workspaceContext, editorContext,
      model: selectedModel || AGENTS.researcher.model, webSearch: true, onProgress
    });
    const successful = findings.filter((item) => !item.failed);
    const research = successful.map((item, index) => `### ${index + 1}. ${item.title}\n${item.content}`).join('\n\n');
    swarm.emit(onProgress, 'researcher', successful.length ? 'completed' : 'failed',
      successful.length ? `Respuesta sin consulta web: ${successful.length} subtareas completadas.` : 'No se pudo completar la respuesta con modelos gratuitos.');
    return { content: research || 'No se pudo completar la respuesta con modelos gratuitos.', research, intent: 'web_research', provider: 'BSCL AI · Respuesta sin búsqueda web' };
  }

  static async architecture({ swarm, taskPrompt, editorContext = '', requiresWebSearch, onProgress, selectedModel }) {
    const agentModel = selectedModel || AGENTS.architect.model;
    swarm.skipUnneededAgents(onProgress, 'Solo hace falta diseñar la arquitectura.', ['coder', 'critic', 'qa']);
    const research = requiresWebSearch
      ? await swarm.runAgent(onProgress, 'researcher', 'Consultando fuentes actuales para apoyar el diseño.', agentModel,
        () => ResearcherAgent.run({ client: swarm.client, prompt: taskPrompt, model: agentModel }))
      : '';
    const architecture = await swarm.runAgent(onProgress, 'architect', 'Diseñando la arquitectura solicitada.', agentModel,
      () => ArchitectAgent.run({ client: swarm.client, prompt: taskPrompt, references: research, context: editorContext, model: agentModel }));
    return { content: `${research ? `### Investigación web\n${research}\n\n` : ''}${architecture}`, architecture, research, intent: 'architecture_design', provider: 'BSCL AI · Arquitecto' };
  }

  static async codeReview({ swarm, taskPrompt, editorContext = '', plan, requiresWebSearch, workspaceContext = '', onProgress, selectedModel }) {
    const reviewModel = selectedModel || AGENTS.qa.model;
    swarm.skipUnneededAgents(onProgress, 'La solicitud pide una revisión, no cambios de código.', ['architect', 'coder', 'critic']);
    const research = requiresWebSearch
      ? await swarm.runAgent(onProgress, 'researcher', 'Buscando referencias actuales para la revisión solicitada.', reviewModel,
        () => ResearcherAgent.run({ client: swarm.client, prompt: taskPrompt, model: reviewModel }))
      : '';
    if (!requiresWebSearch) swarm.emit(onProgress, 'researcher', 'skipped', 'Esta auditoría usa los archivos del workspace y no necesita búsqueda web.');
    const tasks = plan.subtasks?.length ? plan.subtasks : TaskPlanner.normalizeSubtasks([], 'code_review');
    const findings = await SubagentRunner.run({
      client: swarm.client, tasks, prompt: taskPrompt, workspaceContext, editorContext, references: research,
      model: reviewModel, onProgress, contextLimit: 9000
    });
    const successfulFindings = findings.filter((item) => !item.failed);
    const review = await swarm.runAgent(onProgress, 'qa', 'Integrando las revisiones terminadas con los archivos leídos del workspace.', reviewModel,
      () => QaAuditorAgent.run({
        client: swarm.client,
        prompt: taskPrompt,
        references: research,
        workspaceContext: joinContext(editorContext, workspaceContext),
        findings: successfulFindings,
        model: reviewModel
      }));
    const subagentSummary = findings.length
      ? `### Revisiones de subagentes (${successfulFindings.length}/${findings.length})\n${findings.map((item) => `- **${item.title}:** ${item.content}`).join('\n')}`
      : '';
    return { content: `${research ? `### Investigación web\n${research}\n\n` : ''}${subagentSummary}${subagentSummary ? '\n\n' : ''}${review}`, research, intent: 'code_review', provider: 'BSCL AI · Auditoría del workspace' };
  }

  /**
   * Lanza Crítico y QA sobre `reviewCode`. Devuelve { critic, qa } con resultados "settled".
   * Una cancelación se relanza en lugar de quedarse como un rechazo más.
   */
  static async runReviews({ swarm, onProgress, model, reviewCode, mediaItems, needsCritic, needsQa, iteration }) {
    const jobs = [];
    if (needsCritic) jobs.push(['critic', () => swarm.runAgent(onProgress, 'critic',
      iteration ? 'Revisando el cambio corregido y esperando el resultado.' : 'Revisando la interfaz y los medios adjuntos.', model,
      () => MediaCriticAgent.run({ client: swarm.client, code: reviewCode, mediaItems, model }))]);
    if (needsQa) jobs.push(['qa', () => swarm.runAgent(onProgress, 'qa',
      iteration ? 'Volviendo a revisar la versión ajustada.' : 'Comprobando la implementación y buscando errores concretos.', model,
      () => QaAuditorAgent.run({ client: swarm.client, code: reviewCode, model }))]);
    if (!jobs.length) return {};
    swarm.emit(onProgress, 'router', 'working', `Esperando a que termine la revisión ${iteration ? 'final' : 'paralela'} antes de continuar.`);
    const settle = (job) => Promise.resolve().then(job)
      .then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
    let settled;
    if (isExplicitLocalModel(model)) {
      settled = [];
      for (const [, job] of jobs) {
        const result = await settle(job);
        settled.push(result);
        if (isAbortError(result.reason)) break;
      }
    } else {
      settled = await Promise.all(jobs.map(([, job]) => settle(job)));
    }
    const aborted = settled.find((result) => result.status === 'rejected' && isAbortError(result.reason));
    if (aborted) throw aborted.reason;
    swarm.emit(onProgress, 'router', 'completed', 'Revisión terminada.');
    return Object.fromEntries(jobs.map(([id], index) => [id, settled[index]]));
  }

  /** Texto de revisión que justifica otra ronda del Programador, o '' si no hace falta. */
  static actionableFeedback(results) {
    const parts = [];
    // El Crítico solo cuenta con un CORREGIR explícito: sus sugerencias estéticas no deben
    // disparar por sí solas una reescritura.
    if (results.critic?.status === 'fulfilled' && this.hasActionableFindings(results.critic.value, { heuristic: false })) {
      parts.push(`Revisión visual:\n${results.critic.value}`);
    }
    if (results.qa?.status === 'fulfilled' && this.hasActionableFindings(results.qa.value)) {
      parts.push(`Revisión de calidad:\n${results.qa.value}`);
    }
    return parts.join('\n\n');
  }

  static async implementation({ swarm, taskPrompt, editorContext = '', triage, requiresWebSearch, plan, workspaceContext = '', rootPath = null, mediaItems = [], onProgress, selectedModel }) {
    const model = selectedModel || AGENTS.coder.model;
    const research = requiresWebSearch
      ? await swarm.runAgent(onProgress, 'researcher', 'Buscando documentación actual para la tarea.', model,
        () => ResearcherAgent.run({ client: swarm.client, prompt: taskPrompt, model }))
      : '';
    // taskPrompt es solo la petición de la persona y viaja sola como requerimiento. La
    // investigación y los hallazgos son salida de otros modelos (los subagentes leen el archivo
    // abierto y pueden repetir una instrucción inyectada en él): van en secciones de datos.
    const architecture = await swarm.runAgent(onProgress, 'architect', 'Diseñando una estrategia para el cambio solicitado.', model,
      () => ArchitectAgent.run({ client: swarm.client, prompt: taskPrompt, references: research, context: editorContext, model }));
    const tasks = plan.subtasks?.length ? plan.subtasks : TaskPlanner.normalizeSubtasks([], 'coding_implementation');
    const [findings, extraToolContext] = await Promise.all([
      SubagentRunner.run({
        client: swarm.client, tasks, prompt: taskPrompt, architecturePlan: architecture, references: research,
        workspaceContext, editorContext, model, onProgress
      }),
      AgentToolLoop.gatherExtraContext({
        client: swarm.client, prompt: taskPrompt, workspaceContext: joinContext(editorContext, workspaceContext), rootPath, model, onProgress
      })
    ]);
    const coderContext = joinContext(editorContext, `${workspaceContext}${extraToolContext}`);
    const notes = findings.map((item) => `- ${item.title}: ${item.content}`).join('\n');
    const coderInput = { client: swarm.client, prompt: taskPrompt, architecturePlan: architecture, findings: notes, research, workspaceContext: coderContext, rootPath, model };
    let coder = await swarm.runAgent(onProgress, 'coder', 'Preparando cambios concretos (parches quirúrgicos y archivos) para el proyecto.', model,
      () => CoderAgent.run(coderInput));
    const warnings = [];
    const pushWarning = (text) => { if (text && !warnings.includes(text)) warnings.push(text); };
    if (coder.truncated) pushWarning(coder.summary);
    if (coder.failedPatches?.length) pushWarning(`No se pudieron aplicar parches en: ${coder.failedPatches.join(', ')}.`);

    const result = (extra = {}) => ({
      content: `${research ? `### Investigación web\n${research}\n\n` : ''}${coder.content}${extra.qaReview ? `\n\n### Revisión de calidad\n${extra.qaReview}` : ''}${extra.visualReview ? `\n\n### Revisión visual\n${extra.visualReview}` : ''}${warnings.length ? `\n\n> ⚠️ ${warnings.join(' ')}` : ''}`,
      workspaceFiles: coder.files, workspaceDelete: coder.delete, workspaceRename: coder.rename,
      // Siempre 'coding_implementation': es el único flujo que produce cambios de archivos y con
      // 'visual_and_ui' el host no los guardaba ni avisaba.
      codingSummary: coder.summary, intent: 'coding_implementation',
      architecture, research, visualReview: extra.visualReview || '', qaReview: extra.qaReview || '',
      provider: 'Enjambre BSCL · Cascada Gratis Pro', warning: warnings.join(' ')
    });

    // Sin cambios aplicables no hay nada que revisar: ahorra dos llamadas contra cuotas gratuitas.
    if (!CoderAgent.hasChanges(coder)) {
      swarm.skipUnneededAgents(onProgress, 'El Programador no devolvió cambios aplicables; no hay nada que revisar.', ['critic', 'qa']);
      return result();
    }

    let code = coder.code || JSON.stringify({ summary: coder.summary, delete: coder.delete, rename: coder.rename });
    const needsCritic = Boolean(triage.needsVisionAgent || mediaItems.length > 0 || /\b(css|html|ui|ux|style|estilos?|interfaz|diseno|pantalla|video|audio)\b/i.test(code));
    const needsQa = Boolean(triage.needsQaAgent);
    if (!needsCritic) swarm.emit(onProgress, 'critic', 'skipped', 'El cambio no requiere una revisión visual o multimodal.');
    if (!needsQa) swarm.emit(onProgress, 'qa', 'skipped', 'No se solicitó una auditoría de calidad.');
    const reviewArgs = { swarm, onProgress, model, mediaItems, needsCritic, needsQa };

    let reviews = await this.runReviews({ ...reviewArgs, reviewCode: code, iteration: 0 });
    let syntaxErrors = AgentToolLoop.verifyProposedFiles(coder.files);
    let visualReview = reviews.critic?.status === 'fulfilled' ? reviews.critic.value : '';
    let qaReview = reviews.qa?.status === 'fulfilled' ? reviews.qa.value : '';
    let failedReviews = Object.values(reviews).filter((item) => item?.status === 'rejected').length;
    const reviewFeedback = joinContext(
      syntaxErrors.length ? `Errores de verificación sintáctica automática:\n- ${syntaxErrors.join('\n- ')}` : '',
      this.actionableFeedback(reviews)
    );
    let finalReviewStillHasFindings = false;

    if (reviewFeedback) {
      // Fuera de runAgent a propósito: si la autocorrección falla, la primera versión sigue
      // siendo la entrega y el Programador debe terminar como 'completed', no como 'failed'.
      swarm.emit(onProgress, 'coder', 'working', 'Autocorrigiendo código según verificación sintáctica y hallazgos de QA.', model);
      let revised = null;
      let revisionError = '';
      try {
        revised = await CoderAgent.run({
          ...coderInput,
          revision: { feedback: reviewFeedback, previousChanges: { summary: coder.summary, files: coder.files, delete: coder.delete, rename: coder.rename } }
        });
      } catch (error) {
        if (isAbortError(error)) throw error;
        revisionError = error?.message || String(error);
      }

      let keptFirstVersion = '';
      if (revised?.changed) {
        const merged = CoderAgent.mergeRevision(coder, revised);
        const mergedErrors = AgentToolLoop.verifyProposedFiles(merged.files);
        if (mergedErrors.length > syntaxErrors.length) {
          keptFirstVersion = 'La autocorrección introducía más errores de sintaxis; se conserva la primera versión.';
        } else {
          coder = merged;
          syntaxErrors = mergedErrors;
          if (coder.failedPatches?.length) pushWarning(`La autocorrección no pudo aplicar parches en: ${coder.failedPatches.join(', ')}.`);
          code = coder.code || JSON.stringify({ summary: coder.summary, delete: coder.delete, rename: coder.rename });
          swarm.emit(onProgress, 'coder', 'completed', 'Programador: versión corregida lista.', model);
          reviews = await this.runReviews({ ...reviewArgs, reviewCode: code, iteration: 1 });
          failedReviews = Object.values(reviews).filter((item) => item?.status === 'rejected').length;
          if (reviews.critic?.status === 'fulfilled') visualReview = reviews.critic.value;
          if (reviews.qa?.status === 'fulfilled') qaReview = reviews.qa.value;
          finalReviewStillHasFindings = Boolean(this.actionableFeedback(reviews));
        }
      } else if (revised?.truncated) {
        keptFirstVersion = 'La autocorrección llegó cortada; se conserva la primera versión.';
      } else if (revisionError) {
        keptFirstVersion = `La autocorrección falló (${revisionError}); se conserva la primera versión.`;
      } else {
        keptFirstVersion = 'La autocorrección no devolvió cambios; se conserva la primera versión.';
      }
      if (keptFirstVersion) {
        pushWarning(keptFirstVersion);
        swarm.emit(onProgress, 'coder', 'completed', `Programador: ${keptFirstVersion}`, model);
      }
    }

    if (syntaxErrors.length) pushWarning(`Verificación sintáctica: ${syntaxErrors.join('; ')}.`);
    if (failedReviews) pushWarning('Una o más revisiones no pudieron completarse.');
    if (finalReviewStillHasFindings) pushWarning('La última revisión dejó observaciones pendientes; se muestran para que puedas decidir el siguiente ajuste.');
    return result({ visualReview, qaReview });
  }

  /**
   * 'ok', 'fix' o null según la última línea "VEREDICTO: …" que piden QA y Crítico.
   * Los modelos la decoran: "**VEREDICTO**: CORREGIR", "Veredicto final: CORREGIR",
   * "VEREDICTO — CORREGIR". Se admite texto corto antes del separador, pero sin separador solo
   * espacios o marcas: si no, "veredicto previo a corregir" contaría como CORREGIR.
   */
  static reviewVerdict(value) {
    const matches = [...String(value || '').matchAll(/VEREDICTO(?:[^\n:]{0,20}?[*_`\s]*[:\-—–]|[*_`\s]*)[*_`\s]*(OK|CORREGIR)\b/gi)];
    if (!matches.length) return null;
    return matches.at(-1)[1].toUpperCase() === 'OK' ? 'ok' : 'fix';
  }

  /**
   * Decide si una revisión obliga a otra ronda. Con veredicto explícito manda el veredicto.
   * Sin él (el modelo ignoró el formato) solo cuentan señales graves: la heurística anterior
   * daba true con "No encontré errores" o "no se ejecutaron pruebas".
   */
  static hasActionableFindings(value, { heuristic = true } = {}) {
    const verdict = this.reviewVerdict(value);
    if (verdict) return verdict === 'fix';
    if (!heuristic) return false;
    const text = String(value || '');
    return /\b(?:gravedad|severidad|prioridad)\s*:?\s*\**\s*(?:alta|cr[ií]tica)\b|\berror(?:es)? de sintaxis\b|\bno compila\b/i.test(text);
  }
}

module.exports = { SwarmWorkflows };
