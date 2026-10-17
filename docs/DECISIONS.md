# Decisiones de arquitectura

- **Proyecto:** BSCL AI Studio
- **Autor y decisor:** Brayan Stid Cortés Lombana (`bscl`)
- **Formato:** Architecture Decision Records (ADR)
- Los ADR-020 a ADR-026 se tomaron en la revisión 1.2.0 (2026-10-15) y están pendientes de la aprobación del autor.
- ADR-027 (1.3.0) lo decidió el autor.

## ADR-001: Enrutamiento por intención y revisiones concurrentes

### Contexto

Un saludo o una pregunta general no necesita una cadena de agentes. Las tareas de código sí pueden beneficiarse de planificación y revisión especializada.

### Decisión

`NeuralRouter` envía saludos y preguntas generales al chat directo. Las solicitudes de arquitectura activan solo al Arquitecto; las auditorías explícitas, solo QA. Las implementaciones activan Arquitecto y Programador en secuencia, seguidos por el Crítico visual cuando aplica y QA para revisar el cambio. Las revisiones corren en paralelo mediante `Promise.allSettled`.

### Consecuencias

- El usuario ve el estado, la acción y el modelo asignado a cada rol implementado.
- QA presenta hallazgos y límites sin reemplazar el código generado.
- Un error de una revisión no cancela la otra; si falla QA, la UI conserva la implementación y avisa que no pudo revisarla.
- El flujo aún requiere varias llamadas al proveedor. QA es una revisión generativa y no ejecuta pruebas.

**Estado:** Flujo inicial en v0.4.0; enrutamiento por intención y selección de agentes en v0.5.1.

## ADR-002: Adjuntos de imagen en memoria

### Contexto

Las imágenes deben llegar a un modelo con visión sin crear archivos temporales ni aceptar formatos que el cliente no sabe procesar.

### Decisión

`MediaProcessor` normaliza PNG, JPEG, WebP y GIF a bloques `image_url` compatibles con la API de chat del Smart AI Router. Cada archivo se limita a 8 MB.

### Consecuencias

- Las imágenes permanecen en memoria y no necesitan dependencias nativas.
- El audio adjunto se envía por un flujo separado a Gemini; el video aún no se procesa.

**Estado:** Implementado en v0.4.0; transcripción de audio adjunto con Gemini en v0.6.0.

**Actualización 1.2.0:** las imágenes siguen igual. La transcripción de audio está desactivada para no generar costes y los adjuntos de audio se retiraron del panel (ver ADR-026).

## ADR-003: Ruta de Obsidian configurable

### Contexto

Una ruta de bóveda fijada en el código ata la extensión a una sola máquina y contradice la configuración documentada.

### Decisión

La extensión lee `bsclAi.obsidianVaultPath` desde la configuración de VS Code. El valor predeterminado es vacío; no se intenta adivinar una ruta local.

### Consecuencias

- El usuario configura la ruta absoluta de su bóveda.
- Si no se configura o la ruta no existe, el contexto de Obsidian se omite.

**Estado:** Implementado en v0.5.0.

## ADR-005: Búsqueda web con fuentes desde Extension Host

### Contexto

Las preguntas actuales requieren navegación real y citas; Ollama local o una respuesta generativa sin búsqueda no debe presentarse como información recién verificada.

### Decisión

`AiClient` usa la herramienta server-side `openrouter:web_search` en OpenRouter. Si la extensión no tiene clave propia, la solicitud se envía a Smart AI Router con el mismo payload. Las citas `url_citation` se representan como enlaces. Las solicitudes web no hacen fallback a Ollama.

### Consecuencias

- La búsqueda necesita OpenRouter directo o Smart AI Router configurado con esa clave.
- Los costos de búsqueda y modelo dependen de la cuenta y proveedor configurados.
- Las respuestas muestran enlaces solo cuando OpenRouter devuelve annotations de fuentes.

**Estado:** Implementado en v0.6.0.

## ADR-006

**Actualización 1.2.0:** desactivado. La búsqueda web de OpenRouter puede cobrar aparte, así que no se llama en modo sin coste. Las preguntas de actualidad se responden sin Internet y con un aviso. El botón de búsqueda web se retiró (ADR-026).

## ADR-006: Transcribir archivos de audio antes de clasificar la solicitud

### Contexto

