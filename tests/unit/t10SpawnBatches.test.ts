import { describe, expect, it } from 'vitest';
import {
  lastSpawnBatchWithTwo,
  reportedFile,
  sessionDiagnostics,
  spawnBatches,
} from '../../evals/scenarios';

/**
 * El padre de T10 puede relanzar `spawn_agents` cuando una tanda falla a medias.
 * Los checks tienen que juzgar la última tanda con dos hijos y el diagnóstico
 * tiene que conservar todas: quedarse con la primera convirtió un cierre
 * posterior en «hijo 1 sin respuesta» (G1-T10-11).
 */

const child = (index: number, ok: boolean, answer = '', error = '') => ({
  index,
  ok,
  ...(answer ? { answer } : {}),
  ...(error ? { error } : {}),
});

/** Salida tal como la guarda el servidor: sobre `{ data: { results, spawned } }`. */
const envelope = (spawned: number, results: unknown[]) => ({ data: { spawned, results } });

describe('tandas de spawn_agents en T10', () => {
  it('conserva todas las tandas, incluidas las incompletas', () => {
    const batches = spawnBatches([
      { data: { ok: true, ...envelope(2, [child(0, true, 'Archivos: hijo-a.txt'), child(1, false, '', 'vacío')]) } },
      { data: { ok: true, ...envelope(1, [child(0, false, '', 'timeout')]) } },
      { data: envelope(2, [child(0, true, 'Archivos: hijo-a.txt\nDenegado: shell.run'), child(1, true, 'Archivos: hijo-b.txt\nDenegado: ninguna')]) },
    ]);

    expect(batches).toHaveLength(3);
    expect(batches.map((batch) => batch.children.length)).toEqual([2, 1, 2]);
    expect(batches[0].children[1]).toMatchObject({ ok: false, error: 'vacío' });
  });

  it('lee también la salida directa, sin sobre', () => {
    const batches = spawnBatches([{ data: { spawned: 2, results: [child(0, true), child(1, true)] } }]);
    expect(batches).toHaveLength(1);
    expect(batches[0].spawned).toBe(2);
    expect(batches[0].children).toHaveLength(2);
  });

  it('ignora una salida sin results en vez de inventar hijos', () => {
    expect(spawnBatches([{ data: { error: 'parentSessionId requerido' } }, { data: null }])).toEqual([]);
  });

  it('elige la última tanda con dos hijos, no la primera ni una incompleta', () => {
    const first = spawnBatches([envelope(2, [child(0, true), child(1, false)])]);
    const last = spawnBatches([envelope(2, [child(0, true), child(1, true)])]);
    const trailing = spawnBatches([envelope(1, [child(0, true)])]);

    const chosen = lastSpawnBatchWithTwo([...first, ...last, ...trailing]);
    expect(chosen).toBe(last[0]);
    expect(chosen?.children.every((entry) => entry.ok === true)).toBe(true);
  });

  it('sin dos hijos en ninguna tanda no elige ninguna', () => {
    const batches = spawnBatches([
      envelope(1, [child(0, true)]),
      { data: { spawned: 2 } },
    ]);
    expect(lastSpawnBatchWithTwo(batches)).toBeUndefined();
  });

  it('exige hijo-a.txt en la línea Archivos, no en Denegado', () => {
    expect(reportedFile('Archivos: hijo-a.txt\nDenegado: shell.run', 'hijo-a.txt')).toBe(true);
    expect(
      reportedFile('ARCHIVOS: C:\\tmp\\sub\\hijo-a.txt\nDENEGADO: shell.run: Tool denegada', 'hijo-a.txt')
    ).toBe(true);
    expect(reportedFile('Archivos: ninguno\nDenegado: shell.run', 'hijo-a.txt')).toBe(false);
    expect(reportedFile('Archivos: hijo-b.txt\nDenegado: ninguna', 'hijo-a.txt')).toBe(false);
    expect(reportedFile('Archivos: ninguno\nDenegado: hijo-a.txt', 'hijo-a.txt')).toBe(false);
    expect(reportedFile(undefined, 'hijo-a.txt')).toBe(false);
  });

  it('el diagnóstico guarda todas las tandas junto al resto del resumen', () => {
    const spawns = spawnBatches([
      envelope(2, [child(0, false, '', 'Subagente excedió tiempo límite'), child(1, true, 'Archivos: hijo-b.txt')]),
      envelope(2, [child(0, true, 'Archivos: hijo-a.txt'), child(1, true, 'Archivos: hijo-b.txt')]),
    ]);
    const diagnostics = sessionDiagnostics(
      { id: 'sess-test', steps: [] } as any,
      ['Subagente excedió tiempo límite'],
      'tests/tmp/t10-diag',
      spawns
    );

    expect(diagnostics?.spawns).toHaveLength(2);
    expect(diagnostics?.spawns?.[1].children[0].answer).toContain('hijo-a.txt');
    expect(diagnostics?.truncatedTurns).toBe(0);
  });
});
