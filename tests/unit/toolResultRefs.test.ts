import { describe, expect, it } from 'vitest';
import { toolResultRefs } from '../../src/agent/toolResultRefs';

/**
 * F4A-3: el servidor normaliza archivo/línea de las tools para que el cliente
 * pueda abrir el resultado. Cada forma real tiene su caso.
 */
describe('toolResultRefs', () => {
  it('extrae las coincidencias de fs.grep', () => {
    const refs = toolResultRefs({
      matches: [{ file: 'src/a.ts', line: 3, text: 'hola' }],
      roots: ['/proyecto'],
      truncated: false,
    });
    expect(refs).toEqual([{ path: 'src/a.ts', line: 3, text: 'hola' }]);
  });

  it('extrae definiciones y referencias de code.analyze', () => {
    const refs = toolResultRefs({
      symbol: 'suma',
      declarations: [{ file: 'src/math.ts', line: 1, column: 17, text: 'suma', isDefinition: true }],
      references: [{ file: 'src/app.ts', line: 8, column: 3, text: 'suma', isDefinition: false }],
    });
    expect(refs).toEqual([
      { path: 'src/math.ts', line: 1, column: 17, text: 'suma' },
      { path: 'src/app.ts', line: 8, column: 3, text: 'suma' },
    ]);
  });

  it('usa el path del input cuando fs.read sólo devuelve startLine', () => {
    const refs = toolResultRefs({ content: 'x', startLine: 12, endLine: 20 }, { path: './nota.txt' });
    expect(refs).toEqual([{ path: 'nota.txt', line: 12 }]);
  });

  it('acepta diagnostics con message y descarta entradas sin archivo', () => {
    const refs = toolResultRefs({
      diagnostics: [
        { file: 'src/b.ts', line: 4, column: 2, severity: 'error', message: 'falta tipo' },
        { file: '', line: 0, message: 'sin archivo' },
      ],
    });
    expect(refs).toEqual([{ path: 'src/b.ts', line: 4, column: 2, text: 'falta tipo' }]);
  });

  it('deduplica y limita a 20 referencias', () => {
    const matches = Array.from({ length: 30 }, (_, index) => ({
      file: `src/f${index}.ts`,
      line: 1,
      text: 'x',
    }));
    const refs = toolResultRefs({ matches: [...matches, { file: 'src/f0.ts', line: 1, text: 'x' }] });
    expect(refs).toHaveLength(20);
    expect(new Set(refs.map((ref) => ref.path)).size).toBe(20);
  });

  it('no inventa referencias sin archivo', () => {
    expect(toolResultRefs({ ok: true, bytes: 3 })).toEqual([]);
    expect(toolResultRefs(null, { command: 'ls' })).toEqual([]);
  });
});