El dictado Web Speech puede fallar en VS Code Webview por las restricciones de permisos de micrófono. El texto reconocido debe recorrer el mismo enrutador de tareas que el texto escrito.

### Decisión

La extensión admite archivos de audio comunes hasta 12 MB totales y transcribe con Gemini desde Extension Host. El resultado reemplaza el texto vacío o se concatena al texto escrito antes de clasificar y planificar. Cuando el micrófono está bloqueado, la interfaz explica el límite y señala el adjunto como alternativa.

### Consecuencias

- La transcripción requiere una clave Gemini y envía el audio a la API de Google.
- El acceso en vivo al micrófono sigue dependiendo del permiso que exponga VS Code.
- El video y los archivos de audio mayores al límite no se procesan.

**Estado:** Implementado en v0.6.0.

**Actualización 1.2.0:** sustituido por ADR-026. La transcripción está desactivada; un adjunto de audio se descarta con un aviso y la petición sigue con el texto.

## ADR-007: Interpretación visible y conservadora de tareas

### Contexto

Las reglas de palabras clave no interpretan todas las formas naturales de pedir una tarea y pueden activar agentes sin intención real.

### Decisión

En modo agentes, `TaskPlanner` devuelve un plan JSON limitado a intenciones permitidas. Saludos y consultas de inventario omiten esa llamada. QA solo se admite cuando la persona pide una revisión explícita; una falla del planificador conserva el enrutamiento local. La UI muestra el objetivo, pasos y agentes antes de iniciar el flujo.

### Consecuencias

- El planificador usa una llamada adicional al modelo para solicitudes no triviales.
- La clasificación de intención no ejecuta por sí sola acciones externas; los agentes generan respuestas y propuestas.

**Estado:** Implementado en v0.6.0.

## ADR-004: Revisar propuestas con Diff antes de aplicar

### Contexto

Insertar una respuesta directamente puede reemplazar una selección importante o introducir código sin que el usuario revise el cambio.

### Decisión

`DiffManager` crea un documento virtual y abre la comparación nativa de VS Code. **Aceptar y aplicar** ejecuta un `WorkspaceEdit`; **Descartar** cierra la comparación sin tocar el archivo. Se captura el rango y la versión del documento; si cambió después de abrir el Diff, se invalida la propuesta.

### Consecuencias

- Sin selección, la propuesta se inserta en la posición del cursor.
- Con selección, la propuesta reemplaza ese rango.
- Cada propuesta Diff manual cubre un bloque de un archivo; las implementaciones del enjambre usan `WorkspaceChangeManager` para cambios multiarquivo.

**Estado:** Implementado en v0.5.0.

## ADR-008: Aplicar implementaciones completas en el workspace

### Contexto

El chat devolvía código como texto y la vista Diff solo cubría un bloque del editor activo, así que no podía crear proyectos ni implementar tareas multiarquivo.

### Decisión

Para solicitudes clasificadas como implementación, `CoderAgent` devuelve un JSON con rutas relativas y contenidos completos. `WorkspaceContext` aporta una muestra acotada del proyecto; `WorkspaceChangeManager` valida rutas y tamaños y aplica y guarda los archivos con `WorkspaceEdit`.

### Consecuencias

- Los cambios quedan limitados a la carpeta de trabajo abierta o seleccionada; no se ejecuta terminal de forma autónoma ni se escriben rutas de credenciales.
- Se rechazan documentos con cambios sin guardar, enlaces simbólicos, rutas fuera de la raíz y resultados mayores al límite.
- El Diff de bloques sigue disponible como alternativa manual. En v0.8+ se añadieron borrado, renombrado y reversión por entrega bajo las mismas validaciones.

**Estado:** Flujo base en v0.7.0; operaciones reversibles ampliadas en versiones posteriores.

## ADR-009: Investigación automática y equipo de subagentes adaptable

### Contexto

El usuario quiere que la búsqueda se active ante preguntas inciertas y que el progreso muestre un equipo variable, no un conjunto fijo de dos o tres roles.

### Decisión

`TaskPlanner` puede seleccionar `web_research` ante preguntas actuales, especializadas o no sustentadas por el contexto. Para investigación y análisis de implementación, el plan declara solo subtareas independientes útiles, hasta 100. `SubagentRunner` ejecuta hasta seis solicitudes remotas o una local a la vez y reporta cada estado a la UI.

### Consecuencias

