/**
 * Enrutamiento inteligente de intenciones para BSCL AI Studio.
 * Todas las intenciones delegan por defecto en 'smart-router' (cascada gratuita multi-modelo)
 * sin quemar modelos locales pesados.
 */
class NeuralRouter {
  static normalize(text = '') {
    return String(text)
      .toLocaleLowerCase('es')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[¿?¡!.,;:()[\]{}"'`]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static isSmallTalk(text = '') {
    const normalized = this.normalize(text);
    return /^(?:hola|holi|hey|hello|hi|buenas|buenos dias|buenas tardes|buenas noches|que tal|como estas|como te va|saludos|gracias|muchas gracias|te agradezco|ok|okay|vale|listo|entendido|de acuerdo|perfecto|bien|adios|chao|hasta luego|nos vemos|good morning|good afternoon|good evening|thanks|thank you|bye|see you)$/u.test(normalized);
  }

  static isUndoRequest(text = '') {
    const normalized = this.normalize(text);
    return /^(?:deshaz|deshacer|revierte|revertir|revert|undo|restaura|restaurar)\b/u.test(normalized) ||
      /\b(ultimo cambio|ultima entrega|cambios que hiciste|cambio anterior)\b/u.test(normalized) &&
      /\b(deshacer|deshaz|revierte|revertir|restaura|restaurar)\b/u.test(normalized);
  }

  static asksWorkspaceInventory(text = '') {
    const normalized = this.normalize(text);
    return /\b(proyectos?|carpetas?|directorios?|repositorios?|workspace)\b/u.test(normalized) &&
      /\b(que|cuales|cuantos?|lista|muestra|dime|hay|existen|detectados?|disponibles?)\b/u.test(normalized);
  }

  static requestsEditorContext(text = '') {
    const normalized = this.normalize(text);
    return /\b(archivo|editor|seleccion|codigo abierto|pestana|cursor|esta funcion|este codigo|este archivo|lo que tengo abierto|open file|selected code)\b/u.test(normalized);
  }

  static requestsWebSearch(text = '') {
    const normalized = this.normalize(text);
    return /\b(internet|web|online|en linea|navega|busca en|buscar en|investiga|googlea|fuentes actuales|fuentes recientes|informacion actualizada|actualidad|noticias de hoy|ultimas noticias|precio actual|version actual|estadisticas recientes|datos actuales)\b/u.test(normalized);
  }

  static isExplicitReviewRequest(text = '') {
    const normalized = this.normalize(text);
    return /\b(audita|revisa|analiza|evalua|verifica|inspecciona|prueba|testea|busca errores|detecta errores|haz qa|realiza qa)\w*\b/u.test(normalized) &&
      /\b(codigo|bug|error|fallo|prueba|test|proyecto|repositorio|extension|workspace|calidad|seguridad|implementacion)\b/u.test(normalized);
  }

  static isLikelyActionRequest(text = '') {
    const normalized = this.normalize(text);
    return this.isLikelyImplementationRequest(normalized) ||
      /\b(ayudame con|me ayudas con|necesito ayuda con|help me with)\b/u.test(normalized) ||
      this.isLikelyProblemReport(normalized);
  }

  static isLikelyProblemReport(text = '') {
    const normalized = this.normalize(text);
    return /\b(no funciona|no sirve|no carga|no responde|se queda cargando|se queda bloqueado|se rompe|tengo un error|hay un error|sale un error|aparece un error|da error|falla|crashea)\b/u.test(normalized);
  }

  static isLikelyImplementationRequest(text = '') {
    const normalized = this.normalize(text);
    const directVerb = /\b(implement\w*|crea\w*|agrega\w*|anade\w*|construye\w*|programa\w*|escribe\w*|genera\w*|modifica\w*|actualiza\w*|cambia\w*|corrige\w*|arregla\w*|refactoriza\w*|migra\w*|integra\w*|conecta\w*|desarrolla\w*|soluciona\w*|optimiza\w*|mejora(?:r|lo|la|los|las|me|nos)?|fix|build|create|implement|update|refactor)\b/u;
    const requestForChange = /\b(quiero que|necesito que|puedes|podrias|ayudame a|me ayudas a|me gustaria que|please)\b.{0,100}\b(hacer|crear|anadir|agregar|implementar|corregir|arreglar|mejorar|refactorizar|integrar|modificar|actualizar|solucionar|construir|configurar|cambiar|interpretar|desplegar|responder|escribir|generar|aplicar)\b/u;
    const requestedOutcome = /\b(quiero que|necesito que|me gustaria que|podrias hacer que|haz que|haga que)\b.{0,180}\b(haga|hagas|hagan|pueda|puedan|cree|crea|escriba|genere|modifique|aplique|despliegue|interprete|responda|funcione|permita|mejore|mejor|mas rapido|mas facil|aparezca|se vea|se pueda|tenga|sea|sean|dependa|se active|se activen|se ejecute|se ejecuten|se muestre|se actualice|se creen|se hagan|se realicen)\b/u;
    return directVerb.test(normalized) || requestForChange.test(normalized) || requestedOutcome.test(normalized);
  }

  static classifyTask(prompt = '', mediaItems = [], options = {}) {
    const text = this.normalize(typeof prompt === 'string' ? prompt : JSON.stringify(prompt));
    const hasImage = mediaItems.some((item) => item?.category === 'image');
    const requestsImplementation = this.isLikelyImplementationRequest(text);

    if (hasImage) {
      return {
        intent: requestsImplementation ? 'visual_and_ui' : 'visual_analysis',
        recommendedModel: 'smart-router',
        bypassSwarm: !requestsImplementation,
        needsCoderAgent: requestsImplementation,
        needsQaAgent: requestsImplementation,
        needsVisionAgent: true,
        requiresWebSearch: Boolean(options.webSearchEnabled) || this.requestsWebSearch(text)
      };
    }

    if (this.isSmallTalk(text)) {
      return { intent: 'conversation', recommendedModel: 'smart-router', bypassSwarm: true };
    }

    const requiresWebSearch = Boolean(options.webSearchEnabled) || this.requestsWebSearch(text);
    if (requiresWebSearch && !requestsImplementation && !this.isExplicitReviewRequest(text)) {
      return {
        intent: 'web_research',
        recommendedModel: 'smart-router',
        requiresWebSearch: true,
        needsResearcherAgent: true,
        bypassSwarm: false
      };
    }

    if (this.isExplicitReviewRequest(text) && !requestsImplementation) {
      return {
        intent: 'code_review',
        recommendedModel: 'smart-router',
        needsQaAgent: true,
        requiresWebSearch,
        bypassSwarm: false
      };
    }

    const requestsArchitecture = /\b(disena\w*|define\w*|propon\w*|planifica\w*)\b/u.test(text) &&
      /\barquitectura\b/u.test(text);
    if (requestsArchitecture) {
      return {
        intent: 'architecture_design',
        recommendedModel: 'smart-router',
        requiresWebSearch,
        needsArchitectAgent: true,
        bypassSwarm: false
      };
    }

    if (requestsImplementation) {
      const needsVisionAgent = /\b(interfaz|ui|ux|css|html|frontend|front end|diseno|pantalla|layout|visual)\b/u.test(text);
      return {
        intent: needsVisionAgent ? 'visual_and_ui' : 'coding_implementation',
        recommendedModel: 'smart-router',
        needsCoderAgent: true,
        needsQaAgent: true,
        needsVisionAgent,
        requiresWebSearch,
        bypassSwarm: false
      };
    }

    return { intent: 'general_reasoning', recommendedModel: 'smart-router', bypassSwarm: true };
  }
}

module.exports = { NeuralRouter };
