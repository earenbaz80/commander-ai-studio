/**
 * Empaqueta el CLI en un solo archivo (`cli-dist/commander.mjs`).
 *
 * El `bin` del paquete apunta a ese archivo, así que `npm i -g` (o `npx`)
 * instala un ejecutable real sin `tsx` ni el árbol de fuentes. Todo el JS se
 * inlinea; quedan fuera sólo los módulos que no se pueden empaquetar o que
 * corresponden a otra superficie: `node-pty` (dependencia de runtime, viaja en
 * `node_modules`) y `vite`/`playwright`, que se cargan con `import()` dinámico
 * desde `serve` y la tool `browser`.
 *
 * El shebang ya viene de `bin/commander.ts` y esbuild lo deja en la primera
 * línea; el banner añade un `require` real para los paquetes CJS que esbuild
 * envuelve dentro de la salida ESM.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['bin/commander.ts'],
  outfile: 'cli-dist/commander.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['playwright', 'node-pty', 'vite'],
  banner: {
    js: "import { createRequire as __cmdrCreateRequire } from 'module'; const require = __cmdrCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});
