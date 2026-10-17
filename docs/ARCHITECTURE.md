# Arquitectura de BSCL AI Studio

Extensión de VS Code en JavaScript (CommonJS), sin build ni dependencias de npm. Tiene dos
partes que se comunican por mensajes:

- **Extension Host** (`src/`): accede al disco, a VS Code y a los proveedores de IA.
- **Webview** (`webview/`): la interfaz del panel. No toca el disco ni la red, solo envía
  mensajes ([protocolo](API_REFERENCE.md)).

## Flujo de una petición

```
webview (composer.js → main.js)
  └─ sendMessage ─▶ view-provider.handleUserMessage
        ├─ RequestInput.prepare        adjuntos: límites, redacción de secretos, avisos
        ├─ NeuralRouter.classifyTask   intención por reglas (chat, implementación, revisión…)
        ├─ WorkspaceInspector          archivo activo (vacío si es sensible)
        ├─ WorkspaceScopeResolver      carpeta de trabajo (la elegida por el usuario manda)
        ├─ WorkspaceContext.build      contexto del proyecto + huella (baseHash) de cada archivo
        ├─ modo Agentes o implementación ─▶ AgentSwarm.runSwarm
        │     modo Chat ─▶ TaskPlanner.plan ─▶ enjambre si es «coding_implementation»
        │                                     o AiClient.sendMessage
        ├─ applyResponseChanges        assessRisk → confirmación modal → WorkspaceChangeManager
        └─ aiResponse ─▶ webview (message-view.js)
```

Una petición a la vez por panel. **Detener** aborta un `AbortController` que la extensión
pasa a `AiClient.setAbortSignal`: todas las llamadas de la cascada y del enjambre lo
respetan, y si se cancela no se escribe ningún archivo.

## Módulos del Extension Host

| Módulo | Responsabilidad |
|---|---|
| `extension.js` | Activación, comandos y eventos del editor |
| `view-provider.js` | Puente con el webview: valida mensajes, orquesta la petición, aplica cambios |
| `config-manager.js` | Ajustes y claves (SecretStorage); vista enmascarada y guardado por parche |
| `history-manager.js` | Historial en `globalState`, con límites de tamaño |
| `ai-client.js` | Envío a proveedores, cascada Automática, visión, plazo global y cancelación |
| `provider-cascade.js` | Cascadas de Gemini, Groq, Z.ai, OpenRouter y Cerebras con su orden de modelos |
| `provider-cooldown.js` | Enfriamientos por modelo y proveedor, cupos de concurrencia, errores de cancelación |
| `model-catalog.js`, `free-cloud-fallback.js` | Catálogos de modelos, grupos de coste y Nube pública |
| `message-compactor.js` | Recorte de contexto y lectura de cabeceras de cuota |
| `request-input.js`, `media-processor.js` | Adjuntos de texto e imagen |
| `neural-router.js` | Clasificación de la intención por reglas |
| `agent-swarm.js`, `agents/*` | Planificador, Arquitecto, Programador, Crítico, QA, subagentes y herramientas |
| `json-repair.js` | Extracción de JSON de las respuestas; detecta salidas truncadas |
| `workspace-context.js`, `workspace-inspector.js`, `workspace-scope-resolver.js` | Contexto del proyecto y del editor |
| `patch-applier.js`, `workspace-change-manager.js` | Parches `SEARCH/REPLACE`, escritura validada, riesgo y deshacer |
| `diff-manager.js` | Diff de un bloque de código contra el archivo activo |
| `dropped-file-importer.js` | Archivos y carpetas arrastrados desde el Explorador |
| `sensitive-data.js` | Archivos sensibles y redacción de secretos (fuente única) |
| `brain-context.js` | Prompt base por enfoque y notas marcadas de Obsidian |

## Módulos del webview

Scripts sin build que se cargan en orden desde `index.html`. Todos llevan el nonce de la CSP.

| Módulo | Responsabilidad |
|---|---|
| `ui.js` | Creación de nodos sin `innerHTML`, iconos, toasts y vistas superpuestas con foco atrapado |
| `markdown.js`, `highlight.js` | Markdown seguro (todo se escapa) y resaltado ligero con colores del tema |
| `message-view.js` | Hilo: mensajes, tarjeta de progreso plegable, errores y archivos cambiados |
| `code-actions.js` | Copiar, insertar y diff de bloques; enlaces y apertura de archivos |
| `composer.js` | Cuadro de mensaje, adjuntos, arrastrar y soltar, fichas de carpeta y archivo activo |
| `history.js`, `settings.js` | Vistas de historial y ajustes |
| `sensitive-names.js` | Patrón de nombres sensibles compartido con `src/sensitive-data.js` |
| `main.js` | Estado de la sesión, mensajes con la extensión y persistencia con `getState`/`setState` |

`styles.css` solo usa variables `--vscode-*`, así que el panel sigue el tema del usuario.

