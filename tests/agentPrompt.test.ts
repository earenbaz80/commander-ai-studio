import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, type LLMContext } from '../src/agent/llm.js';

/** Contexto mínimo: cada test añade sólo lo que mira. */
function ctx(extra: Partial<LLMContext> = {}): LLMContext {
  return {
    goal: 'arreglar el bug del validador',
    cwd: '/tmp/repo',
    history: [],
    toolSchema: '[]',
    recentSteps: [],
    plan: [],
    ...extra,
  };
}

test('el prompt abre con la identidad y separa las secciones con línea en blanco', () => {
  const out = buildSystemPrompt(ctx());
  const sections = out.split('\n\n');

  assert.ok(sections[0].startsWith('Eres un agente autónomo de ingeniería de código'), sections[0].slice(0, 60));
  assert.ok(out.includes('update_plan'), 'el contrato del plan tiene que viajar');
  assert.ok(sections.length >= 5, `secciones=${sections.length}`);
});

test('protocolo de edición, contrato de tools e higiene git van en orden', () => {
  const out = buildSystemPrompt(ctx());
  const protocolo = out.indexOf('PROTOCOLO DE EDICIÓN');
  const contrato = out.indexOf('CONTRATO DE TOOLS');
  const git = out.indexOf('HIGIENE GIT');

  assert.ok(protocolo > 0 && contrato > protocolo && git > contrato, `${protocolo} ${contrato} ${git}`);
  assert.match(out.slice(protocolo, contrato), /fs\.edit/);
  assert.match(out.slice(contrato, git), /task/);
  assert.match(out.slice(git), /no hagas commit/i);
});

test('la sección de modo plan sólo aparece cuando el modo es plan', () => {
  assert.ok(!buildSystemPrompt(ctx()).includes('MODO PLAN'));
  assert.match(buildSystemPrompt(ctx({ mode: 'plan' })), /MODO PLAN/);
  assert.ok(!buildSystemPrompt(ctx({ mode: 'build' })).includes('MODO PLAN'));
});

test('las skills se anuncian sólo cuando hay alguna', () => {
  assert.ok(!buildSystemPrompt(ctx()).includes('SKILLS DISPONIBLES'));
  assert.ok(!buildSystemPrompt(ctx({ skills: [] })).includes('SKILLS DISPONIBLES'));

  const out = buildSystemPrompt(ctx({ skills: ['api', 'frontend-design'] }));
  assert.match(out, /SKILLS DISPONIBLES: api, frontend-design/);
});

test('AGENTS.md entra recortado y sin encabezado vacío', () => {
  assert.ok(!buildSystemPrompt(ctx()).includes('REGLAS DEL REPO'));

  const largo = buildSystemPrompt(ctx({ agentsMd: 'r'.repeat(5000) + '-COLA' }));
  assert.match(largo, /REGLAS DEL REPO \(AGENTS\.md\):/);
  assert.ok(!largo.includes('-COLA'), 'lo que pasa de 4000 caracteres se corta');

  const corto = buildSystemPrompt(ctx({ agentsMd: 'usa tsx, no node' }));
  assert.match(corto, /REGLAS DEL REPO \(AGENTS\.md\):\nusa tsx, no node/);
});
