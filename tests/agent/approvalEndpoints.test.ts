/**
 * Contrato HTTP de las aprobaciones (F1-04): forma del ApprovalRequestV2,
 * códigos 200/400/404/409 e idempotencia contra el servidor real.
 */
import { afterAll, beforeAll, describe, test } from 'vitest';
import assert from 'node:assert/strict';
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

async function session(extra: Record<string, unknown> = {}) {
  const provider: FakeProvider = await startScriptedProvider([
    { tool: 'fs.write', args: { path: 'contrato.txt', content: 'secreto', apiKey: 'sk-no-debe-salir' } },
    { text: 'Fin.' },
  ]);
  const created = await createApprovalSession(srv, provider, extra);
  resources.push(async () => {
    await provider.close();
    cleanupDir(created.cwd);
  });
  return created;
}

describe('endpoints de aprobaciones (F1-04)', () => {
  test('el request cumple el contrato y redacta credenciales', async () => {
    const { id } = await session({ approvalTimeoutMs: 2_000 });
    const approval = await waitForApproval(srv, id);

    assert.equal(typeof approval.id, 'string');
    assert.equal(approval.sessionId, id);
    assert.equal(approval.tool, 'fs.write');
    assert.equal((approval.input as any).apiKey, '[redacted]');
    assert.ok(approval.diff?.includes('+secreto'), 'la escritura trae diff');
    // `hunks` es opcional en el contrato: una escritura nueva se representa con
    // un diff completo y no necesita descomponerse en reemplazos.
    assert.ok(approval.createdAt > 0);
    assert.ok(approval.expiresAt > approval.createdAt);
    assert.ok(!JSON.stringify(approval).includes('sk-no-debe-salir'), 'sin tokens en el request');

    const denied = await resolveApproval(srv, id, approval.id, 'deny', 'revisado');
    assert.equal(denied.status, 200, denied.raw);
    assert.equal(denied.body.success, true);
    assert.equal(denied.body.approvalId, approval.id);
    assert.equal(denied.body.decision, 'deny');
    assert.equal(denied.body.reason, 'revisado');

    const replay = await resolveApproval(srv, id, approval.id, 'deny', 'otra razón');
    assert.equal(replay.status, 200, replay.raw);
    assert.deepEqual(replay.body, denied.body, 'repetir la decisión devuelve el mismo cuerpo');

    const conflict = await resolveApproval(srv, id, approval.id, 'allow');
    assert.equal(conflict.status, 409, conflict.raw);
    assert.equal(conflict.body.success, false);
    assert.ok(!conflict.raw.includes('sk-no-debe-salir'));

    const state = await waitForState(srv, id, ['completed', 'failed']);
    assert.equal(state.status, 'completed', JSON.stringify(state));
  }, 30_000);

  test('400/404 para sesión, approval y decisión inválidas', async () => {
    const { id } = await session();
    const approval = await waitForApproval(srv, id);

    const badDecision = await srv.request(
      'POST',
      `/api/agent/sessions/${id}/approvals/${approval.id}`,
      { decision: 'quizá' }
    );
    assert.equal(badDecision.status, 400, badDecision.raw);
    assert.equal(badDecision.body.success, false);

    const missingDecision = await srv.request(
      'POST',
      `/api/agent/sessions/${id}/approvals/${approval.id}`,
      {}
    );
    assert.equal(missingDecision.status, 400, missingDecision.raw);

    const unknown = await resolveApproval(srv, id, 'apr_no_existe', 'allow');
    assert.equal(unknown.status, 404, unknown.raw);

    const invalidSession = await srv.request(
      'POST',
      '/api/agent/sessions/..%2Fetc/approvals/apr_x',
      { decision: 'allow' }
    );
    assert.equal(invalidSession.status, 400, invalidSession.raw);

    const missingSession = await srv.request(
      'POST',
      '/api/agent/sessions/sess_no_existe/approvals/apr_x',
      { decision: 'allow' }
    );
    assert.equal(missingSession.status, 404, missingSession.raw);

    const other = await session({ run: false });
    const foreign = await resolveApproval(srv, other.id, approval.id, 'allow');
    assert.equal(foreign.status, 404, foreign.raw);
    assert.ok(!foreign.raw.includes('sk-no-debe-salir'));

    await resolveApproval(srv, id, approval.id, 'deny');
    await waitForState(srv, id, ['completed', 'failed']);
  }, 30_000);
});
