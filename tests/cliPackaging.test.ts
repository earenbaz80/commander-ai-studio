import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Empaquetado del CLI.
 *
 * El `bin` del paquete apunta a `cli-dist/commander.mjs`, un bundle que se
 * genera con `npm run build:cli` (y `prepack`). Sin estas piezas `npm i -g`
 * instalaba una carpeta sin ejecutable: sólo se podía correr con `npx tsx
 * bin/commander.ts` desde el repo.
 */
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const buildScript = fs.readFileSync('scripts/build-cli.mjs', 'utf8');
const entry = fs.readFileSync('bin/commander.ts', 'utf8');

test('el paquete declara el ejecutable `commander` y publica sólo el bundle', () => {
  assert.equal(pkg.bin?.commander, 'cli-dist/commander.mjs');
  assert.deepEqual(pkg.files, ['cli-dist']);
});

test('`prepack` construye el CLI antes de empaquetar', () => {
  assert.equal(pkg.scripts?.['build:cli'], 'node scripts/build-cli.mjs');
  assert.equal(pkg.scripts?.prepack, 'npm run build:cli');
});

test('`build:cli` falla claro sin `dist/index.html` y no deja un bundle sin UI', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-cli-sin-dist-'));
  try {
    // El script usa rutas relativas al cwd, así que un temporal sin `dist/`
    // reproduce el clon limpio sin tocar el `dist/` real del repo.
    const script = path.resolve('scripts/build-cli.mjs');
    const result = spawnSync(process.execPath, [script], {
      cwd: tmp,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1, `esperaba exit 1; stderr: ${result.stderr}`);
    assert.match(result.stderr, /falta dist\/index\.html/);
    assert.match(result.stderr, /npm run build/);
    assert.equal(
      fs.existsSync(path.join(tmp, 'cli-dist')),
      false,
      'no debe quedar `cli-dist` a medias cuando falta la UI'
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('el bundle conserva el shebang y añade un require real para los CJS', () => {
  assert.match(entry, /^#!\/usr\/bin\/env node/);
  assert.match(buildScript, /createRequire/);
  assert.match(buildScript, /format: 'esm'/);
  assert.match(buildScript, /outfile: 'cli-dist\/commander\.mjs'/);
});

test('los módulos que no se pueden empaquetar quedan externos', () => {
  for (const mod of ['node-pty', 'playwright', 'vite']) {
    assert.ok(buildScript.includes(`'${mod}'`), `${mod} debe quedar externo`);
  }
  // `vite` llega por vitest y sólo lo usa `serve --dev`; los otros dos se
  // instalan con el paquete y los necesita el propio CLI.
  for (const mod of ['node-pty', 'playwright']) {
    assert.match(pkg.dependencies?.[mod] ?? pkg.devDependencies?.[mod] ?? '', /\^?\d/,
      `${mod} debe estar declarado como dependencia`);
  }
});

test('`dependencies` sólo lleva lo que hace falta en runtime', () => {
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), ['node-pty']);
  assert.equal(pkg.private, undefined, 'el paquete se publica: sin private');
  assert.equal(pkg.scripts?.postinstall, undefined,
    'un postinstall viaja al consumidor y rompe `npm i -g`');
});

test('el guardián instala el tarball y corre `commander agent` contra el servidor falso', () => {
  const guard = fs.readFileSync('scripts/check-cli-package.mjs', 'utf8');
  const harness = fs.readFileSync('scripts/check-cli-agent-run.ts', 'utf8');
  assert.match(guard, /'install', '--prefix'/, 'instala el tarball en un prefijo temporal');
  assert.match(guard, /check-cli-agent-run\.ts/, 'delega la corrida real en el arnés');
  assert.match(harness, /startFakeAgentServer/, 'usa el servidor falso del repo');
  assert.match(harness, /'agent'/, 'invoca el subcomando agent');
  assert.match(harness, /type === 'done'/, 'exige el cierre del CLI');
  assert.match(harness, /run-tool/, 'exige que el CLI haya ejecutado una tool');
});