- El planificador añade una llamada de IA para solicitudes no triviales en modo automático y en chat directo.
- Un plan grande puede generar consumo de API y tardar más; la concurrencia limita picos, no el número total de tareas.
- El Programador integra las conclusiones en un conjunto de cambios; los subagentes no escriben archivos por separado.

**Estado:** Implementado en v0.7.0.


## ADR-010: Importar adjuntos y carpetas desde el chat

### Contexto
Los archivos del Explorador no siempre se transferían al contexto y una carpeta podía tratarse como archivo. También era necesario evitar enviar credenciales accidentalmente.

### Decisión
El Webview separa archivos de carpetas y envía URIs locales al Extension Host. El Host vuelve a validar ruta, tipo, enlace simbólico, nombre sensible y límites; importa contenido de texto, imagen o audio admitido. Una carpeta se establece como workspace de tarea, no se copia al prompt. El contenido adjunto se marca como referencia no confiable y se redactan patrones comunes de secretos.

### Consecuencias
- Hay topes explícitos por archivo y por solicitud; elementos no admitidos se reportan.
- El workspace elegido sirve para lectura y escritura con los permisos normales del usuario.
- No se envía toda una carpeta por el hecho de seleccionarla.

**Estado:** Implementado en v0.9.0.

## ADR-011: Fallback local condicionado por RAM y diagnóstico de proveedores

### Contexto
El router podía agotar el tiempo de espera del cliente mientras probaba proveedores, y un fallback local podía cargar un modelo que dejara poca memoria disponible.

### Decisión
Se fijan plazos por proveedor y un plazo total para la cascada; la extensión espera más que el router y traduce los errores de timeout al español. Ollama procesa una solicitud a la vez, consulta modelos instalados y memoria libre, limita el fallback automático a modelos pequeños y no descarga modelos automáticamente.

### Consecuencias
- Una clave presente en health no significa que sea válida ni que tenga cuota.
- Cuando falla la nube, el mensaje distingue Ollama detenido, modelo ausente y RAM insuficiente.
- Un modelo local grande solo se puede probar por selección explícita y si pasa el umbral de seguridad.

**Estado:** Implementado en v0.9.0.

## ADR-012: Gemini como primera opción y OpenCode gratuito verificado en vivo

### Contexto
Se solicitó usar Gemini como proveedor cloud predeterminado y ofrecer modelos gratuitos de OpenCode sin seleccionar por error modelos de pago o retirados.

### Decisión
Smart AI Router intenta el modelo Gemini configurado primero. OpenCode Zen se incorpora mediante una lista compatible de modelos gratuitos intersectada con el catálogo oficial actual; requiere clave de API.

### Consecuencias
- Un proveedor gratuito puede cambiar su disponibilidad, cuota o requisitos de cuenta.
- La selección automática continúa por fallbacks configurados si Gemini no responde.
- Las claves permanecen en configuración local y no se muestran en health ni en el catálogo.

**Estado:** Implementado en Smart AI Router 1.3.0; reemplazado por ADR-013.

## ADR-013: Política estricta de costo cero

### Contexto
Una clave configurada no indica si una cuenta está en un plan gratuito o con facturación habilitada. Algunas APIs de búsqueda también se cobran aparte del modelo de texto.

### Decisión
La versión 0.9.1 aplica `zero-cost-only`: Ollama local y OpenRouter con IDs terminados en `:free` y precio de entrada/salida publicado de $0, o `openrouter/free`. Las rutas a Gemini, Groq, SambaNova, OpenCode, modelos de pago y APIs personalizadas se bloquean. La búsqueda web y la transcripción de Gemini no se invocan.

### Consecuencias
- Tener una clave antigua guardada no inicia solicitudes a esos servicios.
- Los límites gratuitos pueden agotarse; el router no añade créditos ni cambia a modelos de pago.
- Las preguntas de investigación se contestan sin consultar Internet y se advierte de ello. Un buscador futuro requiere un límite que bloquee por diseño los cargos por excedentes.
- El fallback local continúa condicionado por memoria libre; descargar modelos usa red y disco, la inferencia local no requiere API.

**Estado:** Implementado en extensión 0.9.1 y Smart AI Router 1.4.0; endurecido en ADR-014.

## ADR-014: Validación en vivo y prioridad a modelos chinos gratuitos

