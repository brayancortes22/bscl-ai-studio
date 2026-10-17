# BSCL AI Studio

Agente de programación para VS Code, en español. Chatea sobre tu código, planifica tareas con
varios agentes (Arquitecto, Programador, Crítico, QA), aplica cambios en tus archivos con
revisión y deshacer, y prioriza proveedores de IA **gratuitos**. Los de pago solo se usan si
tú los eliges.

Novedades por versión: [CHANGELOG.md](CHANGELOG.md).

## Instalación

Requiere VS Code 1.90 o superior.

```powershell
npm run package
```

Genera `bscl-ai-studio-<versión>.vsix` con `@vscode/vsce` (vía `npx`). Instálalo con
**Extensions: Install from VSIX…** y recarga la ventana. Las claves guardadas se conservan al
actualizar.

## Uso

Abre **BSCL AI Studio** en la barra de actividad. La barra del panel tiene tres botones:
**Nuevo chat**, **Historial** y **Ajustes**.

El cuadro de mensaje reúne todo lo demás:

- **Carpeta de trabajo**: la carpeta sobre la que leen y escriben los agentes. Pulsa la ficha
  para elegirla o arrastra una carpeta al panel.
- **Archivo activo**: el archivo abierto en el editor se envía como contexto. Pulsa su ficha
  para excluirlo.
- **Adjuntos** (📎 o arrastrar): hasta 12 archivos de código o texto (64 KB cada uno y 160 KB en
  total) e imágenes PNG, JPEG, WebP o GIF de hasta 8 MB. Los archivos con credenciales
  (`.env`, `id_rsa`, `*.pem`…) se rechazan.
- **Modo**: *Agentes* decide qué agentes intervienen; *Chat* responde directamente.
- **Enfoque**: General, Clean Code, Arquitectura, DevSecOps, UI/UX, Multiagente, Bases de datos
  o QA y tests.
- **Modelo**, agrupado en Automático, Gratis, Local y De pago.
- **Enter** envía, **Shift+Enter** salta de línea y **Esc** (o el botón ■) detiene la petición.

Con texto seleccionado en el editor, el menú contextual **BSCL AI** ofrece *Explicar*,
*Refactorizar* y *Buscar errores*.

### Cambios en archivos

Cuando el Programador entrega cambios, se guardan en la carpeta de trabajo y la respuesta
lista cada archivo (pulsa uno para abrirlo) con un botón **Revertir**. Se pueden revertir hasta
cinco entregas.

- Antes de **borrar**, **renombrar** o dejar un archivo con menos de la mitad de su tamaño,
  VS Code pide confirmación.
- Si guardaste un archivo mientras el modelo generaba, no se pisa: la entrega se rechaza y te
  pide repetir la tarea.
- Los bloques de código de las respuestas tienen **Copiar**, **Insertar en el cursor** y
  **Ver diff** contra el archivo activo.

## Proveedores y coste

| Proveedor | Clave | Coste | Cuándo se usa |
|---|---|---|---|
| Gemini (Google AI Studio) | sí | Free tier | Automático y a mano |
| Groq | sí | Free tier | Automático solo con la casilla marcada; también a mano |
| Z.ai (GLM-4.7-Flash, GLM-4.5-Flash, GLM-4.6V-Flash) | sí | gratis | Automático y a mano |
| OpenRouter `:free` (Qwen, DeepSeek, GLM, Kimi…) | sí | gratis | Automático y a mano |
| Nube pública (Pollinations) | no | gratis | Último recurso de Automático, solo en chat sin contexto |
| Ollama | no | local | Solo a mano |
| xAI Grok, Meta Muse | sí | **de pago** | Solo si eliges uno de sus modelos |

Necesitas **al menos una clave gratuita**. Sin ninguna, las tareas de los agentes muestran un
aviso con un botón para abrir Ajustes.

**Orden de Automático:**

1. Gemini, que prueba hasta 8 modelos.
2. Groq, si está activado.
3. Z.ai: GLM-4.7-Flash y después GLM-4.5-Flash. Son gratuitos pero más lentos.
4. OpenRouter `:free`: hasta 3 modelos verificados con precio $0, y después `openrouter/free`.
5. Nube pública.

