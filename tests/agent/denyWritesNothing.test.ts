/**
 * F1-04: denegar una escritura no modifica ni un byte.
 *
 * Se intentan fs.write, fs.edit y shell.run (fuera de allowlist) con el mismo
 * cwd temporal y se compara un hash de todo el árbol antes/después.
 */
import { afterAll, beforeAll, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type ServerHarness } from '../helpers/serverHarness.js';
import {
  cleanupDir,
  createApprovalSession,
  resolveApproval,
  startScriptedProvider,
  treeFingerprint,
  waitForApproval,
  waitForState,
  type FakeProvider,
} from './approvalHarness.js';

let srv: ServerHarness;
let provider: FakeProvider | null = null;
let cwd = '';

beforeAll(async () => {
  srv = await startServer();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-f1-04-deny-'));
  fs.writeFileSync(path.join(cwd, 'edit.txt'), 'original\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'keep.txt'), 'sentinela\n', 'utf8');
  provider = await startScriptedProvider([
    { tool: 'fs.write', args: { path: 'write.txt', content: 'no debe existir' } },
    { tool: 'fs.edit', args: { path: 'edit.txt', oldString: 'original', newString: 'hackeado' } },
    {
      tool: 'shell.run',
      args: { command: 'node -e "require(\'fs\').writeFileSync(\'shell.txt\', \'x\')"' },
    },
    { text: 'Fin.' },
  ]);
}, 90_000);

afterAll(async () => {
  await provider?.close();
  cleanupDir(cwd);
  await srv?.stop();
}, 30_000);

describe('denegar escrituras no toca el árbol (F1-04)', () => {
  test('fs.write, fs.edit y shell.run denegados dejan el hash intacto', async () => {
    assert.ok(provider);
    const created = await createApprovalSession(srv, provider, { maxSteps: 20 });
    const before = treeFingerprint(cwd);

    let lastId: string | undefined;
    for (const expected of ['fs.write', 'fs.edit', 'shell.run']) {
      const approval = await waitForApproval(srv, created.id, { notId: lastId, timeoutMs: 10_000 });
      assert.equal(approval.tool, expected);
      const denied = await resolveApproval(srv, created.id, approval.id, 'deny', 'prueba F1-04');
      assert.equal(denied.status, 200, denied.raw);
      lastId = approval.id;
    }

    const state = await waitForState(srv, created.id, ['completed', 'failed']);
    assert.equal(state.status, 'completed', JSON.stringify(state));
    assert.equal(treeFingerprint(cwd), before, 'el árbol cambió tras denegar');
    assert.equal(fs.existsSync(path.join(cwd, 'write.txt')), false);
    assert.equal(fs.existsSync(path.join(cwd, 'shell.txt')), false);
    assert.equal(fs.readFileSync(path.join(cwd, 'edit.txt'), 'utf8'), 'original\n');
    assert.equal(fs.readFileSync(path.join(cwd, 'keep.txt'), 'utf8'), 'sentinela\n');

    const results = state.steps.filter((step: any) => step.type === 'tool_result');
    assert.equal(results.length, 3);
    assert.ok(results.every((step: any) => step.approval?.decision === 'deny'));
  }, 30_000);
});
