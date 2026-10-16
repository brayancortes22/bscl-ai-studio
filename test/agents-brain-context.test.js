require('./helpers/vscode-stub');
// Prompt base: sin datos personales del autor y sin depender de la estructura de un vault concreto.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { state, reset } = require('./helpers/vscode-stub');
const { BrainContext, skillsFromFrontmatter } = require('../src/brain-context');

test.afterEach(() => reset());

function vault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bscl-vault-'));
}

function write(root, relPath, content) {
  const target = path.join(root, ...relPath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test('PRIV-1: el prompt no incluye el nombre del autor', () => {
  const prompt = BrainContext.getBaseSystemPrompt('general');
  assert.doesNotMatch(prompt, /Brayan|Cortés Lombana|Segundo Cerebro/);
  assert.match(prompt, /BSCL AI Studio/);
});

test('MAINT-1: solo se usa una nota marcada para la skill, esté donde esté', () => {
  const root = vault();
  write(root, '.obsidian/oculta.md', '---\nbscl-skill: qa-testing\n---\nNO');
  write(root, 'Programación/Calidad/Mis pruebas.md', '---\ntags: [qa]\nbscl-skill: qa-testing\n---\n# Testing\nPiramide de pruebas.\nAPI_TOKEN="abcdefghijk1234567890"\n');
  write(root, 'Programación/bscl-skill-architecture.md', 'Arquitectura hexagonal elegida.');
  write(root, 'Notas/Multi.md', '---\nbscl-skills:\n  - multiagent\n  - clean-code\n---\nOrquestación de agentes.');
  state.configuration.obsidianVaultPath = root;

  const qa = BrainContext.getBaseSystemPrompt('qa-testing');
  assert.match(qa, /Piramide de pruebas/);
  assert.ok(!qa.includes('abcdefghijk1234567890'), 'la nota se redacta antes de enviarse');
  assert.ok(!qa.includes('bscl-skill:'), 'el frontmatter no se envía');
  assert.doesNotMatch(qa, /^NO$/m);
  assert.match(BrainContext.getBaseSystemPrompt('architecture'), /hexagonal/);
  assert.match(BrainContext.getBaseSystemPrompt('multiagent'), /Orquestación/);
  assert.match(BrainContext.getBaseSystemPrompt('clean-code'), /Orquestación/);
  assert.doesNotMatch(BrainContext.getBaseSystemPrompt('database'), /Nota de referencia/);
});

test('MAINT-1: una nota con nombre parecido pero sin marca no se envía', () => {
  const root = vault();
  // Son los falsos positivos que daba la búsqueda por palabras en un vault real.
  write(root, 'Desarrollo/Pipeline 3D/9 - Arquitectura de capas.md', 'Capas del pipeline de texturas.');
  write(root, 'Herramientas/Mapa de pruebas legible (testing).md', 'Rejilla y carteles.');
  write(root, 'Arquitectura Limpia.md', 'limpia');
  write(root, 'Sin cerrar.md', '---\nbscl-skill: architecture\nNo se cierra el frontmatter.');
  state.configuration.obsidianVaultPath = root;
  for (const skill of ['architecture', 'qa-testing', 'ui-ux', 'database']) {
    assert.doesNotMatch(BrainContext.getBaseSystemPrompt(skill), /Nota de referencia/, skill);
  }
});

test('MAINT-1: con obsidianSkillsFolder solo se busca en esa carpeta del vault', () => {
  const root = vault();
  write(root, 'Otra/bscl-skill-database.md', 'fuera de la carpeta');
  write(root, 'Skills/BD.md', '---\nbscl-skill: "database"\n---\nIndices y normalizacion.');
  state.configuration.obsidianVaultPath = root;
  state.configuration.obsidianSkillsFolder = 'Skills';
  const prompt = BrainContext.getBaseSystemPrompt('database');
  assert.match(prompt, /Indices y normalizacion/);
  assert.doesNotMatch(prompt, /fuera de la carpeta/);
  // Una carpeta que sale del vault no se usa.
  state.configuration.obsidianSkillsFolder = '../';
  assert.equal(BrainContext.getSkillsRoot(root), null);
});

test('skillsFromFrontmatter admite línea, lista en línea y lista en bloque', () => {
  assert.deepEqual(skillsFromFrontmatter('---\nbscl-skill: ui-ux\n---\n'), ['ui-ux']);
  assert.deepEqual(skillsFromFrontmatter("---\nbscl-skills: [ui-ux, 'database', inventada]\n---\n"), ['ui-ux', 'database']);
  assert.deepEqual(skillsFromFrontmatter('---\nbscl-skills:\n  - devsecops\n  - qa-testing\ntags: x\n---\n'), ['devsecops', 'qa-testing']);
  assert.deepEqual(skillsFromFrontmatter('Texto sin frontmatter\nbscl-skill: ui-ux\n'), []);
});

test('sin vault configurado no hay nota de skill', () => {
  assert.doesNotMatch(BrainContext.getBaseSystemPrompt('clean-code'), /Nota de referencia/);
});
