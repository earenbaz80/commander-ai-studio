import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
