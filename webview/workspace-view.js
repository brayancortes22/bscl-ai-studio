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
    const { activeEditor, openEditors = [], workspaceDirectories = [] } = payload || {};

    if (activeEditor) {
      activeFileChip.classList.remove('hidden');
      activeFileName.textContent = `${activeEditor.fileName} (${activeEditor.language}, ${activeEditor.lineCount}L)`;
      activeFileChip.title = `Ruta: ${activeEditor.relativePath}\nSelección: ${activeEditor.selectedText ? 'Sí' : 'No'}`;
    } else {
      activeFileChip.classList.remove('hidden');
      activeFileName.textContent = workspaceDirectories.length > 0
        ? `📁 ${workspaceDirectories.length} carpetas principales`
        : '📂 Workspace activo';
      activeFileChip.title = 'Carpetas visibles de primer nivel; no todas se verifican como proyectos.';
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
