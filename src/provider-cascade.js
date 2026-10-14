/**
 * Ejecutor de cascada multi-modelo para Gemini, Groq, Cerebras y OpenRouter en BSCL AI Studio.
 * Inspirado en gemini-provider.js y ai-service.js de Figma AI Copilot.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
const {
  GEMINI_2026_MODELS,
  CEREBRAS_FREE_MODELS,
  geminiModelsForRole,
  groqModelsForRole
} = require('./free-cloud-fallback');
const { compactMessages, summarizeProviderError } = require('./message-compactor');

function maxTokensForRole(roleHint = '') {
  if (roleHint === 'coder' || roleHint === 'architect') return 8192;
  if (roleHint === 'planner' || roleHint === 'subagent') return 1800;
  return 4096;
}

class ProviderCascade {
  static async tryGeminiCascade(client, messages, roleHint = '', preferredModel = '') {
    if (!client.geminiApiKey) return { result: null, failure: '' };
    const providerAuthCooldown = client.providerCooldown.get('gemini:auth');
    if (providerAuthCooldown) {
      return { result: null, failure: `Gemini omitido (${providerAuthCooldown.reason})` };
    }

    const releaseSlot = await client.providerCooldown.acquire('gemini', 3);
    const failures = [];
    try {
      const candidates = preferredModel
        ? [preferredModel, ...geminiModelsForRole(roleHint).filter((m) => m !== preferredModel)]
        : geminiModelsForRole(roleHint);

      for (const modelId of candidates) {
        const cooldown = client.providerCooldown.get(`gemini:${modelId}`);
        if (cooldown) continue;

        const credentialRevision = client.geminiCredentialRevision;
        try {
          const result = await client.sendCompatibleRequest({
            model: modelId,
            messages,
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
            apiKey: client.geminiApiKey,
            providerName: `Gemini Free (${modelId})`,
            timeoutMs: 45000
          });
          client.providerCooldown.recordQuota(`gemini:${modelId}`, result.quota);
          return { result: { ...result, model: `google/${modelId}` }, failure: '' };
        } catch (error) {
          if (credentialRevision === client.geminiCredentialRevision) {
            if ([401, 403].includes(Number(error.status))) {
              client.providerCooldown.recordFailure('gemini:auth', error);
              return { result: null, failure: `Gemini: ${summarizeProviderError(error.message)}` };
            }
            client.providerCooldown.recordFailure(`gemini:${modelId}`, error);
          }
          failures.push(`${modelId}: ${summarizeProviderError(error.message)}`);
        }
      }
      return {
        result: null,
        failure: failures.length ? `Cascada Gemini agotada (${failures.slice(0, 2).join('; ')})` : 'Gemini en enfriamiento temporal'
      };
    } finally {
      releaseSlot();
    }
  }

  static async tryCerebrasCascade(client, messages, roleHint = '', preferredModel = '') {
    if (!client.cerebrasApiKey) return { result: null, failure: '' };
    const release = client.providerCooldown.tryAcquire('cerebras', 2);
    if (!release) return { result: null, failure: 'Cerebras ocupado' };
    try {
      const baseIds = CEREBRAS_FREE_MODELS.map((m) => m.id);
      const candidates = preferredModel ? [preferredModel, ...baseIds.filter((m) => m !== preferredModel)] : baseIds;
      for (const modelId of candidates) {
        if (client.providerCooldown.get(`cerebras:${modelId}`)) continue;
        try {
          const result = await client.sendCompatibleRequest({
            model: modelId,
            messages: compactMessages(messages, 28000),
            baseUrl: 'https://api.cerebras.ai/v1',
            apiKey: client.cerebrasApiKey,
            providerName: `Cerebras Free · ${modelId}`,
            timeoutMs: 30000,
            maxCompletionTokens: maxTokensForRole(roleHint)
          });
          client.providerCooldown.recordQuota(`cerebras:${modelId}`, result.quota);
          return { result: { ...result, model: `cerebras:${modelId}` }, failure: '' };
        } catch (error) {
          client.providerCooldown.recordFailure(`cerebras:${modelId}`, error);
        }
      }
      return { result: null, failure: 'Cerebras en enfriamiento temporal' };
    } finally {
      release();
    }
  }

  static async tryGroqCascade(client, messages, roleHint = '', preferredModel = '', hasImages = false) {
    if (!client.groqFreeEnabled || !client.groqApiKey || hasImages) return { result: null, failure: '' };
    const authCooldown = client.providerCooldown.get('groq:auth');
    if (authCooldown) return { result: null, failure: `Groq omitido (${authCooldown.reason})` };

    const release = client.providerCooldown.tryAcquire('groq', 2);
    if (!release) return { result: null, failure: 'Groq ocupado con tareas concurrentes' };
    try {
      const available = await client.fetchGroqModelCatalog();
      const ordered = groqModelsForRole(roleHint, available);
      const candidates = preferredModel
        ? [preferredModel, ...ordered.filter((m) => m !== preferredModel)]
        : ordered;

      const compacted = compactMessages(messages, 28000);
      const maxTokens = Math.min(4096, maxTokensForRole(roleHint));
      const failures = [];

      for (const modelId of candidates) {
        if (client.providerCooldown.get(`groq:${modelId}`)) continue;
        const credentialRevision = client.groqCredentialRevision;
        try {
          const result = await client.sendCompatibleRequest({
            model: modelId,
            messages: compacted,
            baseUrl: 'https://api.groq.com/openai/v1',
            apiKey: client.groqApiKey,
            providerName: `Groq Free · ${modelId}`,
            timeoutMs: 45000,
            maxCompletionTokens: maxTokens
          });
          client.providerCooldown.recordQuota(`groq:${modelId}`, result.quota);
          return { result: { ...result, model: `groq:${modelId}` }, failure: '' };
        } catch (error) {
          if (credentialRevision === client.groqCredentialRevision) {
            if ([401, 403].includes(Number(error.status))) {
              client.providerCooldown.recordFailure('groq:auth', error);
              return { result: null, failure: `Groq: ${summarizeProviderError(error.message)}` };
            }
            client.providerCooldown.recordFailure(`groq:${modelId}`, error);
          }
          failures.push(`${modelId}: ${summarizeProviderError(error.message)}`);
        }
      }
      return {
        result: null,
        failure: failures.length ? `Groq (${failures[0]})` : 'Groq en enfriamiento temporal'
      };
    } finally {
      release();
    }
  }
}

module.exports = { ProviderCascade, GEMINI_2026_MODELS, maxTokensForRole };