### Contexto
El catálogo gratuito de OpenRouter cambia y el usuario solicita usar Qwen y otros modelos chinos sin habilitar pagos. Un sufijo `:free` antiguo no debe bastar si el precio publicado ya no se puede confirmar.

### Decisión
Antes de cada solicitud con un modelo `:free`, Smart AI Router y la extensión consultan el catálogo actual y permiten el envío solo si entrada y salida siguen en $0. La ruta automática prioriza Qwen, DeepSeek, MiniMax/Kimi, GLM y otras familias chinas solo cuando aparecen en ese catálogo; continúa con `openrouter/free`, otros modelos gratuitos y Ollama local. No se agrega saldo ni se habilitan APIs con facturación incierta.

### Consecuencias
- Si el catálogo no se puede consultar o el modelo ya no aparece con precio cero, no se envía esa solicitud.
- La disponibilidad de familias chinas depende del catálogo y la cuota gratuita de OpenRouter.
- La búsqueda web y la transcripción cloud continúan apagadas porque pueden tener cargos aparte.

**Estado:** Implementado en extensión 0.9.2 y Smart AI Router 1.4.1.

## ADR-015: Gemini AI Studio Free Tier directo con respaldo sin costo

### Contexto
El usuario confirmó que su clave de Google AI Studio pertenece al nivel Free y solicitó priorizar los modelos Gemini disponibles sin pagar. Smart AI Router mantiene una lista de proveedores estrictamente gratuita, por lo que Gemini se integra desde la extensión y la clave no se copia al `.env` del router.

### Decisión
En extensión 0.9.3, `smart-router` intenta únicamente `gemini-3.8-flash` por el endpoint OpenAI compatible de Google. Si la solicitud falla, agota cuota o vence el tiempo, continúa con Smart AI Router, que solo usa OpenRouter `:free` verificado u Ollama local. La clave se almacena en SecretStorage de VS Code y, tras actualizar, el usuario debe volver a introducirla en ⚙️ APIs. No se habilitan Google Search grounding, otros modelos Gemini, ni SambaNova. El comprobador consulta la lista de modelos sin generar inferencia.

### Consecuencias
- La extensión no puede consultar ni imponer el estado de facturación del proyecto Google. El usuario debe mantenerlo en Free y sin facturación vinculada; si habilita facturación, las solicitudes pueden dejar de ser gratuitas.
- Las cuotas Free pueden limitar o rechazar solicitudes; el fallback solo recurre a los proveedores sin costo configurados.
- No se usan ni se guardan claves pegadas en la conversación; se introducen directamente en el campo seguro de VS Code.

**Estado:** Implementado en extensión 0.9.3; Smart AI Router permanece en 1.4.1.

## ADR-016: Circuito de enfriamiento para la cascada Gemini en tareas multiagente

### Contexto
Figma AI Copilot organiza proveedores detrás de un servicio único y cambia de modelo/proveedor al fallar. Su flujo de UI normalmente genera una solicitud de diseño; BSCL reutiliza `AiClient` en varios subagentes paralelos, de modo que un mismo 429, error de credencial o timeout podía repetirse para cada agente. La lista Gemini estática y el endpoint público de Pollinations del plugin son específicos del producto de diseño y no son una ruta de costo, privacidad o disponibilidad que debamos asumir para enviar código del workspace.

### Decisión
La extensión 0.9.4 incorpora `ProviderCooldown` en memoria y limita a tres las llamadas automáticas a Gemini que pueden estar en vuelo. Las que esperan vuelven a comprobar el estado. Si falla Gemini, las llamadas `smart-router` siguientes lo omiten durante 15 min para cuota, 10 min para autenticación/permisos, 60 s para timeout/5xx y 2 min para otros errores; si existe `Retry-After`, se respeta con un límite de 15 s a 24 h. Cambiar la clave limpia el estado. Solicitudes ya enviadas no se cancelan. El timeout de Gemini automático queda en 60 s. La cascada continúa con Smart AI Router, que conserva sus rutas verificadas de OpenRouter `:free` y Ollama. La selección explícita de Gemini conserva la llamada directa.

### Consecuencias
- Después de la primera falla, las nuevas llamadas automáticas pasan al fallback; solicitudes Gemini que ya estaban en vuelo no se cancelan.
- El circuito vive solo en la instancia de `AiClient` y no expone ni persiste claves.
- No se añaden APIs públicas sin clave ni se amplía el catálogo a modelos gratuitos no comprobados.

