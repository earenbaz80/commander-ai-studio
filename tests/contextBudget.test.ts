import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipMiddle,
  compactTurns,
  estimateTokens,
  forContext,
  limitForTool,
  serializeResults,
} from '../src/agent/contextBudget.js';

test('clipMiddle conserva cabeza y cola y dice cuánto omitió', () => {
  const text = 'INICIO-' + 'x'.repeat(5000) + '-FIN';
  const out = clipMiddle(text, 300);

  assert.ok(out.length <= 340, `no debe pasarse del límite (len=${out.length})`);
  assert.ok(out.startsWith('INICIO-'));
  assert.ok(out.endsWith('-FIN'), 'el final lleva el error: debe sobrevivir');
  assert.match(out, /caracteres omitidos/);
});

test('clipMiddle no toca el texto que ya cabe', () => {
  assert.equal(clipMiddle('corto', 100), 'corto');
});

test('limitForTool da más espacio a una lectura que a una lista de archivos', () => {
  assert.ok(limitForTool('fs.read') > limitForTool('fs.glob'));
  assert.equal(limitForTool('tool-desconocida'), limitForTool('otra-desconocida'));
});

test('forContext recorta data larga y deja el resto intacto', () => {
  const out = forContext({ tool: 'fs.read', ok: true, data: { content: 'y'.repeat(50_000) } }, 1000);

  assert.equal(out.tool, 'fs.read');
  assert.equal(out.ok, true);
  assert.equal(typeof out.data, 'string', 'data larga se sustituye por una cadena recortada');
  assert.ok(String(out.data).length <= 1040);
  assert.match(String(out.data), /caracteres omitidos/);
});

test('forContext conserva data pequeña tal cual', () => {
  const out = forContext({ tool: 'fs.glob', ok: true, data: { files: ['a.ts', 'b.ts'] } });
  assert.deepEqual(out.data, { files: ['a.ts', 'b.ts'] });
});

test('serializeResults deja JSON válido cuando el lote cabe', () => {
  const out = serializeResults([
    { tool: 'fs.glob', ok: true, data: { files: ['a.ts'] } },
    { tool: 'fs.read', ok: false, error: 'No existe: x.ts' },
  ]);

  assert.deepEqual(JSON.parse(out), [
    { tool: 'fs.glob', ok: true, data: { files: ['a.ts'] } },
    { tool: 'fs.read', ok: false, error: 'No existe: x.ts', data: null },
  ]);
});

test('serializeResults respeta el presupuesto con varios resultados enormes', () => {
  const huge = { tool: 'fs.read', ok: true, data: { content: 'z'.repeat(200_000) } };
  const out = serializeResults([huge, huge, huge], 4000);

  assert.ok(out.length <= 4000, `len=${out.length}`);
  assert.match(out, /caracteres omitidos/);
});

test('compactTurns deja literales los recientes y resume los viejos', () => {
  const turns = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 === 0 ? 'model' : 'user',
    text: `turno-${i}-` + 'z'.repeat(1500),
  }));

  const out = compactTurns(turns, { maxChars: 12_000, keepRecent: 4 });

  assert.deepEqual(out.slice(-4), turns.slice(-4), 'los recientes van completos');
  assert.match(out[0].text, /compactado/);
  assert.equal(out[0].role, turns[0].role, 'el rol se conserva al resumir');
  const total = out.reduce((n, t) => n + t.text.length, 0);
  assert.ok(total <= 12_000, `total=${total}`);
});

test('compactTurns no toca una conversación corta', () => {
  const turns = [
    { role: 'model', text: 'a' },
    { role: 'user', text: 'b' },
  ];
  assert.deepEqual(compactTurns(turns), turns);
});

test('compactTurns tira resúmenes viejos si aún no cabe', () => {
  const turns = Array.from({ length: 30 }, (_, i) => ({ role: 'model', text: `t${i}-` + 'w'.repeat(1990) }));

  const out = compactTurns(turns, { maxChars: 12_000, keepRecent: 6 });

  assert.equal(out.length, 6, 'solo caben los recientes');
  assert.deepEqual(out, turns.slice(-6));
});

test('estimateTokens redondea a 4 caracteres por token', () => {
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
});
