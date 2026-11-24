/**
 * Copia el CLI y el servidor ya construidos (`../cli-dist`) al árbol del VSIX,
 * junto con `node-pty` (el servidor lo importa al arrancar).
 *
 * Así un VS Code limpio no necesita `npx`, un `commander` global ni el repo:
 * `cli/commander.mjs` arranca el servidor y corre las tareas. El empaquetado
 * exige que antes se haya corrido, en la raíz:
 *
 *   npm run build && npm run build:cli
 *
 * `node-pty` trae binarios por plataforma; se copia sólo el de esta máquina.
 * Publicar un VSIX para otra plataforma exige empaquetar en ella (o copiar su
 * prebuild a mano), igual que hace electron-builder con `afterPack`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const REPO = path.resolve(EXTENSION, '..');
const SRC = path.join(REPO, 'cli-dist');
const DEST = path.join(EXTENSION, 'cli');
const NODE_PTY = path.join(REPO, 'node_modules', 'node-pty');
const PLATFORM = `${process.platform}-${process.arch}`;

function fail(message) {
  console.error(`[bundle-cli] ${message}`);
  process.exit(1);
}

function sizeOf(target) {
  let bytes = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    bytes += entry.isDirectory() ? sizeOf(full) : fs.statSync(full).size;
  }
  return bytes;
}

for (const required of ['commander.mjs', 'server.mjs', path.join('dist', 'index.html')]) {
  if (!fs.existsSync(path.join(SRC, required))) {
    fail(
      `falta cli-dist/${required}. Corré en la raíz: npm run build && npm run build:cli`
    );
  }
}
if (!fs.existsSync(path.join(NODE_PTY, 'package.json'))) {
  fail('falta node_modules/node-pty (npm install en la raíz)');
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

for (const file of ['commander.mjs', 'server.mjs']) {
  fs.copyFileSync(path.join(SRC, file), path.join(DEST, file));
}
fs.cpSync(path.join(SRC, 'dist'), path.join(DEST, 'dist'), { recursive: true });

const PTY_DEST = path.join(DEST, 'node_modules', 'node-pty');
fs.mkdirSync(PTY_DEST, { recursive: true });
for (const entry of ['package.json', 'LICENSE', 'lib', 'typings']) {
  const source = path.join(NODE_PTY, entry);
  if (!fs.existsSync(source)) continue;
  fs.cpSync(source, path.join(PTY_DEST, entry), { recursive: true });
}

const prebuild = path.join(NODE_PTY, 'prebuilds', PLATFORM);
if (fs.existsSync(prebuild)) {
  fs.cpSync(prebuild, path.join(PTY_DEST, 'prebuilds', PLATFORM), { recursive: true });
} else {
  console.warn(
    `[bundle-cli] node-pty no trae prebuild para ${PLATFORM}; el servidor puede fallar al abrir terminales`
  );
}

console.log(
  `[bundle-cli] ${path.relative(REPO, DEST)} listo: ${(sizeOf(DEST) / 1024 / 1024).toFixed(1)} MB ` +
    `(node-pty ${PLATFORM})`
);
