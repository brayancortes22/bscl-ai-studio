/**
 * Cliente HTTP modular y desacoplado para BSCL AI Studio.
 * Conecta con Cascada Gemini 2026, Groq LPU, Cerebras, Smart AI Router, OpenRouter :free, Nube Pública y Ollama.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
const { LocalModelManager } = require('./local-model-manager');
const { ProviderCooldown } = require('./provider-cooldown');
const { ModelCatalog } = require('./model-catalog');
const { ProviderCascade, GEMINI_2026_MODELS } = require('./provider-cascade');
const { callFreeCloudDirect } = require('./free-cloud-fallback');
const {
  isLoopbackUrl,
  summarizeProviderError,
  parseDurationMs,
  readQuotaHeaders,
  retryDelayFromBody,
  compactLocalMessages
} = require('./message-compactor');

class AiClient {
  constructor(options = {}) {
    this.smartRouterUrl = options.smartRouterUrl || 'http://localhost:3000';
    this.ollamaUrl = isLoopbackUrl(options.ollamaUrl || 'http://localhost:11434')
      ? (options.ollamaUrl || 'http://localhost:11434') : 'http://localhost:11434';
    this.geminiApiKey = options.geminiApiKey || '';
    this.groqApiKey = options.groqApiKey || '';
    this.groqFreeEnabled = Boolean(options.groqFreeEnabled);
    this.groqAutoEnabled = this.groqFreeEnabled;
    this.cerebrasApiKey = options.cerebrasApiKey || '';
    this.openRouterApiKey = options.openRouterApiKey || '';
    this.freeCloudEnabled = options.freeCloudEnabled !== false;
    this.openCodeFreeEnabled = options.openCodeFreeEnabled !== false;
    this.openCodeApiKey = options.openCodeApiKey || '';
    this.xaiApiKey = options.xaiApiKey || '';
    this.providerCooldown = new ProviderCooldown();
    this.geminiCredentialRevision = 0;
    this.groqCredentialRevision = 0;
    this.xaiCredentialRevision = 0;
    this.groqModelCatalog = { checkedAt: 0, ids: [] };
    this.opencodeModelCatalog = { checkedAt: 0, ids: [] };
    this.xaiModelCatalog = { checkedAt: 0, ids: [] };
  }

  updateConfig({ smartRouterUrl, ollamaUrl, geminiApiKey, groqApiKey, groqFreeEnabled, cerebrasApiKey, openRouterApiKey, freeCloudEnabled, openCodeFreeEnabled, openCodeApiKey, xaiApiKey }) {
    const nextGeminiApiKey = geminiApiKey || '';
    if (nextGeminiApiKey !== this.geminiApiKey) {
      this.geminiCredentialRevision += 1;
      this.providerCooldown.clear('gemini');
    }
    const nextGroqApiKey = groqApiKey || '';
    if (nextGroqApiKey !== this.groqApiKey || Boolean(groqFreeEnabled) !== this.groqFreeEnabled) {
      this.groqCredentialRevision += 1;
      this.groqModelCatalog = { checkedAt: 0, ids: [] };
      this.providerCooldown.clear('groq');
    }
    if ((cerebrasApiKey || '') !== this.cerebrasApiKey) this.providerCooldown.clear('cerebras');
    if (smartRouterUrl) this.smartRouterUrl = smartRouterUrl;
    if (ollamaUrl && isLoopbackUrl(ollamaUrl)) this.ollamaUrl = ollamaUrl;
    this.geminiApiKey = nextGeminiApiKey;
    this.groqApiKey = nextGroqApiKey;
    this.groqFreeEnabled = Boolean(groqFreeEnabled);
    this.groqAutoEnabled = this.groqFreeEnabled;
    this.cerebrasApiKey = cerebrasApiKey || '';
    this.openRouterApiKey = openRouterApiKey || '';
    if (freeCloudEnabled !== undefined) this.freeCloudEnabled = Boolean(freeCloudEnabled);
    if (openCodeFreeEnabled !== undefined && Boolean(openCodeFreeEnabled) !== this.openCodeFreeEnabled) {
      this.openCodeFreeEnabled = Boolean(openCodeFreeEnabled);
      this.opencodeModelCatalog = { checkedAt: 0, ids: [] };
    }
    if (openCodeApiKey !== undefined) this.openCodeApiKey = openCodeApiKey || '';
    const nextXaiApiKey = xaiApiKey !== undefined ? (xaiApiKey || '') : this.xaiApiKey;
    if (nextXaiApiKey !== this.xaiApiKey) {
      this.xaiCredentialRevision += 1;
      this.xaiModelCatalog = { checkedAt: 0, ids: [] };
      this.providerCooldown.clear('grok');
    }
    this.xaiApiKey = nextXaiApiKey;
  }

  transcribeAudio() {
    throw new Error('La transcripción de audio en la nube está desactivada para evitar cargos. Usa el dictado del micrófono de VS Code.');
  }

  getLocalModels() { return ModelCatalog.getLocalModels(this.ollamaUrl); }
  getGeminiModels() { return Promise.resolve(ModelCatalog.getGeminiModels(this.geminiApiKey)); }
  fetchGroqModelCatalog() { return ModelCatalog.fetchGroqModelCatalog(this.groqApiKey, this.groqFreeEnabled, this.groqModelCatalog); }
  getGroqModels() { return ModelCatalog.getGroqModels(this.groqApiKey, this.groqFreeEnabled, this.groqModelCatalog); }
  getCerebrasModels() { return Promise.resolve(ModelCatalog.getCerebrasModels(this.cerebrasApiKey)); }
  getFreeCloudModels() { return Promise.resolve(ModelCatalog.getFreeCloudModels(this.freeCloudEnabled)); }
  fetchVerifiedOpenRouterFreeModels() { return ModelCatalog.fetchVerifiedOpenRouterFreeModels(this.openRouterApiKey); }
  getOpenRouterModels() { return ModelCatalog.getOpenRouterModels(this.openRouterApiKey); }
  getOpenCodeModels() { if (!this.openCodeFreeEnabled) return Promise.resolve([]); return ModelCatalog.getOpenCodeModels(this.opencodeModelCatalog); }
  fetchXaiModelCatalog() { return ModelCatalog.fetchXaiModelCatalog(this.xaiApiKey, this.xaiModelCatalog); }
  getXaiModels() { return ModelCatalog.getXaiModels(this.xaiApiKey, this.xaiModelCatalog); }
  pullLocalModel(model, onProgress) { return LocalModelManager.pull(this.ollamaUrl, model, onProgress); }
  async recommendLocalModel() { return LocalModelManager.recommendation(await this.getLocalModels()); }

  async getCloudModels() {
    const fallbackList = [{ id: 'smart-router', name: '⚡ Automático · 100% Cloud Gratis (0% PC)', provider: 'auto' }];
    try {
      const res = await fetch(`${this.smartRouterUrl}/api/models`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return fallbackList;
      const data = await res.json();
      const models = Array.isArray(data.models) ? data.models : fallbackList;
      const withoutAuto = models.filter((item) => item?.id && item.id !== 'smart-router' &&
        item.id !== 'auto' && ModelCatalog.isSafeRouterId(item.id));
      return [fallbackList[0], ...withoutAuto];
    } catch { return fallbackList; }
  }

  async listAllModels() {
    const [localModels, cloudModels, geminiModels, cerebrasModels, groqModels, openRouterModels, freeCloudModels, openCodeModels, xaiModels] = await Promise.all([
      this.getLocalModels(), this.getCloudModels(), this.getGeminiModels(),
      this.getCerebrasModels(), this.getGroqModels(), this.getOpenRouterModels(), this.getFreeCloudModels(), this.getOpenCodeModels(), this.getXaiModels()
    ]);
    const autoModel = cloudModels.find((m) => m.id === 'smart-router');
    const otherCloud = cloudModels.filter((m) => m.id !== 'smart-router');
    const combined = [autoModel, ...xaiModels, ...geminiModels, ...cerebrasModels, ...groqModels, ...openRouterModels, ...freeCloudModels, ...openCodeModels, ...otherCloud, ...localModels].filter(Boolean);
    return [...new Map(combined.map((item) => [item.id, item])).values()];
  }

  async sendCompatibleRequest({ model, messages, baseUrl, apiKey, providerName, timeoutMs = 90000, maxCompletionTokens }) {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, messages, ...(maxCompletionTokens ? { max_completion_tokens: maxCompletionTokens } : {}) }),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const requestError = new Error(`${providerName} no respondió: ${summarizeProviderError(error.message)}`);
      requestError.code = error.code || error.name;
      throw requestError;
    }
    if (!response.ok) {
      const rawError = await response.text();
      let parsedError = null;
      try { parsedError = JSON.parse(rawError); } catch {}
      const providerError = parsedError?.error || parsedError || {};
      const details = summarizeProviderError(providerError.message || rawError);
      const requestError = new Error(`${providerName} respondió HTTP ${response.status}: ${details}`);
      requestError.status = response.status;
      requestError.code = providerError.status || providerError.code || '';
      requestError.quota = readQuotaHeaders(response.headers);
      const retryAfter = response.headers.get('retry-after');
      requestError.retryAfterMs = parseDurationMs(retryAfter) || retryDelayFromBody(providerError) ||
        (requestError.quota?.requestsRemaining === 0 ? requestError.quota.requestsResetMs : null);
      throw requestError;
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${providerName} respondió sin texto utilizable.`);
    return { content, model, provider: providerName, quota: readQuotaHeaders(response.headers) };
  }

  async sendOpenCodeRequest({ model, messages, timeoutMs = 90000 }) {
    const baseUrl = 'https://opencode.ai/zen/v1';
    const sessionId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'opencode/2.0.3',
      'x-opencode-session': sessionId,
      'x-session-id': sessionId,
      'x-opencode-client': 'opencode',
      'x-opencode-project': 'global',
      'x-title': 'BSCL AI Studio'
    };
    if (this.openCodeApiKey) headers.Authorization = `Bearer ${this.openCodeApiKey}`;
    else headers.Authorization = 'Bearer ';
    let response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, stream: false }),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const requestError = new Error(`OpenCode Zen no respondió: ${summarizeProviderError(error.message)}`);
      requestError.code = error.code || error.name;
      throw requestError;
    }
    if (!response.ok) {
      const rawError = await response.text();
      let parsedError = null;
      try { parsedError = JSON.parse(rawError); } catch {}
      const providerError = parsedError?.error || parsedError || {};
      const details = summarizeProviderError(providerError.message || rawError || `HTTP ${response.status}`);
      const requestError = new Error(`OpenCode Zen respondió HTTP ${response.status}: ${details}`);
      requestError.status = response.status;
      requestError.code = providerError.status || providerError.code || '';
      throw requestError;
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenCode Zen respondió sin texto utilizable.');
    return { content, model, provider: `OpenCode Zen (${model})` };
  }

  async describeImages(messages = []) {
    if (this.geminiApiKey) {
      try {
        const result = await this.sendCompatibleRequest({
          model: 'gemini-2.5-flash',
          messages,
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: this.geminiApiKey,
          providerName: 'Gemini Vision',
          timeoutMs: 45000
        });
        if (result?.content) return result.content;
      } catch (error) {
        // try next provider
      }
    }

    if (this.xaiApiKey) {
      try {
        const result = await this.sendCompatibleRequest({
          model: 'grok-2-vision-latest',
          messages,
          baseUrl: 'https://api.x.ai/v1',
          apiKey: this.xaiApiKey,
          providerName: 'Grok Vision',
          timeoutMs: 45000
        });
        if (result?.content) return result.content;
      } catch (error) {
        // try next provider
      }
    }

    if (this.openRouterApiKey) {
      const visionCandidates = [
        'google/gemini-2.0-flash-exp:free',
        'qwen/qwen2.5-vl-72b-instruct:free',
        'meta-llama/llama-3.2-11b-vision-instruct:free'
      ];
      for (const candidate of visionCandidates) {
        try {
          const result = await this.sendCompatibleRequest({
            model: candidate,
            messages,
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: this.openRouterApiKey,
            providerName: 'OpenRouter Vision',
            timeoutMs: 45000
          });
          if (result?.content) return result.content;
        } catch (error) {
          // try next candidate
        }
      }
    }

    try {
      const localModels = await this.getLocalModels();
      const visionModels = (localModels || []).map((m) => m.id).filter((id) => /llava|vision|bakllava|minicpm-v|qwen.*vl|gemma3/i.test(String(id)));
      for (const candidate of visionModels) {
        try {
          const result = await this.sendCompatibleRequest({
            model: candidate,
            messages,
            baseUrl: `${String(this.ollamaUrl).replace(/\/+$/, '')}/v1`,
            providerName: `Ollama Vision (${candidate})`,
            timeoutMs: 60000
          });
          if (result?.content) return result.content;
        } catch (error) {
          // try next
        }
      }
    } catch (error) {
      // ignore
    }

    throw new Error('No hay un modelo con visión disponible para analizar la imagen. Configura una clave Gemini, una clave OpenRouter o instala un modelo local con visión (llava, etc.).');
  }

  async sendMessage({ model = 'smart-router', messages = [], systemPrompt = '', webSearch = false, roleHint = '' }) {
    if (typeof model !== 'string') throw new Error('El identificador del modelo no es válido.');
    if (model.startsWith('router:') && !ModelCatalog.isSafeRouterId(model)) model = 'smart-router';
    let formattedMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    if (systemPrompt) formattedMessages.unshift({ role: 'system', content: systemPrompt });
    let hasImages = formattedMessages.some((m) => Array.isArray(m.content) && m.content.some((p) => p?.type === 'image_url'));

    if (hasImages && /^(opencode:|groq:|cerebras:|free-cloud:)/.test(model)) {
      let description = '';
      try {
        description = await this.describeImages(formattedMessages);
      } catch (analysisError) {
        throw analysisError;
      }
      formattedMessages = formattedMessages.map((m) => {
        if (!Array.isArray(m.content)) return m;
        const text = m.content.filter((p) => p?.type === 'text').map((p) => p.text || '').filter(Boolean).join('\n');
        return { role: m.role, content: text };
      });
      let annotated = false;
      for (let i = formattedMessages.length - 1; i >= 0; i -= 1) {
        if (formattedMessages[i].role === 'user') {
          const base = (formattedMessages[i].content || '').toString().trim();
          formattedMessages[i] = {
            role: 'user',
            content: (base ? base + '\n\n' : '') + `[Análisis visual de la imagen adjunta]: ${description}`
          };
          annotated = true;
          break;
        }
      }
      if (!annotated) formattedMessages.push({ role: 'user', content: `[Análisis visual de la imagen adjunta]: ${description}` });
      hasImages = false;
    }

    if (hasImages && model.startsWith('opencode:')) {
      throw new Error('El modelo gratuito de OpenCode Zen seleccionado no admite imágenes. Usa un modelo con visión o envía solo texto.');
    }

    if (webSearch) {
      const result = await this.sendMessage({
        model, roleHint,
        messages: [...formattedMessages, { role: 'system', content: 'No tienes acceso a búsqueda web en este modo sin costo. Responde con conocimiento general y advierte si depende de datos actuales.' }]
      });
      return { ...result, content: `> Búsqueda web desactivada en modo sin costo.\n\n${result.content}`, provider: `${result.provider} · sin búsqueda web` };
    }

    if (model.startsWith('google/') || model.startsWith('gemini:')) {
      const preferred = model.replace(/^(?:google\/|gemini:)/, '');
      const { result, failure } = await ProviderCascade.tryGeminiCascade(this, formattedMessages, roleHint, GEMINI_2026_MODELS.includes(preferred) ? preferred : 'gemini-3.6-flash');
      if (result) return result;
      throw new Error(failure || 'No se pudo completar con Google Gemini Free.');
    }
    if (model.startsWith('groq:')) {
      const { result, failure } = await ProviderCascade.tryGroqCascade(this, formattedMessages, roleHint, model.slice(5), hasImages);
      if (result) return result;
      throw new Error(failure || 'No se pudo completar con Groq Free.');
    }
    if (model.startsWith('cerebras:')) {
      const { result, failure } = await ProviderCascade.tryCerebrasCascade(this, formattedMessages, roleHint, model.slice(9));
      if (result) return result;
      throw new Error(failure || 'No se pudo completar con Cerebras Free.');
    }
    if (model.startsWith('grok:') || model.startsWith('xai:')) {
      if (!this.xaiApiKey) throw new Error('Configura tu clave de xAI en ⚙️ APIs para usar Grok.');
      const grokModel = model.replace(/^(?:grok:|xai:)/, '').trim();
      if (!grokModel) throw new Error('El identificador del modelo Grok no es válido.');
      return this.sendCompatibleRequest({ model: grokModel, messages: formattedMessages, baseUrl: 'https://api.x.ai/v1', apiKey: this.xaiApiKey, providerName: `Grok (${grokModel})` });
    }
    if (model.startsWith('free-cloud:')) {
      return callFreeCloudDirect(formattedMessages, model.slice(11) || 'openai');
    }
    if (model.startsWith('opencode:')) {
      if (!this.openCodeFreeEnabled) throw new Error('Los modelos gratuitos de OpenCode están desactivados en ⚙️ APIs.');
      const freeModel = model.slice(9);
      if (freeModel !== 'big-pickle' && !/-free$/i.test(freeModel)) throw new Error('Solo se permiten modelos gratuitos de OpenCode.');
      return this.sendOpenCodeRequest({ model: freeModel, messages: formattedMessages, timeoutMs: 90000 });
    }

    if (model.startsWith('openrouter:')) {
      if (!this.openRouterApiKey) throw new Error('Configura una clave de OpenRouter en ⚙️ APIs.');
      const freeModel = model.slice(11);
      if (freeModel !== 'openrouter/free' && !/:free$/i.test(freeModel)) throw new Error('Solo se permiten modelos :free.');
      return this.sendCompatibleRequest({ model: freeModel, messages: formattedMessages, baseUrl: 'https://openrouter.ai/api/v1', apiKey: this.openRouterApiKey, providerName: 'OpenRouter Free' });
    }

    const providerFailures = [];
    const isAuto = model === 'smart-router' || model === 'auto' || model === 'auto-smart';
    if (isAuto) {
      // Balanceo inteligente 100% Cloud: para subagentes/planificador priorizamos velocidad (Groq/Cerebras -> Gemini)
      const preferFastFirst = (roleHint === 'planner' || roleHint === 'subagent') && !hasImages;
      if (preferFastFirst) {
        const cerebrasTry = await ProviderCascade.tryCerebrasCascade(this, formattedMessages, roleHint);
        if (cerebrasTry.result) return cerebrasTry.result;
        if (cerebrasTry.failure) providerFailures.push(cerebrasTry.failure);
        const groqTry = await ProviderCascade.tryGroqCascade(this, formattedMessages, roleHint, '', hasImages);
        if (groqTry.result) return groqTry.result;
        if (groqTry.failure) providerFailures.push(groqTry.failure);
      }

      const geminiTry = await ProviderCascade.tryGeminiCascade(this, formattedMessages, roleHint);
      if (geminiTry.result) return geminiTry.result;
      if (geminiTry.failure) providerFailures.push(geminiTry.failure);

      if (!preferFastFirst && !hasImages) {
        const cerebrasTry = await ProviderCascade.tryCerebrasCascade(this, formattedMessages, roleHint);
        if (cerebrasTry.result) return cerebrasTry.result;
        if (cerebrasTry.failure) providerFailures.push(cerebrasTry.failure);
        const groqTry = await ProviderCascade.tryGroqCascade(this, formattedMessages, roleHint, '', hasImages);
        if (groqTry.result) return groqTry.result;
        if (groqTry.failure) providerFailures.push(groqTry.failure);
      }

      if (this.openRouterApiKey && !hasImages) {
        try {
          const verified = await this.fetchVerifiedOpenRouterFreeModels();
          const targetOr = verified[0]?.id || 'openrouter/free';
          return await this.sendCompatibleRequest({
            model: targetOr, messages: formattedMessages,
            baseUrl: 'https://openrouter.ai/api/v1', apiKey: this.openRouterApiKey,
            providerName: `OpenRouter Free (${targetOr})`, timeoutMs: 35000
          });
        } catch (orErr) {
          providerFailures.push(`OpenRouter: ${summarizeProviderError(orErr.message)}`);
        }
      }
    }

    // Delegar a Smart AI Router Cloud (Gemini / Groq / Cerebras / OpenRouter :free / Free Cloud — 0% uso local en Automático)
    try {
      const routerRes = await fetch(`${this.smartRouterUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: isAuto ? 'auto' : model, messages: formattedMessages, roleHint }),
        signal: AbortSignal.timeout(90000)
      });
      if (routerRes.ok) {
        const data = await routerRes.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) return { content, model: data.model || model, provider: data.model || 'Smart AI Router Cloud' };
      }
    } catch (routerErr) {
      providerFailures.push(`Smart Router: ${summarizeProviderError(routerErr.message)}`);
    }

    // Fallback a Nube Gratuita Pública Sin API Key (estilo Figma AI Copilot — 100% Cloud)
    if (isAuto && this.freeCloudEnabled && !hasImages) {
      try {
        return await callFreeCloudDirect(formattedMessages, 'openai', 35000);
      } catch (fcErr) {
        providerFailures.push(`Nube Pública: ${summarizeProviderError(fcErr.message)}`);
      }
    }

    // Ollama Local SOLO se ejecuta si el usuario eligió explícitamente un modelo local (!isAuto)
    // En modo Automático NUNCA se carga Ollama local para no ralentizar el PC.
    if (!isAuto && !hasImages) {
      try {
        const targetLocalModel = model.replace(/^ollama\//i, '');
        const ollamaRes = await fetch(`${this.ollamaUrl}/api/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: targetLocalModel, messages: compactLocalMessages(formattedMessages), stream: false, keep_alive: 0, options: { num_ctx: 4096, num_predict: 1024 } }),
          signal: AbortSignal.timeout(60000)
        });
        if (ollamaRes.ok) {
          const data = await ollamaRes.json();
          return { content: data.message?.content || '', model: targetLocalModel, provider: `Ollama (${targetLocalModel})` };
        }
      } catch (localErr) {
        providerFailures.push(`Ollama Local: ${summarizeProviderError(localErr.message)}`);
      }
    }

    throw new Error(`No se pudo generar respuesta con las IAs en la nube («${model}»). ${providerFailures.join(' · ')}`);
  }
}

module.exports = { AiClient };
