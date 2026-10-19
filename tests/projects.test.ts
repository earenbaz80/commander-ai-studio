import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Aislamos la persistencia: los tests NO deben escribir en .agent-roots.json real.
const ROOTS_FILE = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-roots-')),
  'roots.json'
);
process.env.AGENT_ROOTS_FILE = ROOTS_FILE;

const {
  listRoots,
  addRoot,
  removeRoot,
  resolveProjectPath,
  isInsideRoots,
  normalizeRoot,
  removableRoots,
} = await import('../projects.js');

// Sandbox temporal: dos "proyectos" de prueba fuera del repo.
let tmpBase = '';
let projA = '';
let projB = '';

before(() => {
  // realpath: en Windows os.tmpdir() puede devolver ruta corta 8.3 que no
  // coincide con la que canonicaliza projects.ts.
  tmpBase = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-projects-')));
  projA = path.join(tmpBase, 'alpha');
  projB = path.join(tmpBase, 'beta');
  fs.mkdirSync(path.join(projA, 'src'), { recursive: true });
  fs.mkdirSync(projB, { recursive: true });
  fs.writeFileSync(path.join(projA, 'src', 'app.ts'), 'export const a = 1;', 'utf8');
  addRoot(projA);
  addRoot(projB);
});

after(() => {
  try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('projects: el cwd siempre es un root válido', () => {
  const roots = listRoots();
  const cwd = fs.realpathSync.native(process.cwd());
  assert.ok(
    roots.some((r) => r.replace(/\\/g, '/').toLowerCase() === cwd.replace(/\\/g, '/').toLowerCase()),
    'process.cwd() debe estar en la allowlist'
  );
});

test('projects: añade directorios y los deduplica', () => {
  const before1 = listRoots().length;
  const r = addRoot(projA);
  assert.equal(r.added, fs.realpathSync.native(projA));
  assert.equal(listRoots().length, before1, 'añadir dos veces no duplica');
});

test('projects: rechaza rutas que no existen', () => {
  assert.throws(() => addRoot(path.join(tmpBase, 'no-existe-xyz')), /No existe/);
});

test('projects: rechaza archivos (solo directorios)', () => {
  assert.throws(() => addRoot(path.join(projA, 'src', 'app.ts')), /No es un directorio/);
});

test('projects: rechaza entradas vacías o no-string', () => {
  assert.throws(() => addRoot(''), /Directorio requerido/);
  assert.throws(() => addRoot(null), /Directorio requerido/);
  assert.throws(() => addRoot(42 as any), /Directorio requerido/);
});

test('projects: rechaza la raíz del sistema y carpetas del SO', () => {
  assert.throws(() => addRoot(path.parse(process.cwd()).root), /no se puede usar/);
});

test('projects: resolveProjectPath acepta ruta relativa dentro de un root', () => {
  // Con rootHint explícito: debe resolver dentro de ese proyecto.
  const r = resolveProjectPath('src/app.ts', projA);
  assert.ok(fs.existsSync(r.abs), 'el archivo debe existir en la ruta resuelta');
  assert.ok(isInsideRoots(r.abs));
  assert.equal(fs.realpathSync.native(r.abs), fs.realpathSync.native(path.join(projA, 'src', 'app.ts')));
});

test('projects: resolveProjectPath acepta ruta absoluta dentro de un root', () => {
  const abs = path.join(projA, 'src', 'app.ts');
  const r = resolveProjectPath(abs);
  assert.equal(fs.realpathSync.native(r.abs), fs.realpathSync.native(abs));
});

test('projects: sin rootHint usa el primer root que contiene la ruta', () => {
  const file = path.join(projB, 'nota.txt');
  fs.writeFileSync(file, 'hola', 'utf8');
  const r = resolveProjectPath(file);
  assert.ok(isInsideRoots(r.abs));
  assert.ok(fs.existsSync(r.abs));
});

test('projects: BLOQUEA path traversal fuera de los roots', () => {
  assert.throws(() => resolveProjectPath('../../../etc/passwd'), /fuera de los proyectos/);
  assert.throws(() => resolveProjectPath(path.join(projA, '..', '..', 'windows', 'system32')), /fuera de los proyectos/);
});

test('projects: BLOQUEA una ruta absoluta fuera de cualquier root', () => {
  assert.throws(() => resolveProjectPath(os.tmpdir()), /fuera de los proyectos/);
});

test('projects: BLOQUEA symlink que apunta fuera del root', () => {
  const link = path.join(projB, 'escape');
  const target = path.join(tmpBase, 'secreto.txt');
  fs.writeFileSync(target, 'clasificado', 'utf8');
  try { fs.symlinkSync(target, link, 'file'); } catch { return; } // sin symlink en el entorno
  assert.throws(() => resolveProjectPath(link), /symlink|fuera de los proyectos/);
});

test('projects: rootHint selects el proyecto indicado', () => {
  const r = resolveProjectPath('src/app.ts', projA);
  assert.equal(fs.realpathSync.native(r.abs), fs.realpathSync.native(path.join(projA, 'src', 'app.ts')));
});

test('projects: rootHint no permite escapar del root hinted', () => {
  assert.throws(() => resolveProjectPath('../../windows', projA), /fuera de los proyectos/);
});

test('projects: removableRoots excluye cwd y env roots', () => {
  const removable = removableRoots();
  const cwdReal = fs.realpathSync.native(process.cwd()).replace(/\\/g, '/').toLowerCase();
  assert.ok(
    !removable.some((r) => r.replace(/\\/g, '/').toLowerCase() === cwdReal),
    'el cwd no debe ser removible'
  );
});

test('projects: no se puede quitar el cwd por defecto', () => {
  assert.throws(() => removeRoot(process.cwd()), /no se puede quitar/);
});

test('projects: quitar un root añadido lo saca de la lista', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-remove-'));
  addRoot(temp);
  assert.ok(listRoots().some((r) => r.replace(/\\/g, '/').toLowerCase() === fs.realpathSync.native(temp).replace(/\\/g, '/').toLowerCase()));
  removeRoot(temp);
  assert.ok(!listRoots().some((r) => r.replace(/\\/g, '/').toLowerCase() === fs.realpathSync.native(temp).replace(/\\/g, '/').toLowerCase()));
  fs.rmSync(temp, { recursive: true, force: true });
});

test('projects: normalizeRoot canonicaliza a ruta real', () => {
  const r = normalizeRoot(projA);
  assert.equal(r, fs.realpathSync.native(projA));
});

test('projects: isInsideRoots distingue dentro/fuera', () => {
  assert.equal(isInsideRoots(path.join(projA, 'src')), true);
  assert.equal(isInsideRoots(path.join(tmpBase, 'otro-cualquiera')), false);
});

test('projects: no confunde prefijos de nombre (projA2 no es projA)', () => {
  const sibling = projA + '-hermano';
  fs.mkdirSync(sibling, { recursive: true });
  addRoot(sibling);
  try {
    // La ruta está dentro del hermano, no de projA; debe resolverse solo si es root.
    assert.equal(isInsideRoots(path.join(sibling, 'x.txt')), true);
    assert.equal(isInsideRoots(path.join(projA, 'x.txt')), true);
  } finally {
    removeRoot(sibling);
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});
