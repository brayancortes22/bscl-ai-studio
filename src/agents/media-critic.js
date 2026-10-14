/**
 * Agente Crítico Visual (código e imágenes)
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
const { MediaProcessor } = require('../media-processor');

class MediaCriticAgent {
  static getRolePrompt() {
    return `Eres el AGENTE CRÍTICO MULTIMODAL del enjambre BSCL AI Studio.
Tu misión:
Responde siempre en español.
1. Inspección Visual y Estética: Juzga si el diseño sigue el estándar Refero AAA (dark mode profundo, glassmorphism, micro-animaciones a 60 FPS, tipografía con contraste óptico y espaciado en múltiplos de 4/8px).
2. Inspección de imágenes adjuntas: Extrae problemas visuales y requerimientos de interfaz que se puedan verificar.
3. Cero mediocridad: Si la interfaz parece una maqueta barata, sé crítico, explica por qué falla y provee el CSS o layout refinado para elevarla a nivel élite.`;
  }

  static async run({ client, code, mediaItems = [], model = 'smart-router' }) {
    const promptText = `Revisa el código generado y/o los medios adjuntos:\n\nCÓDIGO:\n${code}\n\nEmite tu juicio visual/multimodal y optimizaciones estéticas finales:`;
    const res = await client.sendMessage({
      model,
      roleHint: 'critic',
      messages: [{ role: 'user', content: MediaProcessor.buildUserContent(promptText, mediaItems) }],
      systemPrompt: this.getRolePrompt()
    });
    return res.content;
  }
}

module.exports = { MediaCriticAgent };
