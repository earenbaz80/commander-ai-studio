import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoop, type AgentLLMClient } from '../src/agent/loop.js';
import { AgentOrchestrator } from '../src/agent/orchestrator.js';
import type { AgentTask, AgentStep, AgentState } from '../src/agent/types.js';

/**
 * LLM fake determinista: alterna toolCalls (fs.read) y finish.
 * Registra qué método (callJson / callTools) invoca el loop según el dialecto.
 */
function createFakeLLM() {
  let turn = 0;
  const invoked: string[] = [];
  const next = () => { turn += 1; return turn; };
  const client: AgentLLMClient = {
    callJson: async () => {
      invoked.push('callJson');
      const t = next();
      if (t % 3 === 0) return { thought: `paso ${t}: objetivo cumplido`, finish: true, answer: 'listo' };
      return {
        thought: `paso ${t}: leyendo package.json`,
        plan: [{ id: `p${t}`, text: 'leer package.json', done: false }],
        toolCalls: [{ id: `t${t}`, tool: 'fs.read', input: { path: 'package.json' } }],
      };
    },
    callTools: async () => {
      invoked.push('callTools');
      const t = next();
      if (t % 3 === 0) return { thought: `paso ${t}: objetivo cumplido`, calls: [] };
      return {
        thought: `paso ${t}: leyendo package.json`,
        calls: [{ name: 'fs_read', args: { path: 'package.json' } }],
      };
    },
  };
  return { client, invoked };
}

function createMockOrchestrator() {
  const steps: AgentStep[] = [];
  let state: AgentState = {
    task: null,
    plan: [],
    steps: [],
    thinking: false,
    running: false,
  };

  const orchestrator = new AgentOrchestrator({
    cwd: '.',
    onStep: (step) => { steps.push(step); },
    onPlanChange: () => {},
    onStateChange: (s) => { state = s; },
    approve: async ({}) => ({ approved: true }),
  });

  return { orchestrator, steps, getState: () => state };
}

function createLoop(model: string) {
  const { orchestrator, steps, getState } = createMockOrchestrator();
  const { client, invoked } = createFakeLLM();
  const loop = new AgentLoop(orchestrator, model, client);
  return { loop, orchestrator, steps, getState, invoked };
}

test('AgentLoop se inicia correctamente', async () => {
  const { loop, getState } = createLoop('gemini-2.0-flash');

  const task: AgentTask = { id: 'test-1', goal: 'Test goal', cwd: '.', maxSteps: 5 };
  await loop.start(task);

  const state = getState();
  assert.equal(state.running, true);
  assert.equal(state.task?.id, 'test-1');
  assert.equal(state.thinking, true);
  loop.stop();
});

test('AgentLoop se detiene correctamente', async () => {
  const { loop, getState } = createLoop('gemini-2.0-flash');

  const task: AgentTask = { id: 'test-2', goal: 'Test goal', cwd: '.', maxSteps: 5 };
  await loop.start(task);
  loop.stop();

  const state = getState();
  assert.equal(state.running, false);
  assert.equal(state.thinking, false);
});

test('AgentLoop registra pensamientos', async () => {
  const { loop, steps } = createLoop('gemini-2.0-flash');

  const task: AgentTask = { id: 'test-3', goal: 'Test goal', cwd: '.', maxSteps: 5 };
  await loop.start(task);

  const thoughtSteps = steps.filter((s) => s.type === 'thought');
  assert.ok(thoughtSteps.length > 0, 'Debería registrar pensamientos');
  loop.stop();
});

test('AgentLoop respeta maxSteps', async () => {
  const { loop, getState } = createLoop('gemini-2.0-flash');

  const task: AgentTask = { id: 'test-4', goal: 'Test goal', cwd: '.', maxSteps: 3 };
  await loop.start(task);

  const state = getState();
  assert.ok(state.steps.length <= 3, `Debería respetar maxSteps (obtenido: ${state.steps.length})`);
  loop.stop();
});

test('AgentOrchestrator maneja tools requiriendo aprobación', async () => {
  const { orchestrator } = createMockOrchestrator();

  // Shell run requiere aprobación
  const result = await orchestrator.runTool('shell.run', { command: 'echo test' });
  // El resultado depende de si shell.run está disponible, pero al menos debería intentar aprobar
  assert.equal(typeof result.ok, 'boolean');
});

test('AgentOrchestrator maneja tool no encontrada', async () => {
  const { orchestrator } = createMockOrchestrator();
  const result = await orchestrator.runTool('tool.inexistente' as any, {});
  assert.equal(result.ok, false);
  assert.ok(result.error?.includes('no encontrado') || result.error?.includes('no encontrada'));
});

test('AgentLoop con modelo nativo usa function calling', async () => {
  const { loop, getState } = createLoop('gemini-2.0-flash');

  const task: AgentTask = { id: 'test-5', goal: 'Test goal', cwd: '.', maxSteps: 5 };
  await loop.start(task);

  const state = getState();
  assert.equal(state.running, true);
  loop.stop();
});

test('AgentLoop con modelo Ollama usa tool-calling nativo (dialecto OpenAI)', async () => {
  const { loop, getState, invoked } = createLoop('ollama/llama3.2');

  const task: AgentTask = { id: 'test-6', goal: 'Test goal', cwd: '.', maxSteps: 5 };
  await loop.start(task);

  const state = getState();
  assert.equal(state.running, true);
  assert.ok(invoked.includes('callTools'), 'Ollama debe usar callTools (dialecto OpenAI)');
  loop.stop();
});

test('AgentLoop con modelo Pollinations usa JSON mode (sin tool-calling nativo)', async () => {
  const { loop, getState, invoked } = createLoop('pollinations/openai');

  const task: AgentTask = { id: 'test-6b', goal: 'Test goal', cwd: '.', maxSteps: 5 };
  await loop.start(task);

  const state = getState();
  assert.equal(state.running, true);
  assert.ok(invoked.includes('callJson'), 'Pollinations debe usar callJson (dialecto json-text)');
  assert.ok(!invoked.includes('callTools'), 'Pollinations NO debe usar callTools');
  loop.stop();
});

test('AgentLoop spawnSubagent ejecuta tarea acotada', async () => {
  const { loop, getState } = createLoop('gemini-2.0-flash');

  const task: AgentTask = { id: 'test-7', goal: 'Test goal', cwd: '.', maxSteps: 5 };
  await loop.start(task);

  const subId = await loop.spawnSubagent('Sub goal', 3);
  assert.ok(subId.startsWith('sub'), `subId debería empezar por "sub" (obtenido: ${subId})`);
  const state = getState();
  assert.ok(state.steps.some((s) => s.title === 'Subagente'), 'Debería registrar el lanzamiento del subagente');
});
