/**
 * Puente cliente → servidor de las tools que trabajan en el servidor.
 *
 * Estas cuatro estaban registradas pero no funcionaban: `spawn_agents` y `skill`
 * devolvían un `{ ok:false, error:'… se ejecuta en el servidor' }` escrito a
 * mano, así que el modelo recibía un fallo que el servidor nunca dio, y
 * `run_file_change_hooks` no mandaba el root (formateaba contra el cwd del
 * servidor). Lo que se prueba aquí es el contrato del salto: URL, `toolId`,
 * `input.root` y el reenvío del error real.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { skillTool } from '../src/agent/tools/skill.js';
import { spawnAgentsTool } from '../src/agent/tools/spawnAgents.js';
import { taskTool } from '../src/agent/tools/task.js';
import { AGENT_FUNCTION_DECLARATIONS } from '../src/agent/fnTools.js';
import { runFileChangeHooksTool } from '../src/agent/tools/hooks.js';
import { worktreeCreateTool } from '../src/agent/tools/worktreeCreate.js';
import { setActiveProjectRoot } from '../src/agent/activeProject.js';
import {
  clearActiveSession,
  ensureServerSession,
  getActiveSessionId,
  getRememberedTask,
  registerServerSession,
  rememberTask,
} from '../src/agent/activeSession.js';
import type { ToolContext } from '../src/agent/types.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setActiveProjectRoot('');
  clearActiveSession();
});

const ctx: ToolContext = { cwd: '/proyecto', approve: async () => ({ approved: true }), log: () => {} };

/** Sustituye `fetch` por uno que responde `body` y anota las llamadas. */
function stubFetch(body: any, status = 200) {
  const calls: { url: string; method?: string; body: any }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: status < 400, status, json: async () => body } as any;
  }) as any;
  return calls;
}

/** Como `stubFetch`, pero con una respuesta distinta por ruta de la app. */
function stubRoutes(routes: Record<string, { body: any; status?: number }>) {
  const calls: { url: string; method?: string; body: any }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
    const r = routes[String(url)] ?? { body: {} };
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body } as any;
  }) as any;
  return calls;
}

test('skill llama al servidor y manda el root del proyecto abierto', async () => {
  setActiveProjectRoot('/proyecto');
  const calls = stubFetch({ ok: true, data: { name: 'x', path: '/proyecto/skills/x/SKILL.md', description: 'd', content: 'cuerpo' } });

  const res: any = await skillTool.run({ name: 'x' } as any, ctx);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/agent/run-tool');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.toolId, 'skill');
  assert.deepEqual(calls[0].body.input, { name: 'x', root: '/proyecto' });
  assert.equal(res.ok, true);
  assert.equal(res.data.content, 'cuerpo');
});

test('spawn_agents reenvía agentes y sesión padre al servidor', async () => {
  setActiveProjectRoot('/proyecto');
  const calls = stubFetch({ ok: true, data: { results: [], spawned: 1, capped: false } });

  const agents = [{ goal: 'buscar', mode: 'plan' }];
  const res: any = await spawnAgentsTool.run({ agents, parentSessionId: 'sess-1' } as any, ctx);

  assert.equal(calls[0].body.toolId, 'spawn_agents');
  const sent = calls[0].body.input;
  assert.deepEqual(sent.agents, agents, 'los subagentes viajan tal cual');
  assert.equal(sent.parentSessionId, 'sess-1');
  assert.equal(res.ok, true);
  assert.equal(res.data.spawned, 1);
});

test('spawn_agents registra la sesión padre en el primer uso y no antes', async () => {
  rememberTask({ taskId: 'task-1', goal: 'revisar', cwd: '/proyecto', model: 'gemini-x' });
  const calls = stubRoutes({
    '/api/agent/sessions': { body: { success: true, session: { id: 'sess-real' } } },
    '/api/agent/run-tool': { body: { ok: true, data: { results: [], spawned: 1, capped: false } } },
  });

  await spawnAgentsTool.run({ agents: [{ goal: 'x' }], parentSessionId: 'sess-inventado' } as any, ctx);

  assert.equal(calls[0].url, '/api/agent/sessions', 'la sesión se crea aquí, no al empezar la tarea');
  assert.deepEqual(calls[0].body, { goal: 'revisar', cwd: '/proyecto', model: 'gemini-x' });
  const tool = calls.find((c) => c.url === '/api/agent/run-tool');
  assert.ok(tool, 'después de registrar se reenvía la llamada');
  assert.equal(tool!.body.input.parentSessionId, 'sess-real', 'manda la sesión real, no la inventada');

  // Segundo uso de la misma tarea: no se vuelve a registrar.
  await spawnAgentsTool.run({ agents: [{ goal: 'y' }] } as any, ctx);
  assert.equal(calls.filter((c) => c.url === '/api/agent/sessions').length, 1);
});

