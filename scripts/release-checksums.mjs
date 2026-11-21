#!/usr/bin/env node
/**
 * Genera `SHA256SUMS-<plataforma>.txt` para los artefactos que el workflow de
 * release sube al GitHub Release.
 *
 * Uso: `node scripts/release-checksums.mjs [directorio] [etiqueta]`
 * Por defecto lee `release/` y etiqueta según `process.platform`.
 *
 * Sólo hashea las extensiones que el workflow publica: añadir una extensión
 * nueva al upload exige añadirla acá, y viceversa. El archivo de checksums no
 * se incluye a sí mismo.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ETIQUETAS = { win32: 'windows', darwin: 'macos', linux: 'linux' };
const EXTENSIONES = new Set(['.exe', '.dmg', '.appimage', '.deb', '.rpm', '.yml']);

const directorio = path.resolve(process.argv[2] ?? 'release');
const etiqueta = (process.argv[3] ?? ETIQUETAS[process.platform] ?? process.platform).toLowerCase();
const salida = path.join(directorio, `SHA256SUMS-${etiqueta}.txt`);

let entradas;
try {
  entradas = await readdir(directorio, { withFileTypes: true });
} catch {
  console.error(`[release-checksums] no pude leer ${directorio}`);
  process.exit(1);
}

const artefactos = entradas
  .filter((entrada) => entrada.isFile() && EXTENSIONES.has(path.extname(entrada.name).toLowerCase()))
  .map((entrada) => entrada.name)
  .sort();

if (artefactos.length === 0) {
  console.error(`[release-checksums] no hay artefactos publicables en ${directorio}`);
  process.exit(1);
}

const lineas = [];
for (const nombre of artefactos) {
  const hash = await new Promise((resolve, reject) => {
    const calculo = createHash('sha256');
    createReadStream(path.join(directorio, nombre))
      .on('error', reject)
      .on('data', (bloque) => calculo.update(bloque))
      .on('end', () => resolve(calculo.digest('hex')));
  });
  lineas.push(`${hash}  ${nombre}`);
}

await writeFile(salida, `${lineas.join('\n')}\n`, 'utf8');
console.log(`[release-checksums] ${artefactos.length} artefacto(s) → ${salida}`);