**Estado:** Implementado en extensión 0.9.4; Smart AI Router permanece en 1.4.1.

**Actualización 1.2.0:** los enfriamientos son por modelo, salvo dos casos que pausan todo el proveedor: la clave rechazada (`:auth`, 10 min) y la falta de conexión (`:net`, 45 s; 3 min si es timeout de conexión). Valores por modelo: cuota diaria 24 h, límite por minuto 60 s, otro 429 3 min, timeout 3 min, 5xx 45 s. Hay plazo total y cancelación (ADR-023).

## ADR-017: Groq Qwen Free opcional según Figma AI Copilot

### Contexto
Figma AI Copilot configura Gemini, Groq, Cerebras, OpenRouter, OpenAI directo y Pollinations. Su comentario de “1M tokens al día gratis” para Cerebras ya no representa la página actual de precios, y su llamada a Pollinations envía el prompt a un endpoint público. La petición de BSCL requiere conservar costo cero y proteger el código del workspace.

### Decisión
La extensión 0.9.5 permite únicamente `qwen/qwen3.8-27b` desde Groq, que aparece en la tabla oficial de límites Free. El usuario activa Groq por separado para la lista de modelos y para la cascada automática; ambas opciones vienen apagadas por defecto. La llamada automática va después de Gemini, se limita a una tarea en vuelo, omite imágenes y contextos de más de 24.000 caracteres, y limita la salida a 1.200 tokens. La clave permanece en SecretStorage y el catálogo de modelos se comprueba con el endpoint oficial. No se intenta leer el estado de facturación: el usuario debe mantener la cuenta en Free y sin método de pago.

Cerebras queda fuera porque ofrece crédito de prueba limitado y opción de pago por uso; OpenAI API queda fuera por facturación; Pollinations no se usa para prompts con archivos locales. OpenRouter conserva la verificación de precio `:free`; Ollama conserva sus límites de RAM.

### Consecuencias
- Groq aporta baja latencia para código, razonamiento y visión dentro de sus cuotas gratuitas; los agentes en paralelo que encuentren el cupo ocupado continúan con el fallback sin acumular cola.
- La extensión no puede garantizar costo cero si el usuario cambia la cuenta Groq al plan Developer o asocia un método de pago.
- La casilla “Incluir Groq en el modo Automático” permanece apagada hasta que el usuario confirme su plan.

**Estado:** Implementado en extensión 0.9.5; Smart AI Router permanece en 1.4.1.

**Actualización 1.2.0:** la casilla vuelve a mandar. Hasta la 1.1.0, guardar una clave de Groq activaba Groq en Automático aunque la casilla estuviera desmarcada. Ahora hacen falta la casilla **y** la clave, y viene apagada por defecto. En Automático, Groq admite hasta 2 llamadas a la vez y prueba 5 modelos.

## ADR-018: Cascada Multi-Modelo de Figma AI Copilot, Enrutamiento por Rol y Auto-Reparación JSON

### Contexto
Atar la extensión a un único modelo de Gemini (`gemini-3.8-flash`, 20 req/día) y un único modelo de Groq (`qwen/qwen3.8-27b` con 1.200 tokens máximos), además de tener quemado un modelo local de 7B (`huihui_ai/qwen2.5-coder-abliterate:7b`) para el `CoderAgent`, agotaba rápidamente la cuota o truncaba el JSON de salida del Programador. En `figma-ai-copilot`, la cascada `GEMINI_2026_MODELS`, el conector `free-cloud.js` y el reparador `repairTruncatedJson` demostraron alta resiliencia sin bloqueos.

