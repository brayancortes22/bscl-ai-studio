# BSCL AI Studio para VS Code

![Versión](https://img.shields.io/badge/version-0.9.6-blue.svg)

## Novedades de la versión 0.9.6: uso automático según cuota

- El modo Automático intenta Gemini; cuando Groq Free está habilitado, lo usa como respaldo antes de Smart AI Router. Una sola casilla habilita Groq tanto en el selector como en la cascada.
- Lee `Retry-After`, los tiempos de reinicio y las cabeceras de cuota disponibles. Cuando un proveedor marca su límite como agotado, la extensión lo pausa y continúa con el siguiente proveedor gratuito.
- Smart AI Router sigue limitado a OpenRouter `:free` verificado y Ollama local. IDs cloud antiguos guardados en conversaciones se sustituyen por la cascada gratuita; las selecciones válidas `:free` se conservan.
- Groq solo se usa con una clave configurada y la confirmación del usuario de que su cuenta permanece en Free, sin método de pago. La extensión no puede comprobar el plan ni garantizar que una cuenta configurada para facturar no genere cargos.

Fuentes oficiales: [límites de Gemini](https://ai.google.dev/gemini-api/docs/rate-limits), [precios Free de Gemini](https://ai.google.dev/gemini-api/docs/pricing), [cabeceras de cuota Groq](https://console.groq.com/docs/rate-limits).

## Novedades de la versión 0.9.5: proveedores de Figma con rutas gratuitas

- Se habilita Groq con el modelo `qwen/qwen3.8-27b`, que Groq incluye en sus límites del plan Free. La extensión solo permite ese ID, consulta el catálogo oficial antes de mostrarlo y limita a una solicitud simultánea.
- Groq aparece en la lista y en el modo automático después de confirmar que la cuenta es Free con una casilla en ⚙️ APIs.
- La ruta automática limita Groq a contexto pequeño y respuestas de hasta 1.200 tokens para respetar los límites gratuitos; si está ocupado, tiene cuota agotada o recibe imágenes, pasa a Smart AI Router.
- La pantalla de APIs explica qué conviene usar: Gemini para programación y tareas largas; Groq/Qwen para velocidad, código y visión; OpenRouter `:free` para alternar modelos gratuitos; Ollama para trabajo local.
- Cerebras, OpenAI directo y Pollinations no se copian a la cascada: Cerebras ofrece créditos de prueba limitados, OpenAI API puede facturar y Pollinations recibe el prompt en un endpoint público sin control de la extensión.
- Las claves Groq se guardan en SecretStorage de VS Code. La extensión no puede comprobar el nivel de facturación de Groq; usa una cuenta Free sin método de pago y no cambies al plan Developer.

Groq Free publica para Qwen 3.8 27B un límite base de 30 solicitudes/minuto, 1.000 solicitudes/día, 8.000 tokens/minuto y 200.000 tokens/día; los límites exactos pueden variar por cuenta. Si el plan cambia a Developer, Groq factura por token. Verifica el plan en Groq Console antes de habilitarlo.

Fuentes oficiales: [límites Free de Groq](https://console.groq.com/docs/rate-limits), [modelos de Groq](https://console.groq.com/docs/models), [facturación de Groq](https://console.groq.com/docs/billing-faqs), [prueba gratuita de Cerebras](https://www.cerebras.ai/inference), [precios Gemini](https://ai.google.dev/gemini-api/docs/pricing) y [router OpenRouter gratuito](https://openrouter.ai/openrouter/free/apps).

## Novedades de la versión 0.9.4: cascada eficiente entre agentes

- Gemini continúa primero en automático. Si falla, el cliente registra una pausa temporal para no repetir el mismo intento fallido en cada subagente de una tarea paralela.
- Las llamadas automáticas a Gemini se limitan a tres simultáneas; las siguientes esperan un cupo y vuelven a revisar la pausa antes de enviar.
- La pausa distingue cuota, credenciales y fallos de servicio; respeta `Retry-After` cuando el proveedor lo envía. Cambiar la clave limpia la pausa. La llamada automática a Gemini vence a los 60 segundos.
- Reutiliza la idea de cascada del Figma AI Copilot, adaptada al flujo multiagente de VS Code. Conserva los modelos gratuitos ya verificados y el almacenamiento de claves en SecretStorage.
- No se copia la nube pública de Pollinations ni la lista fija de modelos Gemini del plugin Figma: pueden enviar código a un tercero y no son una garantía de cuota gratuita o disponibilidad para tareas de desarrollo.

## Novedades de la versión 0.9.3: Gemini Free Tier

- Con una clave de tu proyecto **Free** de Google AI Studio, el modo automático intenta primero `gemini-3.8-flash`; si falla o agota su cuota, continúa con Smart AI Router (OpenRouter `:free` u Ollama local).
- La clave Gemini se guarda en SecretStorage de VS Code. Al actualizar, una clave antigua no se activa automáticamente: vuelve a introducir la clave del proyecto Free en ⚙️ APIs.
- No se activa Google Search grounding, audio cloud ni otros proveedores de pago. SambaNova continúa desactivado.
- La extensión no puede consultar ni bloquear la facturación de tu proyecto Google. Mantén el proyecto sin facturación vinculada para que el uso no pase a la tarifa de pago después de agotar cuotas gratuitas.
- Smart AI Router conserva su propia ruta estricta de OpenRouter `:free` y Ollama; Gemini se usa desde la extensión.

## Novedades de la versión 0.9.2: APIs gratuitas verificadas

- Antes de cada solicitud cloud, el router actualiza el catálogo y confirma precio de entrada y salida de $0. Prioriza familias gratuitas chinas como Qwen, DeepSeek, MiniMax/Kimi y GLM cuando están disponibles; si no, usa `openrouter/free` y otros modelos gratuitos publicados.
- El router solo usa Ollama local o OpenRouter con precio verificado de $0. Groq, SambaNova, OpenCode y APIs personalizadas no se ejecutan.
- El selector no ofrece modelos de pago. El router devuelve HTTP 403 si una selección antigua pide un proveedor bloqueado o un modelo OpenRouter sin `:free`.
- La búsqueda web de OpenRouter quedó desactivada: su herramienta se cobra aparte incluso si el modelo de texto es gratuito. Las respuestas de investigación avisan que no consultaron Internet.
- La transcripción cloud permanece desactivada. El mensaje HTTP 503 muestra el diagnóstico legible, y los modelos sin precio confirmado se bloquean antes de enviarse.
- Smart AI Router v1.4.1 publica en `/health` la política `zero-cost-only`.

## Novedades de la versión 0.9.0

- En v0.9.0, el **Smart AI Router v1.3.0** intentaba Gemini y otros proveedores. Esa política fue reemplazada por el modo de costo cero de v0.9.1.
- El router limita el tiempo de cada proveedor y la duración total de una cadena de fallbacks, muestra un diagnóstico útil si no hay modelo Ollama o memoria suficiente y evita reintentar Ollama desde la extensión después de un 503.
- Las solicitudes a Ollama pasan por una cola de una en una, solo cargan modelos ligeros con RAM suficiente, limitan contexto y salida, y piden descargar el modelo al terminar.
- Los errores de timeout se presentan en español; el chat espera más que el límite global del router para recibir su diagnóstico final.
- Se pueden adjuntar archivos de código/texto junto con imágenes y audio. El arrastre desde el Explorador de VS Code separa carpetas de archivos; las carpetas se usan como ámbito del proyecto y los archivos se adjuntan al mensaje.
- Los adjuntos de texto tienen un límite de 64 KB por archivo y 160 KB por mensaje; se excluyen nombres sensibles y se redactan claves comunes antes de enviarlos.

## Novedades de la versión 0.8.3

- Ajuste menor al guardar la carpeta de tarea seleccionada en el estado de VS Code.

## Novedades de la versión 0.8.2

- La carpeta de tarea seleccionada se conserva después de reiniciar o recargar VS Code.

## Novedades de la versión 0.8.1

- Las auditorías también leen el contexto de la carpeta seleccionada y ahora incluyen Gradle Kotlin DSL (`.kts`) y propiedades de configuración no locales.
- Los subagentes completan revisiones independientes de estructura, lógica y seguridad; QA espera esos resultados y redacta el informe con las rutas y el código adjuntados.

## Novedades de la versión 0.8.0

- Puedes arrastrar una carpeta al chat para acotar qué archivos lee y modifica el agente; el botón de carpeta también abre el selector de VS Code.
- Los cambios de cada tarea muestran los archivos creados, editados, borrados o renombrados, y permiten revertir la entrega. La extensión conserva hasta cinco entregas y evita revertir si detecta cambios posteriores en esos archivos.
- Las solicitudes de programación siempre pasan por el Programador, también si el selector está en Chat Directo. Las revisiones independientes terminan antes de que el Programador aplique sus hallazgos; luego se vuelve a revisar la versión ajustada.
- Google Gemini se conecta directamente y carga los modelos disponibles para la clave configurada. También se puede definir un proveedor compatible con OpenAI.
- Groq carga sus modelos de chat directamente; OpenRouter muestra modelos cuyo precio publicado es cero y ofrece su enrutador gratuito. La disponibilidad y límites dependen de cada proveedor.
- OpenCode se puede conectar como proveedor de agentes, usando `opencode serve` y los modelos ya configurados ahí. Sus agentes devuelven análisis; BSCL valida y aplica los cambios.
- El panel puede recomendar y descargar un tamaño de Qwen 3.5 según la RAM disponible, con cuantización Q4 en los perfiles de 2B o más. Las solicitudes a Ollama reducen contexto y entrada cuando la memoria libre es baja.
- Las claves se guardan en el almacenamiento seguro de VS Code y dejan de copiarse automáticamente al `.env` del workspace.

## Novedades de la versión 0.7.2

Asistente de desarrollo para Visual Studio Code, creado por **Brayan Stid Cortés Lombana (`bscl`)**. Conecta el chat con Smart AI Router, Ollama, OpenRouter y Gemini; añade contexto del editor y coordina agentes según la intención.

## Novedades de la versión 0.7.1

- El panel de agentes permanece anclado mientras se desplaza la conversación; su contenido tiene desplazamiento propio cuando es extenso.
- El cuadro de escritura crece automáticamente hasta un límite adaptable y permite desplazarse dentro del texto largo, manteniéndose fijo al pie del chat.

## Novedades de la versión 0.7.0

- En modo **Agentes según la tarea**, las solicitudes de implementación leen el workspace, generan archivos completos y los crean o guardan directamente en la carpeta abierta.
- El planificador activa investigación web automáticamente para preguntas actuales, especializadas o sin contexto suficiente; saludos y preguntas sobre carpetas locales no disparan búsquedas.
- El plan puede delegar entre 1 y 100 subtareas. Se muestran estados en vivo; hay hasta 6 solicitudes simultáneas con modelos remotos y 1 con modelos locales.
- Las respuestas de chat, investigación y agentes se redactan en español.
- La escritura valida rutas y bloquea salidas del workspace, enlaces simbólicos, carpetas de dependencias, archivos binarios y archivos de credenciales. Los documentos con cambios sin guardar requieren guardarse antes.

## Novedades de la versión 0.6.0

- La búsqueda web se activa al pedir “busca en internet”, “investiga” o desde el botón 🌐. Las respuestas incluyen enlaces a las fuentes devueltas por OpenRouter.
- Los archivos de audio adjuntos se transcriben antes de interpretar la solicitud; el texto transcrito pasa por el mismo enrutador de tareas y agentes.
- El modo **Agentes según la tarea** interpreta solicitudes en lenguaje natural y muestra el objetivo, los pasos y los agentes elegidos antes de ejecutarlos.
- El botón de micrófono informa cuando VS Code bloquea ese permiso y ofrece el adjunto de audio como alternativa.

### Requisitos de estas funciones

- **Búsqueda web:** está pausada en modo sin costo porque el buscador de OpenRouter puede cobrar por consulta. El chat advierte que responde sin consultar Internet.
- **Transcripción de audio:** la API de Gemini está bloqueada en modo sin costo. El dictado por micrófono depende de VS Code y del navegador; un audio adjunto no se envía a un servicio cloud.
- El dictado por micrófono depende de la política de permisos de VS Code Webview. Si está bloqueado, adjunta una grabación con 📎.

## Novedades de la versión 0.5.2

- Al preguntar por los proyectos/carpetas del workspace, el asistente recibe la lista real de carpetas de primer nivel.
- La interfaz las llama “carpetas principales” porque no se verifica automáticamente si cada una contiene un proyecto.

## Novedades de la versión 0.5.1

- El modo automático detecta saludos, preguntas y solicitudes técnicas; solo activa los agentes necesarios para la tarea.
- Un saludo como “hola” recibe una respuesta normal, sin contexto del editor ni pasos de QA.
- Arquitectura y auditoría explícitas usan sus agentes especializados; para implementar código se ejecutan Programador y revisión de calidad.
- Los hallazgos de QA complementan la implementación y ya no sustituyen el código generado.

## Novedades de la versión 0.5.0

- El Arquitecto y el Programador trabajan en secuencia; después, el Crítico multimodal y el Auditor QA revisan en paralelo.
- El panel muestra estado, acción y modelo de cada agente. Al seleccionar un nodo se ven sus detalles.
- Las imágenes adjuntas llegan al modelo compatible con visión. Se aceptan PNG, JPEG, WebP y GIF de hasta 8 MB.
- El renderizado del chat escapa HTML recibido y la lectura de archivos valida rutas reales dentro del workspace.
- Cada bloque de código puede abrirse en el Diff de VS Code y aceptarse o descartarse desde el chat.
- La aplicación del Diff se cancela si el archivo cambió después de abrir la comparación.

## Capacidades

- Chat directo o modo automático con Investigador web, Arquitecto, Programador, Crítico multimodal y Auditor QA seleccionados por intención.
- Plan visible con el objetivo, los pasos y los agentes elegidos para solicitudes de trabajo.
- Creación, edición, borrado y renombrado de varios archivos desde solicitudes de implementación; el asistente confirma las rutas y ofrece revertir la entrega.
- Detección de preguntas que requieren investigación; en modo sin costo avisa que no se consultó Internet y evita inventar fuentes.
- Subagentes dimensionados por tarea, con progreso por subtarea y concurrencia limitada.
- Respuestas en español en los flujos directos, de investigación y multiagente.
- Gemini 3.8 Flash directo en modo automático con una clave de Google AI Studio Free; si no está disponible, usa Smart AI Router.
- Las solicitudes de investigación reconocen cuándo necesitan actualidad; la búsqueda web está desactivada en la política de costo cero y el chat avisa cuando no consultó Internet.
- Auto-Context del editor activo y selección de código.
- Dictado por voz mediante Web Speech API e imágenes adjuntas. La transcripción cloud de archivos de audio está desactivada.
- Adjuntos de código y documentos de texto e imágenes; la transcripción cloud de audio está desactivada. El arrastre de archivos no selecciona por error una carpeta.
- Historial persistente, preferencias de modelos y configuración de Smart AI Router / Ollama.
- Inserción de bloques de código en el cursor o selección activa.
- Vista previa Diff para insertar en el cursor o reemplazar el texto seleccionado con aceptación explícita.
- Selección de carpetas por arrastre o diálogo, con lectura y cambios limitados a la carpeta seleccionada.
- Reversión por entrega con comparación de estado para conservar ediciones hechas después por la persona.
- OpenCode queda desactivado porque su servidor local puede reenviar solicitudes a proveedores remotos que cobren.
- Smart Router admite modelos OpenRouter publicados con precio cero y el selector solo muestra sus IDs `:free`; las solicitudes quedan sujetas al límite gratuito del proveedor.
- Gemini se limita a `gemini-3.8-flash` con la clave guardada en SecretStorage; Groq, SambaNova, OpenCode, APIs personalizadas y modelos OpenRouter de pago permanecen bloqueados.
- Recomendación e instalación manual de modelos locales ajustada a memoria libre; los modelos locales procesan una tarea a la vez.

## Configuración

La extensión usa estas opciones de VS Code:

- `bsclAi.smartRouterUrl`: URL de Smart AI Router (por defecto `http://localhost:3000`).
- `bsclAi.ollamaUrl`: URL de Ollama (por defecto `http://localhost:11434`).
- `bsclAi.defaultModel`: modelo inicial (por defecto `smart-router`).
- `bsclAi.obsidianVaultPath`: ruta absoluta opcional a la bóveda de Obsidian.

Las claves del panel se guardan en `SecretStorage` de VS Code. En modo Automático, Gemini se intenta primero; si falla o agota la cuota, Groq Qwen se usa cuando lo habilitas como Free y después la extensión pasa a Smart AI Router con OpenRouter `:free` y Ollama. El circuito pausa proveedores según `Retry-After`, los límites de cuota reportados o el tipo de error. La extensión no puede comprobar si Google o Groq tienen facturación vinculada: mantén ambos proyectos/cuentas en Free y sin método de pago. Smart AI Router mantiene su propia clave opcional en su `.env`; configura `OPENROUTER_API_KEY` allí para usar modelos gratuitos. No agregues saldo. SambaNova, OpenCode y APIs personalizadas no se consultan ni se usan.

El modo sin costo no conecta a OpenCode ni a OpenCode Zen. Las claves y URLs antiguas se conservan, pero no se consultan ni se usan.

El instalador local elige un modelo según la RAM total y libre observada en ese momento. La descarga es manual desde **Analizar equipo** y **Descargar recomendado**; Ollama puede usar CPU y GPU según la configuración disponible. El Smart AI Router omite inferencia local si no hay memoria suficiente, ejecuta una solicitud local a la vez y descarga el modelo de memoria al acabar. La memoria disponible cambia con otras aplicaciones abiertas.

## Desarrollo e instalación

```powershell
npm run package
code --install-extension .\bscl-ai-studio-0.9.4.vsix --force
```

Documentación: `docs/ARCHITECTURE.md`, `docs/API_REFERENCE.md`, `docs/RUNBOOK.md`, `docs/DECISIONS.md` y `docs/VISION_AND_ROADMAP.md`.

## Licencia

MIT. Desarrollado por **Brayan Stid Cortés Lombana (`bscl`)**.
