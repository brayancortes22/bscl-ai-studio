# Protocolo y APIs de BSCL AI Studio

## Webview → extensión

Los mensajes se reciben en `src/view-provider.js` (`handleMessage`). Todo payload se trata
como no confiable: la extensión comprueba tipos y rutas.

| Tipo | Payload | Qué hace |
|---|---|---|
| `ready` | `{ sessionId? }` | El webview está listo: se envían contexto, historial y modelos, y se entregan los comandos en cola |
| `sendMessage` | `{ sessionId, requestId, model, messages[], skillKey, isSwarmMode, mediaItems[], autoContext, webSearchEnabled: false }` | Petición del usuario. Se rechaza si hay otra en curso. Solo se usan los últimos 40 mensajes con rol `user` o `assistant` |
| `cancelRequest` | `{ requestId }` | Aborta la petición en curso |
| `loadSession` | `{ id, silent? }` | Responde `sessionLoaded` con la conversación completa |
| `restoreWorkspaceScope` | `{ sessionId }` | Restaura la carpeta guardada en esa sesión; no acepta rutas sueltas |
| `getHistory` · `deleteChat` · `clearAllChats` | — · `{ id }` · — | Historial. Vaciar pide confirmación modal en VS Code |
| `getApiConfig` · `saveApiConfig` · `testProviders` | — · parche · — | Ajustes (ver más abajo) |
| `pickWorkspaceFolder` · `clearWorkspaceFolder` | — | Carpeta de trabajo |
| `importDroppedItems` | `{ uris: string[] }` (máx. 20) | Archivos o una carpeta arrastrados desde el Explorador |
| `recommendLocalModel` · `installLocalModel` | — · `{ model }` | Modelo local de Ollama |
| `undoChanges` | `{ undoId }` | Revierte una entrega |
| `insertCode` | `{ code }` | Inserta en el cursor del editor activo |
| `prepareDiff` · `acceptDiff` · `discardDiff` · `discardAllDiffs` | `{ codeKey, code, language? }` · `{ proposalId, codeKey }` | Diff de un bloque contra el archivo activo |
| `openExternal` | `{ url }` | Abre un enlace; solo `http`, `https` y `mailto` |
| `openFile` | `{ path }` | Abre un archivo cambiado, solo dentro de la carpeta de trabajo |
| `copyToClipboard` | `{ text }` | Respaldo cuando `navigator.clipboard` falla en el webview |
| `getContext` | — | Reenvía el contexto del editor |

## Extensión → webview

| Tipo | Payload |
|---|---|
| `modelsList` | `{ models: [{ id, name, group }], defaultModel }`; `group` es `auto`, `free`, `local` o `paid` |
| `activeContext` | `{ activeEditor: { fileName, relativePath, language, lineCount, hasSelection } \| null, selectedFolder, selectedFolderPath }`. Sin contenido de archivos; se agrupa cada 150 ms y solo con el panel visible |
| `historyList` | `{ sessions: [{ id, title, model, skillKey, messageCount, createdAt, updatedAt, hasWorkspaceScope }] }`: resúmenes sin mensajes |
| `sessionLoaded` | `{ session }` |
| `apiConfig` | `{ secrets: { <clave>: { configured, hint? } }, legacySecrets: [{ key, label }], groqFreeEnabled, freeCloudEnabled, ollamaUrl }`. Nunca la clave; `hint` son sus 4 últimos caracteres |
| `apiConfigSaved` | `{ success, message?, field? }` |
| `testProvidersResult` | Estado por proveedor: `online`, `error-<código>`, `offline`, `model-unavailable`, `not-configured`, `not-enabled`, `disabled` o `checking-*` |
| `taskPlan` | `{ title, goal, intent, steps[], agents[], subtasks[] }` |
| `swarmProgress` | `{ agentId, agent?, state, status, model? }`, con `state` = `queued`, `working`, `completed`, `failed` o `skipped`; los subagentes son `subagent-N` |
| `aiResponse` | `{ content, provider, requestId, fileChanges?, undoId?, warning?, transcribedPrompt?, revertedUndoId? }` |
| `requestCancelled` | `{ requestId }` |
| `error` | `{ message, requestId?, kind? }`; `kind: 'warning'` cuando no quedó nada que enviar (adjuntos descartados) |
| `notice` | `{ message, kind }` |
| `status` | `{ loading, requestId }` |
| `command` | `{ action: 'newChat' \| 'history' \| 'settings' }`. Se encola si el webview aún no está listo |
| `activeSelection` | `{ selectedText, language, actionType }`. Comandos del menú contextual; también se encola |
| `folderSelected` · `filesImported` · `undoResult` | carpeta elegida · adjuntos importados y omitidos · resultado de revertir |
| `localModelRecommendation` · `localModelProgress` | Modelo local de Ollama |
| `diffPrepared` · `diffResolved` · `diffError` | `{ codeKey, proposalId }` · `{ codeKey, outcome }` · `{ codeKey, message }` |
| `audioStatus` | `{ text: '' }`; solo se envía para limpiar el estado al terminar |

