# Estado y hoja de ruta de BSCL AI Studio

## Qué hay hoy (1.3.0)

**Panel.**

- Chat en español con la apariencia nativa de VS Code (tema claro, oscuro y alto contraste).
- Historial con búsqueda y ajustes con claves enmascaradas.
- Botón Detener que cancela de verdad.

**Agentes.**

- Planificador, Investigador, Arquitecto, Programador, Crítico visual y Auditor QA, elegidos
  según la intención.
- Hasta 16 subagentes, 3 a la vez.
- El Programador edita con parches `SEARCH / REPLACE` o con archivos completos, y puede leer
  el proyecto con herramientas (`read_file`, `search_code`, `list_files`).

**Archivos.**

- Crear, editar, borrar y renombrar dentro de la carpeta de trabajo.
- Confirmación para los cambios que pueden perder contenido.
- Protección contra pisar archivos guardados durante la generación.
- Deshacer de las 5 últimas entregas.

**Coste.**

- Automático solo usa proveedores gratuitos en la nube: Gemini, Groq con casilla, Z.ai
  (GLM Flash), OpenRouter `:free` y Nube pública sin contexto. No depende de ningún servidor
  local.
- Los de pago (xAI, Meta) solo se usan si se eligen.
- Plazo total de 170 s por llamada y enfriamientos por modelo y por proveedor.

**Calidad.** 273 tests con `node:test` y vista previa del panel sin VS Code.

## Límites conocidos

- Las cuotas gratuitas cambian sin aviso. La extensión no puede ver si una cuenta tiene
  facturación vinculada.
- No hay búsqueda web ni transcripción de audio en modo sin coste.
- QA es revisión generativa, no ejecuta tests. La verificación previa al guardado solo comprueba
  la sintaxis (JS/JSON).
- Las respuestas no se muestran mientras se generan (sin streaming).
- Lo que se envía a un proveedor en la nube llega a ese proveedor. La redacción de secretos tapa
  los formatos conocidos, no cualquier dato sensible.

## Pendiente

Decisiones abiertas para el autor:

1. **Aprobar o ajustar las decisiones de la 1.2.0** (ADR-020 a ADR-026 en
   [DECISIONS.md](DECISIONS.md)): se tomaron en la revisión y están marcadas como propuestas.
2. **Nube pública elegida a mano.** Hoy recibe la conversación sin el contexto del proyecto. En
   Automático solo recibe el último turno. Igualarlo cuesta una línea en `ai-client.js`; es una
   decisión de producto.

Mejoras técnicas:

3. **Presupuesto de contexto para Groq.** Subir el tamaño del contexto compactado podría mejorar
   las respuestas, pero no se ha medido si provoca errores 413 o 429 en el plan gratuito. Medir
   antes de cambiar `provider-cascade.js`.
4. **Streaming** de las respuestas, ya con la cancelación disponible.
5. **Diagnóstico por proveedor** en Ajustes: latencia, cuota y último error, sin claves.
6. **Índice semántico local** con exclusiones por carpeta.
7. **Búsqueda web**, solo con un proveedor que por diseño no pueda cobrar excedentes.
8. **Ocultar o dar formato** a la línea «VEREDICTO: OK|CORREGIR» con la que terminan las
   revisiones de QA y del Crítico.

Limpieza:

9. `src/system-tools.js` quedó vacío a propósito y solo lo usa un test: se puede borrar.
10. `dev-watch.ps1` tiene rutas de un equipo concreto: convendría leerlas de variables de
    entorno.
