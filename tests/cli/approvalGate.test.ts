import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../../src/cli/agentClient.js';
import type { CliEventV2 } from '../../src/agent/sessionTypes.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';

const TASK = 'SCENARIO:tool-denied Escribe salida.txt.';

describe('aprobación de tools mutantes en el CLI', () => {
  test('sin callback deniega la tool y no llama a run-tool', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: TASK,
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      sessionId: 'sess_approval_denied',
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(
      fake.requests.some((request) => request.path === '/api/agent/run-tool'),
      false,
      'sin decisión la tool mutante no se ejecuta'
    );
    const request = events.find((event) => event.type === 'approval_request');
    assert.ok(request, 'se emite approval_request');
    const decision = events.find((event) => event.type === 'approval_result');
    assert.equal(decision?.type, 'approval_result');
    if (decision?.type === 'approval_result') {
      assert.equal(decision.decision, 'deny');
      assert.match(decision.reason || '', /terminal interactiva/);
    }
  });

  test('con callback allow ejecuta la tool después de la decisión', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    let approvals = 0;

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: TASK,
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      sessionId: 'sess_approval_allowed',
      requestApproval: async () => {
        approvals += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return 'allow';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(approvals, 1);
    assert.equal(
      fake.requests.some((request) => request.path === '/api/agent/run-tool'),
      true,
      'la decisión allow deja ejecutar la tool'
    );
    const decision = events.find((event) => event.type === 'approval_result');
    assert.equal(decision?.type, 'approval_result');
    if (decision?.type === 'approval_result') {
      assert.equal(decision.decision, 'allow');
      assert.equal(typeof decision.latencyMs, 'number');
      assert.ok((decision.latencyMs ?? 0) >= 20, 'la latencia incluye la espera de la decisión');
    }
  });

  test('no repite una mutación idéntica ya completada', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    let approvals = 0;

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:tool-edit-same-twice Edita la misma salida dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 5,
      stream: false,
      sessionId: 'sess_approval_duplicate',
      requestApproval: async () => {
        approvals += 1;
        return 'allow';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(approvals, 1, 'la segunda llamada idéntica no vuelve a pedir aprobación');
    assert.equal(
      fake.requests.filter((request) => request.path === '/api/agent/run-tool').length,
      1,
      'la segunda llamada idéntica no se ejecuta'
    );
    const duplicate = events.find(
      (event) =>
        event.type === 'tool_result' && /ya se aplicó con el mismo input/.test(event.summary)
    );
    assert.ok(duplicate, 'se informa que la mutación ya estaba aplicada');
  });

  test('abortar durante la aprobación cancela sin ejecutar la tool', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    const controller = new AbortController();

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: TASK,
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      sessionId: 'sess_approval_aborted',
      signal: controller.signal,
      requestApproval: async () => {
        controller.abort();
        return 'deny';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.cancelled, true, 'la corrida queda cancelada');
    assert.equal(
      fake.requests.some((request) => request.path === '/api/agent/run-tool'),
      false,
      'abortar no ejecuta la tool'
    );
    assert.ok(events.some((event) => event.type === 'error' && /cancelado/i.test(event.text)));
  });

  test('allow-session no vuelve a preguntar para la misma tool y objetivo', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    let approvals = 0;

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:tool-write-twice Escribe dos salidas.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 5,
      stream: false,
      sessionId: 'sess_approval_session',
      requestApproval: async () => {
        approvals += 1;
        return 'allow-session';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(approvals, 1, 'la segunda escritura reutiliza la decisión de la sesión');
    assert.equal(
      fake.requests.filter((request) => request.path === '/api/agent/run-tool').length,
      2,
      'las dos escrituras se ejecutaron'
    );
    assert.equal(
      events.filter((event) => event.type === 'approval_request').length,
      1,
      'sólo se pidió aprobación para la primera escritura'
    );
    const decision = events.find((event) => event.type === 'approval_result');
    assert.equal(decision?.type, 'approval_result');
    if (decision?.type === 'approval_result') {
      assert.equal(decision.decision, 'allow-session');
    }
  });
});
