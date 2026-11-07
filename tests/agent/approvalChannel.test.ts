/**
 * Canal de aprobaciones servidor ↔ CLI (F1-04).
 *
 * Se ejercita el bucle real del servidor con un proveedor falso: allow, deny,
 * allow-session (y su aislamiento entre sesiones), timeout y cancelación en
 * bloque. Los endpoints HTTP tienen su propia suite.
 */
import { afterAll, beforeAll, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, type ServerHarness } from '../helpers/serverHarness.js';
import {
  cleanupDir,
  collectApprovals,
  createApprovalSession,
  resolveApproval,
  startScriptedProvider,
  waitForApproval,
  waitForState,
  type FakeProvider,
  type ScriptStep,
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

async function session(script: ScriptStep[], extra: Record<string, unknown> = {}) {
  const provider: FakeProvider = await startScriptedProvider(script);
  const created = await createApprovalSession(srv, provider, extra);
  resources.push(async () => {
    await provider.close();
    cleanupDir(created.cwd);
  });
  return created;
}

describe('canal de aprobaciones (F1-04)', () => {
  test('allow ejecuta la escritura y deja la decisión en el paso', async () => {
    const { id, cwd } = await session([
      { tool: 'fs.write', args: { path: 'ok.txt', content: 'hola' } },
      { text: 'Listo.' },
    ]);

    const approval = await waitForApproval(srv, id);
    assert.equal(approval.tool, 'fs.write');
    assert.equal(approval.sessionId, id);
    assert.match(approval.diff || '', /\+hola/);

    const first = await resolveApproval(srv, id, approval.id, 'allow');
    assert.equal(first.status, 200, first.raw);
    assert.equal(first.body.decision, 'allow');

    const replay = await resolveApproval(srv, id, approval.id, 'allow');
    assert.equal(replay.status, 200, replay.raw);
    assert.deepEqual(replay.body, first.body, 'la misma decisión es idempotente');

    const conflict = await resolveApproval(srv, id, approval.id, 'deny');
    assert.equal(conflict.status, 409, conflict.raw);

    const state = await waitForState(srv, id, ['completed', 'failed']);
    assert.equal(state.status, 'completed', JSON.stringify(state));
    assert.equal(fs.readFileSync(path.join(cwd, 'ok.txt'), 'utf8'), 'hola');
    const result = state.steps.find(
      (step: any) => step.type === 'tool_result' && step.toolId === 'fs.write'
    );
    assert.equal(result?.approval?.decision, 'allow');
    assert.equal(result?.approval?.id, approval.id);
  }, 30_000);

  test('deny no ejecuta la tool y conserva el motivo', async () => {
    const { id, cwd } = await session([
      { tool: 'fs.write', args: { path: 'denied.txt', content: 'no debe existir' } },
      { text: 'Fin.' },
    ]);

    const approval = await waitForApproval(srv, id);
    const denied = await resolveApproval(srv, id, approval.id, 'deny', 'el usuario dijo no');
    assert.equal(denied.status, 200, denied.raw);
    assert.equal(denied.body.decision, 'deny');
    assert.equal(denied.body.reason, 'el usuario dijo no');

    const state = await waitForState(srv, id, ['completed', 'failed']);
    assert.equal(state.status, 'completed', JSON.stringify(state));
    assert.equal(fs.existsSync(path.join(cwd, 'denied.txt')), false);
    const result = state.steps.find(
      (step: any) => step.type === 'tool_result' && step.toolId === 'fs.write'
    );
    assert.equal(result?.approval?.decision, 'deny');
    assert.equal(result?.approval?.reason, 'el usuario dijo no');
  }, 30_000);

  test('allow-session no vuelve a preguntar el mismo patrón y no cruza de sesión', async () => {
    const script: ScriptStep[] = [
      { tool: 'fs.write', args: { path: 'same.txt', content: 'primero' } },
      { tool: 'fs.write', args: { path: 'same.txt', content: 'segundo', overwrite: true } },
      { text: 'Fin.' },
    ];
    const { id, cwd } = await session(script);

    const first = await waitForApproval(srv, id);
    const allowed = await resolveApproval(srv, id, first.id, 'allow-session');
    assert.equal(allowed.status, 200, allowed.raw);
    assert.equal(allowed.body.decision, 'allow-session');

    const state = await waitForState(srv, id, ['completed', 'failed']);
    assert.equal(state.status, 'completed', JSON.stringify(state));
    assert.equal(fs.readFileSync(path.join(cwd, 'same.txt'), 'utf8'), 'segundo');
    const writeResults = state.steps.filter(
      (step: any) => step.type === 'tool_result' && step.toolId === 'fs.write'
    );
    assert.equal(writeResults.length, 2, 'las dos escrituras se ejecutaron');
    assert.equal(
      writeResults.filter((step: any) => step.approval).length,
      1,
      'la segunda escritura del mismo patrón no volvió a preguntar'
    );
    assert.equal(writeResults[0].approval?.decision, 'allow-session');

    const other = await session([
      { tool: 'fs.write', args: { path: 'same.txt', content: 'otra sesión' } },
      { text: 'Fin.' },
    ]);
    const otherApproval = await waitForApproval(srv, other.id);
    assert.equal(otherApproval.tool, 'fs.write', 'la regla no se filtra a otra sesión');
    await resolveApproval(srv, other.id, otherApproval.id, 'deny');
    await waitForState(srv, other.id, ['completed', 'failed']);
  }, 30_000);

  test('el timeout deniega la tool y la corrida continúa', async () => {
    const { id, cwd } = await session(
      [
        { tool: 'fs.write', args: { path: 'timeout.txt', content: 'tarde' } },
        { text: 'Timeout controlado.' },
      ],
      { approvalTimeoutMs: 150 }
    );

    const state = await waitForState(srv, id, ['completed', 'failed']);
    assert.equal(state.status, 'completed', JSON.stringify(state));
    assert.equal(fs.existsSync(path.join(cwd, 'timeout.txt')), false);
    const result = state.steps.find(
      (step: any) => step.type === 'tool_result' && step.toolId === 'fs.write'
    );
    assert.equal(result?.approval?.decision, 'deny');
    assert.equal(result?.approval?.reason, 'timeout');
    assert.match(result?.content || '', /timeout/);
  }, 30_000);

  test('cancelar resuelve en bloque todas las aprobaciones pendientes', async () => {
    const { id, cwd } = await session([
      {
        tools: [
          { tool: 'fs.write', args: { path: 'a.txt', content: 'a' } },
          { tool: 'fs.write', args: { path: 'b.txt', content: 'b' } },
        ],
      },
      { text: 'Fin.' },
    ]);

    await waitForApproval(srv, id);
    const pending = await collectApprovals(srv, id, 2);
    assert.equal(pending.length, 2);

    const cancelled = await srv.request('POST', `/api/agent/sessions/${id}/cancel`);
    assert.equal(cancelled.status, 200, cancelled.raw);
    const state = await waitForState(srv, id, ['cancelled']);
    assert.equal(state.status, 'cancelled', JSON.stringify(state));
    assert.equal(state.pendingApproval, null);
    assert.equal(fs.existsSync(path.join(cwd, 'a.txt')), false);
    assert.equal(fs.existsSync(path.join(cwd, 'b.txt')), false);

    for (const approval of pending) {
      const deny = await resolveApproval(srv, id, approval.id, 'deny');
      assert.equal(deny.status, 200, `la cancelación resolvió ${approval.id}: ${deny.raw}`);
      assert.equal(deny.body.decision, 'deny');
      assert.equal(deny.body.reason, 'cancelled');
      const allow = await resolveApproval(srv, id, approval.id, 'allow');
      assert.equal(allow.status, 409, allow.raw);
    }
  }, 30_000);
});
