/**
 * Comprueba la firma Authenticode de los instaladores de Windows.
 *
 * electron-builder no falla cuando no hay certificado: avisa con "no code
 * signing certificate configured, signing is skipped" y produce instaladores
 * sin firmar. Así, un tag podía publicar un .exe sin firmar sin que nadie lo
 * viera hasta que SmartScreen lo bloqueaba en la máquina del usuario.
 *
 * Este script convierte ese aviso en un fallo explícito.
 *
 * Uso:
 *   node scripts/check-signing.cjs [--dir release]           sólo informa
 *   node scripts/check-signing.cjs --require [--dir release] falla si hay alguno sin firmar
 *
 * Escape: SIGNING_OPTIONAL=1 permite seguir con un aviso (prerelease sin
 * certificado), nunca en silencio.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const requireSigning = args.includes('--require');
const dirArg = args.indexOf('--dir');
const dir = path.resolve(dirArg >= 0 && args[dirArg + 1] ? args[dirArg + 1] : 'release');

if (process.platform !== 'win32') {
  console.log('[firma] Authenticode sólo aplica a Windows; se omite.');
  process.exit(0);
}

if (!fs.existsSync(dir)) {
  console.error(`[firma] no existe el directorio ${dir}`);
  process.exit(requireSigning ? 1 : 0);
}

const exes = fs
  .readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith('.exe'))
  .map((f) => path.join(dir, f));

if (exes.length === 0) {
  console.error(`[firma] no hay .exe en ${dir}`);
  process.exit(requireSigning ? 1 : 0);
}

/** Get-AuthenticodeSignature no falla con un archivo sin firmar: devuelve NotSigned. */
function estado(exe) {
  const ruta = exe.replace(/'/g, "''");
  const salida = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${ruta}').Status`],
    { encoding: 'utf8' }
  ).trim();
  return salida || 'sin estado';
}

let sinFirma = 0;
for (const exe of exes) {
  const st = estado(exe);
  const ok = st === 'Valid';
  if (!ok) sinFirma++;
  console.log(`[firma] ${ok ? 'OK  ' : 'SIN '} ${path.basename(exe)} → ${st}`);
}

if (sinFirma === 0) {
  console.log('[firma] todos los instaladores están firmados.');
  process.exit(0);
}

if (!requireSigning) {
  console.log(`[firma] ${sinFirma} sin firmar (modo informativo; usa --require para bloquear).`);
  process.exit(0);
}

if (process.env.SIGNING_OPTIONAL === '1') {
  console.log('[firma] SIGNING_OPTIONAL=1: se continúa sin firma. No publicar como estable.');
  process.exit(0);
}

console.error(
  `[firma] ${sinFirma} instalador(es) sin firmar. Configura WIN_CERTIFICATE y ` +
    'WIN_CERTIFICATE_PASSWORD en el repo, o define SIGNING_OPTIONAL=1 para una prerelease.'
);
process.exit(1);
