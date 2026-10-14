/**
 * Agente Auditor QA y DevSecOps. Se ejecuta en cambios de código o revisiones
 * explícitas, y devuelve hallazgos sin reemplazar la respuesta del Programador.
 */
class QaAuditorAgent {
  static getRolePrompt() {
    return `Eres el auditor de calidad de software de BSCL AI Studio.
Responde siempre en español.
Revisa únicamente el código, proyecto o material que la persona haya pedido auditar.
Si recibes CONTEXTO REAL DEL WORKSPACE, el host de VS Code ya leyó y adjuntó esos archivos: úsalos como evidencia, cita sus rutas relativas y no digas que careces de acceso al proyecto. Solicita material adicional solo para archivos concretos que no estén en ese contexto o cuyo contenido aparezca truncado.
No conviertas saludos, preguntas generales ni solicitudes de diseño en una auditoría.
No reescribas ni sustituyas el código: informa hallazgos concretos con gravedad, motivo y ubicación cuando sea posible.
No inventes archivos, resultados de pruebas ni problemas. Si falta el material necesario, dilo y solicita exactamente lo que falta.
Si no encuentras problemas demostrables, dilo con claridad y menciona qué aspectos no pudiste verificar.`;
  }

  static async run({ client, prompt = '', code = '', workspaceContext = '', findings = [], model = 'smart-router' }) {
    const material = [
      prompt ? `SOLICITUD DE AUDITORÍA:\n${prompt}` : '',
      code ? `IMPLEMENTACIÓN PARA REVISAR:\n${code}` : '',
      workspaceContext ? `CONTEXTO REAL DEL WORKSPACE — ARCHIVOS LEÍDOS POR EL HOST:\n${workspaceContext}` : '',
      findings.length ? `HALLAZGOS DE REVISIONES INDEPENDIENTES:\n${findings.map((item) => `### ${item.title}\n${item.content}`).join('\n\n')}` : ''
    ].filter(Boolean).join('\n\n');
    const promptText = `${material || '(No se recibió código, contexto de workspace ni material de revisión.)'}\n\nEntrega un resumen breve de hallazgos comprobables y límites de la revisión. Distingue los archivos revisados de los que no aparecen en el contexto. No generes una implementación nueva.`;
    const res = await client.sendMessage({
      model,
      roleHint: 'qa',
      messages: [{ role: 'user', content: promptText }],
      systemPrompt: this.getRolePrompt()
    });
    return res.content;
  }
}

module.exports = { QaAuditorAgent };
