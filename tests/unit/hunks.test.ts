import { describe, expect, test } from 'vitest';
import {
  applyHunkReviewState,
  attributeHunks,
  carryHunkReviews,
  filterPatchByAcceptedHunks,
  parseVerificationHunks,
  patchPathFromHeader,
  reviewVerificationHunk,
} from '../../src/artifacts/hunks';
import type { VerificationArtifact } from '../../src/artifacts/types';

const PATCH = [
  'diff --git a/src/checkout.ts b/src/checkout.ts',
  '--- a/src/checkout.ts',
  '+++ b/src/checkout.ts',
  '@@ -1 +1 @@',
  '-export const total = 2;',
  '+export const total = 3;',
  '@@ -10,2 +10,3 @@ function apply() {',
  ' const tax = 0.1;',
  '+const discount = 0.05;',
  ' export const name = "checkout";',
  'diff --git a/src/cart.ts b/src/cart.ts',
  '--- a/src/cart.ts',
  '+++ b/src/cart.ts',
  '@@ -5,2 +5,2 @@',
  '-const items = load();',
  '+const items = load({ fresh: true });',
  ' export default items;',
].join('\n');

function makeArtifact(patch = PATCH): VerificationArtifact {
  return {
    id: 'ver-hunks',
    kind: 'verification',
    schemaVersion: 1,
    projectPath: 'C:/tmp/app',
    title: 'Verificación',
    createdAt: 1,
    sessionId: 's1',
    status: 'passed',
    plan: [],
    decisions: [],
    diff: { patch, files: ['src/checkout.ts', 'src/cart.ts'] },
    tests: [],
    environment: { node: 'v22', os: 'win32' },
  };
}

