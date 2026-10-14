/**
 * Agente Arquitecto de Software
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
class ArchitectAgent {
  static getRolePrompt() {
    return `Eres el AGENTE ARQUITECTO del enjambre BSCL AI Studio.
Tu misión:
1. Descomponer el problema en módulos concisos con Principio de Responsabilidad Única (SRP).
2. Definir contratos de tipos, interfaces limpias y patrones de arquitectura (Hexagonal/DDD).
3. Asegurar que ningún archivo supere las 150-200 líneas.
Entrega en español un plan de diseño técnico estructurado y directo.`;
  }

  static async run({ client, prompt, model = 'smart-router' }) {
    const res = await client.sendMessage({
      model,
      roleHint: 'architect',
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: this.getRolePrompt()
    });
    return res.content;
  }
}

module.exports = { ArchitectAgent };
