/**
 * Persistencia de la posición de Nono (asistente flotante).
 * Guarda la posición arrastrada para restaurarla tras recargar la página.
 */

export interface NonoPosition {
  x: number;
  y: number;
}

const NONO_POSITION_KEY = 'nono-position-v1';

/** Recupera la posición guardada, o null si no hay/está corrupta. */
export const loadNonoPosition = (): NonoPosition | null => {
  try {
    const raw = localStorage.getItem(NONO_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
    return null;
  } catch {
    // JSON corrupto o almacenamiento no disponible
    return null;
  }
};

/** Guarda la posición arrastrada (falla silenciosamente en modo privado). */
export const saveNonoPosition = (pos: NonoPosition): void => {
  try {
    localStorage.setItem(NONO_POSITION_KEY, JSON.stringify({ x: pos.x, y: pos.y }));
  } catch {
    // almacenamiento no disponible (modo privado) — ignorar
  }
};

/** Elimina la posición guardada (vuelta al anclaje original). */
export const clearNonoPosition = (): void => {
  try {
    localStorage.removeItem(NONO_POSITION_KEY);
  } catch {
    // ignorar
  }
};