### Decisión
En extensión 0.9.7 y Smart AI Router 2.0.0:
1. Se elimina el hardcoding del modelo local de 7B en `NeuralRouter` y `agent-registry.js`, delegando todos los agentes a `smart-router` con su respectivo `roleHint` (`architect`, `coder`, `qa`, `critic`, `planner`, `subagent`).
2. Se implementa la cascada multi-modelo de Gemini (`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-flash-lite-latest`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash`, `gemini-3.8-flash`), Groq (`qwen/qwen3.8-27b`, `openai/gpt-oss-120b`, `llama-3.3-70b-versatile`, `openai/gpt-oss-20b`, `llama-3.1-8b-instant`), Cerebras (`llama-3.3-70b`, `llama3.1-8b`), OpenRouter `:free` (puntuado por capacidad de código/parámetros) y Nube Gratuita Pública Sin API Key (`openai` ➔ `mistral`).
3. El enfriamiento (`ProviderCooldown`) pasa a ser granular por `proveedor:modelo`, permitiendo que si un modelo alcanza su límite por minuto (429), la solicitud salte de inmediato al siguiente modelo gratuito del mismo proveedor.
4. Se incorpora `json-repair.js` (`repairTruncatedJson` y `extractJsonObject`) en `CoderAgent` y `TaskPlanner`.
5. La cabecera del Webview inyecta dinámicamente la versión activa desde `package.json` (`{{appVersion}}`) para evitar confusiones con versiones previas instaladas en el IDE.
6. En modo Automático (`smart-router` / `auto`), tanto `bscl-ai-studio` como `smart-ai-router` operan **100% en la nube (Cloud-Only)** y desactivan el fallback automático a Ollama local (`ALLOW_AUTO_LOCAL_FALLBACK=false` por defecto) para no consumir RAM/CPU ni ralentizar el PC.

**Estado:** Implementado en extensión 0.9.9 y Smart AI Router 2.0.0.

**Actualización 1.3.0:** el Smart AI Router sale de Automático y entra Z.ai (ADR-027).

**Actualización 1.2.0:** Cerebras sale de Automático: su cuenta es de crédito de prueba y la clave no tenía campo en la interfaz. La Nube pública sigue como último recurso, pero solo en chat directo, sin imágenes y sin ningún contexto del proyecto, y recibe solo el último turno. OpenRouter entra en Automático antes que el Smart Router.

## ADR-019: Auto-Detección de Sub-Proyectos, Edición Quirúrgica (`SEARCH / REPLACE`) y Bucle de Herramientas (`ReAct`)

### Contexto
En workspaces que agrupan múltiples repositorios (como `proyectos con ia`), la extensión necesita enfocar automáticamente el proyecto sobre el que el usuario está trabajando o hablando, editar archivos grandes mediante bloques quirúrgicos sin gastar miles de tokens reescribiendo todo el archivo, consultar archivos/símbolos bajo demanda y verificar la sintaxis antes de guardar.

### Decisión
En extensión 1.0.0:
1. `WorkspaceScopeResolver` (`src/workspace-scope-resolver.js`) detecta automáticamente la subcarpeta del proyecto objetivo a partir del nombre mencionado en el prompt o del archivo abierto en el editor activo cuando no se fijó una carpeta manual.
2. `PatchApplier` (`src/patch-applier.js`) permite que `CoderAgent` devuelva `patches: [{ path, search, replace }]` además de `files`, resolviendo los parches sobre los archivos reales y preservando el flujo de reversión (`Undo`) de `WorkspaceChangeManager`.
3. `AgentToolLoop` (`src/agents/agent-tool-loop.js`) ejecuta herramientas bajo demanda (`read_file`, `search_code`, `list_files`) confinadas a la carpeta del proyecto y verifica sintácticamente (`node --check` / `JSON.parse`) los archivos propuestos para que el `CoderAgent` autocorrija errores sintácticos antes de guardar.

**Estado:** Implementado en extensión 1.0.0.

**Actualización 1.2.0:** la carpeta elegida por el usuario siempre manda. La autodetección solo actúa sin carpeta elegida, compara por palabra completa (antes «rápido» encajaba con `api/`) y solo considera subproyectos reales: carpetas con `package.json`, `.git`, `pyproject.toml`… El deshacer usa la raíz guardada en cada entrega.

## ADR-020: Interfaz nativa con las variables del tema de VS Code

### Contexto
El panel usaba una paleta propia fija (azul neón sobre fondo casi negro) y no seguía el tema del usuario.

Medido en un panel de 400 px:

- 69 de 109 textos estaban por debajo de 11 px.
- La cabecera de tres filas se desbordaba.
- Había 24 emojis como iconos.
- La tarjeta fija del enjambre tapaba 312 de 602 px del chat.

### Decisión
- `styles.css` solo usa variables `--vscode-*`, con fallbacks dentro de `var()`.
- Tipografía y densidad del editor: 13 px de lectura, 11 px como mínimo.
- Iconos SVG propios que toman el color del texto.
- Nuevo chat, Historial y Ajustes pasan a la barra del panel (`menus.view/title`).
- El progreso de los agentes va dentro de la respuesta, en una tarjeta plegable.

### Consecuencias
- El panel sigue el tema claro, oscuro y de alto contraste. Textos bajo 11 px: 0 de 65. Colores
  fijos: 135 → 4. Área de chat: 602 → 704 px.
- Los botones de la barra del panel solo se ven al pasar el ratón o con el panel enfocado
  (comportamiento estándar de VS Code).
- `tools/webview-preview/` permite revisar el diseño en el navegador sin el Extension Host.

**Estado:** Propuesto en la revisión 1.2.0, pendiente de aprobación del autor.

## ADR-021: Claves enmascaradas y ajustes guardados por parche

### Contexto
`getConfig` enviaba todas las claves en claro al webview en cada carga. El formulario reescribía
toda la configuración: guardar antes de que cargara, o con un campo vacío, borraba claves.

### Decisión
El webview recibe `{ configured, hint }` por clave (`hint` = 4 últimos caracteres). Al guardar
envía un parche: solo las claves nuevas y las que se piden borrar.
`ConfigManager.applySettingsPatch` valida todo antes de escribir nada y devuelve el campo del
error.

### Consecuencias
- Ninguna clave completa llega al DOM del webview.
- Lo que no se toca se conserva. Las claves de proveedores retirados se pueden borrar desde
  Ajustes.

**Estado:** Propuesto en la revisión 1.2.0, pendiente de aprobación del autor.

## ADR-022: Ajustes solo de usuario (`scope: application`)

### Contexto
`bsclAi.smartRouterUrl` se podía fijar en el `.vscode/settings.json` de un repositorio. Al
abrirlo, las conversaciones, con código del workspace, se enviaban a ese servidor. Lo mismo
valía para `defaultModel`, con el que se podía preseleccionar un modelo de pago.

### Decisión
Los cuatro ajustes `bsclAi.*` llevan `scope: application`. `ConfigManager` los lee con
`inspect().globalValue`. `defaultModel` ignora los modelos de pago y Ollama exige loopback.

### Consecuencias
Un repositorio ya no puede cambiar a dónde se envían las conversaciones ni qué proveedor se
usa. Configurar un Smart Router remoto sigue siendo posible desde los ajustes de usuario.

**Estado:** Propuesto en la revisión 1.2.0, pendiente de aprobación del autor.

## ADR-023: Cancelación y plazo global por llamada

### Contexto
No había forma de cancelar. Sumando los timeouts de la cascada, el peor caso de un mensaje en
Automático era de unos 853 s (calculado, no medido), y cada agente del enjambre podía repetirlo.

### Decisión
- Cada petición tiene un `AbortController`.
- `AiClient.setAbortSignal(signal)` lo combina con un plazo de 170 s por llamada a
  `sendMessage`, y cada `fetch` usa `AbortSignal.any`.
- Las cascadas y el enjambre relanzan el `AbortError` sin registrar enfriamiento.
- Si se cancela, no se escribe ningún archivo.

### Consecuencias
Detener responde enseguida. Un plazo vencido es un error (`BSCL_DEADLINE`) y una cancelación
no lo es (`requestCancelled`). Se procesa una petición a la vez por panel.

**Estado:** Propuesto en la revisión 1.2.0, pendiente de aprobación del autor.

## ADR-024: Confirmar los cambios arriesgados

### Contexto
Borrados, renombrados y reescrituras completas se aplicaban sin confirmación. Un modelo
gratuito puede devolver un archivo truncado («// resto igual»). El deshacer no cubre ediciones
posteriores del usuario.

### Decisión
- `WorkspaceChangeManager.assessRisk` detecta borrados, renombrados y archivos que pierden más
  del 50 % de su tamaño. La extensión pide confirmación modal con tres salidas: *Aplicar todo*,
  *Solo crear y editar* o cancelar.
- Deshacer por texto también pide confirmación.
- Cada archivo lleva la huella (`baseHash`) de lo que se leyó. Si el disco cambió durante la
  generación, la entrega se rechaza.

### Consecuencias
Un clic más en las entregas destructivas. No se pisa trabajo guardado durante la generación.

**Estado:** Propuesto en la revisión 1.2.0, pendiente de aprobación del autor.

## ADR-025: Un único módulo de datos sensibles

### Contexto
El regex de redacción estaba copiado en cinco archivos y fallaba en los dos sentidos. Alteraba
código normal (`if (password === confirm)`, `token => …`) y dejaba pasar `OPENAI_KEY=…`, bloques
PEM y credenciales en URLs. El filtro de nombres bloqueaba `token.service.ts` o `tokenizer.js`.

### Decisión
`src/sensitive-data.js` es la fuente única:

- `isSensitiveFileName`, `isSensitivePath`, `redactSecrets` y `safeFileContent`.
- Solo redacta literales: cadenas entre comillas, variables `*_KEY`, `*_TOKEN`…, formatos de
  token conocidos, credenciales en URLs y PEM.
- Los valores sin comillas solo se redactan en archivos de configuración.
- El patrón de nombres vive en `webview/sensitive-names.js`, compartido con el webview.

### Consecuencias
Menos falsos positivos y menos fugas, con tests de los dos lados. Lo que no tenga un formato
reconocible no se detecta.

**Estado:** Propuesto en la revisión 1.2.0, pendiente de aprobación del autor.

## ADR-026: Retirar el micrófono, los adjuntos de audio y el botón de búsqueda web

### Contexto
VS Code no concede el micrófono a los webviews, así que el dictado solo producía errores. La
transcripción de audio está desactivada, así que un adjunto de audio hacía fallar toda la
petición. El botón de búsqueda web no buscaba nada y multiplicaba las llamadas al planificador y
a los subagentes.

### Decisión
Se retiran los tres controles. Un audio que llegue igualmente se descarta con un aviso y la
petición sigue con el texto.

### Consecuencias
Menos controles rotos. Si vuelve un proveedor de búsqueda o transcripción que no pueda cobrar,
habrá que reintroducirlos con su propio ADR.

**Estado:** Propuesto en la revisión 1.2.0, pendiente de aprobación del autor.

## ADR-027: Retirar el Smart AI Router y añadir Z.ai (GLM Flash)

### Contexto
Automático tenía como paso 4 un servidor local propio, el Smart AI Router, en
`http://localhost:3000`.

- Quien instala la extensión no tiene ese servidor. Sin claves, Automático acababa en un error
  que solo nombraba al router («Smart Router: respondió sin texto»).
- En el puerto 3000 suele haber otra aplicación (React, Next…), que recibía las conversaciones
  con código del proyecto.
- El autor pidió quitar el router y añadir IAs en la nube, por ejemplo modelos chinos.

Revisión de las páginas oficiales el 2026-10-17:

- **Z.ai.** `https://docs.z.ai/guides/overview/pricing` marca GLM-4.7-Flash, GLM-4.5-Flash y
  GLM-4.6V-Flash como gratuitos en entrada y salida. Los «FlashX» y GLM-5.3 cobran.
- **SiliconFlow internacional.** No tiene modelos de chat gratuitos, solo $1 de crédito. Sus
  modelos gratuitos de la plataforma china exigen verificación de identidad china. Se descartó.

### Decisión
- Se retiran del código, la interfaz, los ajustes (`bsclAi.smartRouterUrl`) y «Probar
  conexiones»:
  - el paso del router en Automático;
  - sus modelos `router:`.
- Los ids `router:` guardados pasan a Automático.
- Z.ai entra como proveedor gratuito, con clave en Ajustes, en Automático después de Gemini y
  Groq. Usa GLM-4.7-Flash y luego GLM-4.5-Flash, y con imágenes GLM-4.6V-Flash. También se usa
  para describir imágenes en modelos sin visión.
- Solo se envían los tres IDs de precio $0. Un modelo `zai:` de pago se rechaza sin llamar a la
  API.
- Sin ninguna clave, Automático lanza `BSCL_NO_PROVIDER` y el panel ofrece abrir Ajustes.
- Ollama se queda como opción manual.

### Consecuencias
- La extensión funciona igual para cualquiera: no depende de nada instalado en el equipo, salvo
  Ollama si se elige a mano.
- Hace falta al menos una clave gratuita para las tareas de agentes.
- Z.ai no publica un endpoint para listar modelos: los IDs van fijos y «Probar conexiones» los
  confirma con una petición de 1 token a un modelo gratuito.
- Los límites de uso de los modelos gratuitos de Z.ai no se pudieron leer: su página exige
  iniciar sesión.

**Estado:** Implementado en extensión 1.3.0.
