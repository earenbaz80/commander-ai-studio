import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineDiff, summarizeDiff, hasChanges } from '../src/utils/lineDiff.js';

const types = (before: string, after: string) => lineDiff(before, after).map((op) => op.type);

test('lineDiff sin cambios devuelve solo líneas iguales', () => {
  const ops = lineDiff('a\nb\nc', 'a\nb\nc');
  assert.deepEqual(types('a\nb\nc', 'a\nb\nc'), ['equal', 'equal', 'equal']);
  assert.equal(hasChanges(ops), false);
  assert.deepEqual(summarizeDiff(ops), { added: 0, removed: 0 });
});

test('lineDiff detecta un renglón modificado', () => {
  const ops = lineDiff('a\nb\nc', 'a\nB\nc');
  assert.deepEqual(ops.map((o) => o.text), ['a', 'b', 'B', 'c']);
  assert.deepEqual(ops.map((o) => o.type), ['equal', 'del', 'add', 'equal']);
  assert.deepEqual(summarizeDiff(ops), { added: 1, removed: 1 });
});

test('lineDiff detecta líneas añadidas y quitadas', () => {
  assert.deepEqual(types('a\nb', 'a\nb\nc'), ['equal', 'equal', 'add']);
  assert.deepEqual(types('a\nb\nc', 'a\nb'), ['equal', 'equal', 'del']);
});

test('lineDiff reconstruye ambos textos desde las operaciones', () => {
  const before = 'uno\ndos\ntres\ncuatro';
  const after = 'uno\ntres\nCUATRO\ncinco';
  const ops = lineDiff(before, after);
  const rebuiltBefore = ops.filter((o) => o.type !== 'add').map((o) => o.text).join('\n');
  const rebuiltAfter = ops.filter((o) => o.type !== 'del').map((o) => o.text).join('\n');
  assert.equal(rebuiltBefore, before);
  assert.equal(rebuiltAfter, after);
});

test('lineDiff de un fragmento vacío a contenido lo marca como añadido', () => {
  const ops = lineDiff('', 'nueva');
  assert.equal(hasChanges(ops), true);
  assert.deepEqual(summarizeDiff(ops), { added: 1, removed: 1 }); // "" cuenta como una línea vacía
});
