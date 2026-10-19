import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getIndex, listIndexedFiles, invalidateIndex, invalidateAll } from '../repoIndex.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdr-index-'));

function makeProject(name: string, files: Record<string, string>): string {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

before(() => {
  fs.mkdirSync(TMP, { recursive: true });
});

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('getIndex construye el índice y lo persiste en .commander/index.json', () => {
  const dir = makeProject('build', { 'a.txt': 'hola', 'src/b.ts': 'const x = 1;' });
  const idx = getIndex(dir);
  assert.equal(idx.version, 1);
  assert.equal(idx.files.length, 2);
  const a = idx.files.find((f) => f.path === 'a.txt');
  assert.ok(a);
  assert.equal(a!.size, 4);
  assert.ok(a!.hash.length > 0);
  assert.ok(a!.mtimeMs > 0);
  // El propio directorio .commander no se indexa.
  assert.ok(!idx.files.some((f) => f.path.startsWith('.commander')));
  // Persiste en disco.
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, '.commander', 'index.json'), 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.files.length, 2);
});

test('getIndex carga de disco tras "reinicio" (caché vacía) y reconcilia', () => {
  const dir = makeProject('restart', { 'a.txt': 'hola' });
  const first = getIndex(dir);
  assert.equal(first.files.length, 1);

  // Simula un reinicio: se pierde la caché en memoria, se lee de disco.
  invalidateAll();
  fs.writeFileSync(path.join(dir, 'b.txt'), 'nuevo', 'utf8');
  const second = getIndex(dir);
  assert.equal(second.files.length, 2);
  assert.ok(second.files.some((f) => f.path === 'b.txt'));
  // El archivo sin cambios conserva su hash (no se relee).
  assert.equal(
    second.files.find((f) => f.path === 'a.txt')!.hash,
    first.files.find((f) => f.path === 'a.txt')!.hash
  );
});

test('invalidateIndex fuerza la reconstrucción con el contenido nuevo', () => {
  const dir = makeProject('dirty', { 'a.txt': 'corto' });
  const before = getIndex(dir);
  const hashAntes = before.files.find((f) => f.path === 'a.txt')!.hash;

  // Cambia el contenido (distinto tamaño → se detecta aunque el mtime coincida).
  fs.writeFileSync(path.join(dir, 'a.txt'), 'contenido mucho más largo', 'utf8');

  // Sin invalidar: la caché devuelve el hash viejo.
  const cached = getIndex(dir);
  assert.equal(cached.files.find((f) => f.path === 'a.txt')!.hash, hashAntes);

  invalidateIndex(dir);
  const after = getIndex(dir);
  const entry = after.files.find((f) => f.path === 'a.txt')!;
  assert.notEqual(entry.hash, hashAntes);
  assert.equal(entry.size, Buffer.byteLength('contenido mucho más largo', 'utf8'));
});

test('listIndexedFiles devuelve las entradas del índice', () => {
  const dir = makeProject('list', { 'x.ts': '1', 'y.ts': '2' });
  const files = listIndexedFiles(dir);
  assert.equal(files.length, 2);
  assert.ok(files.every((f) => f.path && f.size >= 0 && f.hash));
});

test('getIndex con refresh reconstruye aunque haya caché', () => {
  const dir = makeProject('refresh', { 'a.txt': 'hola' });
  getIndex(dir);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'nuevo', 'utf8');
  const idx = getIndex(dir, { refresh: true });
  assert.equal(idx.files.length, 2);
});
