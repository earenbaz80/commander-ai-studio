/**
 * Aplicador de propuestas: base y resultado verificados antes de escribir,
 * checkpoint previo y reintento idempotente.
 */
import { afterEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyProposalToFile } from '../../src/agent/applyProposal.js';
import { hashContent } from '../../src/agent/proposalHash.js';
import type { SessionProposalV2 } from '../../src/agent/sessionTypes.js';
import { listCheckpoints, restoreCheckpoint } from '../../checkpoints.js';
import { diffLines, toUnifiedDiff } from '../../src/utils/patch.js';

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-apply-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function proposal(
  relPath: string,
  before: string,
  after: string,
  over: Partial<SessionProposalV2> = {}
): SessionProposalV2 {
  const diff = toUnifiedDiff(relPath, diffLines(before, after), { exists: before !== '' });
  return {
    proposalId: 'prop_test',
    path: relPath,
    diff,
    baseHash: hashContent(before),
    afterHash: hashContent(after),
    applied: false,
    tool: 'fs.propose.edit',
    createdAt: 1,
    ...over,
  };
}

describe('applyProposalToFile', () => {
  test('no aplica una propuesta descartada', () => {
    const root = tempRoot();
    const before = 'uno\n';
    const after = 'dos\n';
    fs.writeFileSync(path.join(root, 'faro.txt'), before, 'utf8');

    const result = applyProposalToFile(
      proposal('faro.txt', before, after, { discardedAt: 2 }),
      { root }
    );

    assert.equal(result.ok, false);
    assert.equal(result.code, 'PROPOSAL_DISCARDED');
    assert.equal(fs.readFileSync(path.join(root, 'faro.txt'), 'utf8'), before);
  });

  test('aplica el diff, guarda el checkpoint y marca la propuesta', () => {
    const root = tempRoot();
    const before = 'uno\ndos\ntres\n';
    const after = 'uno\nDOS\ntres\n';
    fs.writeFileSync(path.join(root, 'faro.txt'), before, 'utf8');

    const result = applyProposalToFile(proposal('faro.txt', before, after), { root });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.applied, true);
    assert.equal(result.changed, true);
    assert.equal(fs.readFileSync(path.join(root, 'faro.txt'), 'utf8'), after);
    assert.equal(result.proposal?.applied, true);
    assert.ok(result.proposal?.appliedAt);
    assert.ok(result.checkpointId);

    const checkpoint = listCheckpoints(root).find((item) => item.id === result.checkpointId);
    assert.ok(checkpoint, 'el checkpoint previo existe');
    assert.equal(checkpoint.files[0].path, 'faro.txt');
    assert.equal(checkpoint.files[0].existed, true);
    restoreCheckpoint(root, result.checkpointId!);
    assert.equal(fs.readFileSync(path.join(root, 'faro.txt'), 'utf8'), before);
  });

  test('reintentar una propuesta aplicada no vuelve a escribir ni a checkpointear', () => {
    const root = tempRoot();
    const before = 'uno\n';
    const after = 'dos\n';
    fs.writeFileSync(path.join(root, 'faro.txt'), before, 'utf8');

    const first = applyProposalToFile(proposal('faro.txt', before, after), { root });
    assert.equal(first.ok, true, first.error);
    const checkpoints = listCheckpoints(root).length;

    const again = applyProposalToFile(first.proposal!, { root });
    assert.equal(again.ok, true);
    assert.equal(again.alreadyApplied, true);
    assert.equal(again.applied, true);
    assert.equal(fs.readFileSync(path.join(root, 'faro.txt'), 'utf8'), after);
    assert.equal(listCheckpoints(root).length, checkpoints);
  });

  test('si el archivo ya está en el estado final, el reintento es idempotente', () => {
    const root = tempRoot();
    const before = 'uno\n';
    const after = 'dos\n';
    fs.writeFileSync(path.join(root, 'faro.txt'), before, 'utf8');
    const pending = proposal('faro.txt', before, after);

    const first = applyProposalToFile(pending, { root });
    assert.equal(first.ok, true, first.error);
    // Estado perdido: se reintenta la propuesta original, no la actualizada.
    const retry = applyProposalToFile(pending, { root });

    assert.equal(retry.ok, true);
    assert.equal(retry.alreadyApplied, true);
    assert.equal(retry.applied, true);
    assert.equal(retry.changed, false);
    assert.equal(fs.readFileSync(path.join(root, 'faro.txt'), 'utf8'), after);
    assert.equal(listCheckpoints(root).length, 1);
  });

  test('rechaza una base obsoleta sin escribir ni checkpointear', () => {
    const root = tempRoot();
    const before = 'uno\n';
    const after = 'dos\n';
    fs.writeFileSync(path.join(root, 'faro.txt'), 'otro contenido\n', 'utf8');

    const result = applyProposalToFile(proposal('faro.txt', before, after), { root });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'STALE_BASE');
    assert.equal(fs.readFileSync(path.join(root, 'faro.txt'), 'utf8'), 'otro contenido\n');
    assert.equal(listCheckpoints(root).length, 0);
  });

  test('rechaza un afterHash que no corresponde al resultado', () => {
    const root = tempRoot();
    const before = 'uno\n';
    const after = 'dos\n';
    fs.writeFileSync(path.join(root, 'faro.txt'), before, 'utf8');

    const result = applyProposalToFile(
      proposal('faro.txt', before, after, { afterHash: hashContent('otra cosa\n') }),
      { root }
    );

    assert.equal(result.ok, false);
    assert.equal(result.code, 'AFTER_HASH_MISMATCH');
    assert.equal(fs.readFileSync(path.join(root, 'faro.txt'), 'utf8'), before);
    assert.equal(listCheckpoints(root).length, 0);
  });

  test('rechaza un diff mal formado o que no encaja', () => {
    const root = tempRoot();
    const before = 'uno\n';
    fs.writeFileSync(path.join(root, 'faro.txt'), before, 'utf8');

    const malformed = applyProposalToFile(
      proposal('faro.txt', before, 'dos\n', { diff: '+solo una suma\n' }),
      { root }
    );
    assert.equal(malformed.ok, false);
    assert.equal(malformed.code, 'INVALID_DIFF');

    const noMatch = applyProposalToFile(
      proposal('faro.txt', before, 'dos\n', {
        diff: '--- a/faro.txt\n+++ b/faro.txt\n@@ -1 +1 @@\n-no existe\n+dos\n',
      }),
      { root }
    );
    assert.equal(noMatch.ok, false);
    assert.equal(noMatch.code, 'INVALID_DIFF');
    assert.equal(fs.readFileSync(path.join(root, 'faro.txt'), 'utf8'), before);
  });

  test('dryRun valida sin escribir ni crear checkpoint', () => {
    const root = tempRoot();
    const before = 'uno\n';
    const after = 'dos\n';
    fs.writeFileSync(path.join(root, 'faro.txt'), before, 'utf8');

    const result = applyProposalToFile(proposal('faro.txt', before, after), {
      root,
      dryRun: true,
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.applied, false);
    assert.equal(result.changed, true);
    assert.equal(fs.readFileSync(path.join(root, 'faro.txt'), 'utf8'), before);
    assert.equal(listCheckpoints(root).length, 0);
  });

  test('crea archivos nuevos, incluidos los de subdirectorios', () => {
    const root = tempRoot();
    const after = 'hola\nmundo\n';
    const result = applyProposalToFile(proposal('nested/nuevo.txt', '', after), { root });

    assert.equal(result.ok, true, result.error);
    assert.equal(fs.readFileSync(path.join(root, 'nested', 'nuevo.txt'), 'utf8'), after);
    assert.ok(result.checkpointId);
    const checkpoint = listCheckpoints(root).find((item) => item.id === result.checkpointId);
    assert.equal(checkpoint?.files[0].existed, false);
  });

  test('rechaza rutas fuera del proyecto y propuestas sin afterHash', () => {
    const root = tempRoot();
    const outside = path.join(os.tmpdir(), 'commander-fuera.txt');
    const pathResult = applyProposalToFile(proposal(outside, '', 'x\n'), { root });
    assert.equal(pathResult.ok, false);
    assert.equal(pathResult.code, 'PATH_INVALID');

    const old = applyProposalToFile(
      proposal('viejo.txt', 'uno\n', 'dos\n', { afterHash: '' }),
      { root }
    );
    assert.equal(old.ok, false);
    assert.equal(old.code, 'MISSING_AFTER_HASH');
  });
});
