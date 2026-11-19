import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../../src/cli/agentClient.js';
import type { CliEventV2 } from '../../src/agent/sessionTypes.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';

/**
 * T4 en el bucle del CLI.
 *
 * T4 pide cubrir una rama y demostrar el fallo previo; en F0 y G1 quedó 0/2
 * porque el modelo editaba y cerraba sin verificar, o verificaba en rojo y
 * cerraba igual. El gate sólo deja cerrar con una verificación en verde
 * posterior a la última edición de código.
 */

function collect() {
  const events: CliEventV2[] = [];
  return { events, onEvent: (event: CliEventV2) => events.push(event) };
}

function gateErrors(events: CliEventV2[]): string[] {
  const out: string[] = [];
  for (const event of events) {
    if (event.type !== 'error') continue;
    const text = String(event.text || '');
    if (/Gate de verificación/.test(text)) out.push(text);
  }
  return out;
}

function runT4(
  fake: Awaited<ReturnType<typeof startFakeAgentServer>>,
  scenario: string,
  maxSteps: number
) {
  const { events, onEvent } = collect();
  return runAgent({
    serverUrl: fake.baseUrl,
    task: `SCENARIO:${scenario} Corrige la rama de descuento en discount.mjs.`,
    cwd: '/workspace/demo',
    model: 'gemini-2.5-flash',
    maxSteps,
    stream: false,
    requestApproval: async () => 'allow',
    persistSession: true,
    onEvent,
  }).then((result) => ({ result, events }));
}

describe('gate de verificación (T4)', () => {
  test('test en rojo: no cierra, recibe la salida y el verde desbloquea', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    fake.queueShell([
      { exitCode: 1, stderr: 'not ok 1 - descuento del 0%' },
      { exitCode: 0, stdout: 'ok 2 tests' },
    ]);

    const { result, events } = await runT4(fake, 't4-verify', 8);

    assert.equal(result.answer, 'Listo: descuento corregido y test en verde.');
    assert.equal(result.state?.status, 'completed');

    const refusals = gateErrors(events);
    assert.equal(refusals.length, 1, 'un sólo cierre rechazado antes de corregir');
    assert.match(refusals[0] ?? '', /sigue en rojo \(exit 1\)/);
    assert.match(refusals[0] ?? '', /not ok 1 - descuento del 0%/, 'la salida del test llega al modelo');
    const nudge = events.find(
      (event) => event.type === 'status' && /Editaste código/.test(String(event.text || ''))
    );
    assert.ok(nudge, 'el empujón llega al editar, no sólo al intentar cerrar');

    const toolCalls = fake.requests
      .filter((request) => request.path === '/api/agent/run-tool')
      .map((request) => request.body?.toolId);
    assert.deepEqual(toolCalls, ['fs.edit', 'fs.edit', 'shell.run', 'fs.edit', 'shell.run']);

    const shells = fake.requests.filter(
      (request) => request.path === '/api/agent/run-tool' && request.body?.toolId === 'shell.run'
    );
    assert.deepEqual(
      shells.map((request) => request.body?.input?.command),
      ['node --test discount.test.mjs', 'node --test discount.test.mjs']
    );
  });

  test('sin verificación: no cierra y queda failed con motivo', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    const { result, events } = await runT4(fake, 't4-no-verify', 6);

    assert.equal(result.state?.status, 'failed');
    assert.match(String(result.state?.error ?? ''), /no se verificó después de la última edición/);
    assert.match(String(result.answer), /Gate de verificación/);
    const refusals = gateErrors(events);
    assert.equal(refusals.length, 3, 'dos avisos y el cierre fallido');
    assert.match(refusals[0] ?? '', /no hay una verificación posterior/);
    assert.match(refusals[0] ?? '', /node --test discount\.test\.mjs/);
    assert.equal(
      fake.requests.some(
        (request) => request.path === '/api/agent/run-tool' && request.body?.toolId === 'shell.run'
      ),
      false,
      'el gate no ejecuta nada por su cuenta'
    );
  });

  test('rojo persistente: no se puede cerrar con el test en rojo', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    fake.queueShell([{ exitCode: 1, stderr: 'not ok 1 - descuento del 0%' }]);

    const { result, events } = await runT4(fake, 't4-red-always', 7);

    assert.equal(result.state?.status, 'failed');
    assert.match(String(result.state?.error ?? ''), /salió con exit 1 después de la última edición/);
    assert.equal(result.answer, result.state?.error);
    const refusals = gateErrors(events);
    assert.match(refusals[refusals.length - 1] ?? '', /No se cierra la tarea sin verde/);
    const shells = fake.requests.filter(
      (request) => request.path === '/api/agent/run-tool' && request.body?.toolId === 'shell.run'
    );
    assert.equal(shells.length, 1, 'una sola verificación: el gate no reintenta solo');
  });
});
