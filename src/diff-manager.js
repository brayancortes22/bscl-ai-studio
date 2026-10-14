const vscode = require('vscode');
const path = require('path');
const { randomUUID } = require('crypto');

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

  async prepareProposal({ editor, code, codeKey }) {
    if (!editor) throw new Error('Abre un archivo para revisar una propuesta con Diff.');
    if (typeof code !== 'string' || !code.trim()) throw new Error('El bloque de código está vacío.');

    const document = editor.document;
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
      await vscode.languages.setTextDocumentLanguage(previewDocument, document.languageId);
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
        ? await this.prepareProposal({ editor: vscode.window.activeTextEditor, code: payload.code, codeKey: payload.codeKey })
        : action === 'accept'
          ? await this.applyProposal(payload.proposalId)
          : await this.discardProposal(payload.proposalId);
      webview.postMessage({
        type: action === 'prepare' ? 'diffPrepared' : 'diffResolved',
        payload: { ...result, ...(action === 'prepare' ? {} : { outcome: action === 'accept' ? 'accepted' : 'discarded' }) }
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
