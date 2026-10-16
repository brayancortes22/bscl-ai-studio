/**
 * Módulo vaciado a propósito.
 *
 * Contenía executeInTerminal (enviaba cualquier texto a una terminal integrada, que lo
 * ejecutaba sin confirmación), readFileContent y listWorkspaceFiles. Ninguna tenía uso: el
 * webview nunca enviaba 'execTerminal' y la lectura de archivos ya la cubren
 * WorkspaceContext y la herramienta read_file del enjambre, con sus filtros de rutas y de
 * credenciales. Mantener código sin uso con esas capacidades solo dejaba una puerta abierta
 * a cualquier fallo futuro del webview. Se conserva el archivo para que un require antiguo
 * no rompa la carga de la extensión.
 */
module.exports = {};
