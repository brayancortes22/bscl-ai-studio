const os = require('os');

class LocalModelManager {
  static safeFallbackModel(models = [], runningIds = new Set()) {
    const freeBytes = os.freemem();
    // Automatic fallback stays in the small-model tier. Larger models remain
    // available only when the user selects them explicitly in the model list.
    const candidates = [...models]
      .filter((model) => Number(model.size || 0) <= 1.8 * 1024 ** 3)
      .sort((a, b) => Number(a.size || Infinity) - Number(b.size || Infinity));
    for (const model of candidates) {
      const loaded = runningIds.has(model.id);
      const minimumBytes = loaded
        ? 700 * 1024 ** 2
        : Math.max(2.8 * 1024 ** 3, Number(model.size || 0) * 1.8 + 1.5 * 1024 ** 3);
      if (freeBytes >= minimumBytes) return model.id;
    }
    return '';
  }

  static recommendation(installedModels = []) {
    const totalGB = os.totalmem() / (1024 ** 3);
    const freeGB = os.freemem() / (1024 ** 3);
    let model;
    let estimatedSize;
    if (totalGB < 8 || freeGB < 2.2) {
      model = 'qwen3.5:0.8b';
      estimatedSize = 'aprox. 1,2 GB';
    } else if (totalGB >= 16 && freeGB >= 9) {
      model = 'qwen3.5:9b-q4_K_M';
      estimatedSize = 'aprox. 6,6 GB';
    } else if (freeGB >= 5) {
      model = 'qwen3.5:4b-q4_K_M';
      estimatedSize = 'aprox. 3,3 GB';
    } else {
      model = 'qwen3.5:2b-q4_K_M';
      estimatedSize = 'aprox. 1,9 GB';
    }
    const family = model.replace(/-q4_K_M$/i, '');
    const installed = installedModels.some((item) => item.id === model || item.id === family || item.id.startsWith(`${family}-`));
    return {
      totalMemoryGB: Number(totalGB.toFixed(1)),
      availableMemoryGB: Number(freeGB.toFixed(1)),
      model,
      estimatedSize,
      installed,
      contextSize: freeGB < 4 ? 4096 : freeGB < 8 ? 6144 : 8192,
      message: `RAM total ${totalGB.toFixed(1)} GB; libre ahora ${freeGB.toFixed(1)} GB. Recomendación conservadora: ${model} (${estimatedSize}).` +
        ' Ollama decidirá si reparte la inferencia entre GPU y CPU; el contexto se limitará para reducir el uso de memoria.'
    };
  }

  static maxInputChars() {
    const windowSize = this.recommendation().contextSize;
    return windowSize <= 4096 ? 7000 : windowSize <= 6144 ? 11000 : 16000;
  }

  static async pull(baseUrl, model, onProgress = () => {}) {
    if (!/^(?:qwen3\.5:(?:0\.8b|(?:2b|4b|9b)-q4_K_M)|qwen2\.5-coder:1\.5b)$/i.test(String(model))) {
      throw new Error('Solo se permite descargar uno de los perfiles locales ligeros recomendados por BSCL AI Studio.');
    }
    let response;
    try {
      response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
        signal: AbortSignal.timeout(30 * 60 * 1000)
      });
    } catch (error) {
      throw new Error(`No se pudo iniciar la descarga desde Ollama: ${error.message}`);
    }
    if (!response.ok) {
      const details = (await response.text()).replace(/\s+/g, ' ').slice(0, 260);
      throw new Error(`Ollama rechazó la descarga (HTTP ${response.status}): ${details}`);
    }
    if (!response.body) throw new Error('Ollama inició la descarga, pero no envió el progreso esperado.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) this.consumeProgress(line, model, onProgress);
      if (done) break;
    }
    if (buffer.trim()) this.consumeProgress(buffer, model, onProgress);
    onProgress({ model, status: 'success', progress: 100, message: `${model} está listo.` });
    return { model };
  }

  static consumeProgress(line, model, onProgress) {
    if (!line.trim()) return;
    let item;
    try { item = JSON.parse(line); } catch { return; }
    if (item.error) throw new Error(`Ollama no pudo descargar ${model}: ${String(item.error).slice(0, 260)}`);
    // Hay líneas de /api/pull con total y sin completed (inicio de capa): sin esta guarda salía
    // NaN y el botón mostraba "Descargando NaN%".
    const completed = Number(item.completed);
    const total = Number(item.total);
    const progress = total > 0 && Number.isFinite(completed) ? Math.min(99, Math.floor((completed / total) * 100)) : null;
    onProgress({
      model,
      status: item.status || 'Descargando modelo…',
      progress,
      message: item.completed && item.total
        ? `${item.status || 'Descargando'} · ${Math.round(item.completed / (1024 ** 2))}/${Math.round(item.total / (1024 ** 2))} MB`
        : item.status || 'Preparando descarga…'
    });
  }
}

module.exports = { LocalModelManager };
