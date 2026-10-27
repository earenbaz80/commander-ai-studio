import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PIPELINE_SEGMENTS,
  segmentBinary,
  splitPipeline,
} from '../src/agent/shellCommand.js';
import { shellJobTool, shellRunTool } from '../src/agent/tools/shell.js';

test('separa un pipeline en etapas', () => {
  const res = splitPipeline('rg foo src | head -20 | sort');

  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.segments, ['rg foo src', 'head -20', 'sort']);
});

test('un comando sin pipes es una sola etapa', () => {
  const res = splitPipeline('  npm list  ');

  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.segments, ['npm list']);
});

test('rechaza encadenamiento, redirecciones y sustituciones', () => {
  const peligrosos = [
    'echo a; echo b',
    'echo a && echo b',
    'echo a || echo b',
    'echo a & echo b',
    'echo a > archivo',
    'echo a < archivo',
    'echo $(whoami)',
    'echo ${HOME}',
    'echo `whoami`',
    'echo %PATH%',
    'echo ^hola',
    'echo a\nrm -rf /',
  ];

  for (const command of peligrosos) {
    const res = splitPipeline(command);
    assert.equal(res.ok, false, `debe rechazar: ${command}`);
  }
});

test('rechaza etapas vacías', () => {
  assert.equal(splitPipeline('echo a |  | head').ok, false);
  assert.equal(splitPipeline('| head').ok, false);
  assert.equal(splitPipeline('echo a |').ok, false);
});

test('rechaza comando vacío y demasiado largo', () => {
  assert.equal(splitPipeline('').ok, false);
  assert.equal(splitPipeline('   ').ok, false);
  assert.equal(splitPipeline(`echo ${'x'.repeat(2100)}`).ok, false);
});

test('limita el número de etapas', () => {
  const justo = Array.from({ length: MAX_PIPELINE_SEGMENTS }, () => 'echo a').join(' | ');
  assert.equal(splitPipeline(justo).ok, true);

  const deMas = Array.from({ length: MAX_PIPELINE_SEGMENTS + 1 }, () => 'echo a').join(' | ');
  assert.equal(splitPipeline(deMas).ok, false);
});

test('segmentBinary devuelve el ejecutable de la etapa', () => {
  assert.equal(segmentBinary('  rg foo src '), 'rg');
  assert.equal(segmentBinary(''), '');
});

test('un pipeline pide aprobación si alguna etapa la pediría', () => {
  const seguro = shellRunTool.requiresApproval({ command: 'npm list | head -5' } as any, {} as any);
  const inseguro = shellRunTool.requiresApproval({ command: 'echo a | sh' } as any, {} as any);
  const roto = shellRunTool.requiresApproval({ command: 'echo a; echo b' } as any, {} as any);

  assert.equal(seguro, false);
  assert.equal(inseguro, true);
  assert.equal(roto, true, 'un comando inválido no se ejecuta sin revisión');
});

test('shell.job solo pide aprobación al parar un trabajo', () => {
  assert.equal(shellJobTool.requiresApproval({ action: 'list' } as any, {} as any), false);
  assert.equal(shellJobTool.requiresApproval({ action: 'logs', id: 'job-1' } as any, {} as any), false);
  assert.equal(shellJobTool.requiresApproval({ action: 'stop', id: 'job-1' } as any, {} as any), true);
});
