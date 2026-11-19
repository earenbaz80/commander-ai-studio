import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../../src/cli/agentClient.js';
import type { CliEventV2 } from '../../src/agent/sessionTypes.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';

/**
 * Permisos por defecto: lectura, tests y build no piden aprobación.
 *
 * La lectura nunca preguntó (sólo pasan por el gate las tools mutantes); lo que
 * cambia es la verificación, que en T1 se ejecutaba dos veces (rojo y verde) y
 * gastaba dos aprobaciones humanas por corrida. Escribir sigue preguntando.
 */

function collect() {
  const events: CliEventV2[] = [];
  return { events, onEvent: (event: CliEventV2) => events.push(event) };
}

const approvals = (events: CliEventV2[]) =>
  events.flatMap((event) => (event.type === 'approval_request' ? [event.approval] : []));

async function runT1(defaultPermissionRules: boolean) {
  const fake = await startFakeAgentServer();
  fake.queueShell([
    { exitCode: 1, stderr: 'not ok 1 - 0.1 + 0.2 no da 0.3' },
    { exitCode: 0, stdout: 'ok 2 tests' },
  ]);
  const { events, onEvent } = collect();
  const result = await runAgent({
    serverUrl: fake.baseUrl,
    task: 'SCENARIO:t1-bugfix El test de math.mjs falla; corrige math.mjs sin tocar math.test.mjs.',
    cwd: '/workspace/demo',
    model: 'gemini-2.5-flash',
    maxSteps: 8,
    stream: false,
    requestApproval: async () => 'allow',
    persistSession: true,
    defaultPermissionRules,
    onEvent,
  });
  await fake.close();
  return { result, events, fake };
}

describe('permisos por defecto en T1', () => {
  test('con reglas por defecto: pide sólo las dos escrituras', async () => {
    const { result, events, fake } = await runT1(true);

    assert.equal(result.state?.status, 'completed');
    const asked = approvals(events);
    assert.equal(asked.length, 2, 'una por cada edición de math.mjs');
    for (const approval of asked) {
      assert.equal(approval.tool, 'fs.edit');
    }

    const tools = fake.requests
      .filter((request) => request.path === '/api/agent/run-tool')
      .map((request) => request.body?.toolId);
    assert.deepEqual(tools, ['fs.read', 'fs.edit', 'shell.run', 'fs.edit', 'shell.run']);
    assert.equal(events.some((event) => event.type === 'error'), false);
  });

  test('sin reglas: las dos verificaciones vuelven a pedir aprobación', async () => {
    const { result, events } = await runT1(false);

    assert.equal(result.state?.status, 'completed');
    assert.equal(approvals(events).length, 4, 'dos ediciones + dos `node --test`');

    const shellApprovals = approvals(events).filter((approval) => approval.tool === 'shell.run');
    assert.equal(shellApprovals.length, 2);
  });

  test('T1 se ahorra 2 de 4 aprobaciones (50%)', async () => {
    const withRules = approvals((await runT1(true)).events).length;
    const withoutRules = approvals((await runT1(false)).events).length;
    assert.equal(withoutRules - withRules, 2);
  });

  test('un comando de riesgo sigue pidiendo aprobación', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const { events, onEvent } = collect();

    await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:risky-shell Empuja el commit.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      requestApproval: async () => 'allow',
      persistSession: true,
      onEvent,
    });

    const asked = approvals(events);
    assert.equal(asked.length, 1);
    assert.equal(asked[0]?.tool, 'shell.run');
    assert.equal(
      String((asked[0]?.input as Record<string, unknown> | undefined)?.command ?? ''),
      'git push origin main'
    );
  });
});
