# Changelog

Cambios por versión de BSCL AI Studio. Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Las fechas salen del historial de git; las versiones anteriores a 1.0.0 no tienen fecha registrada.

## [1.3.0] — 2026-10-17

### Proveedores

- **Z.ai (GLM)** como proveedor gratuito, con su clave en Ajustes.
  - En Automático va después de Gemini y Groq: GLM-4.7-Flash y luego GLM-4.5-Flash.
  - Con imágenes usa GLM-4.6V-Flash, que también describe imágenes para los modelos sin visión.
  - Solo se envían modelos de precio $0, según la página oficial de precios consultada el
    2026-10-17.
- **Retirado el Smart AI Router local** (`bsclAi.smartRouterUrl`): era un servidor propio que
  los demás usuarios no tienen. Los ids `router:` de conversaciones guardadas pasan a
  Automático.
- Sin ninguna clave, las tareas de agentes en Automático avisan antes de empezar y ofrecen un
  botón **Abrir ajustes**. Los mensajes de error ya no dicen «smart-router».

### Proyecto

- 8 tests nuevos de Z.ai y de la retirada del router (273 en total).

## [1.2.0] — 2026-10-15

Revisión completa: auditoría de 131 hallazgos verificados contra el código, rediseño del
panel y 263 tests nuevos.

### Interfaz

- Panel rediseñado con los colores, la tipografía y los iconos del tema de VS Code: sigue el tema
  claro, oscuro y de alto contraste. Medido en un panel de 400 px: textos de menos de 11 px
  69 de 109 → 0 de 65; colores fijos en el CSS 135 → 4 (solo como respaldo); emojis 24 → 0.
- Nuevo chat, Historial y Ajustes pasan a la barra del panel. La cabecera de tres filas, que se
  desbordaba, desaparece: el área de chat pasa de 602 a 704 px.
- El progreso de los agentes va dentro de la respuesta, en una tarjeta que se pliega sola al
  terminar. Antes era una tarjeta fija que tapaba 312 de 602 px del chat.
- Botón **Detener** (o Esc) que cancela la petición de verdad.
- Respuestas con enlaces, tablas, listas anidadas y de tareas, y resaltado de sintaxis.
- Historial a pantalla completa con búsqueda, grupos por fecha y borrado con confirmación.
- Ajustes reorganizados: claves enmascaradas, validación en línea, casilla de Nube pública,
  estado de conexiones y borrado de claves antiguas.
- Selector de modelo agrupado en Automático, Gratis, Local y De pago.
- Menú contextual **BSCL AI** en el editor. Los comandos funcionan aunque el panel no se haya
  abierto todavía.
- Al cambiar de conversación con una petición en curso, la respuesta tardía ya no aparece en el
  chat nuevo.
- Si una petición falla, el mensaje vuelve al cuadro de texto para reintentarlo.
- Retirados el micrófono (VS Code no da micrófono a los paneles), los adjuntos de audio (la
  transcripción está desactivada y hacían fallar toda la petición) y el botón de búsqueda web
  (no buscaba y multiplicaba las llamadas).

### Seguridad y privacidad

- Las claves de API ya no se envían al panel: solo se indica si están configuradas y sus 4
  últimos caracteres. Guardar ajustes ya no puede borrar claves por accidente.
- Los ajustes `bsclAi.*` solo se leen de la configuración de usuario: un repositorio ya no
  puede desviar las conversaciones cambiando la URL del Smart Router.
- La Nube pública nunca recibe el contexto del proyecto, aunque la interfaz ya lo prometía antes.
- Redacción de secretos reescrita (`src/sensitive-data.js`): ya no corrompe código como
  `password === confirm` y ahora tapa `OPENAI_KEY=…`, bloques PEM y credenciales en URLs.
- El archivo activo con credenciales (`.env`, claves…) no se envía al modelo.
- Política de seguridad del panel más estricta (scripts con nonce, sin estilos en línea).
- Eliminado un manejador que mandaba cualquier texto a la terminal.
- Corregida una inyección de HTML en los títulos del historial.
- Los agentes ya no pueden escribir en `.vscode/` ni leer carpetas de credenciales.

### Coste

- Las imágenes enviadas con un modelo gratuito ya no acaban en xAI o Meta, que son de pago.
- La casilla «Usar Groq en Automático» se respeta: antes, con una clave guardada, Groq se usaba
  siempre.
