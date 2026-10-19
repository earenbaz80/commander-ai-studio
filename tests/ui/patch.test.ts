import { describe, test, expect } from 'vitest';
import { diffLines, mergeHunks, applyExactEdit } from '../../src/utils/patch';

describe('diffLines', () => {
  test('sin cambios → sin hunks', () => {
    const d = diffLines('a\nb\nc', 'a\nb\nc');
    expect(d.hunks).toHaveLength(0);
    expect(d.additions).toBe(0);
    expect(d.deletions).toBe(0);
  });

  test('detecta una línea modificada', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc');
    expect(d.hunks).toHaveLength(1);
    expect(d.additions).toBe(1);
    expect(d.deletions).toBe(1);
    const types = d.hunks[0].lines.map((l) => l.type);
    expect(types).toContain('del');
    expect(types).toContain('add');
    expect(types).toContain('context');
  });

  test('calcula los rangos del hunk', () => {
    const d = diffLines('a\nb\nc\nd', 'a\nb\nX\nd');
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0].oldCount).toBe(4);
    expect(d.hunks[0].newCount).toBe(4);
    expect(d.hunks[0].oldLines).toEqual(['a', 'b', 'c', 'd']);
    expect(d.hunks[0].newLines).toEqual(['a', 'b', 'X', 'd']);
  });

  test('agrupa cambios cercanos y separa los lejanos', () => {
    const oldText = Array.from({ length: 40 }, (_, i) => `linea ${i}`).join('\n');
    const lines = oldText.split('\n');
    lines[1] = 'cambio A';
    lines[35] = 'cambio B';
    const d = diffLines(oldText, lines.join('\n'), 3);
    expect(d.hunks).toHaveLength(2);
  });
});

describe('mergeHunks', () => {
  const oldText = 'a\nb\nc\nd';
  const newText = 'a\nB\nc\nD';

  test('aceptar todo reproduce el nuevo contenido', () => {
    const d = diffLines(oldText, newText);
    const merged = mergeHunks(oldText, d.hunks, new Set(d.hunks.map((h) => h.id)));
    expect(merged).toBe(newText);
  });

  test('rechazar todo reproduce el original', () => {
    const d = diffLines(oldText, newText);
    const merged = mergeHunks(oldText, d.hunks, new Set());
    expect(merged).toBe(oldText);
  });

  test('aplicar parcialmente sólo afecta a los hunks aceptados', () => {
    const base = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
    const lines = base.split('\n');
    lines[1] = 'X';
    lines[25] = 'Y';
    const proposed = lines.join('\n');
    const d = diffLines(base, proposed, 3);
    expect(d.hunks).toHaveLength(2);

    const merged = mergeHunks(base, d.hunks, new Set([d.hunks[0].id]));
    const expected = base.split('\n');
    expected[1] = 'X';
    expect(merged).toBe(expected.join('\n'));
  });

  test('maneja inserciones puras', () => {
    const before = 'a\nc';
    const after = 'a\nb\nc';
    const d = diffLines(before, after);
    expect(mergeHunks(before, d.hunks, new Set(d.hunks.map((h) => h.id)))).toBe(after);
    expect(mergeHunks(before, d.hunks, new Set())).toBe(before);
  });
});

describe('applyExactEdit', () => {
  test('devuelve null si no encuentra oldString', () => {
    expect(applyExactEdit('hola', 'nope', 'x')).toBeNull();
  });

  test('devuelve null para oldString vacío', () => {
    expect(applyExactEdit('hola', '', 'x')).toBeNull();
  });

  test('reemplaza la primera ocurrencia', () => {
    const r = applyExactEdit('a b a', 'a', 'z');
    expect(r?.content).toBe('z b a');
    expect(r?.replaced).toBe(1);
  });

  test('replaceAll reemplaza todas las ocurrencias', () => {
    const r = applyExactEdit('a b a', 'a', 'z', true);
    expect(r?.content).toBe('z b z');
    expect(r?.replaced).toBe(2);
  });
});
