/**
 * Gestor Persistente de Historial de Chats (Sessions)
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
class HistoryManager {
  constructor(context) {
    this.context = context;
    this.storageKey = 'bscl_ai_chat_sessions';
  }

  listSessions() {
    const raw = this.context.globalState.get(this.storageKey, []);
    return Array.isArray(raw) ? raw : [];
  }

  getSession(sessionId) {
    const sessions = this.listSessions();
    return sessions.find(s => s.id === sessionId) || null;
  }

  saveSession(sessionData) {
    if (!sessionData || !sessionData.id) return null;
    const sessions = this.listSessions();
    const idx = sessions.findIndex(s => s.id === sessionData.id);

    const firstMsg = (sessionData.messages || []).find(m => m.role === 'user');
    const autoTitle = firstMsg 
      ? (firstMsg.content.slice(0, 38).trim() + (firstMsg.content.length > 38 ? '...' : '')) 
      : 'Conversación sin título';

    const cleanSession = {
      id: sessionData.id,
      title: sessionData.title || autoTitle,
      createdAt: sessionData.createdAt || Date.now(),
      updatedAt: Date.now(),
      model: sessionData.model || 'smart-router',
      skillKey: sessionData.skillKey || 'general',
      workspaceScope: sessionData.workspaceScope || (sessions[idx]?.workspaceScope) || '',
      messages: sessionData.messages || []
    };

    if (idx >= 0) {
      sessions[idx] = cleanSession;
    } else {
      sessions.unshift(cleanSession);
    }

    // Limitar a las últimas 50 conversaciones para no sobrecargar el almacenamiento
    const trimmed = sessions.slice(0, 50);
    this.context.globalState.update(this.storageKey, trimmed);
    return cleanSession;
  }

  deleteSession(sessionId) {
    const sessions = this.listSessions().filter(s => s.id !== sessionId);
    this.context.globalState.update(this.storageKey, sessions);
    return true;
  }

  clearAll() {
    this.context.globalState.update(this.storageKey, []);
    return true;
  }
}

module.exports = { HistoryManager };
