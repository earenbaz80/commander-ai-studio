/**
 * Corte de mutaciones idénticas en el bucle del SERVIDOR, que es el que usan
 * las sesiones lanzadas desde el escritorio. El escenario es el de `CAL2-R19` y
 * `G1-D1-04`: el modelo vuelve a pedir la misma edición una y otra vez. Antes
 * de esto el guardia sólo existía en el cliente del CLI y la sesión del
 * escritorio gastaba sus 24 pasos sin escribir nada nuevo.
 *
 * Se ejercita contra el server real con el proveedor falso del arnés F1-04.
 */
import { afterAll, beforeAll, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, type ServerHarness } from '../helpers/serverHarness.js';
import {
  cleanupDir,
  createApprovalSession,
  resolveApproval,
  startScriptedProvider,
  waitForApproval,
  waitForState,
  type FakeProvider,
} from './approvalHarness.js';

let srv: ServerHarness;
const resources: Array<() => Promise<void> | void> = [];

beforeAll(async () => {
  srv = await startServer();
}, 90_000);

afterAll(async () => {
  for (const cleanup of resources.reverse()) {
    try { await cleanup(); } catch { /* limpieza best-effort */ }
  }
  await srv?.stop();
}, 30_000);

describe('bucle del servidor: mutaciones idénticas', () => {
  test('la misma edición repetida corta la sesión antes de agotar los pasos', async () => {
    const edit = { path: 'faro.txt', oldString: 'viejo', newString: 'nuevo' };
    const provider: FakeProvider = await startScriptedProvider([
      { tool: 'fs.edit', args: edit },
      { tool: 'fs.edit', args: edit },
      { tool: 'fs.edit', args: edit },
      { tool: 'fs.edit', args: edit },
      { tool: 'fs.edit', args: edit },
      { tool: 'fs.edit', args: edit },
      { text: 'Listo.' },
    ]);
    // `run: false` para poder crear el archivo antes del primer turno: si la
    // sesión arranca sola, el `oldString` todavía no existe y la edición falla.
    const created = await createApprovalSession(srv, provider, { run: false, maxSteps: 24 });
    resources.push(async () => {
      await provider.close();
      cleanupDir(created.cwd);
    });
    fs.writeFileSync(path.join(created.cwd, 'faro.txt'), 'viejo\n');

    const started = await srv.request(
      'POST',
      `/api/agent/sessions/${created.id}/message`,
      { text: 'empieza' }
    );
    assert.equal(started.status, 202, started.raw);

    const approval = await waitForApproval(srv, created.id);
    assert.equal(approval.tool, 'fs.edit');
    // `allow-session` para que el escenario sin guardia no se quede esperando un
    // segundo prompt: así el fallo del test es la aserción del corte, no un
    // timeout de aprobación.
    const allowed = await resolveApproval(srv, created.id, approval.id, 'allow-session');
    assert.equal(allowed.status, 200, allowed.raw);

    const state = await waitForState(srv, created.id, ['failed', 'error']);
    assert.match(String(state.error), /Bucle de fs\.edit/, 'el estado dice por qué se detuvo');
    assert.match(String(state.error), /4 llamadas idénticas/);
    assert.deepEqual(
      state.loopCut,
      { guard: 'mutations', tool: 'fs.edit', attempts: 4 },
      'el estado deja qué guarda cortó, con qué tool y en qué intento'
    );
    assert.ok(
      provider.requests() <= 6,
      `no llega a los 24 pasos (turnos pedidos al proveedor: ${provider.requests()})`
    );
    assert.equal(
      fs.readFileSync(path.join(created.cwd, 'faro.txt'), 'utf8'),
      'nuevo\n',
      'sólo la primera edición se aplicó'
    );

    const steps = state.steps as any[];
    const edits = steps.filter((step) => step.type === 'tool_result' && step.toolId === 'fs.edit');
    assert.equal(edits.length, 4, 'primera edición, aviso, fallo explícito y corte');
    assert.match(String(edits[1].content), /No repitas la edición/);
    assert.match(String(edits[2].content), /bucle de fs\.edit/, 'la segunda repetición es un fallo');
    assert.deepEqual(edits[3].output, {
      skipped: 'loop',
      guard: 'mutations',
      tool: 'fs.edit',
      attempts: 4,
    });
    assert.ok(
      steps.some((step) => step.title === 'Bucle de tool detectado'),
      'queda el paso con el motivo del corte'
    );
  }, 30_000);
});
