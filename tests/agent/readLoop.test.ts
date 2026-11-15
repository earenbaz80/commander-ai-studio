/**
 * G1-T2-READ-LOOP en el bucle del SERVIDOR (sesiones del escritorio): el modelo
 * vuelve a leer el mismo archivo una y otra vez sin que el workspace cambie. El
 * corte de mutaciones no lo ve —no hay ninguna edición aplicada— y antes de
 * esto la sesión gastaba sus 24 pasos releyendo.
 */
import { afterAll, beforeAll, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, type ServerHarness } from '../helpers/serverHarness.js';
import {
  cleanupDir,
  createApprovalSession,
  startScriptedProvider,
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

describe('bucle del servidor: lecturas idénticas', () => {
  test('la cuarta lectura del mismo archivo cierra la sesión con el motivo', async () => {
    const read = { tool: 'fs.read', args: { path: 'faro.txt' } };
    const provider: FakeProvider = await startScriptedProvider([
      read,
      read,
      read,
      read,
      read,
      { text: 'Listo.' },
    ]);
    // `run: false` para crear el archivo antes del primer turno: si no existe,
    // la lectura falla y el guardia contaría igual, pero el test dejaría de
    // cubrir el caso real (lecturas que sí devuelven contenido).
    const created = await createApprovalSession(srv, provider, { run: false, maxSteps: 24 });
    resources.push(async () => {
      await provider.close();
      cleanupDir(created.cwd);
    });
    fs.writeFileSync(path.join(created.cwd, 'faro.txt'), 'hola\n');

    const started = await srv.request(
      'POST',
      `/api/agent/sessions/${created.id}/message`,
      { text: 'empieza' }
    );
    assert.equal(started.status, 202, started.raw);

    const state = await waitForState(srv, created.id, ['failed', 'error']);
    assert.match(String(state.error), /Bucle de lectura/);
    assert.match(String(state.error), /4 llamadas idénticas a `fs\.read`/);
    assert.deepEqual(state.loopCut, { guard: 'reads', tool: 'fs.read', attempts: 4 });
    assert.ok(
      provider.requests() <= 5,
      `no llega a los 24 pasos (turnos pedidos al proveedor: ${provider.requests()})`
    );

    const steps = state.steps as any[];
    const reads = steps.filter((step) => step.type === 'tool_result' && step.toolId === 'fs.read');
    assert.equal(reads.length, 4, 'lectura, aviso, fallo explícito y corte');
    assert.match(String(reads[1].content), /Ya pediste el mismo input a fs\.read/);
    assert.match(String(reads[2].content), /bucle de lectura/);
    assert.deepEqual(reads[3].output, {
      skipped: 'loop',
      guard: 'reads',
      tool: 'fs.read',
      attempts: 4,
    });
    assert.ok(steps.some((step) => step.title === 'Bucle de tool detectado'));
  }, 30_000);
});
