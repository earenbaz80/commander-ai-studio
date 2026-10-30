import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipMiddle,
  compactTurns,
  createReadIndex,
  estimateTokens,
  forContext,
  formatReadIndex,
  formatStepDigest,
  limitForTool,
  recordRead,
  serializeResults,
  RESULT_TURN_CHARS,
  TURN_CHARS,
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

test('el turno con resultados tiene más presupuesto que el de razonamiento', () => {
  // Con el mismo tope, el corte caía en la línea 38 de un fichero de 63: el
  // modelo recibía la cabecera, no el cuerpo y volvía a leerlo.
  assert.ok(RESULT_TURN_CHARS > TURN_CHARS, 'un fs.read cabe donde un turno de razonamiento no');
  assert.ok(RESULT_TURN_CHARS >= 3000, 'debe caber entero un fichero de ~3 KB');
});

test('recordRead fusiona rangos contiguos y solapados y guarda el total', () => {
  const index = createReadIndex();
  recordRead(index, 'a.ts', 40, 80, 120);
  recordRead(index, 'a.ts', 1, 39, 120); // contiguo: 39+1 = 40
  recordRead(index, 'a.ts', 70, 90, 120); // solapa con el primero

  assert.deepEqual(index.get('a.ts')!.ranges, [{ start: 1, end: 90 }]);
  assert.equal(index.get('a.ts')!.totalLines, 120);
});

test('recordRead deja separados los huecos e ignora lecturas sin ruta', () => {
  const index = createReadIndex();
  recordRead(index, '', 1, 10, 0);
  recordRead(index, 'b.ts', 1, 10, 50);
  recordRead(index, 'b.ts', 20, 30, 50);

  assert.equal(index.size, 1, 'sin ruta no hay entrada');
  assert.deepEqual(index.get('b.ts')!.ranges, [
    { start: 1, end: 10 },
    { start: 20, end: 30 },
  ]);
});

test('formatReadIndex calla si no hay lecturas y lista rangos si las hay', () => {
  assert.equal(formatReadIndex(createReadIndex()), '', 'sin lecturas no añade un turno vacío');

  const index = createReadIndex();
  recordRead(index, 'a.ts', 5, 5, 5);
  recordRead(index, 'b.ts', 1, 10, 42);
  const out = formatReadIndex(index);

  assert.match(out, /^ARCHIVOS LEÍDOS/);
  assert.match(out, /a\.ts \(total 5 líneas\): 5$/m, 'un rango de una línea se escribe sin guion');
  assert.match(out, /b\.ts \(total 42 líneas\): 1-10$/m);
});

test('compactTurns conserva el outline de lecturas aunque no quepa nada más', () => {
  const index = createReadIndex();
  recordRead(index, 'validador.ts', 1, 63, 63);

  const largo = Array.from({ length: 30 }, (_, i) => ({ role: 'model', text: `t${i}-` + 'w'.repeat(1990) }));
  const out = compactTurns(largo, { maxChars: 12_000, keepRecent: 6, readIndex: index });
  assert.match(out[0].text, /ARCHIVOS LEÍDOS/, 'el outline va primero');
  assert.match(out[0].text, /validador\.ts \(total 63 líneas\)/);

  const corto = compactTurns([{ role: 'model', text: 'a' }], { readIndex: index });
  assert.match(corto[0].text, /validador\.ts/, 'también sin compactar hay outline');
});

test('formatStepDigest resume los pasos sin repetir su contenido', () => {
  assert.equal(formatStepDigest([]), '(sin pasos todavía)');

  const steps = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    toolId: 'fs.read',
    status: 'done',
    title: `leer archivo ${i}`,
  }));
  const out = formatStepDigest(steps, 3);

  assert.equal(out.split('\n').length, 3, 'sólo los últimos N');
  assert.match(out, /^#18 fs\.read done — leer archivo 17$/m);
  assert.match(out, /^#20 fs\.read done — leer archivo 19$/m);
});
