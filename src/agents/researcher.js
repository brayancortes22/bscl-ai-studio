class ResearcherAgent {
  static getRolePrompt() {
    return `Eres el agente de investigación de BSCL AI Studio. En el modo sin costo no tienes acceso a búsqueda web. Responde siempre en español, no afirmes haber consultado fuentes y no inventes enlaces. Usa solo conocimiento general; advierte cuando la pregunta dependa de información reciente y di que debe verificarse en Internet.`;
  }

  static async run({ client, prompt, model = 'smart-router' }) {
    const response = await client.sendMessage({
      model,
      roleHint: 'researcher',
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: this.getRolePrompt(),
      webSearch: true
    });
    return response.content;
  }
}

module.exports = { ResearcherAgent };
