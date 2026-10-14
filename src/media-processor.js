/**
 * Normalización de imágenes adjuntas para solicitudes compatibles con OpenAI.
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */

class MediaProcessor {
  static getSupportedTypes() {
    return {
      image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    };
  }

  static detectMediaType(mimeType) {
    const types = this.getSupportedTypes();
    if (types.image.includes(mimeType)) return 'image';
    return 'unknown';
  }

  static buildUserContent(text, mediaItems = []) {
    if (!mediaItems || mediaItems.length === 0) {
      return text;
    }

    const contentArray = [{ type: 'text', text }];
    for (const item of mediaItems) {
      if (item.category !== 'image' || !this.getSupportedTypes().image.includes(item.mimeType)) {
        throw new Error(`Formato multimedia no compatible: ${item.mimeType || 'desconocido'}`);
      }
      const data = String(item.data || '').replace(/^data:[^,]+;base64,/, '').replace(/\s/g, '');
      const paddingBytes = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
      const estimatedBytes = Math.floor(data.length * 0.75) - paddingBytes;
      if (!data || estimatedBytes > 8 * 1024 * 1024) {
        throw new Error('Cada imagen debe tener menos de 8 MB.');
      }
      contentArray.push({
        type: 'image_url',
        image_url: { url: `data:${item.mimeType};base64,${data}` }
      });
    }

    return contentArray;
  }
}

module.exports = { MediaProcessor };
