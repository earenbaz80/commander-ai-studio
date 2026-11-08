/** Utilidades pequeñas compartidas por la grabación y la vista de artifacts. */

export function newArtifactId(prefix = 'artifact'): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  if (cryptoObject?.randomUUID) return `${prefix}_${cryptoObject.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Reloj de reproducción. Con `tenths` se usa en comentarios para que dos
 * anotaciones cercanas no parezcan el mismo instante.
 */
export function formatMediaTime(ms: number, tenths = false): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  if (!tenths) return `${minutes}:${seconds}`;
  return `${minutes}:${seconds}.${Math.floor((safe % 1000) / 100)}`;
}
