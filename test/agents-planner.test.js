// Planificador: su veredicto debe sobrevivir a normalizePlan cuando acierta.
const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskPlanner } = require('../src/agents/task-planner');
const { MAX_SUBAGENTS } = require('../src/agents/subagent-runner');
const { NeuralRouter } = require('../src/neural-router');

const PROPOSAL = [
  { role: 'user', content: 'mejora el login' },
  { role: 'assistant', content: 'Te propongo validar el formulario y mostrar errores. ¿Quieres que lo implemente?' },
  { role: 'user', content: 'hazlo' }
];

function plan(intent, prompt, messages = [], extra = {}) {
  return TaskPlanner.normalizePlan({ intent, title: 't', goal: 'g', steps: ['paso'], subtasks: [], ...extra }, prompt,
    NeuralRouter.classifyTask(prompt, []), false, messages);
}

test('PLAN-1: "hazlo" tras una propuesta conserva coding_implementation', () => {
  assert.equal(plan('coding_implementation', 'hazlo', PROPOSAL).intent, 'coding_implementation');
  // Sin propuesta previa no hay nada que continuar.
  assert.equal(plan('coding_implementation', 'hazlo', []).intent, 'answer');
});

test('PLAN-1: las respuestas naturales a la propuesta también conservan coding_implementation', () => {
  const offer = PROPOSAL.slice(0, 2);
  for (const reply of ['Sí, hazlo', 'hazlo por favor', 'perfecto, hazlo', 'si por favor', 'Dale, adelante', 'ok', 'Sí, adelante, gracias',
    'claro que sí, impleméntalo', 'bueno, hazlo así', 'vale', 'procede']) {
    const messages = [...offer, { role: 'user', content: reply }];
    assert.equal(TaskPlanner.isTaskContinuation(reply, messages), true, reply);
    assert.equal(plan('coding_implementation', reply, messages).intent, 'coding_implementation', reply);
  }
  // Cortesía sola, matices o un cambio de tema no aceptan la propuesta.
  for (const reply of ['gracias', 'no', 'sí, pero primero explícame cómo funciona', 'bueno', 'hazlo en otro archivo y explícame', 'con eso']) {
    const messages = [...offer, { role: 'user', content: reply }];
    assert.equal(TaskPlanner.isTaskContinuation(reply, messages), false, reply);
  }
  // Sin propuesta previa, "Sí, hazlo" no tiene nada que continuar.
  assert.equal(TaskPlanner.isTaskContinuation('Sí, hazlo', [{ role: 'assistant', content: 'Hola, ¿en qué te ayudo?' }]), false);
});

test('PLAN-1: el subjuntivo se acepta como implementación', () => {
  assert.equal(plan('coding_implementation', 'necesito que arregles el login').intent, 'coding_implementation');
});

test('PLAN-1: revisar y mejorar a la vez no se queda en auditoría', () => {
  const prompt = 'Revisa el proyecto actual y mejoralo todo, tanto el diseño tambien';
  assert.equal(plan('code_review', prompt).intent, 'coding_implementation');
  assert.equal(plan('code_review', 'revisa el código del login').intent, 'code_review');
});

test('visual_analysis del planificador se traduce a un flujo real', () => {
  assert.equal(plan('visual_analysis', 'Quiero que el proyecto tenga una interfaz más bonita').intent, 'coding_implementation');
  assert.equal(plan('visual_analysis', 'explícame qué es CSS grid').intent, 'answer');
});

test('fallback: "sí" tras una oferta de explicar no lanza al Programador', () => {
  const triage = NeuralRouter.classifyTask('si', []);
  assert.equal(TaskPlanner.fallback('hazlo', NeuralRouter.classifyTask('hazlo', []), false, PROPOSAL).intent, 'coding_implementation');
  assert.equal(TaskPlanner.fallback('si', triage, false, [{ role: 'assistant', content: '¿Quieres que te explique más detalles?' }]).intent, 'answer');
});

test('UX-1: las subtareas se recortan al máximo que se ejecuta', () => {
  const raw = Array.from({ length: 30 }, (_, index) => ({ title: `t${index}`, description: 'd' }));
  const subtasks = TaskPlanner.normalizeSubtasks(raw, 'code_review');
  assert.equal(subtasks.length, MAX_SUBAGENTS);
  assert.deepEqual(subtasks.map((task) => task.id), Array.from({ length: MAX_SUBAGENTS }, (_, index) => index + 1));
});

test('plan(): el prompt pide como máximo MAX_SUBAGENTS y recibe messages', async () => {
  let seen = null;
  const client = { sendMessage: async (opts) => { seen = opts; return { content: JSON.stringify({ intent: 'coding_implementation', title: 'x', goal: 'y', steps: [], subtasks: [] }) }; } };
  const result = await TaskPlanner.plan({ client, prompt: 'hazlo', triage: NeuralRouter.classifyTask('hazlo', []), model: 'm', messages: PROPOSAL });
  assert.match(seen.systemPrompt, new RegExp(`máximo de ${MAX_SUBAGENTS}\\b`));
  assert.doesNotMatch(seen.systemPrompt, /máximo de 100/);
  assert.equal(result.intent, 'coding_implementation');
});

test('plan(): una cancelación se relanza en vez de caer al fallback', async () => {
  const abort = Object.assign(new Error('Solicitud cancelada.'), { name: 'AbortError' });
  const client = { sendMessage: async () => { throw abort; } };
  await assert.rejects(TaskPlanner.plan({ client, prompt: 'crea un login', triage: NeuralRouter.classifyTask('crea un login', []), model: 'm' }),
    (error) => error === abort);
});

test('PROMPT-1: la subtarea por defecto de investigación no pide enlaces', () => {
  const [task] = TaskPlanner.normalizeSubtasks([], 'web_research');
  assert.doesNotMatch(task.description, /conserva enlaces/);
  assert.match(task.description, /no inventes enlaces/);
});
