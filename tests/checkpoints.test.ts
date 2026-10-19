import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  snapshotPath,
  snapshotProject,
  listCheckpoints,
  restoreCheckpoint,
} from '../checkpoints.js';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-ckpt-'));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function fresh() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
}

test('snapshotPath guarda el estado previo y restore lo revierte', () => {
  fresh();
  fs.writeFileSync(path.join(ROOT, 'a.txt'), 'antes', 'utf8');

  const cp = snapshotPath(ROOT, 'a.txt', 'fs.write a.txt', 'fs.write');
  assert.equal(cp.files.length, 1);
  assert.equal(cp.files[0].existed, true);

  fs.writeFileSync(path.join(ROOT, 'a.txt'), 'despues', 'utf8');
  const r = restoreCheckpoint(ROOT, cp.id);
  assert.deepEqual(r.restored, ['a.txt']);
  assert.equal(fs.readFileSync(path.join(ROOT, 'a.txt'), 'utf8'), 'antes');
});

test('snapshotPath de un archivo nuevo se restaura eliminándolo', () => {
  fresh();
  const cp = snapshotPath(ROOT, 'nuevo.txt', 'fs.write nuevo.txt', 'fs.write');
  assert.equal(cp.files[0].existed, false);

  fs.writeFileSync(path.join(ROOT, 'nuevo.txt'), 'x', 'utf8');
  const r = restoreCheckpoint(ROOT, cp.id);
  assert.deepEqual(r.deleted, ['nuevo.txt']);
  assert.equal(fs.existsSync(path.join(ROOT, 'nuevo.txt')), false);
});

test('listCheckpoints ordena por fecha descendente', async () => {
  fresh();
  snapshotPath(ROOT, 'a.txt', 'uno');
  await new Promise((r) => setTimeout(r, 5));
  snapshotPath(ROOT, 'a.txt', 'dos');

  const list = listCheckpoints(ROOT);
  assert.equal(list.length, 2);
  assert.ok(list[0].ts >= list[1].ts);
});

test('snapshotProject captura el árbol y restore lo revierte', () => {
  fresh();
  fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'src', 'index.ts'), 'export const x = 1;', 'utf8');
  fs.writeFileSync(path.join(ROOT, 'README.md'), '# hola', 'utf8');

  const cp = snapshotProject(ROOT, 'manual');
  assert.ok(cp.files.length >= 2);

  fs.writeFileSync(path.join(ROOT, 'src', 'index.ts'), 'ROTO', 'utf8');
  const r = restoreCheckpoint(ROOT, cp.id);
  assert.ok(r.restored.includes('src/index.ts'));
  assert.equal(fs.readFileSync(path.join(ROOT, 'src', 'index.ts'), 'utf8'), 'export const x = 1;');
});

test('snapshotProject ignora node_modules y .commander', () => {
  fresh();
  fs.mkdirSync(path.join(ROOT, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'node_modules', 'dep', 'index.js'), 'x', 'utf8');
  fs.writeFileSync(path.join(ROOT, 'ok.txt'), 'ok', 'utf8');

  const cp = snapshotProject(ROOT, 'manual');
  const paths = cp.files.map((f) => f.path);
  assert.ok(paths.includes('ok.txt'));
  assert.ok(!paths.some((p) => p.startsWith('node_modules')));
});

test('restoreCheckpoint no escribe fuera del root a través de un enlace de directorio', () => {
  fresh();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-outside-'));
  const sub = path.join(ROOT, 'sub');
  try {
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'a.txt'), 'original', 'utf8');
    const cp = snapshotPath(ROOT, 'sub/a.txt', 'fs.write sub/a.txt', 'fs.write');

    // Tras el snapshot, 'sub' pasa a ser un enlace que apunta fuera del proyecto.
    fs.rmSync(sub, { recursive: true, force: true });
    fs.symlinkSync(outside, sub, process.platform === 'win32' ? 'junction' : 'dir');

    assert.throws(() => restoreCheckpoint(ROOT, cp.id), /fuera del proyecto/);
    assert.equal(fs.existsSync(path.join(outside, 'a.txt')), false, 'no debe escribir fuera del root');
  } finally {
    fs.rmSync(sub, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
