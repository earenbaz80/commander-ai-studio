/**
 * Tests del store global de diagnósticos (panel Problemas).
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  useLspProblems,
  useLspProblemCounts,
  ensureProblemsAttached,
  normalizeProblemPath,
  __resetProblemsForTests,
} from '../../src/utils/lspProblems';

beforeEach(() => {
  __resetProblemsForTests();
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  __resetProblemsForTests();
});

describe('normalizeProblemPath', () => {
  test('reduce uris de Windows a una clave comparable', () => {
    expect(normalizeProblemPath('file:///c%3A/proj/src/a.ts')).toBe('c:/proj/src/a.ts');
    expect(normalizeProblemPath('C:\\proj\\src\\a.ts')).toBe('c:/proj/src/a.ts');
  });
});

describe('lspProblems store', () => {
  test('acumula diagnósticos de varios archivos y cuenta severidades', async () => {
    const listeners: Array<(p: { uri: string; diagnostics: any[] }) => void> = [];
    (window as any).electronAPI = {
      lsp: {
        onDiagnostics: (cb: (p: { uri: string; diagnostics: any[] }) => void) => {
          listeners.push(cb);
          return () => {};
        },
      },
    };

    const { result } = renderHook(() => ({
      groups: useLspProblems(),
      counts: useLspProblemCounts(),
    }));

    act(() => {
      listeners.forEach((cb) =>
        cb({
          uri: 'file:///c%3A/proj/src/a.ts',
          diagnostics: [
            {
              range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
              severity: 1,
              message: 'boom',
              source: 'tsserver',
            },
            {
              range: { start: { line: 5, character: 0 }, end: { line: 5, character: 3 } },
              severity: 2,
              message: 'unused',
              source: 'tsserver',
            },
          ],
        })
      );
    });
    await waitFor(() => expect(result.current.groups.length).toBe(1));
    expect(result.current.groups[0].path).toBe('c:/proj/src/a.ts');
    expect(result.current.groups[0].problems).toHaveLength(2);
    expect(result.current.groups[0].problems[0].line).toBe(2);
    expect(result.current.counts).toEqual({ error: 1, warning: 1, info: 0, total: 2 });

    // Un archivo sin diagnósticos se elimina del listado.
    act(() => {
      listeners.forEach((cb) => cb({ uri: 'file:///c%3A/proj/src/a.ts', diagnostics: [] }));
    });
    await waitFor(() => expect(result.current.groups).toHaveLength(0));
  });

  test('ensureProblemsAttached es idempotente y no-op sin Electron', () => {
    ensureProblemsAttached();
    expect(() => ensureProblemsAttached()).not.toThrow();
  });
});
