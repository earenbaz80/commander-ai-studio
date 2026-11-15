import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  MAX_PENDING_PROPOSALS_PER_PATH,
  MAX_SESSION_PROPOSALS,
  normalizeProposals,
} from '../../src/agent/proposals.js';
import type { SessionProposalV2 } from '../../src/agent/sessionTypes.js';

function proposal(over: Partial<SessionProposalV2> = {}): SessionProposalV2 {
  return {
    proposalId: 'prop_1',
    path: 'src/faro.ts',
    diff: '--- a/src/faro.ts\n+++ b/src/faro.ts\n@@ -1 +1 @@\n-a\n+b\n',
    baseHash: 'sha256:base-1',
    afterHash: 'sha256:after-1',
    applied: false,
    tool: 'fs.propose.edit',
    createdAt: 1,
    ...over,
  };
}

describe('normalizeProposals', () => {
  test('una misma ruta, base y diff queda una sola vez, con la más reciente', () => {
    const drops = { duplicates: 0, perFileCap: 0, totalCap: 0 };
    const result = normalizeProposals(
      [
        proposal({ proposalId: 'prop_vieja', createdAt: 1 }),
        proposal({ proposalId: 'prop_nueva', createdAt: 2 }),
      ],
      drops
    );

    assert.equal(result.length, 1);
    assert.equal(drops.duplicates, 1);
    assert.equal(result[0].proposalId, 'prop_nueva');
    assert.equal(result[0].createdAt, 2);
  });

  test('la base y el diff forman parte de la identidad', () => {
    const result = normalizeProposals([
      proposal({ proposalId: 'prop_base_a', baseHash: 'sha256:a' }),
      proposal({ proposalId: 'prop_base_b', baseHash: 'sha256:b' }),
      proposal({ proposalId: 'prop_otro_diff', diff: '+otro' }),
    ]);

    assert.deepEqual(result.map((p) => p.proposalId), [
      'prop_base_a',
      'prop_base_b',
      'prop_otro_diff',
    ]);
  });

  test('un duplicado aplicado no vuelve a quedar pendiente', () => {
    const result = normalizeProposals([
      proposal({ proposalId: 'prop_pendiente', applied: false }),
      proposal({ proposalId: 'prop_aplicada', applied: true }),
    ]);

    assert.equal(result.length, 1);
    assert.equal(result[0].applied, true);
  });

  test(`conserva como máximo ${MAX_PENDING_PROPOSALS_PER_PATH} pendientes por archivo`, () => {
    const drops = { duplicates: 0, perFileCap: 0, totalCap: 0 };
    const result = normalizeProposals(
      [1, 2, 3, 4, 5].map((n) =>
        proposal({ proposalId: `prop_${n}`, diff: `+${n}`, createdAt: n })
      ),
      drops
    );

    assert.deepEqual(
      result.map((p) => p.proposalId),
      ['prop_3', 'prop_4', 'prop_5'],
      'se descartan las variantes pendientes más antiguas'
    );
    assert.equal(drops.perFileCap, 2);
  });

  test('las aplicadas no cuentan para el tope por archivo', () => {
    const result = normalizeProposals([
      proposal({ proposalId: 'prop_aplicada', diff: '+0', applied: true }),
      ...[1, 2, 3, 4].map((n) =>
        proposal({ proposalId: `prop_${n}`, diff: `+${n}`, createdAt: n })
      ),
    ]);

    assert.deepEqual(
      result.map((p) => p.proposalId),
      ['prop_aplicada', 'prop_2', 'prop_3', 'prop_4']
    );
  });

  test(`el total no supera ${MAX_SESSION_PROPOSALS} y conserva las recientes`, () => {
    const many = Array.from({ length: MAX_SESSION_PROPOSALS + 10 }, (_, i) =>
      proposal({
        proposalId: `prop_${i}`,
        path: `src/archivo-${i}.ts`,
        diff: `+${i}`,
        baseHash: `sha256:${i}`,
        createdAt: i,
      })
    );

    const drops = { duplicates: 0, perFileCap: 0, totalCap: 0 };
    const result = normalizeProposals(many, drops);

    assert.equal(result.length, MAX_SESSION_PROPOSALS);
    assert.equal(drops.totalCap, 10);
    assert.equal(result[0].path, 'src/archivo-10.ts');
    assert.equal(result.at(-1)?.path, `src/archivo-${MAX_SESSION_PROPOSALS + 9}.ts`);
  });

  test('descarta entradas corruptas del estado persistido', () => {
    const result = normalizeProposals([
      proposal(),
      { proposalId: 'rota', path: 'src/x.ts' } as SessionProposalV2,
    ]);

    assert.deepEqual(result.map((p) => p.proposalId), ['prop_1']);
  });
});