`fileChanges` describe cada ruta con su acción: `creado`, `editado`, `borrado` o `renombrado`.

Eliminados en la 1.2.0:

- `execTerminal`, que mandaba cualquier texto a una terminal.
- `saveChat` y `selectWorkspaceFolder`, que no tenían emisor.
- `audioTranscript`.

## Parche de ajustes (`saveApiConfig`)

```json
{
  "secrets": { "geminiApiKey": "clave nueva" },
  "clearSecrets": ["xaiApiKey"],
  "groqFreeEnabled": false,
  "freeCloudEnabled": true,
  "ollamaUrl": "http://localhost:11434"
}
```

Lo que no viene en el parche no se toca. Todo se valida antes de escribir nada:

- Ollama solo en este equipo: `localhost`, `127.0.0.1` o `[::1]`.
- Las claves no pueden tener espacios.

Groq entra en Automático solo con la casilla marcada **y** con clave.

Claves editables: `geminiApiKey`, `groqApiKey`, `zaiApiKey`, `openRouterApiKey`, `xaiApiKey`
y `metaApiKey`. Las de proveedores retirados (`cerebrasApiKey`, `sambanovaApiKey`,
`customApiKey`, `openCodePassword`) solo se pueden borrar.

## Límites de adjuntos

| Tipo | Límite |
|---|---|
| Texto y código | 12 archivos; 64 KB cada uno y 160 KB en total |
| Imágenes PNG, JPEG, WebP y GIF | 8 MB cada una; 20 MB entre todas (webview) |
| Audio | No se admite: se descarta con un aviso |
| Nombres sensibles (`.env`, `id_rsa`, `*.pem`, `credentials.json`…) | Se rechazan |

## Smart AI Router (retirado)

Hasta la 1.2.0, Automático pasaba por un servidor local propio en `http://localhost:3000`. Se
retiró en la 1.3.0 (ADR-027): los demás usuarios no lo tienen, y en ese puerto suele haber otra
aplicación, que recibía las conversaciones. Los ids `router:` de conversaciones guardadas pasan
a Automático.

## Proveedores directos

Todos usan la API compatible con OpenAI (`<base>/chat/completions`), salvo Pollinations y
Ollama.

| Modelos | Base |
|---|---|
| Gemini (Automático o elegido a mano) | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `groq:` | `https://api.groq.com/openai/v1` |
| `zai:` (solo GLM-4.7-Flash, GLM-4.5-Flash y GLM-4.6V-Flash, de precio $0) | `https://api.z.ai/api/paas/v4` |
| `openrouter:` (solo IDs `:free`) | `https://openrouter.ai/api/v1` |
| `opencode:` (solo modelos gratuitos de OpenCode Zen) | `https://opencode.ai/zen/v1` |
| `cerebras:` (clave heredada, crédito de prueba) | `https://api.cerebras.ai/v1` |
| `grok:` / `xai:` (de pago) | `https://api.x.ai/v1` |
| `meta:` (de pago) | `https://api.meta.ai/v1` |
| `free-cloud:` | `https://text.pollinations.ai/` |
| ID sin prefijo | Ollama, `POST {ollamaUrl}/api/chat` |

Las claves se envían solo en la cabecera `Authorization` del proveedor correspondiente.