## Proveedores

**Automático** (`AiClient.sendAutomatic`). Los pasos se recorren en orden hasta que uno
responde:

1. **Gemini** (8 modelos, ordenados por rol; hasta 3 llamadas simultáneas).
2. **Groq**, solo con la casilla marcada y clave; nunca con imágenes; hasta 2 llamadas.
3. **Z.ai**: GLM-4.7-Flash y GLM-4.5-Flash (precio $0); con imágenes, GLM-4.6V-Flash. Hasta
   2 llamadas a la vez.
4. **OpenRouter `:free`**: hasta 3 modelos verificados con precio $0 y después
   `openrouter/free`. Sin imágenes.
5. **Nube pública** (Pollinations). Solo si está activada, sin imágenes, en chat directo y sin
   ningún marcador de contexto del proyecto. Recibe solo el último turno.

El planificador y los subagentes prueban Groq antes que Gemini. Automático nunca usa xAI,
Meta, Cerebras, OpenCode ni Ollama: esos modelos solo se usan si se eligen a mano. Tampoco
hay ningún servidor local: el Smart AI Router se retiró en la 1.3.0 (ADR-027).

Si no hay ninguna clave configurada, `sendAutomatic` lanza un error con código
`BSCL_NO_PROVIDER`, y el panel muestra un botón para abrir Ajustes. Para las tareas de agentes,
`view-provider` lo comprueba antes de empezar.

| Plazo por petición | Valor |
|---|---|
| Total por llamada a `sendMessage` | 170 s |
| Gemini, Groq | 45 s por modelo |
| OpenRouter, Nube pública | 35 s por modelo |
| Z.ai | 60 s por modelo |
| Ollama | 60 s |

Enfriamientos (`provider-cooldown.js`):

| Causa | Pausa |
|---|---|
| Clave rechazada (401/403) | 10 min, todo el proveedor |
| Sin conexión | 45 s, todo el proveedor; 3 min si el fallo es de tiempo de conexión |
| Cuota diaria (429) | 24 h, solo ese modelo |
| Límite por minuto (429) | 60 s, solo ese modelo |
| Otro 429 | 3 min, solo ese modelo |
| Modelo inexistente (404) | 10 min, solo ese modelo |
| Timeout del modelo | 3 min, solo ese modelo |
| Error 5xx | 45 s, solo ese modelo |
| Otros fallos | 90 s, solo ese modelo |
| `Retry-After` de cabecera | Se respeta, entre 15 s y 24 h |

Una cancelación del usuario nunca registra un enfriamiento.

**Visión.** Si eliges un modelo gratuito sin visión y adjuntas imágenes, primero se describen
con Gemini, después con GLM-4.6V-Flash de Z.ai, luego con modelos de visión `:free` de OpenRouter y por último con Ollama local.
Se envían solo las imágenes y una instrucción fija, sin historial. Nunca se usan xAI ni Meta.

## Agentes

`AgentSwarm.runSwarm` elige el flujo según la intención: investigación, arquitectura, revisión
o implementación. En una implementación actúan el Arquitecto, los subagentes, el Programador
(que puede usar herramientas de lectura) y la revisión del Crítico y de QA en paralelo, con una
ronda de autocorrección.

- Subagentes: como máximo 16 y 3 a la vez (2 con búsqueda, 1 con modelo local).
- Todo agente que empieza termina en `completed`, `failed` o `skipped`.
- Si se cancela, se relanza el `AbortError` sin seguir con la revisión.

## Archivos

`WorkspaceChangeManager.applyChanges` valida cada ruta antes de escribir:

- dentro de la raíz;
- sin rutas absolutas, `..`, enlaces simbólicos ni nombres reservados;
- fuera de `.git`, `node_modules` y `.vscode`;
- sin archivos sensibles ni carpetas de credenciales.

Límites: hasta 100 operaciones y 1 MB por entrega. Si un archivo cambió en disco desde que se
leyó (su `baseHash` no coincide), se rechaza la entrega.

El deshacer guarda los bytes originales en base64 dentro de `workspaceState`: hasta 5
entregas, 1 MB por archivo y 2 MB por entrega. Cada instantánea conserva su raíz.

## Seguridad del webview

- CSP: `default-src 'none'; script-src 'nonce-…'`, estilos solo desde la extensión, sin
  `'unsafe-inline'`.
- `localResourceRoots` se limita a `webview/`.
- Los enlaces los abre la extensión, solo `http(s)` y `mailto`. Los archivos solo se abren
  dentro de la carpeta de trabajo.
- Las claves nunca llegan al webview.

Ver también: [API_REFERENCE.md](API_REFERENCE.md), [DECISIONS.md](DECISIONS.md),
[RUNBOOK.md](RUNBOOK.md) y [VISION_AND_ROADMAP.md](VISION_AND_ROADMAP.md).
