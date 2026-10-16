const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { WorkspaceContext } = require('./workspace-context');
const { isSensitivePath, redactSecrets } = require('./sensitive-data');
const { isCredentialRoot } = require('./patch-applier');

const MAX_FILES = 12;
const MAX_TEXT_BYTES = 160 * 1024;
const MAX_TEXT_FILE_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME = new Map([['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.gif', 'image/gif']]);
// La transcripción está desactivada: un audio adjunto viajaría en base64 (hasta MB) sin que
// ningún modelo lo use. Se reconoce la extensión solo para explicar por qué se omite.
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.aiff', '.aif', '.webm', '.opus']);

class DroppedFileImporter {
  static read(uriStrings = []) {
    const files = [];
    const directories = [];
    const skipped = [];
    const seen = new Set();
    let textBytes = 0;
    let imageBytes = 0;
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
          // Una carpeta arrastrada pasa a ser la raíz de trabajo y, desde ahí, las rutas
          // relativas (config.json, authorized_keys) ya no dicen que son credenciales.
          if (isCredentialRoot(realPath)) throw new Error('es una carpeta de credenciales y no se usa como carpeta de trabajo');
          directories.push({ name: path.basename(realPath), path: realPath });
          continue;
        }
        if (!stat.isFile()) throw new Error('no es un archivo regular');
        if (directories.length >= MAX_FILES || files.length >= MAX_FILES) throw new Error(`límite de ${MAX_FILES} elementos`);
        const name = path.basename(realPath);
        // Ruta completa: además del nombre (.env, id_rsa…) cuentan carpetas como ~/.ssh o ~/.aws.
        if (isSensitivePath(realPath)) throw new Error('nombre de archivo sensible');
        const extension = path.extname(name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(extension)) throw new Error('los audios no se pueden adjuntar porque la transcripción está desactivada');
        const imageMime = IMAGE_MIME.get(extension);

        if (imageMime) {
          if (stat.size > MAX_IMAGE_BYTES || imageBytes + stat.size > MAX_IMAGE_BYTES) throw new Error('las imágenes superan el límite de 8 MB');
          const data = fs.readFileSync(realPath).toString('base64');
          files.push({ category: 'image', mimeType: imageMime, data: `data:${imageMime};base64,${data}`, name, size: stat.size });
          imageBytes += stat.size;
          continue;
        }

        if (!WorkspaceContext.isTextFileName(name)) throw new Error('tipo de archivo no admitido');
        if (stat.size > MAX_TEXT_FILE_BYTES || textBytes + stat.size > MAX_TEXT_BYTES) throw new Error('el texto adjunto supera 64 KB por archivo o 160 KB en conjunto');
        const bytes = fs.readFileSync(realPath);
        if (bytes.includes(0)) throw new Error('el archivo contiene datos binarios');
        // TextDecoder quita el BOM; con 'utf8' de Node quedaba un U+FEFF al principio del texto.
        const content = new TextDecoder('utf-8').decode(bytes);
        files.push({ category: 'text', mimeType: 'text/plain', content: redactSecrets(content, { fileName: name }), name, size: stat.size });
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
