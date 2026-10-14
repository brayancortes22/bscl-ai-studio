# Estado y hoja de ruta de BSCL AI Studio

- **Versión documentada:** 1.0.0 · **Revisión:** 2026-10-13

## Implementado

Chat en español con insignia de versión activa (`v1.0.0`) visible en la parte superior del panel; enrutamiento **100% Cloud en modo Automático** (cero carga automática en Ollama local para no ralentizar el PC) consciente del rol de cada agente (`coder`, `architect`, `qa`, `critic`, `planner`, `subagent`); cascada multi-modelo inspirada en **Figma AI Copilot** (Gemini 2026 Cascade -> Cerebras/Groq LPU multi-modelo -> Smart AI Router Cloud -> OpenRouter `:free` con puntuación de capacidad -> Nube Gratuita Pública Sin API Key) y auto-reparación de JSON truncado (`repairTruncatedJson`) en `CoderAgent` y `TaskPlanner`.

Auto-detección inteligente de sub-proyectos (`WorkspaceScopeResolver`) cuando se abre una carpeta raíz con múltiples proyectos (`proyectos con ia`) a partir del prompt o del archivo abierto en el editor; edición quirúrgica híbrida por bloques `SEARCH / REPLACE` (`PatchApplier`) además de creación/edición/borrado/renombrado completo de archivos; bucle de herramientas agénticas bajo demanda (`AgentToolLoop`: `read_file`, `search_code`, `list_files`) y autoverificación sintáctica (`node --check` y `JSON.parse`) con autocorrección antes del guardado y reversión completa (`Deshacer`).

Los roles de investigación, arquitectura, programación, crítica visual y QA aparecen según la tarea. Los planes admiten hasta 100 subtareas cuando se justifican y ejecutan subagentes en paralelo en la nube sin colisionar en el mismo modelo gracias al enfriamiento granular por `proveedor:modelo`.

Se puede elegir/arrastrar una carpeta y adjuntar texto/código, imágenes y audio. La implementación puede crear, editar, borrar y renombrar archivos dentro de la carpeta seleccionada. La respuesta muestra archivos cambiados y ofrece revertir hasta cinco entregas. Diff nativo para propuestas manuales.

## Límites confirmados

OpenRouter puede devolver límites gratuitos, saturación o modelos retirados; no se agrega saldo. En cuentas gratuitas el catálogo y la cuota pueden cambiar. Ollama no consume cuota cloud, pero depende de RAM disponible; un modelo descargado no significa que pueda cargarse ahora.

El acceso a archivos usa los permisos normales de Windows. Video, streaming progresivo, ejecución autónoma de terminal y sincronización con Obsidian no están implementados. QA es revisión generativa, no tests. La carpeta fuente de BSCL puede seleccionarse y editarse, pero empaquetar/reinstalar/recargar requiere una acción aparte. Los prompts y archivos enviados a nube llegan al proveedor seleccionado.

## Próximas mejoras

1. Mostrar diagnóstico por proveedor: disponibilidad, latencia, cuota y último error sin claves.
2. Añadir confirmación para borrados/renombrados agénticos.
3. Agregar streaming visible con cancelación y plazo total.
4. Diseñar índice semántico local con exclusiones por carpeta.
5. Diseñar integración de Obsidian inicialmente explícita y de solo lectura.
6. Incorporar validaciones automáticas configurables sin confundirlas con QA generativa.
7. Rehabilitar investigación web solo cuando exista un proveedor con límite de uso que garantice por diseño que no puede cobrar excedentes.
