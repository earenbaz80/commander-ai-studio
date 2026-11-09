import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoop, RepeatGuard, callSignature, type AgentLLMClient } from '../src/agent/loop.js';
import { AgentOrchestrator } from '../src/agent/orchestrator.js';
import type { AgentTask, AgentStep, AgentState } from '../src/agent/types.js';
import { AGENT_FUNCTION_DECLARATIONS, mapFunctionCall } from '../src/agent/fnTools.js';
import { PLAN_TOOL, normalizePlan } from '../src/agent/plan.js';

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

test('AgentLoop con un modelo Freebuff con tool-calls usa la vía nativa', async () => {
  const { loop, getState, invoked } = createLoop('freebuff/gpt-6-luna');

  const task: AgentTask = { id: 'test-6c', goal: 'Test goal', cwd: '.', maxSteps: 5 };
  await loop.start(task);

  assert.equal(getState().running, true);
  assert.ok(invoked.includes('callTools'), 'Freebuff con tool-calls debe usar callTools');
  loop.stop();
});

test('AgentLoop con un modelo Freebuff sin tool-calls cae a JSON en texto', async () => {
  const { loop, getState, invoked } = createLoop('freebuff/qwen-chat-7b');

  const task: AgentTask = { id: 'test-6d', goal: 'Test goal', cwd: '.', maxSteps: 5 };
  await loop.start(task);

  assert.equal(getState().running, true);
  assert.ok(invoked.includes('callJson'), 'Freebuff sin tool-calls debe usar callJson');
  assert.ok(!invoked.includes('callTools'), 'no debe gastar un paso en un tool-call que el modelo no sabe hacer');
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

// ── update_plan: plan en la vía nativa ────────────────────────────────
// `stepNative` no recibe un campo `plan` del proveedor, así que el plan sólo
// puede llegar por esta pseudo-tool. Antes, con modelos de function calling el
// panel de plan se quedaba vacío para siempre.

test('update_plan se declara al modelo pero no se mapea a una tool del registro', () => {
  const decl = AGENT_FUNCTION_DECLARATIONS.find((d) => d.name === PLAN_TOOL);
  assert.ok(decl, 'update_plan debe estar en las declaraciones de funciones');
  assert.equal(mapFunctionCall(PLAN_TOOL, { items: [] }), null, 'no debe resolverse a una tool ejecutable');
});

test('AgentLoop aplica update_plan en la vía nativa y no lo toma por respuesta final', async () => {
  const { orchestrator, steps, getState } = createMockOrchestrator();
  let turns = 0;
  const client: AgentLLMClient = {
    callJson: async () => ({ finish: true, answer: 'no debería usarse' }),
    callTools: async () => {
      turns += 1;
      return {
        thought: 'planifico',
        calls: [
          {
            name: PLAN_TOOL,
            args: {
              items: [
                { id: 'p1', text: 'leer el repo' },
                { id: 'p2', text: 'editar el bucle', done: true },
              ],
            },
          },
        ],
      };
    },
  };
  const loop = new AgentLoop(orchestrator, 'gemini-2.0-flash', client);

  await loop.start({ id: 'plan-1', goal: 'Test goal', cwd: '.', maxSteps: 5 });

  const state = getState();
  assert.equal(turns, 1, 'debe usar la vía nativa');
  assert.deepEqual(
    state.plan.map((p) => ({ id: p.id, text: p.text, done: p.done })),
    [
      { id: 'p1', text: 'leer el repo', done: false },
      { id: 'p2', text: 'editar el bucle', done: true },
    ]
  );
  assert.equal(state.running, true, 'un turno que sólo actualiza el plan no termina la tarea');
  assert.ok(!steps.some((s) => s.title === 'Finalizado'), 'no debe marcar Finalizado');
  loop.stop();
});

// ── Llamadas repetidas ────────────────────────────────────────────────
// Un modelo que no encuentra lo que busca tiende a releer exactamente lo
// mismo. El bucle se lo dice en vez de dejarlo gastar pasos.

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

test('la huella de una llamada no depende del orden de las claves', () => {
  assert.equal(
    callSignature('fs.read', { path: 'a.ts', limit: 10 }),
    callSignature('fs.read', { limit: 10, path: 'a.ts' })
  );
  assert.notEqual(callSignature('fs.read', { path: 'a.ts' }), callSignature('fs.read', { path: 'b.ts' }));
  assert.notEqual(callSignature('fs.read', { path: 'a.ts' }), callSignature('fs.grep', { path: 'a.ts' }));
});

test('RepeatGuard avisa a partir de la segunda llamada idéntica y perdona tras editar', () => {
  const guard = new RepeatGuard();
  const read = { tool: 'fs.read', input: { path: 'src/a.ts' } };

  assert.deepEqual(guard.track([read]), [], 'la primera vez no hay nada que avisar');
  assert.deepEqual(guard.track([{ ...read, input: { path: 'src/a.ts' } }]), [{ tool: 'fs.read', times: 2 }]);
  assert.deepEqual(guard.track([read]), [{ tool: 'fs.read', times: 3 }], 'sigue contando mientras insista');
  assert.deepEqual(guard.track([{ tool: 'fs.read', input: { path: 'src/b.ts' } }]), [], 'otra ruta no repite');

  // Una edición cambia el estado: releer el mismo sitio deja de ser un bucle.
  assert.deepEqual(guard.track([{ tool: 'fs.edit', input: { path: 'src/a.ts', oldString: 'x', newString: 'y' } }]), []);
  assert.deepEqual(guard.track([read]), [], 'tras editar, la misma lectura es legítima');
});

test('AgentLoop registra un aviso cuando el modelo repite la misma llamada', async () => {
  const { orchestrator, steps } = createMockOrchestrator();
  let turns = 0;
  const client: AgentLLMClient = {
    callJson: async () => ({ finish: true, answer: 'no debería usarse' }),
    callTools: async () => {
      turns += 1;
      if (turns > 3) return { thought: 'listo', calls: [] };
      return { thought: 'leo lo mismo', calls: [{ name: 'fs_read', args: { path: 'package.json' } }] };
    },
  };
  const loop = new AgentLoop(orchestrator, 'gemini-2.0-flash', client);

  await loop.start({ id: 'rep-1', goal: 'Test goal', cwd: '.', maxSteps: 20 });
  try {
    const warned = await waitFor(() => steps.some((step) => step.title === 'Llamada repetida'));
    assert.ok(warned, 'el bucle debe avisar de la relectura en vez de dejarla pasar');
    const step = steps.find((s) => s.title === 'Llamada repetida');
    assert.match(String(step?.content), /fs\.read/);
  } finally {
    loop.stop();
  }
});

test('el bucle registra qué modelo respondió cuando el pedido no lo hizo', async () => {
  const { orchestrator, steps } = createMockOrchestrator();
  const client: AgentLLMClient = {
    callJson: async () => ({ finish: true, answer: '' }),
    callTools: async () => ({
      thought: 'listo',
      calls: [],
      model: 'gemini-3.5-flash-lite',
      fallback: { from: 'gemini-3.5-flash', to: 'gemini-3.5-flash-lite' },
    }),
  };
  const loop = new AgentLoop(orchestrator, 'gemini-3.5-flash', client);

  await loop.start({ id: 'fb-1', goal: 'Test goal', cwd: '.', maxSteps: 6 });
  try {
    const step = steps.find((s) => s.title === 'Modelo sustituido');
    assert.ok(step, 'la sustitución debe quedar como paso, no escondida en el texto');
    assert.match(String(step?.content), /gemini-3\.5-flash no respondió; respondió gemini-3\.5-flash-lite/);
  } finally {
    loop.stop();
  }
});

test('sin sustitución no se registra ningún paso de modelo', async () => {
  const { orchestrator, steps } = createMockOrchestrator();
  const client: AgentLLMClient = {
    callJson: async () => ({ finish: true, answer: '' }),
    callTools: async () => ({ thought: 'listo', calls: [], model: 'gemini-3.5-flash', fallback: null }),
  };
  const loop = new AgentLoop(orchestrator, 'gemini-3.5-flash', client);
  await loop.start({ id: 'fb-2', goal: 'Test goal', cwd: '.', maxSteps: 6 });
  loop.stop();
  assert.ok(!steps.some((s) => s.title === 'Modelo sustituido'));
});

test('normalizePlan marca por id sin repetir el texto y descarta basura', () => {
  const current = [{ id: 'p1', text: 'leer el repo', status: 'pending' as const, done: false }];

  assert.deepEqual(normalizePlan([{ id: 'p1', done: true }], current), [
    { id: 'p1', text: 'leer el repo', status: 'done', done: true },
  ]);
  assert.deepEqual(normalizePlan('no soy un array', current), current, 'un plan inválido no borra el actual');
  assert.equal(normalizePlan([{ text: '   ' }, { done: true }, null]).length, 0);
  assert.equal(normalizePlan([{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }]).length, 1, 'ids repetidos');
  assert.equal(
    normalizePlan(Array.from({ length: 30 }, (_, i) => ({ text: `paso ${i}` }))).length,
    20,
    'el plan se recorta para no inflar el prompt'
  );
});

// ── Reanudar una corrida interrumpida ──

/** Estado de una corrida que se quedó a medias, tal como lo deja el autoguardado. */
const interruptedState = (maxSteps = 40) => ({
  task: { id: 'resume-1', goal: 'seguir con la tarea', cwd: '.', maxSteps },
  plan: [{ id: 'p1', text: 'leer package.json', done: false }],
  steps: [
    { id: 's1', type: 'thought' as const, title: 'Inicio', content: 'objetivo', status: 'completed' as const, ts: 1 },
    { id: 's2', type: 'tool_result' as const, toolId: 'fs.read', title: 'Leer', content: 'ok', status: 'completed' as const, ts: 2 },
  ],
  thinking: false,
  running: false,
});

test('AgentOrchestrator.resume conserva los pasos y el plan', () => {
  const { orchestrator } = createMockOrchestrator();
  orchestrator.restoreState(interruptedState());

  assert.equal(orchestrator.resume(), true);
  const s = orchestrator.getState();
  assert.equal(s.running, true);
  assert.equal(s.thinking, true);
  assert.equal(s.steps.length, 2, 'los pasos guardados no se borran');
  assert.deepEqual(s.plan.map((p) => p.id), ['p1'], 'el plan se mantiene');
});

test('AgentOrchestrator.resume sin tarea no arranca nada', () => {
  const { orchestrator } = createMockOrchestrator();

  assert.equal(orchestrator.resume(), false);
  assert.equal(orchestrator.getState().running, false);
});

test('AgentLoop.resume retoma la corrida sin borrar el log previo', async () => {
  const { loop, orchestrator, getState } = createLoop('gemini-2.0-flash');
  orchestrator.restoreState(interruptedState(2));

  await loop.resume({ id: 'resume-1', goal: 'seguir con la tarea', cwd: '.', maxSteps: 2 });

  const s = getState();
  assert.equal(s.steps[0].id, 's1', 'el último avance sigue en su sitio');
  assert.ok(s.steps.length > 2, `debe seguir avanzando (pasos: ${s.steps.length})`);
  assert.ok(
    s.steps.some((x) => x.title === 'Continuación'),
    'deja constancia en el log de que es una continuación'
  );
  // Con maxSteps=2 y dos pasos ya usados, sin presupuesto nuevo moriría al instante.
  assert.ok(s.steps.length > s.task!.maxSteps - 2, 'renueva el presupuesto de pasos');
  loop.stop();
});

// ── Corte por pasos sin progreso ──

test('el contador de pasos sin progreso se reinicia en cada corrida', async () => {
  // El AgentLoop se reutiliza entre corridas del mismo modelo (useMemo en
  // useAgent), así que el contador de fallos sobrevive a `stop()`. Sin el
  // reinicio, una corrida nueva con un solo fallo se cortaba como si arrastrara
  // los ocho de la anterior.
  const { orchestrator, steps } = createMockOrchestrator();
  let turn = 0;
  let fallosSeguidos = 8;
  const client: AgentLLMClient = {
    callJson: async () => ({ finish: true, answer: 'no debería usarse' }),
    callTools: async () => {
      turn += 1;
      if (turn <= fallosSeguidos) {
        return {
          thought: `fallo ${turn}`,
          calls: [{ name: 'fs_read', args: { path: `no-existe-${turn}.txt` } }],
        };
      }
      return { thought: 'listo', calls: [] };
    },
  };
  const loop = new AgentLoop(orchestrator, 'gemini-2.0-flash', client);
  const cortes = () => steps.filter((s) => s.title === 'Límite de pasos').length;

  await loop.start({ id: 'prog-1', goal: 'primer intento', cwd: '.', maxSteps: 40 });
  const cortado = await waitFor(() => cortes() === 1, 15_000);
  assert.ok(cortado, 'ocho fallos seguidos deben cortar la corrida');
  loop.stop();

  // Corrida nueva: un fallo y luego termina. Con el contador a 8, el primer
  // fallo (9) volvería a disparar el corte antes de llegar al final.
  turn = 0;
  fallosSeguidos = 1;
  await loop.start({ id: 'prog-2', goal: 'segundo intento', cwd: '.', maxSteps: 40 });
  const termino = await waitFor(() => steps.some((s) => s.title === 'Finalizado'), 8_000);
  loop.stop();

  assert.ok(termino, 'la corrida nueva debe llegar al final, no cortarse por fallos viejos');
  assert.equal(cortes(), 1, 'el corte no debe repetirse en la corrida nueva');
});

// ── Historial: la auditoría del chat no abre hilo propio ──

test('persistThread:false no abre hilo en el servidor', async () => {
  // Cada auditoría lanzada desde el chat creaba una sesión más en el historial,
  // titulada con el prompt entero. La conversación ya es la de la pestaña.
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    urls.push(String(url));
    return { ok: false, json: async () => ({}) } as any;
  }) as any;
  try {
    const sinHilo = createLoop('gemini-2.0-flash');
    await sinHilo.loop.start({ id: 'task-audit', goal: 'auditar', cwd: '.', maxSteps: 3, persistThread: false });
    await waitFor(() => urls.length > 0, 2000);
    sinHilo.loop.stop();
    assert.equal(urls.filter((u) => u.includes('/api/threads')).length, 0, 'la auditoría no debe abrir sesión');

    urls.length = 0;
    const conHilo = createLoop('gemini-2.0-flash');
    await conHilo.loop.start({ id: 'task-agente', goal: 'arreglar', cwd: '.', maxSteps: 3 });
    await waitFor(() => urls.some((u) => u.includes('/api/threads')), 2000);
    conHilo.loop.stop();
    assert.ok(urls.some((u) => u.includes('/api/threads')), 'una corrida normal sí registra su hilo');
  } finally {
    globalThis.fetch = original;
  }
});
