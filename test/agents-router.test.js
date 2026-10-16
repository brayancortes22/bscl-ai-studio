// Enrutamiento por regex: cada caso es una frase real que antes se clasificaba mal.
const test = require('node:test');
const assert = require('node:assert/strict');
const { NeuralRouter } = require('../src/neural-router');

test('ROUTER-1: el subjuntivo activa la implementación', () => {
  for (const prompt of [
    'necesito que arregles el login',
    'quiero que agregues un botón de exportar',
    'Quiero que corrijas el bug del proyecto',
    'me gustaría que implementes la paginación',
    'quiero que en la pantalla de login agregues un botón'
  ]) {
    assert.equal(NeuralRouter.isLikelyImplementationRequest(prompt), true, prompt);
    assert.equal(NeuralRouter.classifyTask(prompt, []).needsCoderAgent, true, prompt);
  }
});

test('ROUTER-1: los verbos ambiguos no disparan lejos del "que"', () => {
  for (const prompt of ['¿crees que esto funciona?', 'quiero que me digas si crees que es buena idea', 'quiero que me expliques las mejores prácticas',
    // El subjuntivo de una subordinada pertenece a otro sujeto: es una pregunta, no un encargo.
    'quiero que me expliques por qué el linter pide que elimines la variable',
    'necesito que me digas si el revisor quiere que agregues tests']) {
    assert.equal(NeuralRouter.isLikelyImplementationRequest(prompt), false, prompt);
    assert.notEqual(NeuralRouter.classifyTask(prompt, []).intent, 'coding_implementation', prompt);
  }
});

test('ROUTER-2: una petición de cambio no es una pregunta de inventario', () => {
  assert.equal(NeuralRouter.asksWorkspaceInventory('Quiero que corrijas el bug del proyecto'), false);
  assert.equal(NeuralRouter.asksWorkspaceInventory('Quiero que el proyecto tenga una interfaz más bonita'), false);
  assert.equal(NeuralRouter.asksWorkspaceInventory('¿Qué proyectos hay?'), true);
  assert.equal(NeuralRouter.asksWorkspaceInventory('¿Cuáles carpetas existen en el workspace?'), true);
});

test('ROUTER-3: "web" como sustantivo o "busca en el proyecto" no son búsqueda web', () => {
  for (const prompt of ['¿Qué es un servidor web?', 'busca en el proyecto dónde se define handleUserMessage', 'Crea una página web',
    'el error está en línea 42 del archivo', 'la app se conecta a internet', 'crea una tienda online']) {
    assert.equal(NeuralRouter.requestsWebSearch(prompt), false, prompt);
  }
  assert.notEqual(NeuralRouter.classifyTask('¿Qué es un servidor web?', []).intent, 'web_research');
  for (const prompt of ['busca en internet la última versión de react', 'busca en la web cómo usar fetch', 'consulta en google el precio', 'dame las últimas noticias']) {
    assert.equal(NeuralRouter.requestsWebSearch(prompt), true, prompt);
  }
});

test('ROUTER-4: "prueba" sola no es una petición de revisión', () => {
  assert.equal(NeuralRouter.isExplicitReviewRequest('dame una prueba de que raíz de 2 es irracional'), false);
  assert.notEqual(NeuralRouter.classifyTask('dame una prueba de que raíz de 2 es irracional', []).intent, 'code_review');
  assert.equal(NeuralRouter.isExplicitReviewRequest('revisa las pruebas del proyecto'), true);
  assert.equal(NeuralRouter.isExplicitReviewRequest('prueba el código del login'), true);
  assert.equal(NeuralRouter.isExplicitReviewRequest('audita la seguridad'), true);
});

test('FS-7: deshacer solo con órdenes explícitas', () => {
  for (const prompt of ['deshaz los cambios', 'revierte lo que hiciste', 'undo', 'Deshaz el último cambio, por favor',
    'quiero deshacer los cambios', 'deshacer', 'revert the last change', 'restaura lo que había',
    'Deshaz el último cambio que hiciste', 'Deshaz los últimos cambios, gracias', '¿Puedes deshacer el último cambio?']) {
    assert.equal(NeuralRouter.isUndoRequest(prompt), true, prompt);
  }
  for (const prompt of ['Restaurar contraseña: crea el endpoint de recuperación', 'Revierte el color del header a azul',
    'revierte los cambios del header', 'Revierte la migración de la base de datos', 'restaura el botón de guardar',
    'Deshacer y rehacer: implementa un historial en el editor', 'gracias', 'Revierte los cambios que hiciste en el header']) {
    assert.equal(NeuralRouter.isUndoRequest(prompt), false, prompt);
  }
});
