/**
 * Historial persistente de conversaciones (globalState).
 *
 * Límites: globalState se serializa entero en cada escritura y se carga al arrancar
 * VS Code, así que se acota el número de sesiones, de mensajes por sesión y el tamaño
 * de cada mensaje guardado. El webview recibe solo resúmenes; los mensajes de una
 * sesión se piden al abrirla.
 */
const MAX_SESSIONS = 50;
const MAX_MESSAGES_PER_SESSION = 120;
const MAX_STORED_MESSAGE_CHARS = 24000;
const TITLE_LENGTH = 60;

function clip(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}\n\n[… recortado al guardar en el historial]` : value;
}

function makeTitle(messages) {
  const first = (messages || []).find((message) => message?.role === 'user' && String(message.content || '').trim());
  if (!first) return 'Conversación sin título';
  // El título sale de la primera línea con texto, sin bloques de código ni adjuntos.
  const line = String(first.content).replace(/```[\s\S]*?(```|$)/g, ' ').split('\n').map((part) => part.trim()).find(Boolean) || 'Conversación';
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : line;
}

class HistoryManager {
  constructor(context) {
    this.context = context;
    this.storageKey = 'bscl_ai_chat_sessions';
  }

  listSessions() {
    const raw = this.context.globalState.get(this.storageKey, []);
    return Array.isArray(raw) ? raw.filter((session) => session && typeof session.id === 'string') : [];
  }

  /** Lo que necesita la vista de historial, sin los mensajes. */
  listSummaries() {
    return this.listSessions().map((session) => ({
      id: session.id,
      title: session.title,
      model: session.model,
      skillKey: session.skillKey,
      messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      hasWorkspaceScope: Boolean(session.workspaceScope)
    }));
  }

  getSession(sessionId) {
    return this.listSessions().find((session) => session.id === sessionId) || null;
  }

  async saveSession(sessionData) {
    if (!sessionData || typeof sessionData.id !== 'string' || !sessionData.id) return null;
    const sessions = this.listSessions();
    const index = sessions.findIndex((session) => session.id === sessionData.id);
    const previous = index >= 0 ? sessions[index] : null;
    const messages = (Array.isArray(sessionData.messages) ? sessionData.messages : [])
      .filter((message) => message && ['user', 'assistant'].includes(message.role))
      .slice(-MAX_MESSAGES_PER_SESSION)
      .map((message) => ({ role: message.role, content: clip(message.content, MAX_STORED_MESSAGE_CHARS) }));

    const clean = {
      id: sessionData.id,
      title: sessionData.title || previous?.title || makeTitle(messages),
      createdAt: previous?.createdAt || sessionData.createdAt || Date.now(),
      updatedAt: Date.now(),
      model: sessionData.model || previous?.model || 'smart-router',
      skillKey: sessionData.skillKey || previous?.skillKey || 'general',
      workspaceScope: sessionData.workspaceScope || previous?.workspaceScope || '',
      messages
    };
    // Una sesión sin título real se retitula cuando llega su primer mensaje con texto.
    if (clean.title === 'Conversación sin título') clean.title = makeTitle(messages);

    if (index >= 0) sessions.splice(index, 1);
    sessions.unshift(clean);
    await this.context.globalState.update(this.storageKey, sessions.slice(0, MAX_SESSIONS));
    return clean;
  }

  async deleteSession(sessionId) {
    const sessions = this.listSessions().filter((session) => session.id !== sessionId);
    await this.context.globalState.update(this.storageKey, sessions);
    return true;
  }

  async clearAll() {
    await this.context.globalState.update(this.storageKey, []);
    return true;
  }
}

module.exports = { HistoryManager, makeTitle, MAX_SESSIONS, MAX_MESSAGES_PER_SESSION, MAX_STORED_MESSAGE_CHARS };
