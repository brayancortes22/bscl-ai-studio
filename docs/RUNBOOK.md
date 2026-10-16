# Manual operativo de BSCL AI Studio

## Requisitos

- VS Code 1.90 o superior.
- Node.js para empaquetar y pasar los tests (`npm test` usa patrones glob de `node --test`:
  Node 22 o superior).
- Opcionales: Smart AI Router en `http://localhost:3000` y Ollama en `http://localhost:11434`.

## Probar, previsualizar y empaquetar

```powershell
npm test          # batería completa con node:test
npm run preview   # panel en el navegador: http://localhost:5178/?scene=conversation&theme=dark
npm run package   # genera bscl-ai-studio-<versión>.vsix
```

Instala el `.vsix` con **Extensions: Install from VSIX…** (o
`code --install-extension <archivo>.vsix --force`) y ejecuta **Developer: Reload Window**. Las
claves guardadas se conservan al actualizar.

`dev-watch.ps1` reempaqueta e instala la extensión cada vez que guardas un archivo. Las rutas
del proyecto y de `Code.exe` están escritas a mano al principio del script: cámbialas por las
de tu equipo antes de usarlo.

## Publicar

1. Sube la versión en `package.json` y añade la entrada en `CHANGELOG.md`.
2. Crea y sube una etiqueta `v<versión>`.
3. `.github/workflows/release.yml` pasa los tests, empaqueta y publica en el Marketplace con el
   secreto `MARKETPLACE_TOKEN` del repositorio.

El `publisher` de `package.json` (`bscl`) debe coincidir con el del token.

## Configurar proveedores

En el panel, **Ajustes** (icono de la barra del panel):

1. Pega la clave de Gemini (Google AI Studio). Es la primera opción de Automático.
2. Para usar Groq en Automático, pega su clave **y** marca la casilla. Hazlo solo si la cuenta
   sigue en el plan Free y sin método de pago: la extensión no puede comprobarlo.
3. OpenRouter solo usa modelos `:free`. No añadas saldo si quieres mantener el coste en cero.
4. **Probar conexiones** consulta solo los listados de modelos: no genera coste de inferencia.

xAI Grok y Meta Muse cobran por uso y solo se usan si eliges uno de sus modelos.

## Modelo local

**Analizar equipo** mira la RAM total y libre y recomienda un modelo de Ollama que quepa;
**Descargar recomendado** lo descarga. La memoria libre cambia con otras aplicaciones
abiertas: un modelo descargado no siempre se puede cargar. Ollama nunca entra en Automático;
se usa eligiéndolo en el selector.

## Problemas frecuentes

| Mensaje o síntoma | Causa y qué hacer |
|---|---|
| «No se pudo generar respuesta con las IAs en la nube…» | Todos los pasos de Automático fallaron. El mensaje lista cada fallo. Revisa las claves en Ajustes → **Probar conexiones**, o espera si es cuota agotada |
| «… omitido (clave o permisos; reintento en N s)» | La clave fue rechazada (401/403). Corrígela en Ajustes |
| «Se agotó el plazo total de 170 s…» | Ningún proveedor respondió a tiempo. Reintenta; si se repite, comprueba la red o el Smart Router |
| «No se pudo conectar con Ollama local…» | Ollama no está en marcha o la URL no es la correcta (Ajustes → Local) |
| «<archivo> cambió durante la generación; vuelve a enviar la tarea.» | Guardaste ese archivo mientras el modelo trabajaba. No se pisa: repite la petición |
| VS Code pide confirmar borrados o renombrados | El Programador quiere borrar, renombrar o reducir un archivo a menos de la mitad. *Solo crear y editar* aplica el resto |
| «La carpeta elegida guarda credenciales…» | La carpeta de trabajo es `.ssh`, `.aws`, `.docker`… Elige la del proyecto |
| Aviso: el audio no se admite | La transcripción está desactivada; escribe el mensaje |
| «Esa entrega ya no se puede revertir…» | Solo se guardan las 5 últimas entregas y hasta un tamaño máximo |

## Qué no hace

- No ejecuta comandos en la terminal.
- No busca en Internet en modo sin coste: avisa de que la respuesta no consultó la web.
- No transcribe audio.
- QA es una revisión generativa: no compila ni ejecuta tests.
- No se instala ni se actualiza a sí misma.
