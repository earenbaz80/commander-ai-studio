/**
 * Comandos del REPL (F1-08): plan/build, compact, undo, resume/fork, modelo y
 * plantilla. Los comandos que no necesitan red usan dependencias inyectadas;
 * plan/build se validan contra el prompt y la creación de sesión reales.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplSession } from '../../src/cli/repl.js';
import { Tui } from '../../src/cli/tui.js';
import { createSessionState, type SessionStateV2 } from '../../src/agent/sessionTypes.js';
import type { CheckpointMeta } from '../../src/utils/checkpointsApi.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';

function quietTui(): Tui {
  const tui = new Tui({ interactive: false, color: false });
  tui.line = () => {};
  tui.rule = () => {};
  return tui;
}

function declarations(request: { body?: any } | undefined): Array<{ name?: string }> {
  const list = request?.body?.tools?.[0]?.functionDeclarations;
  return Array.isArray(list) ? list : [];
}

describe('comandos del REPL', () => {
  test('/plan y /build cambian el modo del siguiente turno', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const session = new ReplSession({
      serverUrl: fake.baseUrl,
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      preferences: {},
      tui: quietTui(),
      deps: { savePreferences: async () => {} },
    });

    await session.handleLine('/plan');
    await session.handleLine('SCENARIO:final diseña');
    const create = fake.requests.find(
      (request) => request.method === 'POST' && request.path === '/api/agent/sessions'
    );
    assert.equal(create?.body?.mode, 'plan', 'la sesión nace en modo plan');
    assert.equal(session.state?.mode, 'plan');
    const planRequest = fake.requests.find((request) => request.path === '/api/gemini/stream');
    const planTools = declarations(planRequest).map((item) => item.name);
    assert.ok(planTools.includes('fs_read'), 'plan ofrece lectura');
    assert.equal(planTools.includes('fs_write'), false, 'plan no ofrece escritura');

    await session.handleLine('/build');
    await session.handleLine('SCENARIO:final construye');
    assert.equal(session.state?.mode, 'build');
    const streams = fake.requests.filter((request) => request.path === '/api/gemini/stream');
    const buildTools = declarations(streams[1]).map((item) => item.name);
    assert.ok(buildTools.includes('fs_write'), 'build vuelve a ofrecer escritura');
  });

  test('/compact reduce turnos y guarda el estado', async () => {
    const state = createSessionState({
      id: 'sess_compact',
      goal: 'compactar',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
    });
    const now = Date.now();
    for (let index = 0; index < 12; index += 1) {
      state.turns.push({
        role: index % 2 === 0 ? 'user' : 'assistant',
        text: `turno ${index} ${'x'.repeat(2_000)}`,
        ts: now + index,
      });
    }
    let saved: SessionStateV2 | undefined;
    const session = new ReplSession({
      serverUrl: 'http://127.0.0.1:1',
      cwd: '/workspace/demo',
      state,
      preferences: {},
      tui: quietTui(),
      deps: {
        saveState: async (_serverUrl, next) => {
          saved = next;
        },
      },
    });

    await session.handleLine('/compact');

    assert.equal(saved, session.state, 'se persiste el mismo estado vivo');
    assert.ok(session.state, 'el estado sigue disponible');
    assert.ok(session.state!.turns.length < 12, 'el historial se reduce');
    assert.ok(session.state!.turns.length >= 6, 'se conservan los turnos recientes');
  });

  test('/undo restaura el checkpoint más reciente y no lo repite', async () => {
    const checkpoint: CheckpointMeta = {
      id: 'cp_1',
      ts: 10,
      label: 'fs.write',
      tool: 'fs.write',
      files: [{ path: 'salida.txt', existed: true }],
    };
    const restores: string[] = [];
    const session = new ReplSession({
      serverUrl: 'http://127.0.0.1:1',
      cwd: '/workspace/demo',
      tui: quietTui(),
      deps: {
        listCheckpoints: async () => ({ checkpoints: [checkpoint] }),
        restoreCheckpoint: async (_serverUrl, _cwd, id) => {
          restores.push(id);
          return { ok: true, restored: ['salida.txt'] };
        },
      },
    });

    await session.handleLine('/undo');
    assert.deepEqual(restores, ['cp_1']);
    assert.equal(session.undone.has('cp_1'), true);

    await session.handleLine('/undo');
    assert.deepEqual(restores, ['cp_1'], 'un checkpoint deshecho no se repite');
  });

  test('/resume, /fork, /model y /agent actualizan la sesión', async () => {
    const loaded = createSessionState({
      id: 'sess_loaded',
      goal: 'cargada',
      cwd: '/workspace/demo',
      model: 'modelo-cargado',
      mode: 'plan',
    });
    const forked = createSessionState({
      id: 'sess_forked',
      goal: 'bifurcada',
      cwd: '/workspace/demo',
      model: 'modelo-fork',
    });
    const session = new ReplSession({
      serverUrl: 'http://127.0.0.1:1',
      cwd: '/workspace/demo',
      preferences: {},
      tui: quietTui(),
      deps: {
        loadSession: async () => loaded,
        forkSession: async () => forked,
        savePreferences: async () => {},
      },
    });

    await session.handleLine('/resume sess_loaded');
    assert.equal(session.state?.id, 'sess_loaded');
    assert.equal(session.model, 'modelo-cargado');
    assert.equal(session.mode, 'plan');

    await session.handleLine('/fork sess_forked');
    assert.equal(session.state?.id, 'sess_forked');
    assert.equal(session.model, 'modelo-fork');

    await session.handleLine('/model gemini-3.8-flash');
    assert.equal(session.model, 'gemini-3.8-flash');

    await session.handleLine('/agent planner');
    assert.equal(session.agent, 'planner');
    assert.equal(session.mode, 'plan');
    assert.equal(session.maxSteps, 20);

    assert.equal(await session.handleLine('/exit'), false, '/exit pide cerrar el bucle');
  });
});