test('recordar la tarea no abre ninguna sesión en el servidor', async () => {
  // Restaurar una sesión para mirarla no debe dejar sesiones idle en el registro.
  rememberTask({ taskId: 'task-1', goal: 'mirar', cwd: '/proyecto' });
  const calls = stubRoutes({});

  assert.equal(getRememberedTask()?.taskId, 'task-1');
  assert.equal(calls.length, 0);
  assert.equal(getActiveSessionId(), '');
});

test('task reenvía al servidor con la sesión padre perezosa', async () => {
  rememberTask({ taskId: 'task-1', goal: 'revisar', cwd: '/proyecto', model: 'gemini-x' });
  const calls = stubRoutes({
    '/api/agent/sessions': { body: { success: true, session: { id: 'sess-real' } } },
    '/api/agent/run-tool': { body: { ok: true, data: { answer: 'hecho' } } },
  });

  const res: any = await taskTool.run({ goal: 'mirar el diff' } as any, ctx);

  assert.equal(calls[0].url, '/api/agent/sessions');
  const tool = calls.find((c) => c.url === '/api/agent/run-tool');
  assert.ok(tool, 'la tool tiene que llegar al servidor, no fallar en el cliente');
  assert.equal(tool!.body.toolId, 'task');
  assert.equal(tool!.body.input.parentSessionId, 'sess-real');
  assert.equal(res.data.answer, 'hecho');
});

test('task sin tarea anotada no inventa una sesión padre', async () => {
  const calls = stubRoutes({ '/api/agent/run-tool': { body: { ok: false, error: 'parentSessionId requerido para task' } } });

  await taskTool.run({ goal: 'algo' } as any, ctx);

  assert.deepEqual(calls.map((c) => c.url), ['/api/agent/run-tool'], 'sin sesión registrada sólo se reenvía');
  assert.equal(calls[0].body.input.parentSessionId, undefined);
});

test('las declaraciones no le piden al modelo el id de la sesión padre', () => {
  // El modelo no puede conocer ese id: si la declaración lo exige, lo inventa y
  // el servidor responde 404 aunque el bootstrap haya creado la sesión bien.
  const esperado: Record<string, string[]> = { spawn_agents: ['agents'], task: ['goal'] };
  for (const [nombre, required] of Object.entries(esperado)) {
    const decl: any = AGENT_FUNCTION_DECLARATIONS.find((d: any) => d.name === nombre);
    assert.ok(decl, `${nombre} debe estar declarada para el modelo`);
    assert.deepEqual(decl.parameters.required, required);
    assert.equal(decl.parameters.properties.parentSessionId.type, 'STRING');
  }
});

test('registerServerSession guarda el id del servidor y lo limpia si falla', async () => {
  stubFetch({ success: true, session: { id: 'sess-1' } });
  const id = await registerServerSession({ goal: 'revisar', cwd: '/proyecto', model: 'gemini-x' });
  assert.equal(id, 'sess-1');
  assert.equal(getActiveSessionId(), 'sess-1');

  // Un fallo no puede dejar el id de la tarea anterior: los subagentes
  // heredarían cwd/modelo de otro objetivo.
  stubFetch({ success: false, error: 'boom' }, 500);
  const fallo = await registerServerSession({ goal: 'otra', cwd: '/proyecto' });
  assert.equal(fallo, '');
  assert.equal(getActiveSessionId(), '');
});

