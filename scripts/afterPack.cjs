/**
 * Recorta node-pty dentro del paquete de Electron.
 *
 * electron-builder copia el módulo entero (extraResources) y además lo
 * desempaqueta del asar, y en ambos sitios viajan los prebuilds de todas las
 * plataformas: win32-x64, win32-arm64, darwin-x64 y darwin-arm64. En un build
 * de Windows eso son ~28 MB de binarios que nunca se cargan.
 *
 * node-pty resuelve su binario con `prebuilds/<platform>-<arch>` (ver
 * lib/utils.js), así que basta con dejar la carpeta de la arquitectura que se
 * está empaquetando. Lo mismo con las consolas de conpty, que vienen por
 * duplicado para x64 y arm64.
 *
 * También se borra el fuente (src, deps, scripts): en tiempo de ejecución solo
 * hacen falta lib, package.json y los binarios.
 *
 * Hook de electron-builder: se ejecuta después de copiar la app y antes de
 * comprimir, así que lo que se borre aquí no llega al instalador.
 */

const fs = require('fs');
const path = require('path');

// Arch de electron-builder → nombre que usa node-pty.
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' };

// Carpetas que solo sirven para compilar desde el fuente.
const SOLO_FUENTE = ['src', 'deps', 'scripts', 'build', 'typings'];

function borrar(ruta) {
  fs.rmSync(ruta, { recursive: true, force: true });
}

/** Deja solo la carpeta `keep` dentro de `dir` (si existe). */
function soloDejar(dir, keep) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (entry !== keep) borrar(path.join(dir, entry));
  }
}

module.exports = async function afterPack(context) {
  const platform =
    context.electronPlatformName === 'darwin'
      ? 'darwin'
      : context.electronPlatformName === 'win32'
        ? 'win32'
        : 'linux';
  const arch = ARCH_NAMES[context.arch] || process.arch;

  // Linux se compila en el install (no hay prebuild): no se toca.
  const podar = platform === 'win32' || platform === 'darwin';

  const raices = [
    path.join(context.appOutDir, 'resources', 'node_modules', 'node-pty'),
    path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty'),
  ];

  let podados = 0;
  for (const raiz of raices) {
    if (!fs.existsSync(raiz)) continue;

    if (podar) {
      soloDejar(path.join(raiz, 'prebuilds'), `${platform}-${arch}`);

      const conpty = path.join(raiz, 'third_party', 'conpty');
      if (fs.existsSync(conpty)) {
        for (const version of fs.readdirSync(conpty)) {
          soloDejar(path.join(conpty, version), `win10-${arch}`);
        }
      }
    }

    for (const dir of SOLO_FUENTE) borrar(path.join(raiz, dir));
    borrar(path.join(raiz, 'README.md'));
    podados++;
  }

  console.log(`[afterPack] node-pty recortado a ${platform}-${arch} en ${podados} copia(s)`);
};
