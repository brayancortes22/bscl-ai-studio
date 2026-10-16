const vscode = require('vscode');
const path = require('path');
const { randomUUID } = require('crypto');

// Etiquetas habituales de los bloques de código → languageId de VS Code. Solo se usan para
// resaltar la vista previa cuando el documento activo no tiene lenguaje (texto plano).
const LANGUAGE_ALIASES = new Map([
  ['js', 'javascript'], ['mjs', 'javascript'], ['cjs', 'javascript'], ['jsx', 'javascriptreact'],
  ['ts', 'typescript'], ['tsx', 'typescriptreact'], ['py', 'python'], ['rb', 'ruby'], ['rs', 'rust'],
  ['sh', 'shellscript'], ['bash', 'shellscript'], ['shell', 'shellscript'], ['zsh', 'shellscript'],
  ['ps1', 'powershell'], ['pwsh', 'powershell'], ['yml', 'yaml'], ['md', 'markdown'],
  ['cs', 'csharp'], ['c#', 'csharp'], ['c++', 'cpp'], ['kt', 'kotlin'], ['golang', 'go']
]);

class DiffManager {
  constructor(context) {
    this.scheme = 'bscl-ai-proposal';
    this.proposals = new Map();
    this.documents = new Map();
    this.provider = vscode.workspace.registerTextDocumentContentProvider(this.scheme, {
      provideTextDocumentContent: (uri) => this.documents.get(uri.toString()) || ''
    });
    context.subscriptions.push(this.provider);
  }

  async prepareProposal({ editor, code, codeKey, language = '' }) {
    if (!editor) throw new Error('Abre un archivo para revisar una propuesta con Diff.');
    if (typeof code !== 'string' || !code.trim()) throw new Error('El bloque de código está vacío.');

    const document = editor.document;
    if (document.uri.scheme === this.scheme) {
      throw new Error('El editor activo es el Diff de otra propuesta. Acéptala o descártala, o vuelve al archivo que quieres cambiar.');
    }
    if (this.isReadOnlyScheme(document.uri.scheme)) {
      throw new Error(`El editor activo es de solo lectura (${document.uri.scheme}). Abre el archivo que quieres cambiar antes de revisar la propuesta con Diff.`);
    }
    const range = new vscode.Range(editor.selection.start, editor.selection.end);
    const original = document.getText();
    const start = document.offsetAt(range.start);
    const end = document.offsetAt(range.end);
    const proposed = original.slice(0, start) + code + original.slice(end);
    const id = randomUUID();
    const previewUri = vscode.Uri.from({ scheme: this.scheme, path: `/${id}` });
    const proposal = {
      id,
      codeKey,
      documentUri: document.uri,
      documentVersion: document.version,
      range,
      code,
      previewUri
    };

    this.proposals.set(id, proposal);
    this.documents.set(previewUri.toString(), proposed);
    try {
      const previewDocument = await vscode.workspace.openTextDocument(previewUri);
      await this.setPreviewLanguage(previewDocument, document.languageId, language);
      await vscode.commands.executeCommand(
        'vscode.diff', document.uri, previewUri,
        `BSCL AI: ${path.basename(document.fileName || 'propuesta')}`
      );
      return { proposalId: id, codeKey };
    } catch (error) {
      await this.discardProposal(id);
      throw error;
    }
  }

  async applyProposal(id) {
    const proposal = this.proposals.get(id);
    if (!proposal) throw new Error('La propuesta ya no está disponible. Ábrela de nuevo desde el chat.');
    try {
      const document = await vscode.workspace.openTextDocument(proposal.documentUri);
      if (document.version !== proposal.documentVersion) {
        throw new Error('El archivo cambió después de abrir el Diff. Genera una comparación nueva antes de aplicar.');
      }

      const edit = new vscode.WorkspaceEdit();
      edit.replace(proposal.documentUri, proposal.range, proposal.code);
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) throw new Error('VS Code no pudo aplicar el cambio al documento.');
      await this.finishProposal(id);
      return { codeKey: proposal.codeKey };
    } catch (error) {
      await this.discardProposal(id);
      throw error;
    }
  }

  /**
   * Solo se rechazan los esquemas que VS Code declara de solo lectura (p. ej. el lado git:
   * de una comparación). Una lista cerrada de esquemas editables (file, untitled) dejaba
   * fuera celdas de notebook, ajustes de usuario (vscode-userdata) o archivos remotos, donde
   * el Diff y el WorkspaceEdit sí funcionan. Un esquema sin proveedor de archivos (undefined)
   * se acepta: si de verdad no admite edición, applyEdit devuelve false y se avisa entonces.
   */
  isReadOnlyScheme(scheme) {
    try { return vscode.workspace.fs?.isWritableFileSystem?.(scheme) === false; }
    catch { return false; }
  }

  // El resaltado es estético: un languageId desconocido no debe impedir abrir el Diff.
  async setPreviewLanguage(previewDocument, documentLanguage, blockLanguage) {
    const label = String(blockLanguage || '').trim().toLowerCase();
    const preferred = documentLanguage && documentLanguage !== 'plaintext'
      ? documentLanguage
      : (LANGUAGE_ALIASES.get(label) || (/^[a-z][a-z0-9-]{0,30}$/.test(label) ? label : documentLanguage));
    if (!preferred) return;
    try { await vscode.languages.setTextDocumentLanguage(previewDocument, preferred); }
    catch { /* lenguaje no registrado en este VS Code */ }
  }

  async discardProposal(id) {
    const proposal = this.proposals.get(id);
    if (!proposal) return { codeKey: '' };
    await this.finishProposal(id);
    return { codeKey: proposal.codeKey };
  }

  async discardAllProposals() {
    for (const id of this.proposals.keys()) await this.finishProposal(id);
  }

  async handleMessage(type, payload = {}, webview) {
    const action = { prepareDiff: 'prepare', acceptDiff: 'accept', discardDiff: 'discard' }[type];
    if (!action || !webview) return;
    try {
      const result = action === 'prepare'
        ? await this.prepareProposal({ editor: vscode.window.activeTextEditor, code: payload.code, codeKey: payload.codeKey, language: payload.language })
        : action === 'accept'
          ? await this.applyProposal(payload.proposalId)
          : await this.discardProposal(payload.proposalId);
      // Una propuesta ya cerrada devuelve codeKey vacío; el del mensaje permite al webview
      // encontrar la tarjeta y restaurar sus botones.
      webview.postMessage({
        type: action === 'prepare' ? 'diffPrepared' : 'diffResolved',
        payload: { ...result, codeKey: result?.codeKey || payload.codeKey, ...(action === 'prepare' ? {} : { outcome: action === 'accept' ? 'accepted' : 'discarded' }) }
      });
    } catch (error) {
      webview.postMessage({
        type: 'diffError',
        payload: { codeKey: payload.codeKey, message: error.message || String(error) }
      });
    }
  }

  async finishProposal(id) {
    const proposal = this.proposals.get(id);
    if (!proposal) return;
    this.proposals.delete(id);
    try {
      const tabInput = vscode.TabInputTextDiff;
      if (tabInput) {
        const diffTab = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((tab) =>
          tab.input instanceof tabInput && tab.input.modified.toString() === proposal.previewUri.toString()
        );
        if (diffTab) await vscode.window.tabGroups.close(diffTab);
      }
    } catch {
      // El cierre del editor es limpieza; nunca debe ocultar el resultado del cambio.
    } finally {
      this.documents.delete(proposal.previewUri.toString());
    }
  }
}

module.exports = { DiffManager };
