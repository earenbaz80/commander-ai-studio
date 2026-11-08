import type { SubAgentRow } from '../agent/subAgentsStream';

/**
 * Los que están corriendo van primero y, dentro de cada grupo, el más reciente
 * arriba. El servidor manda la lista en orden de llegada, así que sin ordenar
 * un subagente terminado podía quedar por encima del que sigue trabajando.
 */
export function ordenarSubAgentes(rows: SubAgentRow[]): SubAgentRow[] {
  return [...rows].sort((a, b) => {
    const corrida = Number(b.status === 'running') - Number(a.status === 'running');
    if (corrida !== 0) return corrida;
    if (a.startedAt !== b.startedAt) return b.startedAt - a.startedAt;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Umbral de «posible atasco», configurable en Configuración. Cinco minutos es
 * holgado para una tarea normal y bastante menos que «me olvidé del panel».
 */
export const ATASCO_KEY = 'commander_subagents_stuck_minutes';
/** Configuración avisa por aquí para que el panel no necesite recargarse. */
export const PREFERENCIAS_EVENT = 'commander:prefs-changed';
const ATASCO_MINUTOS_POR_DEFECTO = 5;
const ATASCO_MINUTOS_MIN = 1;
const ATASCO_MINUTOS_MAX = 120;

/** Deja el valor en un rango usable: ni cero ni un número absurdo de horas. */
export function normalizarUmbralAtasco(minutos: number): number {
  if (!Number.isFinite(minutos)) return ATASCO_MINUTOS_POR_DEFECTO;
  return Math.min(ATASCO_MINUTOS_MAX, Math.max(ATASCO_MINUTOS_MIN, Math.round(minutos)));
}

/** Umbral vigente en localStorage; valor ausente o corrupto cae al de fábrica. */
export function leerUmbralAtasco(): number {
  if (typeof localStorage === 'undefined') return ATASCO_MINUTOS_POR_DEFECTO;
  try {
    const crudo = localStorage.getItem(ATASCO_KEY);
    if (crudo === null || crudo.trim() === '') return ATASCO_MINUTOS_POR_DEFECTO;
    const minutos = Number(crudo);
    if (!Number.isFinite(minutos) || minutos <= 0) return ATASCO_MINUTOS_POR_DEFECTO;
    return normalizarUmbralAtasco(minutos);
  } catch {
    return ATASCO_MINUTOS_POR_DEFECTO;
  }
}
