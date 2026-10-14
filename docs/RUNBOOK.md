# Manual operativo: BSCL AI Studio

- **Extensión:** 0.9.6 · **Router:** 1.4.1 · **Fecha:** 2026-10-13

## Requisitos y arranque

VS Code 1.90+, Node.js 18+ y, para la ruta cloud, Smart AI Router en http://localhost:3000. Ollama es opcional.

En PowerShell, abre C:\Users\NITRO ACER\Desktop\proyectos con ia\smart-ai-router y ejecuta `node src/server.js`. Comprueba `/health`; debe informar versión 1.4.1 y `costPolicy: zero-cost-only`. Si el puerto ya está ocupado, identifica el proceso antes de cerrarlo.

## Empaquetar e instalar

Desde bscl-ai-studio ejecuta `npm run package`. Instala `bscl-ai-studio-0.9.6.vsix` con `code --install-extension` y `--force`. Luego ejecuta Developer: Reload Window en VS Code. Las claves guardadas en SecretStorage se conservan al actualizar.

## Proveedores y modelos

Gemini 3.8 Flash va primero en automático. Para habilitar Groq, pega una clave de una cuenta Groq Free y activa “Usar Groq Free automáticamente después de Gemini” solo tras verificar que la cuenta no está en Developer y no tiene pago asociado. BSCL solo usa Qwen 3.8 27B, serializa las solicitudes, reduce el contexto y limita la salida a 1.200 tokens; al detectar cuota agotada o recibir un tiempo de reintento, pausa Groq y continúa con Smart AI Router. El catálogo verifica el ID de modelo, pero no puede leer el plan de facturación.

Gemini conserva hasta tres llamadas automáticas simultáneas y su pausa compartida por cuota, credenciales o timeout. La extensión aprovecha cabeceras de cuota y tiempos de reinicio cuando el proveedor los expone; Gemini se pausa ante respuestas de cuota agotada. Las claves Google y Groq se guardan en SecretStorage de VS Code. El proyecto Google también debe seguir en Free y sin facturación vinculada. Smart AI Router usa Ollama y modelos OpenRouter con precio de entrada/salida publicado de $0; actualiza el catálogo antes de cada solicitud y bloquea modelos cuyo precio gratuito no puede confirmar. Prioriza Qwen, DeepSeek, MiniMax/Kimi y GLM si el catálogo los ofrece; `openrouter/free` sirve de respaldo. Para selección explícita, guarda la clave OpenRouter en ⚙️ APIs. Para el modo automático del router, agrega `OPENROUTER_API_KEY` al `.env` local. No agregues saldo. `/api/models` enumera solo modelos OpenRouter gratuitos compatibles y Ollama. Cerebras, OpenAI API, SambaNova, OpenCode y APIs personalizadas quedan excluidos del modo automático.

## Ollama y memoria

El fallback automático considera modelos de hasta aprox. 1,8 GB y necesita como mínimo 2,8 GB de RAM libre, además del margen por tamaño. Las llamadas locales se serializan y el modelo se descarga al terminar. Un modelo manual más grande también tiene control de RAM. El router no descarga modelos automáticamente.

Ollama procesa una solicitud a la vez, limita contexto/salida y descarga el modelo de memoria al terminar. El router omite la inferencia cuando no hay suficiente RAM libre. Descargar un modelo usa red y disco, pero no requiere una API paga; verifica que la descarga haya terminado con `ollama list`. No se carga automáticamente un modelo si el equipo está justo de memoria.

## Adjuntos, permisos y reversión

Abre o arrastra una carpeta de trabajo; también puedes elegirla con el selector. Adjunta código/documentación, imágenes o audio dentro de los límites de API_REFERENCE.md. La extensión respeta los permisos de Windows. Verifica que puedas crear archivos manualmente en la carpeta elegida.

La implementación puede crear, editar, borrar y renombrar archivos, muestra los cambios y permite revertir hasta cinco entregas recientes. Si un archivo cambió después, se rechaza la reversión para preservarlo.

## Costo cero y búsqueda web

El modo automático usa Gemini Free, Groq si activaste su única casilla y confirmaste que sigue en Free, modelos OpenRouter `:free` verificados y Ollama. Cerebras ofrece créditos de prueba limitados; OpenAI API puede facturar y Pollinations recibe prompts en un servicio público, por eso BSCL no los llama. El router no compra créditos ni cambia a un modelo pago. Los límites se basan en respuestas y cabeceras disponibles del proveedor; no hay una API común que permita leer anticipadamente todas las cuotas.

La búsqueda web de OpenRouter puede cobrar aparte incluso si el modelo principal es gratuito, por eso la extensión no la llama en este modo. Las solicitudes de investigación muestran una advertencia y una respuesta sin Internet. La transcripción cloud Gemini también está desactivada.

## Timeout y límites

“The operation was aborted due to timeout” indica que se agotó el plazo del router o del modelo gratuito. Revisa versión 1.4.1 en `/health`, modelos en `/api/models`, clave OpenRouter y cuota gratuita. Si `providers.ollama` aparece `false`, inicia Ollama Desktop; luego consulta `ollama list`. Si falta RAM, la solicitud local se omite por seguridad. El modo automático no descarga modelos.

QA es revisión generativa y no compila ni ejecuta tests. La extensión no ejecuta terminal autónomamente ni se instala/actualiza a sí misma.
