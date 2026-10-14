/**
 * Componente UI para Conciencia del Workspace y Editor Activo
 * Autor: Brayan Stid Cortés Lombana (bscl)
 */
window.WorkspaceView = (function () {
  const activeFileChip = document.getElementById('activeFileChip');
  const activeFileName = document.getElementById('activeFileName');
  const chkAutoContext = document.getElementById('chkAutoContext');
  const openTabsList = document.getElementById('openTabsList');

  let currentContext = null;

  function update(payload) {
    currentContext = payload;
    const { activeEditor, openEditors = [], workspaceDirectories = [], workspaceFolderTree = [] } = payload || {};

    if (activeEditor) {
      activeFileChip.classList.remove('hidden');
      activeFileName.textContent = `${activeEditor.fileName} (${activeEditor.language}, ${activeEditor.lineCount}L)`;
      activeFileChip.title = `Ruta: ${activeEditor.relativePath}\nSelección: ${activeEditor.selectedText ? 'Sí' : 'No'}`;
    } else {
      activeFileChip.classList.remove('hidden');
      const totalFolders = (workspaceFolderTree && workspaceFolderTree.length) ? workspaceFolderTree.length : (workspaceDirectories || []).length;
      activeFileName.textContent = totalFolders > 0
        ? `📁 ${totalFolders} carpetas y subcarpetas`
        : '📂 Workspace activo';
      activeFileChip.title = `Carpetas directas: ${(workspaceDirectories || []).length}\nSubcarpetas incluidas: ${(workspaceFolderTree || []).length}`;
    }

    if (openTabsList) {
      openTabsList.innerHTML = '';
      openEditors.forEach(tab => {
        const span = document.createElement('span');
        span.className = `tab-pill ${tab.isActive ? 'tab-active' : ''}`;
        span.textContent = tab.label;
        openTabsList.appendChild(span);
      });
    }
  }

  function isAutoContextEnabled() {
    return chkAutoContext ? chkAutoContext.checked : true;
  }

  function getContext() {
    return currentContext;
  }

  return { update, isAutoContextEnabled, getContext };
})();
