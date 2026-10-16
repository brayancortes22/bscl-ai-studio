/**
 * Enrutamiento inteligente de intenciones para BSCL AI Studio.
 * Todas las intenciones delegan por defecto en 'smart-router' (cascada gratuita multi-modelo)
 * sin quemar modelos locales pesados.
 */
const UNDO_PATTERN = new RegExp([
  '^(?:(?:puedes|podrias|quiero|necesito|hay que) )?(?:',
  '(?:deshaz|deshacer|revierte|revertir)(?:lo|los)?',
  '(?: (?:todos )?(?:(?:los|las|tus|esos|estos|el|la|ese|este) )?(?:',
  'ultimos? cambios?|ultima entrega|ultima modificacion|entrega anterior|cambio anterior|modificaciones|',
  'cambios?(?: (?:anteriores|que hiciste|que acabas de hacer|aplicados|realizados|de la ultima entrega))?|',
  'lo que hiciste|lo que acabas de hacer|lo ultimo|eso|todo)',
  // "Deshaz el último cambio que hiciste" es la forma natural y antes también se reconocía.
  '(?: que (?:hiciste|acabas de hacer|has hecho|aplicaste))?)?',
  // "Restaura" solo con un objeto inequívoco: "restaurar contraseña" es una petición de código.
  '|(?:restaura|restaurar)(?:lo|los)? (?:lo que habia|como estaba|el estado anterior|la version anterior|los archivos(?: originales| anteriores)?)',
  ')$'
].join(''), 'u');

// La forma más natural de pedir un cambio en español es el subjuntivo ("quiero que corrijas…"),
// que las raíces de imperativo no reconocen. Los verbos ambiguos ("crees", "mejores", "cambies")
// solo cuentan pegados al "que": a distancia, "quiero que me digas si crees…" no es un encargo.
const SUBJUNCTIVE_LEAD = '(?:quiero|necesito|me gustaria|te pido|ocupo) que';
const SUBJUNCTIVE_NEAR = new RegExp(`\\b${SUBJUNCTIVE_LEAD} (?:(?:tu|usted|ustedes|me|te|le|les|nos|lo|la|los|las|se) ){0,2}` +
  '(?:arregl(?:e|es|en)|corrij(?:a|as|an)|agreg(?:ue|ues|uen)|anad(?:a|as|an)|cambi(?:e|es|en)|actualic(?:e|es|en)|' +
  'modifiqu(?:e|es|en)|implement(?:e|es|en)|quit(?:e|es|en)|elimin(?:e|es|en)|refactoric(?:e|es|en)|optimic(?:e|es|en)|' +
  'solucion(?:e|es|en)|integr(?:e|es|en)|desarroll(?:e|es|en)|construy(?:a|as|an)|program(?:e|es|en)|mejor(?:e|es|en)|cre(?:e|es|en))\\b', 'u');
// A distancia, el verbo tiene que pertenecer a la oración que abre el primer "que": otro "que"
// por medio ("…por qué el linter pide que elimines…") o un verbo de explicación convierten una
// pregunta en un encargo.
const FAR_GAP = '(?:(?!\\bque\\b|\\bexpliq|\\bdigas\\b|\\bcuentes\\b|\\bensenes\\b|\\bmuestres\\b|\\bindiques\\b|\\baclares\\b).){0,80}';
const SUBJUNCTIVE_FAR = new RegExp(`\\b${SUBJUNCTIVE_LEAD}\\b${FAR_GAP}\\b` +
  '(?:arregl(?:es|en)|corrij(?:as|an)|agreg(?:ues|uen)|anad(?:as|an)|actualic(?:es|en)|modifiqu(?:es|en)|' +
  'implement(?:es|en)|elimin(?:es|en)|refactoric(?:es|en)|optimic(?:es|en))\\b', 'u');

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

  // Solo la orden explícita de deshacer la última entrega. Antes bastaba con que el mensaje
  // EMPEZARA por "restaura" o "revierte", y "Restaurar contraseña: crea el endpoint…" o
  // "Revierte el color del header a azul" revertían la entrega anterior sin procesar la petición.
  static isUndoRequest(text = '') {
    const normalized = this.normalize(text)
      .replace(/\b(?:muchas gracias|gracias|por favor|porfa|please|thanks|ahora|ya)\b/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (/^(?:undo|revert)(?: (?:the |your )?(?:last )?(?:changes?|edit|delivery|that|it))?$/u.test(normalized)) return true;
    return UNDO_PATTERN.test(normalized);
  }

  static asksWorkspaceInventory(text = '') {
    const normalized = this.normalize(text);
    // Una petición de cambio ("Quiero que el proyecto tenga…") contiene "que" y "proyecto",
    // pero no es una pregunta de inventario; tratarla como trivial se saltaba el planificador.
    return /\b(proyectos?|carpetas?|directorios?|repositorios?|workspace)\b/u.test(normalized) &&
      /\b(que|cuales|cuantos?|lista|muestra|dime|hay|existen|detectados?|disponibles?)\b/u.test(normalized) &&
      !this.isLikelyActionRequest(normalized);
  }

  static requestsEditorContext(text = '') {
    const normalized = this.normalize(text);
    return /\b(archivo|editor|seleccion|codigo abierto|pestana|cursor|esta funcion|este codigo|este archivo|lo que tengo abierto|open file|selected code)\b/u.test(normalized);
  }

  static requestsWebSearch(text = '') {
    const normalized = this.normalize(text);
    // Solo frases inequívocas: "web" suelto ("servidor web", "página web"), "busca en el
    // proyecto" o "en línea 42" lanzaban una investigación externa sin contexto del workspace.
    return /\b((?:en|por|de|desde) internet|en la web|de la web|(?:busca|buscar|buscame|consulta|consultar|investiga|investigar|navega|navegar) (?:en |por )?(?:internet|la web|google|linea|online)|googlea\w*|fuentes actuales|fuentes recientes|informacion actualizada|actualidad|noticias de hoy|ultimas noticias|precio actual|version actual|estadisticas recientes|datos actuales)\b/u.test(normalized);
  }

  static isExplicitReviewRequest(text = '') {
    const normalized = this.normalize(text);
    const action = /\b(audita|revisa|analiza|evalua|verifica|inspecciona|prueba|testea|busca errores|detecta errores|haz qa|realiza qa)\w*\b/u.exec(normalized);
    if (!action) return false;
    // El objeto tiene que ser OTRA palabra: "prueba" está en las dos listas y por sí sola
    // convertía "dame una prueba de que raíz de 2 es irracional" en una auditoría.
    const rest = `${normalized.slice(0, action.index)} ${normalized.slice(action.index + action[0].length)}`;
    return /\b(codigo|bug|error|fallo|prueba|pruebas|test|tests|proyecto|repositorio|extension|workspace|calidad|seguridad|implementacion)\b/u.test(rest);
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
    return directVerb.test(normalized) || requestForChange.test(normalized) || requestedOutcome.test(normalized) ||
      SUBJUNCTIVE_NEAR.test(normalized) || SUBJUNCTIVE_FAR.test(normalized);
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
