/**
 * Empaqueta el CLI en un solo archivo (`cli-dist/commander.mjs`), el servidor
 * en otro (`cli-dist/server.mjs`) y la UI construida en `cli-dist/dist` (Vite
 * ya incluye `public/` ahí), para que `commander serve` funcione desde el
 * tarball.
 *
 * El `bin` del paquete apunta al CLI, así que `npm i -g` (o `npx`) instala un
 * ejecutable real sin `tsx` ni el árbol de fuentes. `serve` importa el bundle
 * del servidor por ruta, en vez de que esbuild lo inlinee en el CLI: así el
 * paquete instalado arranca sin depender del repo. Todo el JS se inlinea;
 * quedan fuera sólo los módulos que no se pueden empaquetar o que corresponden
 * a otra superficie: `node-pty` (dependencia de runtime, viaja en
 * `node_modules`) y `vite`/`playwright`, que se cargan con `import()` dinámico
 * desde `serve` (sólo en desarrollo) y la tool `browser`.
 *
 * El shebang ya viene de `bin/commander.ts` y esbuild lo deja en la primera
 * línea; el banner añade un `require` real para los paquetes CJS que esbuild
 * envuelve dentro de la salida ESM.
 */
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const OUT = 'cli-dist';
const DIST = 'dist';

// La UI es parte del contrato del tarball: `commander serve` la busca en
// `cli-dist/dist`. Sin este corte, `npm pack` seguía adelante y publicaba un
// paquete que instalaba pero servía 404. Se falla antes de generar bundles
// para no dejar un `cli-dist` a medias que parezca empaquetable.
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(
    `[build-cli] falta ${DIST}/index.html: el tarball quedaría sin UI. ` +
      'Corré `npm run build` antes de `npm run build:cli` o `npm pack`.'
  );
  process.exit(1);
}

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['playwright', 'node-pty', 'vite'],
  banner: {
    js: "import { createRequire as __cmdrCreateRequire } from 'module'; const require = __cmdrCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
};

await build({
  entryPoints: ['bin/commander.ts'],
  outfile: 'cli-dist/commander.mjs',
  ...shared,
});

await build({
  entryPoints: ['server.ts'],
  outfile: 'cli-dist/server.mjs',
  ...shared,
});

/**
 * Copia la UI construida a `cli-dist/dist`. Vite ya mete `public/` dentro de
 * `dist/`, así que no se copia aparte. El guard de arriba ya exigió
 * `dist/index.html`; el guardián `check:cli-package` corre `npm run build`
 * antes de empacar.
 */
function empaquetarAssets() {
  const destino = path.join(OUT, 'dist');
  // Restos de cuando `public/` se copiaba aparte: no deben viajar en el tarball.
  fs.rmSync(path.join(OUT, 'public'), { recursive: true, force: true });
  fs.rmSync(destino, { recursive: true, force: true });
  fs.cpSync(DIST, destino, { recursive: true });
  console.log(`[build-cli] assets: ${DIST}/ → ${OUT}/dist`);
}

empaquetarAssets();