- Cerebras sale del modo Automático: su cuenta es de crédito de prueba y la clave no tenía campo
  en la interfaz.
- `bsclAi.defaultModel` ya no puede preseleccionar un modelo de pago.

### Agentes y enrutamiento

- Cancelación real y plazo total de 170 s por llamada. Antes, en el peor caso calculado, un
  mensaje podía tardar unos 14 minutos.
- Enfriamientos por modelo y por proveedor. Una clave rechazada o sin conexión pausa todo el
  proveedor; un timeout pausa solo ese modelo.
- OpenRouter prueba hasta 3 modelos gratuitos verificados, no solo el primero.
- Un modelo Ollama elegido a mano va directo a Ollama, sin pasar por el Smart Router.
- Las respuestas JSON cortadas o truncadas por límite de tokens ya no se guardan como archivos
  completos.
- Los cambios de las peticiones visuales (UI) ya se guardan; antes se perdían sin aviso.
- El enrutador entiende peticiones en subjuntivo («quiero que corrijas…») y continuaciones
  («sí, hazlo»).
- El plan muestra exactamente las subtareas que se ejecutan (máximo 16).
- Ningún agente se queda en «Trabajando» para siempre.
- Las notas de Obsidian deben marcarse con `bscl-skill: <clave>` para usarse. Los prompts ya no
  llevan datos personales.

### Archivos y deshacer

- Confirmación antes de borrar, renombrar o reducir un archivo a menos de la mitad.
- No se pisa un archivo que el usuario guardó mientras el modelo generaba.
- Deshacer restaura los bytes exactos (sin perder codificación ni BOM) y funciona aunque hayas
  cambiado de carpeta de trabajo.
- Deshacer por texto («deshaz los cambios») pide confirmación y ya no se activa con cualquier
  frase que empiece por «Restaura…».
- La carpeta elegida por el usuario manda. Antes, «rápido» bastaba para saltar a una carpeta
  `api/`.
- El historial tiene límites de tamaño (50 conversaciones, 120 mensajes, 24 000 caracteres
  por mensaje) y el panel solo recibe resúmenes.

### Proyecto

- 263 tests con `node:test` (`npm test`) y vista previa del panel sin VS Code
  (`npm run preview`).
- `package.json`: categorías, palabras clave, comandos con icono, menús y ajustes con
  `scope: application`.
- Icono PNG, enlaces al repositorio y workflow de publicación (Brayan).
- El workflow de publicación ejecuta los tests antes de publicar. Ya no llama a `npm ci`, que
  fallaba por no haber `package-lock.json`.
- El historial de versiones sale del README a este archivo.

## [1.1.0] — 2026-10-14

- Modelos gratuitos de OpenCode Zen (solo texto).
- Análisis automático de imágenes con un modelo de visión antes de pasarlas a un modelo sin
  visión.
- Proveedores de pago opcionales: xAI Grok y Meta Muse, con su clave en SecretStorage.
- Historial persistente más robusto y restauración de la carpeta de trabajo al retomar una
  conversación.
- Mejor detección al arrastrar archivos y carpetas.
- Reintentos y concurrencia de subagentes; visibilidad de carpetas anidadas.

## [1.0.0] — 2026-10-13

- Autodetección de subproyectos cuando la carpeta raíz contiene varios proyectos.
- Edición por bloques `SEARCH / REPLACE` además de reescritura completa de archivos.
- Bucle de herramientas para los agentes (`read_file`, `search_code`, `list_files`) y
  verificación sintáctica antes de guardar.

## [0.9.9]

- Cascada multimodelo con enrutamiento por rol y reparación de JSON truncado (ADR-018).

## [0.9.6] — Uso automático según cuota

- El modo Automático intenta Gemini; cuando Groq Free está habilitado, lo usa como respaldo antes de Smart AI Router. Una sola casilla habilita Groq tanto en el selector como en la cascada.
- Lee `Retry-After`, los tiempos de reinicio y las cabeceras de cuota disponibles. Cuando un proveedor marca su límite como agotado, la extensión lo pausa y continúa con el siguiente proveedor gratuito.
- Smart AI Router sigue limitado a OpenRouter `:free` verificado y Ollama local. IDs cloud antiguos guardados en conversaciones se sustituyen por la cascada gratuita; las selecciones válidas `:free` se conservan.
- Groq solo se usa con una clave configurada y la confirmación del usuario de que su cuenta permanece en Free, sin método de pago. La extensión no puede comprobar el plan ni garantizar que una cuenta configurada para facturar no genere cargos.