describe('parseVerificationHunks', () => {
  test('separa archivos y hunks con rangos e ids estables', () => {
    const hunks = parseVerificationHunks(PATCH);

    expect(hunks.map((hunk) => hunk.id)).toEqual([
      'src/checkout.ts@1',
      'src/checkout.ts@10',
      'src/cart.ts@5',
    ]);
    expect(hunks.map((hunk) => hunk.file)).toEqual([
      'src/checkout.ts',
      'src/checkout.ts',
      'src/cart.ts',
    ]);
    expect(hunks[1].oldLines).toBe(2);
    expect(hunks[1].newLines).toBe(3);
    expect(hunks[1].lines[0]).toBe('@@ -10,2 +10,3 @@ function apply() {');
    expect(hunks[1].lines).toContain('+const discount = 0.05;');
    // El hunk no se come las cabeceras del archivo siguiente.
    expect(hunks[1].lines.join('\n')).not.toContain('diff --git');
    expect(parseVerificationHunks(PATCH)).toEqual(hunks);
  });

  test('un patch sin hunks no produce nada revisable', () => {
    expect(parseVerificationHunks('')).toEqual([]);
    expect(parseVerificationHunks('diff --git a/x b/x\n--- a/x\n+++ b/x')).toEqual([]);
  });

  test('una línea de contenido que empieza por `--- ` no corta el hunk', () => {
    const patch = ['--- a/x.sql', '+++ b/x.sql', '@@ -1 +1 @@', '--- comentario', '+++ otro'].join(
      '\n'
    );
    const hunks = parseVerificationHunks(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toEqual(['@@ -1 +1 @@', '--- comentario', '+++ otro']);
  });

  test('descarta rutas fuera del workspace', () => {
    expect(patchPathFromHeader('b/src/app.ts')).toBe('src/app.ts');
    expect(patchPathFromHeader('/dev/null')).toBeNull();
    expect(patchPathFromHeader('C:/tmp/app/x.ts')).toBeNull();
    expect(patchPathFromHeader('b/../../x.ts')).toBeNull();
  });
});

describe('revisión por hunk', () => {
  test('acepta y retira la decisión sin mutar el artifact', () => {
    const artifact = makeArtifact();
    const accepted = reviewVerificationHunk(artifact, 'src/checkout.ts@1', 'accepted', {
      reviewedBy: 'user',
      reviewedAt: 1_700_000_000_000,
    });

    expect(artifact.diff?.reviews).toBeUndefined();
    expect(accepted.diff?.reviews).toEqual([
      {
        hunkId: 'src/checkout.ts@1',
        decision: 'accepted',
        reviewedBy: 'user',
        reviewedAt: 1_700_000_000_000,
      },
    ]);
    expect(accepted.diff?.patch).toBe(artifact.diff?.patch);

    const pending = reviewVerificationHunk(accepted, 'src/checkout.ts@1', 'pending');
    expect(pending.diff?.reviews).toEqual([]);

    const state = applyHunkReviewState(accepted.diff);
    expect(state.summary).toEqual({ total: 3, accepted: 1, rejected: 0, pending: 2 });
    expect(state.hunks[0].decision).toBe('accepted');
    expect(state.hunks[1].decision).toBe('pending');
  });

  test('una decisión por hunk no pisa a las demás', () => {
    const first = reviewVerificationHunk(makeArtifact(), 'src/checkout.ts@1', 'accepted', {
      reviewedAt: 1,
    });
    const second = reviewVerificationHunk(first, 'src/cart.ts@5', 'rejected', {
      reviewedAt: 2,
    });
    expect(second.diff?.reviews?.map((review) => review.hunkId).sort()).toEqual([
      'src/cart.ts@5',
      'src/checkout.ts@1',
    ]);
    expect(applyHunkReviewState(second.diff).summary).toEqual({
      total: 3,
      accepted: 1,
      rejected: 1,
      pending: 1,
    });
  });

  test('conserva sólo revisiones cuyos hunks siguen existiendo', () => {
    const reviews = [
      { hunkId: 'src/checkout.ts@1', decision: 'accepted' as const, reviewedBy: 'user' as const, reviewedAt: 1 },
      { hunkId: 'src/gone.ts@3', decision: 'rejected' as const, reviewedBy: 'user' as const, reviewedAt: 2 },
    ];
    expect(carryHunkReviews(PATCH, reviews)).toEqual([reviews[0]]);
  });
});

describe('atribución de hunks', () => {
  test('asigna cada hunk a la aprobación que lo aportó', () => {
    const first = [
      '--- a/src/checkout.ts',
      '+++ b/src/checkout.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '@@ -10,2 +10,3 @@ function apply() {',
      ' const tax = 0.1;',
      '+const discount = 0.05;',
      ' export const name = "checkout";',
    ].join('\n');
    const second = ['--- a/src/cart.ts', '+++ b/src/cart.ts', '@@ -5 +5 @@', '-c', '+d'].join('\n');
    const attributions = attributeHunks(PATCH, [
      { patch: first, stepId: 'step-1', tool: 'fs.edit', decision: 'allow' },
      { patch: second, stepId: 'step-2', tool: 'fs.write', decision: 'allow-session' },
    ]);

    expect(attributions).toEqual([
      { hunkId: 'src/checkout.ts@1', stepId: 'step-1', tool: 'fs.edit', decision: 'allow' },
      { hunkId: 'src/checkout.ts@10', stepId: 'step-1', tool: 'fs.edit', decision: 'allow' },
      { hunkId: 'src/cart.ts@5', stepId: 'step-2', tool: 'fs.write', decision: 'allow-session' },
    ]);

    const state = applyHunkReviewState({ patch: PATCH, files: [], attributions });
    expect(state.hunks[0].appliedBy).toEqual({
      stepId: 'step-1',
      tool: 'fs.edit',
      decision: 'allow',
    });
  });

  test('un patch sin fuentes no inventa atribuciones', () => {
    expect(attributeHunks(PATCH, [])).toEqual([]);
  });
});

describe('filterPatchByAcceptedHunks', () => {
  test('deja sólo los hunks aceptados y sus cabeceras', () => {
    const filtered = filterPatchByAcceptedHunks(PATCH, ['src/cart.ts@5']);

    expect(filtered).toContain('diff --git a/src/cart.ts b/src/cart.ts');
    expect(filtered).toContain('@@ -5,2 +5,2 @@');
    expect(filtered).toContain('+const items = load({ fresh: true });');
    expect(filtered).not.toContain('src/checkout.ts');
    expect(filtered).not.toContain('+export const total = 3;');
  });

  test('sin aceptados no hay patch y no se exporta un vacío exitoso', () => {
    expect(filterPatchByAcceptedHunks(PATCH, [])).toBe('');
    expect(filterPatchByAcceptedHunks(PATCH, ['no-existe@1'])).toBe('');
  });

  test('conserva un hunk posterior del mismo archivo', () => {
    const filtered = filterPatchByAcceptedHunks(PATCH, ['src/checkout.ts@10']);
    expect(filtered).toContain('@@ -10,2 +10,3 @@');
    expect(filtered).toContain('+const discount = 0.05;');
    expect(filtered).not.toContain('@@ -1 +1 @@');
    expect(filtered).not.toContain('src/cart.ts');
  });
});
