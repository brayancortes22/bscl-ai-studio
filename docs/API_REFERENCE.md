# Referencia técnica y APIs: BSCL AI Studio

- **Extensión:** 0.9.5 · **Router:** 1.4.1

## IPC Webview → Extension Host

| Tipo | Datos | Uso |
|---|---|---|
| ready | — | Cargar modelos, contexto, historial y configuración |
| sendMessage | SendMessagePayload | Enviar prompt, historial y adjuntos |
| importDroppedItems | { uris: string[] } | Importar archivos/carpetas file: |
| selectWorkspaceFolder / pickWorkspaceFolder | URI / — | Elegir carpeta de trabajo |
| clearWorkspaceFolder | — | Usar la carpeta abierta en VS Code |
| prepareDiff / acceptDiff / discardDiff | ID de propuesta | Revisar, aplicar o descartar un Diff |
| undoChanges | { undoId?: string } | Revertir una entrega |
| recommendLocalModel / installLocalModel | { model?: string } | Recomendar o descargar perfil local |
| saveApiConfig / testProviders | Configuración / — | Guardar claves y probar APIs |

SendMessagePayload contiene sessionId, model, messages, isSwarmMode, autoContext, webSearchEnabled, skillKey, requestId y mediaItems. Los roles admitidos son user, assistant y system. Cada mediaItem tiene category, name, mimeType y size; texto incluye content y audio/imagen incluye una data URL.

Límites: 12 textos de 64 KB cada uno y 160 KB total; imágenes PNG/JPEG/WebP/GIF hasta 8 MB cada una; audio hasta 12 MB por solicitud; binarios arrastrados hasta 20 MB combinados. Se rechazan enlaces simbólicos, tipos no admitidos y nombres sensibles. Arrastrar una carpeta la establece como carpeta de trabajo.

## Extension Host → Webview

modelsList devuelve modelos; activeContext incluye editor y carpetas; taskPlan incluye objetivo, pasos y subtareas; swarmProgress informa agente, estado, acción y modelo; filesImported lista adjuntos/omitidos; aiResponse entrega texto, proveedor, fileChanges y undoId; audioStatus/audioTranscript comunican transcripción; diffPrepared/diffResolved/diffError comunican el estado Diff; undoResult, error y status informan reversión, errores y carga.

fileChanges describe cada ruta y acción: creado, editado, borrado o renombrado. undoId identifica la entrega reversible.

## API Smart AI Router

Base: http://localhost:3000

- GET /health: estado, `costPolicy: zero-cost-only`, disponibilidad del enrutador OpenRouter gratuito y Ollama.
- GET /api/models: `smart-router`, modelos OpenRouter con ID `:free` y precio de entrada/salida igual a cero confirmado en vivo, y modelos Ollama instalados. Cuando están disponibles, las familias Qwen, DeepSeek, MiniMax/Kimi y GLM aparecen primero.
- GET /v1/models: catálogo OpenAI compatible.
- POST /v1/chat/completions: chat OpenAI compatible; model=auto o smart-router inicia la cascada.

La extensión acepta `google/gemini-3.8-flash` cuando se configura una clave Gemini; hace la llamada directa a `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`. En `smart-router`, intenta Gemini primero y, ante un fallo, puede intentar Groq si está activado. Groq utiliza exclusivamente `qwen/qwen3.8-27b` en `https://api.groq.com/openai/v1/chat/completions`; `GET /models` verifica que el ID siga disponible. Una sola opción en ⚙️ APIs habilita Groq para el selector y para el modo automático. Limita la concurrencia a uno; si ya atiende una solicitud, el resto de los agentes omite Groq y continúa al Smart AI Router. También omite imágenes y contexto mayor a 24.000 caracteres. La solicitud usa un máximo de 1.200 tokens de salida y se compacta para reducir uso de cuota.

La lista `qwen/qwen3.8-27b` se encuentra en la tabla oficial de límites Free de Groq (base publicada: 30 RPM, 1.000 RPD, 8.000 TPM y 200.000 TPD), pero Groq factura por token en Developer. BSCL no puede consultar ni fijar el plan de facturación de la cuenta; debe mantenerse en Free y sin método de pago para evitar cargos. Las claves Groq se guardan en SecretStorage. Modelo manual: `groq:qwen/qwen3.8-27b`; se bloquean todos los demás IDs de Groq.

El circuito de proveedor mantiene una pausa ante errores: cuota diaria hasta 24 h, límites por minuto 60 s, clave/permisos 10 min, timeout/5xx 60 s y otros errores 2 min; usa `Retry-After`, detalles de reintento y tiempos de reinicio de cuota reportados, con máximo de 24 h. La pausa se reinicia al cambiar la clave y no persiste tras reiniciar VS Code. Gemini conserva un máximo de tres solicitudes automáticas simultáneas y límite de 60 s. La comprobación de Gemini usa `GET /v1beta/openai/models` sin inferencia. La clave Gemini se guarda en SecretStorage; el costo cero requiere que el proyecto se mantenga sin facturación vinculada.

IDs remotos permitidos por Smart AI Router: `router:openrouter/<id>:free`, `router:openrouter/openrouter/free` y `openrouter:<id>:free`. Cada selección `:free` se vuelve a comprobar en el catálogo público de precio antes de enviarse; si no se confirma, se bloquea con HTTP 503. `smart-router`/`auto` prioriza modelos gratuitos chinos cuando aparecen en el catálogo, prueba `openrouter/free` y después el fallback Ollama que quepa en la RAM libre. El servidor Smart AI Router bloquea Gemini, Groq, SambaNova, OpenCode y APIs personalizadas; Gemini y Groq Free solo se llaman directamente desde la extensión. El selector omite IDs cloud obsoletos y las sesiones antiguas con dichos IDs se reencaminan por la cascada automática gratuita. Agotamiento de modelos gratuitos o falta de memoria responde HTTP 503 con `error.message` en español. El buscador web de OpenRouter y la transcripción Gemini están desactivados para evitar cargos.

Configuración VS Code: bsclAi.smartRouterUrl (http://localhost:3000), bsclAi.ollamaUrl (http://localhost:11434), bsclAi.defaultModel (smart-router) y bsclAi.obsidianVaultPath (vacío). La clave OpenRouter puede configurarse en ⚙️ APIs para selección explícita de modelos `:free`, y en el `.env` local del router para el modo automático. Las claves antiguas de proveedores bloqueados se conservan, pero no se consultan ni se usan.
