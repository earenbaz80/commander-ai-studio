/**
 * Diff del pedido de aprobación (CAL2, I2).
 *
 * El menú sólo pinta el hunk si el pedido trae `diff`; si esta reconstrucción se
 * rompe, nadie se entera: el prompt sigue funcionando y `approval.render.diffShown`
 * vuelve a salir siempre en `false`. Estos casos fijan ese contrato.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { approvalDiffFor } from '../../src/cli/approvalDiff.js';

const MATH =
  'export function average(values) {\n' +
  '  let total = 0;\n' +
  '  for (const value of values) total += value;\n' +
  '  return total / (values.length - 1);\n' +
  '}\n';

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-approval-diff-'));
  fs.writeFileSync(path.join(dir, 'math.mjs'), MATH);
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('diff del pedido de aprobación', () => {
  test('un fs.edit produce el hunk del cambio real', () => {
    const diff = approvalDiffFor(
      'fs.edit',
      {
        path: 'math.mjs',
        oldString: 'return total / (values.length - 1);',
        newString: 'return total / values.length;',
      },
      dir
    );

    assert.ok(diff, 'hay diff');
    assert.match(diff, /^--- a\/math\.mjs$/m);
    assert.match(diff, /^\+\+\+ b\/math\.mjs$/m);
    assert.match(diff, /^@@ -\d+,\d+ \+\d+,\d+ @@$/m);
    assert.match(diff, /^-  return total \/ \(values\.length - 1\);$/m);
    assert.match(diff, /^\+  return total \/ values\.length;$/m);
  });

  test('acepta la ruta absoluta y la rotula relativa', () => {
    const diff = approvalDiffFor(
      'fs.edit',
      {
        path: path.join(dir, 'math.mjs'),
        oldString: 'let total = 0;',
        newString: 'let sum = 0;',
      },
      dir
    );

    assert.ok(diff, 'hay diff');
    assert.match(diff, /^--- a\/math\.mjs$/m, 'no cuela la ruta absoluta en la cabecera');
  });

  test('un fs.write de archivo nuevo se pinta desde /dev/null', () => {
    const diff = approvalDiffFor('fs.write', { path: 'nuevo.mjs', content: 'export const x = 1;\n' }, dir);

    assert.ok(diff, 'hay diff');
    assert.match(diff, /^--- \/dev\/null$/m);
    assert.match(diff, /^\+\+\+ b\/nuevo\.mjs$/m);
    assert.match(diff, /^\+export const x = 1;$/m);
  });

  test('replacements vacío no produce diff', () => {
    assert.equal(approvalDiffFor('fs.edit', { path: 'math.mjs', replacements: [] }, dir), undefined);
  });

  test('un replacement mal formado no produce diff', () => {
    const diff = approvalDiffFor(
      'fs.edit',
      { path: 'math.mjs', replacements: [{ oldString: 'let total' }] },
      dir
    );

    assert.equal(diff, undefined, 'no se pinta medio cambio como si fuera el real');
  });

  test('un contenido idéntico no produce diff', () => {
    assert.equal(approvalDiffFor('fs.write', { path: 'math.mjs', content: MATH }, dir), undefined);
  });

  test('las tools que no escriben no producen diff', () => {
    assert.equal(approvalDiffFor('shell.run', { command: 'node --test math.test.mjs' }, dir), undefined);
  });

  test('un archivo por encima del tope no se lee ni produce diff', () => {
    const big = path.join(dir, 'grande.txt');
    fs.writeFileSync(big, 'a\n'.repeat(300_000)); // 600 KB, por encima de los 512 KB del tope

    // Si se leyera, el cambio daría un diff: sólo el tope puede devolver undefined.
    assert.equal(approvalDiffFor('fs.write', { path: 'grande.txt', content: 'x\n' }, dir), undefined);
  });

  test('una ruta fuera del workspace se pinta tal cual en la cabecera', () => {
    const fuera = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-approval-diff-fuera-'));
    try {
      fs.writeFileSync(path.join(fuera, 'nota.txt'), 'uno\ndos\n');
      const diff = approvalDiffFor(
        'fs.edit',
        { path: path.join(fuera, 'nota.txt'), oldString: 'dos', newString: 'dós' },
        dir
      );

      assert.ok(diff, 'hay diff');
      assert.ok(
        diff.includes(`--- a/${path.join(fuera, 'nota.txt').split(path.sep).join('/')}`),
        'no se inventa una ruta relativa: la cabecera lleva la ruta tal cual'
      );
    } finally {
      fs.rmSync(fuera, { recursive: true, force: true });
    }
  });
});
