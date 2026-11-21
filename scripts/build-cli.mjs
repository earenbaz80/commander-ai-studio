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
 * `dist/`, así que no se copia aparte. Si falta `dist/index.html` no se
 * empaqueta una UI vieja como si fuera actual: se borra la copia anterior y se
 * avisa. El guardián `check:cli-package` corre `npm run build` antes de empacar.
 */
function empaquetarAssets() {
  const destino = path.join(OUT, 'dist');
  // Restos de cuando `public/` se copiaba aparte: no deben viajar en el tarball.
  fs.rmSync(path.join(OUT, 'public'), { recursive: true, force: true });
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    fs.rmSync(destino, { recursive: true, force: true });
    console.warn(`[build-cli] falta ${DIST}/index.html: los assets no viajan (corré npm run build)`);
    return;
  }
  fs.rmSync(destino, { recursive: true, force: true });
  fs.cpSync(DIST, destino, { recursive: true });
  console.log(`[build-cli] assets: ${DIST}/ → ${OUT}/dist`);
}

empaquetarAssets();
