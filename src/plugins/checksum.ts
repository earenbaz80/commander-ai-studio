/**
 * Checksum de los archivos de un plugin del catálogo.
 *
 * La huella cubre exactamente lo descargado (ruta relativa + texto), no el
 * manifiesto de instalación ni lo que el plugin copie al proyecto. Queda en
 * `.commander/plugins/<id>.manifest.json` para que la instalación sea revisable
 * y, si el catálogo publica una, se compara antes de escribir nada.
 */
import crypto from 'crypto';

/** Formato aceptado: `sha256:` y 64 hex en minúsculas. */
const PLUGIN_CHECKSUM_RE = /^sha256:[a-f0-9]{64}$/;

export interface PluginFileEntry {
  /** Ruta relativa dentro del plugin; se normaliza a `/`. */
  path: string;
  text: string;
}

export interface PluginChecksumCheck {
  /** Huella real de los archivos descargados. */
  checksum: string;
  /** `false` sólo si el catálogo publicó una huella distinta o inválida. */
  ok: boolean;
}

export function isPluginChecksum(value: unknown): value is string {
  return typeof value === 'string' && PLUGIN_CHECKSUM_RE.test(value.trim());
}

export function normalizePluginFilePath(value: string): string {
  return String(value).replace(/\\/g, '/').replace(/^\.?\//, '');
}

/**
 * SHA-256 determinista de los archivos, ordenados por ruta.
 *
 * Cada archivo aporta `ruta\0contenido\0`: renombrar un archivo cambia el hash
 * aunque el texto sea el mismo, y el orden de la lista no influye.
 */
export function pluginFilesChecksum(files: readonly PluginFileEntry[]): string {
  const hash = crypto.createHash('sha256');
  const sorted = [...files].sort((a, b) => {
    const left = normalizePluginFilePath(a.path);
    const right = normalizePluginFilePath(b.path);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (const file of sorted) {
    hash.update(normalizePluginFilePath(file.path));
    hash.update('\0');
    hash.update(file.text);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Compara la huella publicada por el catálogo con la descarga.
 *
 * Sin checksum declarado la instalación sigue: no todos los catálogos lo
 * publican. Con uno declarado, tiene que ser válido y coincidir.
 */
export function checkPluginChecksum(
  expected: unknown,
  files: readonly PluginFileEntry[],
): PluginChecksumCheck {
  const checksum = pluginFilesChecksum(files);
  if (expected === undefined || expected === null || expected === '') return { checksum, ok: true };
  return { checksum, ok: isPluginChecksum(expected) && expected.trim() === checksum };
}