Fuentes oficiales: [límites de Gemini](https://ai.google.dev/gemini-api/docs/rate-limits), [precios Free de Gemini](https://ai.google.dev/gemini-api/docs/pricing), [cabeceras de cuota Groq](https://console.groq.com/docs/rate-limits).

## [0.9.5] — Proveedores de Figma con rutas gratuitas

- Se habilita Groq con el modelo `qwen/qwen3.8-27b`, que Groq incluye en sus límites del plan Free. La extensión solo permite ese ID, consulta el catálogo oficial antes de mostrarlo y limita a una solicitud simultánea.
- Groq aparece en la lista y en el modo automático después de confirmar que la cuenta es Free con una casilla en ⚙️ APIs.
- La ruta automática limita Groq a contexto pequeño y respuestas de hasta 1.200 tokens para respetar los límites gratuitos; si está ocupado, tiene cuota agotada o recibe imágenes, pasa a Smart AI Router.
- La pantalla de APIs explica qué conviene usar: Gemini para programación y tareas largas; Groq/Qwen para velocidad, código y visión; OpenRouter `:free` para alternar modelos gratuitos; Ollama para trabajo local.
- Cerebras, OpenAI directo y Pollinations no se copian a la cascada: Cerebras ofrece créditos de prueba limitados, OpenAI API puede facturar y Pollinations recibe el prompt en un endpoint público sin control de la extensión.
- Las claves Groq se guardan en SecretStorage de VS Code. La extensión no puede comprobar el nivel de facturación de Groq; usa una cuenta Free sin método de pago y no cambies al plan Developer.

Groq Free publica para Qwen 3.8 27B un límite base de 30 solicitudes/minuto, 1.000 solicitudes/día, 8.000 tokens/minuto y 200.000 tokens/día; los límites exactos pueden variar por cuenta. Si el plan cambia a Developer, Groq factura por token. Verifica el plan en Groq Console antes de habilitarlo.

Fuentes oficiales: [límites Free de Groq](https://console.groq.com/docs/rate-limits), [modelos de Groq](https://console.groq.com/docs/models), [facturación de Groq](https://console.groq.com/docs/billing-faqs), [prueba gratuita de Cerebras](https://www.cerebras.ai/inference), [precios Gemini](https://ai.google.dev/gemini-api/docs/pricing) y [router OpenRouter gratuito](https://openrouter.ai/openrouter/free/apps).

## [0.9.4] — Cascada eficiente entre agentes

- Gemini continúa primero en automático. Si falla, el cliente registra una pausa temporal para no repetir el mismo intento fallido en cada subagente de una tarea paralela.
- Las llamadas automáticas a Gemini se limitan a tres simultáneas; las siguientes esperan un cupo y vuelven a revisar la pausa antes de enviar.
- La pausa distingue cuota, credenciales y fallos de servicio; respeta `Retry-After` cuando el proveedor lo envía. Cambiar la clave limpia la pausa. La llamada automática a Gemini vence a los 60 segundos.
- Reutiliza la idea de cascada del Figma AI Copilot, adaptada al flujo multiagente de VS Code. Conserva los modelos gratuitos ya verificados y el almacenamiento de claves en SecretStorage.
- No se copia la nube pública de Pollinations ni la lista fija de modelos Gemini del plugin Figma: pueden enviar código a un tercero y no son una garantía de cuota gratuita o disponibilidad para tareas de desarrollo.

## [0.9.3] — Gemini Free Tier

- Con una clave de tu proyecto **Free** de Google AI Studio, el modo automático intenta primero `gemini-3.8-flash`; si falla o agota su cuota, continúa con Smart AI Router (OpenRouter `:free` u Ollama local).
- La clave Gemini se guarda en SecretStorage de VS Code. Al actualizar, una clave antigua no se activa automáticamente: vuelve a introducir la clave del proyecto Free en ⚙️ APIs.
- No se activa Google Search grounding, audio cloud ni otros proveedores de pago. SambaNova continúa desactivado.
- La extensión no puede consultar ni bloquear la facturación de tu proyecto Google. Mantén el proyecto sin facturación vinculada para que el uso no pase a la tarifa de pago después de agotar cuotas gratuitas.
- Smart AI Router conserva su propia ruta estricta de OpenRouter `:free` y Ollama; Gemini se usa desde la extensión.

## [0.9.2] — APIs gratuitas verificadas

- Antes de cada solicitud cloud, el router actualiza el catálogo y confirma precio de entrada y salida de $0. Prioriza familias gratuitas chinas como Qwen, DeepSeek, MiniMax/Kimi y GLM cuando están disponibles; si no, usa `openrouter/free` y otros modelos gratuitos publicados.
- El router solo usa Ollama local o OpenRouter con precio verificado de $0. Groq, SambaNova, OpenCode y APIs personalizadas no se ejecutan.
- El selector no ofrece modelos de pago. El router devuelve HTTP 403 si una selección antigua pide un proveedor bloqueado o un modelo OpenRouter sin `:free`.
- La búsqueda web de OpenRouter quedó desactivada: su herramienta se cobra aparte incluso si el modelo de texto es gratuito. Las respuestas de investigación avisan que no consultaron Internet.
- La transcripción cloud permanece desactivada. El mensaje HTTP 503 muestra el diagnóstico legible, y los modelos sin precio confirmado se bloquean antes de enviarse.
- Smart AI Router v1.4.1 publica en `/health` la política `zero-cost-only`.

## [0.9.0]

- En v0.9.0, el **Smart AI Router v1.3.0** intentaba Gemini y otros proveedores. Esa política fue reemplazada por el modo de costo cero de v0.9.1.
- El router limita el tiempo de cada proveedor y la duración total de una cadena de fallbacks, muestra un diagnóstico útil si no hay modelo Ollama o memoria suficiente y evita reintentar Ollama desde la extensión después de un 503.
- Las solicitudes a Ollama pasan por una cola de una en una, solo cargan modelos ligeros con RAM suficiente, limitan contexto y salida, y piden descargar el modelo al terminar.
- Los errores de timeout se presentan en español; el chat espera más que el límite global del router para recibir su diagnóstico final.
- Se pueden adjuntar archivos de código/texto junto con imágenes y audio. El arrastre desde el Explorador de VS Code separa carpetas de archivos; las carpetas se usan como ámbito del proyecto y los archivos se adjuntan al mensaje.
- Los adjuntos de texto tienen un límite de 64 KB por archivo y 160 KB por mensaje; se excluyen nombres sensibles y se redactan claves comunes antes de enviarlos.

## [0.8.3]

- Ajuste menor al guardar la carpeta de tarea seleccionada en el estado de VS Code.

## [0.8.2]

- La carpeta de tarea seleccionada se conserva después de reiniciar o recargar VS Code.

## [0.8.1]

- Las auditorías también leen el contexto de la carpeta seleccionada y ahora incluyen Gradle Kotlin DSL (`.kts`) y propiedades de configuración no locales.
- Los subagentes completan revisiones independientes de estructura, lógica y seguridad; QA espera esos resultados y redacta el informe con las rutas y el código adjuntados.

## [0.8.0]

- Puedes arrastrar una carpeta al chat para acotar qué archivos lee y modifica el agente; el botón de carpeta también abre el selector de VS Code.
- Los cambios de cada tarea muestran los archivos creados, editados, borrados o renombrados, y permiten revertir la entrega. La extensión conserva hasta cinco entregas y evita revertir si detecta cambios posteriores en esos archivos.
- Las solicitudes de programación siempre pasan por el Programador, también si el selector está en Chat Directo. Las revisiones independientes terminan antes de que el Programador aplique sus hallazgos; luego se vuelve a revisar la versión ajustada.
- Google Gemini se conecta directamente y carga los modelos disponibles para la clave configurada. También se puede definir un proveedor compatible con OpenAI.
- Groq carga sus modelos de chat directamente; OpenRouter muestra modelos cuyo precio publicado es cero y ofrece su enrutador gratuito. La disponibilidad y límites dependen de cada proveedor.
- OpenCode se puede conectar como proveedor de agentes, usando `opencode serve` y los modelos ya configurados ahí. Sus agentes devuelven análisis; BSCL valida y aplica los cambios.
- El panel puede recomendar y descargar un tamaño de Qwen 3.5 según la RAM disponible, con cuantización Q4 en los perfiles de 2B o más. Las solicitudes a Ollama reducen contexto y entrada cuando la memoria libre es baja.
- Las claves se guardan en el almacenamiento seguro de VS Code y dejan de copiarse automáticamente al `.env` del workspace.

## [0.7.2]

Asistente de desarrollo para Visual Studio Code, creado por **Brayan Stid Cortés Lombana (`bscl`)**. Conecta el chat con Smart AI Router, Ollama, OpenRouter y Gemini; añade contexto del editor y coordina agentes según la intención.

## [0.7.1]

- El panel de agentes permanece anclado mientras se desplaza la conversación; su contenido tiene desplazamiento propio cuando es extenso.
- El cuadro de escritura crece automáticamente hasta un límite adaptable y permite desplazarse dentro del texto largo, manteniéndose fijo al pie del chat.

## [0.7.0]

- En modo **Agentes según la tarea**, las solicitudes de implementación leen el workspace, generan archivos completos y los crean o guardan directamente en la carpeta abierta.
- El planificador activa investigación web automáticamente para preguntas actuales, especializadas o sin contexto suficiente; saludos y preguntas sobre carpetas locales no disparan búsquedas.
- El plan puede delegar entre 1 y 100 subtareas. Se muestran estados en vivo; hay hasta 6 solicitudes simultáneas con modelos remotos y 1 con modelos locales.
- Las respuestas de chat, investigación y agentes se redactan en español.
- La escritura valida rutas y bloquea salidas del workspace, enlaces simbólicos, carpetas de dependencias, archivos binarios y archivos de credenciales. Los documentos con cambios sin guardar requieren guardarse antes.

## [0.6.0]

- La búsqueda web se activa al pedir “busca en internet”, “investiga” o desde el botón 🌐. Las respuestas incluyen enlaces a las fuentes devueltas por OpenRouter.
- Los archivos de audio adjuntos se transcriben antes de interpretar la solicitud; el texto transcrito pasa por el mismo enrutador de tareas y agentes.
- El modo **Agentes según la tarea** interpreta solicitudes en lenguaje natural y muestra el objetivo, los pasos y los agentes elegidos antes de ejecutarlos.
- El botón de micrófono informa cuando VS Code bloquea ese permiso y ofrece el adjunto de audio como alternativa.

#### Requisitos de estas funciones

- **Búsqueda web:** está pausada en modo sin costo porque el buscador de OpenRouter puede cobrar por consulta. El chat advierte que responde sin consultar Internet.
- **Transcripción de audio:** la API de Gemini está bloqueada en modo sin costo. El dictado por micrófono depende de VS Code y del navegador; un audio adjunto no se envía a un servicio cloud.
- El dictado por micrófono depende de la política de permisos de VS Code Webview. Si está bloqueado, adjunta una grabación con 📎.

## [0.5.2]

- Al preguntar por los proyectos/carpetas del workspace, el asistente recibe la lista real de carpetas de primer nivel.
- La interfaz las llama “carpetas principales” porque no se verifica automáticamente si cada una contiene un proyecto.

## [0.5.1]

- El modo automático detecta saludos, preguntas y solicitudes técnicas; solo activa los agentes necesarios para la tarea.
- Un saludo como “hola” recibe una respuesta normal, sin contexto del editor ni pasos de QA.
- Arquitectura y auditoría explícitas usan sus agentes especializados; para implementar código se ejecutan Programador y revisión de calidad.
- Los hallazgos de QA complementan la implementación y ya no sustituyen el código generado.

## [0.5.0]

- El Arquitecto y el Programador trabajan en secuencia; después, el Crítico multimodal y el Auditor QA revisan en paralelo.
- El panel muestra estado, acción y modelo de cada agente. Al seleccionar un nodo se ven sus detalles.
- Las imágenes adjuntas llegan al modelo compatible con visión. Se aceptan PNG, JPEG, WebP y GIF de hasta 8 MB.
- El renderizado del chat escapa HTML recibido y la lectura de archivos valida rutas reales dentro del workspace.
- Cada bloque de código puede abrirse en el Diff de VS Code y aceptarse o descartarse desde el chat.
- La aplicación del Diff se cancela si el archivo cambió después de abrir la comparación.
