import { describe, expect, it } from 'vitest';
import { checkpointPaths, isStepCheckpoint, nextUndoCandidate } from '../../src/agent/undoRedo';
import type { CheckpointMeta } from '../../src/utils/checkpointsApi';

function cp(partial: Partial<CheckpointMeta> & Pick<CheckpointMeta, 'id'>): CheckpointMeta {
  return {
    id: partial.id,
    ts: partial.ts ?? 1700000000000,
    label: partial.label ?? 'checkpoint',
    tool: partial.tool,
    files: partial.files ?? [{ path: 'src/a.ts', existed: true, captured: true }],
  };
}

describe('undo/redo por paso', () => {
  it('sólo considera checkpoints de escrituras del agente', () => {
    expect(isStepCheckpoint(cp({ id: '1', tool: 'fs.edit' }))).toBe(true);
    expect(isStepCheckpoint(cp({ id: '2', tool: 'manual' }))).toBe(false);
    expect(isStepCheckpoint(cp({ id: '3' }))).toBe(false);
    expect(isStepCheckpoint(cp({ id: '4', tool: 'fs.write', files: [] }))).toBe(false);
  });

  it('elige el más reciente y salta los ya deshechos', () => {
    const list = [
      cp({ id: 'viejo', ts: 1, tool: 'fs.edit' }),
      cp({ id: 'nuevo', ts: 3, tool: 'fs.write' }),
      cp({ id: 'manual', ts: 4, tool: 'manual' }),
    ];
    expect(nextUndoCandidate(list)?.id).toBe('nuevo');
    expect(nextUndoCandidate(list, ['nuevo'])?.id).toBe('viejo');
    expect(nextUndoCandidate(list, ['nuevo', 'viejo'])).toBeNull();
  });

  it('devuelve las rutas sin duplicados', () => {
    const rutas = checkpointPaths(
      cp({
        id: 'x',
        tool: 'code.fix',
        files: [
          { path: 'src/a.ts', existed: true },
          { path: 'src/a.ts', existed: true },
          { path: 'src/b.ts', existed: false },
        ],
      })
    );
    expect(rutas).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
