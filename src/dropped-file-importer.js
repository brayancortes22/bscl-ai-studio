const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { WorkspaceContext } = require('./workspace-context');

const MAX_FILES = 12;
const MAX_TEXT_BYTES = 160 * 1024;
const MAX_TEXT_FILE_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const SECRET_VALUE = /(["']?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|passwd|authorization|private[-_]?key|secret|token)["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^,\s}]+)/gi;
const IMAGE_MIME = new Map([['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.gif', 'image/gif']]);
const AUDIO_MIME = new Map([
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.m4a', 'audio/m4a'], ['.aac', 'audio/aac'],
  ['.ogg', 'audio/ogg'], ['.flac', 'audio/flac'], ['.aiff', 'audio/aiff'], ['.aif', 'audio/aiff'],
  ['.webm', 'audio/webm'], ['.opus', 'audio/opus']
]);
const SENSITIVE_NAME = /(?:^\.env(?:\..*)?$|^local\.properties$|secret|credential|token|^id_(?:rsa|ed25519)|\.(?:pem|key|p12|pfx|jks|keystore)$)/i;

class DroppedFileImporter {
  static read(uriStrings = []) {
    const files = [];
    const directories = [];
    const skipped = [];
    const seen = new Set();
    let textBytes = 0;
    let audioBytes = 0;
    let imageBytes = 0;
    let mediaBytes = 0;
    const uris = [...new Set(uriStrings)].slice(0, MAX_FILES);

    for (const uriString of uris) {
      let filePath;
      try {
        const uri = vscode.Uri.parse(String(uriString));
        if (uri.scheme !== 'file') throw new Error('solo se admiten rutas locales file://');
        filePath = uri.fsPath;
        const stat = fs.lstatSync(filePath);
        if (stat.isSymbolicLink()) throw new Error('se omitieron enlaces simbólicos');
        const realPath = fs.realpathSync(filePath);
        if (seen.has(realPath)) continue;
        seen.add(realPath);
        if (stat.isDirectory()) {
          directories.push({ name: path.basename(realPath), path: realPath });
          continue;
        }
        if (!stat.isFile()) throw new Error('no es un archivo regular');
        if (directories.length >= MAX_FILES || files.length >= MAX_FILES) throw new Error(`límite de ${MAX_FILES} elementos`);
        const name = path.basename(realPath);
        if (SENSITIVE_NAME.test(name)) throw new Error('nombre de archivo sensible');
        const extension = path.extname(name).toLowerCase();
        const imageMime = IMAGE_MIME.get(extension);
        const audioMime = AUDIO_MIME.get(extension);

        if (imageMime || audioMime) {
          const mediaType = imageMime ? 'image' : 'audio';
          const total = imageMime ? imageBytes : audioBytes;
          const sizeLimit = imageMime ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
          if (stat.size > sizeLimit || total + stat.size > sizeLimit || mediaBytes + stat.size > 20 * 1024 * 1024) throw new Error(`el tamaño supera el límite para ${mediaType}`);
          const data = fs.readFileSync(realPath).toString('base64');
          files.push({ category: mediaType, mimeType: imageMime || audioMime, data: `data:${imageMime || audioMime};base64,${data}`, name, size: stat.size });
          if (imageMime) imageBytes += stat.size;
          else audioBytes += stat.size;
          mediaBytes += stat.size;
          continue;
        }

        if (!WorkspaceContext.isTextFileName(name)) throw new Error('tipo de archivo no admitido');
        if (stat.size > MAX_TEXT_FILE_BYTES || textBytes + stat.size > MAX_TEXT_BYTES) throw new Error('el texto adjunto supera 64 KB por archivo o 160 KB en conjunto');
        const content = fs.readFileSync(realPath, 'utf8');
        if (content.includes('\u0000')) throw new Error('el archivo contiene datos binarios');
        files.push({ category: 'text', mimeType: 'text/plain', content: content.replace(SECRET_VALUE, '$1"[REDACTADO]"'), name, size: stat.size });
        textBytes += stat.size;
      } catch (error) {
        skipped.push(`No adjunté «${path.basename(filePath || String(uriString))}»: ${error.message}.`);
      }
    }
    if (uriStrings.length > MAX_FILES) skipped.push(`Se procesaron solo ${MAX_FILES} elementos del arrastre.`);
    return { files, directories, skipped };
  }
}

module.exports = { DroppedFileImporter };
