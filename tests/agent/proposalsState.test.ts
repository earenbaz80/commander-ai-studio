/**
 * Propuestas en el estado de la SESIÓN DEL SERVIDOR.
 *
 * El CLI ejecuta `fs.propose.*` y sincroniza el checkpoint; el servidor guarda
 * las propuestas y las restaura al reabrir la sesión. Así un futuro `fs.apply`
 * puede recuperarlas tras un reinicio y el dogfooding puede contarlas sin PTY.
 */
import { afterAll, beforeAll, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentSession } from '../../agentSession.js';
import { listCheckpoints } from '../../checkpoints.js';
import { MAX_PENDING_PROPOSALS_PER_PATH } from '../../src/agent/proposals.js';
import { startServer, type ServerHarness } from '../helpers/serverHarness.js';
import { cleanupDir } from './approvalHarness.js';

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

async function createSession(goal: string, prefix: string) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  resources.push(() => cleanupDir(cwd));
  const res = await srv.request('POST', '/api/agent/sessions', {
    goal,
    model: 'custom/test',
    cwd,
    run: false,
  });
  assert.equal(res.status, 200, res.raw);
  return { cwd, id: String(res.body.session.id), state: res.body.state };
}

describe('propuestas en el estado del servidor', () => {
  test('el checkpoint las guarda y el estado restaurado las conserva', async () => {
    const session = await createSession('Guardar una propuesta', 'commander-propuestas-');
    const original = 'hola\n';
    const proposal = {
      proposalId: 'prop_test',
      path: 'faro.txt',
      diff: '--- a/faro.txt\n+++ b/faro.txt\n@@ -1 +1 @@\n-hola\n+adios\n',
      baseHash: `sha256:${createHash('sha256').update(original).digest('hex')}`,
      afterHash: `sha256:${createHash('sha256').update('adios\n').digest('hex')}`,
      applied: false,
      tool: 'fs.propose.edit',
      createdAt: Date.now(),
    };

    const put = await srv.request('PUT', `/api/agent/sessions/${session.id}/state`, {
      state: { ...session.state, proposals: [proposal] },
    });
    assert.equal(put.status, 200, put.raw);

    const saved = await srv.request('GET', `/api/agent/sessions/${session.id}`);
    assert.deepEqual(saved.body.state.proposals, [proposal]);

    // Reabrir el estado en una instancia nueva es lo que hace el servidor tras
    // un reinicio: las propuestas tienen que seguir ahí.
    const restored = new AgentSession(
      {
        goal: saved.body.state.goal,
        cwd: session.cwd,
        model: saved.body.state.model,
        persist: false,
        maxSteps: 10,
      },
      saved.body.state
    );
    assert.deepEqual(restored.toState().proposals, [proposal]);
  }, 30_000);

  test('aplica una propuesta por id, con checkpoint e idempotencia', async () => {
    const session = await createSession('Aplicar una propuesta', 'commander-propuestas-apply-');
    const before = 'hola\n';
    const after = 'adios\n';
    fs.writeFileSync(path.join(session.cwd, 'faro.txt'), before, 'utf8');

    const proposal = {
      proposalId: 'prop_apply',
      path: 'faro.txt',
      diff: '--- a/faro.txt\n+++ b/faro.txt\n@@ -1 +1 @@\n-hola\n+adios\n',
      baseHash: `sha256:${createHash('sha256').update(before).digest('hex')}`,
      afterHash: `sha256:${createHash('sha256').update(after).digest('hex')}`,
      applied: false,
      tool: 'fs.propose.edit',
      createdAt: Date.now(),
    };
    const put = await srv.request('PUT', `/api/agent/sessions/${session.id}/state`, {
      state: { ...session.state, proposals: [proposal] },
    });
    assert.equal(put.status, 200, put.raw);

    const applied = await srv.request(
      'POST',
      `/api/agent/sessions/${session.id}/proposals/${proposal.proposalId}/apply`,
      {}
    );
    assert.equal(applied.status, 200, applied.raw);
    assert.equal(applied.body.applied, true);
    assert.equal(applied.body.changed, true);
    assert.equal(fs.readFileSync(path.join(session.cwd, 'faro.txt'), 'utf8'), after);
    assert.ok(applied.body.checkpointId);
    assert.equal(applied.body.state.proposals[0].applied, true);
    assert.equal(applied.body.state.proposals[0].checkpointId, applied.body.checkpointId);
    assert.equal(applied.body.state.proposalStats.applied, 1);
    assert.equal(listCheckpoints(session.cwd).length, 1);

    const again = await srv.request(
      'POST',
      `/api/agent/sessions/${session.id}/proposals/${proposal.proposalId}/apply`,
      {}
    );
    assert.equal(again.status, 200, again.raw);
    assert.equal(again.body.alreadyApplied, true);
    assert.equal(listCheckpoints(session.cwd).length, 1, 'reintentar no crea otro checkpoint');
  }, 30_000);

  test('el checkpoint deduplica por contenido y limita pendientes por archivo', async () => {
    const session = await createSession('Deduplicar propuestas', 'commander-propuestas-dup-');
    const base = {
      path: 'faro.txt',
      baseHash: 'sha256:base',
      afterHash: 'sha256:after',
      applied: false,
      tool: 'fs.propose.edit',
    };
    const proposals = [
      { ...base, proposalId: 'prop_aplicada', diff: '+0', applied: true, createdAt: 0 },
      { ...base, proposalId: 'prop_1', diff: '+1', createdAt: 1 },
      { ...base, proposalId: 'prop_1_dup', diff: '+1', createdAt: 2 },
      { ...base, proposalId: 'prop_2', diff: '+2', createdAt: 3 },
      { ...base, proposalId: 'prop_3', diff: '+3', createdAt: 4 },
      { ...base, proposalId: 'prop_4', diff: '+4', createdAt: 5 },
      { ...base, proposalId: 'prop_5', diff: '+5', createdAt: 6 },
    ];

    const put = await srv.request('PUT', `/api/agent/sessions/${session.id}/state`, {
      state: { ...session.state, proposals },
    });
    assert.equal(put.status, 200, put.raw);

    const saved = await srv.request('GET', `/api/agent/sessions/${session.id}`);
    const stored = saved.body.state.proposals as typeof proposals;
    assert.deepEqual(
      stored.map((p) => p.proposalId),
      ['prop_aplicada', 'prop_3', 'prop_4', 'prop_5'],
      `una sola copia del diff y ${MAX_PENDING_PROPOSALS_PER_PATH} pendientes recientes por archivo`
    );
  }, 30_000);
});
