/**
 * Diff de terminal (F1-05): hunks, números de línea, CRLF, archivo nuevo,
 * truncado explícito y `NO_COLOR`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUnifiedDiff,
  diffHunks,
  DIFF_MAX_LINES,
  renderDiff,
  renderHunk,
} from '../../src/cli/diff.js';
import { diffLines, mergeHunks } from '../../src/utils/patch.js';

const BASE = 'linea 1\nlinea 2\nlinea 3\nlinea 4\nlinea 5\nlinea 6\n';

describe('diff de terminal', () => {
  test('muestra cabeceras, signos y números de línea', () => {
    const diff = buildUnifiedDiff('nota.txt', BASE, BASE.replace('linea 3', 'linea TRES'));
    const view = renderDiff(diff);

    assert.match(view.lines[0]!, /^--- a\/nota\.txt$/);
    assert.match(view.lines[1]!, /^\+\+\+ b\/nota\.txt$/);
    assert.equal(view.hunks.length, 1);
    assert.equal(view.truncated, false);
    assert.ok(view.lines.some((line) => line.trimEnd().endsWith('-linea 3')), 'muestra la línea borrada');
    assert.ok(view.lines.some((line) => line.trimEnd().endsWith('+linea TRES')), 'muestra la añadida');
    assert.ok(
      view.lines.some((line) => /^\s*2\s+2\s+ linea 2$/.test(line)),
      'la línea de contexto lleva los dos números'
    );
  });

  test('un fs.edit de varias regiones produce hunks separados', () => {
    const before = Array.from({ length: 30 }, (_, i) => `linea ${i + 1}`).join('\n');
    const after = before.replace('linea 2', 'linea DOS').replace('linea 28', 'linea VEINTIOCHO');
    const diff = buildUnifiedDiff('app.ts', before, after);
    const view = renderDiff(diff);

    assert.equal(view.hunks.length, 2, 'dos regiones, dos hunks');
    assert.equal(view.lines.filter((line) => line.startsWith('@@')).length, 2);
    assert.match(view.hunks[0]!.header, /^@@ -1,5 \+1,5 @@/);
    assert.match(view.hunks[1]!.header, /^@@ -25,6 \+25,6 @@/);
    assert.ok(view.lines.some((line) => line.trimEnd().endsWith('+linea DOS')));
    assert.ok(view.lines.some((line) => line.trimEnd().endsWith('+linea VEINTIOCHO')));
  });

  test('tolera CRLF y un archivo nuevo', () => {
    const diff = buildUnifiedDiff('nuevo.ts', '', 'uno\r\ndos\r\n', { exists: false });
    assert.match(diff, /^--- \/dev\/null$/m);
    const view = renderDiff(diff);
    assert.ok(view.lines.every((line) => !line.includes('\r')));
    assert.ok(view.lines.some((line) => line.trimEnd().endsWith('+uno')));
    assert.ok(view.lines.some((line) => line.trimEnd().endsWith('+dos')));
  });

  test('el tope avisa del truncado y nunca finge estar completo', () => {
    const before = Array.from({ length: 40 }, (_, i) => `linea ${i + 1}`).join('\n');
    const after = before.replace('linea 3', 'linea TRES').replace('linea 35', 'linea TREINTA Y CINCO');
    const diff = buildUnifiedDiff('largo.ts', before, after);
    const completo = renderDiff(diff);
    const recortado = renderDiff(diff, { maxLines: 5 });

    assert.equal(recortado.truncated, true);
    assert.equal(recortado.lines.length, 6, 'cinco líneas más el aviso');
    assert.equal(recortado.omitted, completo.total - 5);
    const aviso = recortado.lines.at(-1)!;
    assert.match(aviso, /truncado en 5/);
    assert.match(aviso, /no está completo/);
    assert.notEqual(aviso, completo.lines.at(-1), 'no se hace pasar por el final real');
    assert.equal(DIFF_MAX_LINES, 400);
  });

  test('sin color no hay ANSI; con color sí', () => {
    const diff = buildUnifiedDiff('nota.txt', BASE, BASE.replace('linea 2', 'linea DOS'));
    const plano = renderDiff(diff, { color: false });
    const color = renderDiff(diff, { color: true });

    assert.equal(plano.lines.some((line) => line.includes('\x1b[')), false, 'NO_COLOR estable');
    assert.equal(color.lines.some((line) => line.includes('\x1b[')), true);
  });

  test('lo aprobado aplica exactamente el contenido mostrado', () => {
    const before = BASE;
    const after = `${BASE}linea 7\nlinea 8\n`.replace('linea 4', 'linea CUATRO');
    const result = diffLines(before, after, 3);
    const aplicado = mergeHunks(
      before,
      result.hunks,
      result.hunks.map((hunk) => hunk.id)
    );

    assert.equal(aplicado, after, 'aceptar todos los hunks reproduce el cambio');
    const view = renderDiff(buildUnifiedDiff('nota.txt', before, after));
    for (const esperada of ['+linea CUATRO', '+linea 7', '+linea 8']) {
      assert.ok(
        view.lines.some((line) => line.trimEnd().endsWith(esperada)),
        `el render muestra ${esperada}`
      );
    }
  });

  test('renderHunk y diffHunks cubren la tecla ?', () => {
    const before = Array.from({ length: 30 }, (_, i) => `linea ${i + 1}`).join('\n');
    const after = before.replace('linea 2', 'linea DOS').replace('linea 28', 'linea VEINTIOCHO');
    const diff = buildUnifiedDiff('app.ts', before, after);

    assert.equal(diffHunks(diff).length, 2);
    const segundo = renderHunk(diff, 1);
    assert.ok(segundo && segundo.some((line) => line.endsWith('+linea VEINTIOCHO')));
    assert.equal(renderHunk(diff, 7), null, 'un índice inexistente no inventa un hunk');
  });
});
