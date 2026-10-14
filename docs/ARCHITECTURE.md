# Arquitectura de BSCL AI Studio

- **Versión documentada:** 0.9.7
- **Router local:** Smart AI Router 2.0.0
- **Actualizado:** 2026-10-13

## Componentes y flujo

| Componente | Responsabilidad |
|---|---|
| Webview | Chat, adjuntos, selección de carpeta, estado de agentes, Diff e historial |
| Extension Host | Acceso a VS Code y disco con los permisos de Windows; valida y coordina |
| NeuralRouter / TaskPlanner | Clasificar conversación, investigación, revisión e implementación con enrutamiento a `smart-router` |
| Agentes | Investigar, diseñar, programar y revisar según la tarea con perfiles de rol (`roleHint`) |
| AiClient / ProviderCascade / ProviderCooldown | Cascada multi-modelo Gemini Free (2026), Groq LPU (`qwen3.8-27b`, `gpt-oss-120b`, `llama-3.3-70b-versatile`, `gpt-oss-20b`, `llama-3.1-8b-instant`), Cerebras Free, Smart AI Router, OpenRouter `:free`, Nube Gratuita Pública Sin API Key y Ollama Local |
| JsonRepair | Reparación automática de JSON truncado (`repairTruncatedJson`) y extracción de bloques Markdown para `CoderAgent` y `TaskPlanner` |
| WorkspaceContext / WorkspaceChangeManager | Leer contexto y crear, editar, borrar o renombrar archivos |
| DroppedFileImporter / RequestInput | Importar y filtrar archivos arrastrados |

El Webview no lee el disco directamente. El Host realiza la operación usando la carpeta abierta en VS Code o la carpeta local seleccionada/arrastrada. Saludos van al chat directo; una tarea no trivial puede mostrar un plan y agentes. Las preguntas que necesitan actualidad se identifican, pero el modo sin costo no hace consultas web: advierte de esa limitación y pide no inventar fuentes.

Para implementar, WorkspaceContext aporta contexto, CoderAgent prepara operaciones con auto-reparación de JSON y WorkspaceChangeManager valida rutas, tipos, permisos, documentos sin guardar y límites antes de escribir. La respuesta enumera archivos creados/editados/borrados/renombrados y ofrece revertir. La reversión se bloquea si un archivo cambió después.

La carpeta fuente de BSCL puede elegirse como workspace para editarla; empaquetar, reinstalar y recargar siguen siendo pasos separados.

## Modelos y Enrutamiento por Rol (`Role-Aware Cascade`)

Integrando los patrones de **Figma AI Copilot**, tanto `bscl-ai-studio` como `smart-ai-router` ejecutan una cascada multi-modelo con enfriamiento granular por `proveedor:modelo`:

1. **Google Gemini Free Cascade (2026):** Recorre automáticamente `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-flash-lite-latest`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash` y `gemini-3.8-flash` aprovechando las cuotas independientes por modelo en Google AI Studio.
2. **Cerebras Cloud y Groq Cloud Free Cascade:** Soportan múltiples modelos gratuitos de alta velocidad (`qwen/qwen3.8-27b`, `openai/gpt-oss-120b`, `llama-3.3-70b-versatile`, `openai/gpt-oss-20b`, `llama-3.1-8b-instant`) con hasta 4.096–8.192 tokens de salida para código y priorización de modelos ligeros para `TaskPlanner` y `SubagentRunner`.
3. **OpenRouter `:free` con Puntuación por Capacidad:** Verifica precio $0 en vivo y puntúa primero a los modelos flagship de código y razonamiento (`qwen3-coder`, `deepseek-r1`, `gpt-oss-120b`, `llama-3.3-70b`, `nemotron`).
4. **Nube Gratuita Pública Sin API Key (`free-cloud`):** Conmuta a `https://text.pollinations.ai/` (`openai` ➔ `mistral`) cuando no hay claves configuradas o se agotan las cuotas con clave.
5. **Ollama Local:** Control automático de RAM libre antes de cargar modelos locales.

## Adjuntos y límites

Texto/código: 12 archivos, 64 KB cada uno, 160 KB total. Imágenes PNG/JPEG/WebP/GIF: hasta 8 MB c/u. La transcripción cloud de audio está desactivada; usa el dictado del micrófono de VS Code. Medios binarios arrastrados: hasta 20 MB total. Una carpeta arrastrada se usa como workspace, no se copia completa al prompt.

Se filtran nombres sensibles y patrones comunes de claves. Los adjuntos son datos no confiables. Hasta 100 operaciones de archivo y aprox. 1 MB por entrega. No se permiten rutas absolutas, enlaces simbólicos ni directorios protegidos.

Historial y credenciales de extensión se guardan en estado local VS Code; el router conserva sus claves en .env. Los datos enviados a modelos cloud se transfieren al proveedor configurado. Video, terminal autónoma y sincronización con Obsidian no están implementados. QA es generativa, no ejecuta tests.

Ver [API_REFERENCE.md](API_REFERENCE.md), [RUNBOOK.md](RUNBOOK.md), [DECISIONS.md](DECISIONS.md) y [VISION_AND_ROADMAP.md](VISION_AND_ROADMAP.md).