test('restaurar y continuar la misma tarea registra una sola sesión padre', async () => {
  const tarea = { taskId: 'task-1', goal: 'seguir el refactor', cwd: '/proyecto', model: 'gemini-x' };
  rememberTask(tarea);
  rememberTask(tarea); // continuar reanota la misma tarea
  const calls = stubFetch({ success: true, session: { id: 'sess-restaurada' } });

  const [a, b] = await Promise.all([ensureServerSession(), ensureServerSession()]);

  assert.equal(calls.length, 1, 'restaurar + continuar no debe abrir dos sesiones para la misma tarea');
  assert.equal(a, 'sess-restaurada');
  assert.equal(b, 'sess-restaurada');
  assert.equal(getActiveSessionId(), 'sess-restaurada');
});

test('tras olvidar la sesión, la misma tarea se vuelve a registrar', async () => {
  const tarea = { taskId: 'task-1', goal: 'algo', cwd: '/proyecto' };
  rememberTask(tarea);
  stubFetch({ success: true, session: { id: 'sess-1' } });
  await ensureServerSession();

  // Es el caso de la recarga: el id del cliente se perdió aunque la tarea siga
  // guardada en disco, así que hay que registrar de nuevo para los subagentes.
  clearActiveSession();
  rememberTask(tarea);
  const calls = stubFetch({ success: true, session: { id: 'sess-2' } });
  const id = await ensureServerSession();

  assert.equal(calls.length, 1);
  assert.equal(id, 'sess-2');
  assert.equal(getActiveSessionId(), 'sess-2');
});

test('un registro fallido no se da por hecho: la tarea se reintenta', async () => {
  let attempt = 0;
  globalThis.fetch = (async () => {
    attempt++;
    const ok = attempt > 1;
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => (ok ? { success: true, session: { id: 'sess-tarde' } } : { success: false, error: 'boom' }),
    } as any;
  }) as any;

  const first = await ensureServerSession({ taskId: 'task-x', goal: 'algo', cwd: '/proyecto' });
  assert.equal(first, '');
  const second = await ensureServerSession({ taskId: 'task-x', goal: 'algo', cwd: '/proyecto' });
  assert.equal(second, 'sess-tarde');
  assert.equal(attempt, 2, 'el fallo no debe quedar cacheado como sesión válida');
});

test('run_file_change_hooks formatea contra el proyecto abierto, no contra el cwd del servidor', async () => {
  setActiveProjectRoot('/otro-proyecto');
  const calls = stubFetch({ ok: true, data: { ran: true, output: '' } });

  await runFileChangeHooksTool.run({ path: 'src/a.ts' } as any, ctx);

  assert.equal(calls[0].body.toolId, 'run_file_change_hooks');
  assert.equal(calls[0].body.input.path, 'src/a.ts');
  assert.equal(calls[0].body.input.root, '/otro-proyecto', 'sin root el servidor formatearía en su propio cwd');
});

test('worktree.create habla con su propia ruta (no con run-tool)', async () => {
  const calls = stubFetch({ ok: true, worktreePath: '/tmp/wt', branch: 'commander/ab', copied: [], bootstrapped: false });

  const res: any = await worktreeCreateTool.run({ threadId: 'th-1', projectPath: '/proyecto' } as any, ctx);

  assert.equal(calls[0].url, '/api/worktrees');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { threadId: 'th-1', projectPath: '/proyecto' });
  assert.equal(res.branch, 'commander/ab');
});

test('worktree.create toma el proyecto abierto si el modelo no manda la ruta', async () => {
  setActiveProjectRoot('/proyecto-abierto');
  const calls = stubFetch({ ok: true, worktreePath: '/tmp/wt', branch: 'commander/x', copied: [], bootstrapped: false });

  await worktreeCreateTool.run({ threadId: 'th-2' } as any, ctx);

  assert.deepEqual(calls[0].body, { threadId: 'th-2', projectPath: '/proyecto-abierto' });
});

test('el error del servidor llega tal cual, no se inventa uno local', async () => {
  const calls = stubFetch({ ok: false, error: 'Modo Plan: no se puede ejecutar skill.' }, 403);

  const res: any = await skillTool.run({ name: 'x' } as any, ctx);

  assert.equal(calls.length, 1);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'Modo Plan: no se puede ejecutar skill.');
});

test('si el servidor no responde, el fallo lo dice en vez de fingir éxito', async () => {
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as any;

  const res: any = await skillTool.run({ name: 'x' } as any, ctx);

  assert.equal(res.ok, false);
  assert.match(String(res.error), /No se pudo contactar al servidor: ECONNREFUSED/);
});
