/**
 * G1-T2-READ-LOOP en el CLI: repetir la misma lectura sin que el workspace
 * cambie también agota los pasos. En `G1-D1-04` fueron 42 `fs.read` sobre dos
 * archivos (21 y 21) y 0 mutaciones aplicadas; la racha consecutiva nunca pasó
 * de 2, así que el contador es por clave acumulada.
 *
 * Se ejercita con el servidor falso del arnés E2E y el escenario `read-loop`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../../src/cli/agentClient.js';
import type { CliEventV2, SessionStateV2 } from '../../src/agent/sessionTypes.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';

function runToolRequests(
  fake: Awaited<ReturnType<typeof startFakeAgentServer>>,
  toolId: string
) {
  return fake.requests.filter(
    (request) => request.path === '/api/agent/run-tool' && request.body?.toolId === toolId
  );
}

describe('bucle de lecturas en el CLI (G1-T2-READ-LOOP)', () => {
  test('la cuarta lectura del mismo archivo corta la corrida con motivo', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:read-loop Implementa maxLength en slug.mjs.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 24,
      stream: false,
      // Sin `sessionId`: `persistSession` crea la sesión para leer el `loopCut`
      // del estado sincronizado.
      persistSession: true,
      requestApproval: async () => 'allow',
      onEvent: (event) => events.push(event),
    });

    assert.match(result.answer, /Bucle de lectura: 4 llamadas idénticas a `fs\.read`/);
    assert.ok(result.steps <= 12, `corta antes de maxSteps (paró en ${result.steps})`);
    // Tres claves distintas se leen de verdad (slug.mjs, su test y package.json);
    // las repeticiones de slug.mjs se contestan sin volver a pedir la lectura.
    assert.equal(runToolRequests(fake, 'fs.read').length, 3, 'sólo se ejecutan las lecturas nuevas');
    const stateRes = await fetch(
      `${fake.baseUrl}/api/agent/sessions/${encodeURIComponent(result.sessionId)}`
    );
    const { state } = (await stateRes.json()) as { state?: SessionStateV2 };
    assert.deepEqual(
      state?.loopCut,
      { guard: 'reads', tool: 'fs.read', attempts: 4 },
      'el corte queda en el estado sincronizado, no sólo en el PTY'
    );
    const error = events.find((event) => event.type === 'error');
    assert.ok(error, 'emite un error visible, no un cierre mudo');
    if (error?.type === 'error') {
      assert.match(error.text, /sin que el workspace cambie/);
      assert.match(error.text, /la tarea queda sin verificar/);
    }
  });

  test('un subagente que pudo editar vacía la ventana de lecturas', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:read-after-subagent Implementa maxLength en slug.mjs.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 24,
      stream: false,
      sessionId: 'sess_read_after_subagent',
      requestApproval: async () => 'allow',
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(
      runToolRequests(fake, 'fs.read').length,
      2,
      'la relectura posterior al subagente se ejecuta, no cuenta como bucle'
    );
    assert.equal(runToolRequests(fake, 'spawn_agents').length, 1);
    assert.equal(
      events.some((event) => event.type === 'error' && /Bucle de lectura/.test(event.text)),
      false,
      'la sesión no se corta'
    );
  });

  test('una mutación aplicada entre lecturas vacía la ventana y no corta', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:read-after-edit Implementa maxLength en slug.mjs.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 24,
      stream: false,
      sessionId: 'sess_read_after_edit',
      requestApproval: async () => 'allow',
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.', 'releer tras verificar no es un bucle');
    assert.equal(
      events.some((event) => event.type === 'error' && /Bucle de lectura/.test(event.text)),
      false,
      'la sesión no se corta'
    );
    // Turno 1 y turno 4: la relectura posterior al `shell.run` sí se ejecuta.
    assert.equal(runToolRequests(fake, 'fs.read').length, 2);
    assert.equal(runToolRequests(fake, 'shell.run').length, 1);
  });
});