Planificador y subagentes prueban Groq antes que Gemini. Con imágenes el orden es Gemini y
después Z.ai (GLM-4.6V-Flash).

De Z.ai solo se usan los modelos con precio $0. Los «FlashX» y GLM-5.3 cobran y nunca se envían.

Automático nunca usa proveedores de pago, ni Cerebras, ni Ollama, ni ningún servidor local. Cada petición tiene un plazo
total de 170 s. Si un proveedor rechaza la clave o no responde, se pausa un tiempo y se pasa al
siguiente.

Mantén Google y Groq en sus planes gratuitos y sin método de pago: la extensión no puede ver
tu facturación.

## Privacidad y seguridad

- El contexto (archivo activo, carpeta de trabajo, adjuntos) se envía al proveedor que atienda
  la petición. Antes se tapan los secretos que parecen claves: variables `*_KEY` o `*_TOKEN`,
  tokens con formato conocido, credenciales dentro de URLs y bloques PEM. El código normal no
  se toca.
- La Nube pública nunca recibe el contexto del proyecto (archivo activo, carpeta, adjuntos):
  si la petición lo lleva, se salta. En Automático solo recibe tu último mensaje, así que lo
  que pegues en él sí le llega.
- Las imágenes enviadas con un modelo gratuito nunca llegan a xAI ni a Meta.
- Las claves se guardan en el almacén seguro de VS Code (SecretStorage). El panel solo ve si
  están configuradas y sus 4 últimos caracteres.
- Los ajustes `bsclAi.*` solo se leen de tu configuración de usuario: un repositorio no puede
  cambiarlos con su `.vscode/settings.json`.
- Los agentes no escriben en `.git`, `node_modules` ni `.vscode`, ni en carpetas de credenciales
  (`.ssh`, `.aws`, `.gnupg`…).

## Configuración

| Ajuste | Por defecto | Para qué |
|---|---|---|
| `bsclAi.ollamaUrl` | `http://localhost:11434` | Ollama en este equipo (solo localhost) |
| `bsclAi.defaultModel` | `smart-router` | Modelo al abrir el panel; no admite modelos de pago |
| `bsclAi.obsidianVaultPath` | vacío | Bóveda de Obsidian con notas de referencia |
| `bsclAi.obsidianSkillsFolder` | vacío | Subcarpeta de la bóveda donde buscar esas notas |

Las notas de Obsidian solo se usan si están marcadas para un enfoque: `bscl-skill: <clave>` en
el frontmatter, o un nombre de archivo `bscl-skill-<clave>.md`. Las claves válidas son
`clean-code`, `architecture`, `devsecops`, `ui-ux`, `multiagent`, `database` y `qa-testing`.

Las claves de API se gestionan desde **Ajustes** en el panel, no desde `settings.json`.

## Desarrollo

```powershell
npm test          # 273 tests con node:test, sin dependencias
npm run preview   # vista previa del panel en el navegador, sin VS Code
```

La vista previa sirve en `http://localhost:5178/` con una simulación de la API de VS Code. Se
puede cambiar de escena y de tema por la URL:

- `?scene=empty|conversation|working|settings|history|restored`
- `&theme=dark|light|hc`

| Carpeta | Contenido |
|---|---|
| `src/` | Extension Host: proveedores, agentes, archivos, ajustes e historial |
| `src/agents/` | Planificador, agentes y subagentes |
| `webview/` | Interfaz del panel (HTML, CSS y módulos JS sin build) |
| `test/` | Tests; `test/helpers/vscode-stub.js` sustituye al módulo `vscode` |
| `tools/webview-preview/` | Servidor de la vista previa |
| `docs/` | Arquitectura, protocolo, decisiones, manual y hoja de ruta |

Publicar: subir una etiqueta `v*` lanza `.github/workflows/release.yml`, que pasa los tests,
empaqueta y publica en el Marketplace con el secreto `MARKETPLACE_TOKEN`.

Documentación técnica: [arquitectura](docs/ARCHITECTURE.md),
[protocolo y APIs](docs/API_REFERENCE.md), [decisiones](docs/DECISIONS.md),
[manual operativo](docs/RUNBOOK.md) y [hoja de ruta](docs/VISION_AND_ROADMAP.md).

## Licencia

MIT. Desarrollado por **Brayan Stid Cortés Lombana (`bscl`)**.
