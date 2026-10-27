import { uid } from './id';

/**
 * Nombre de la pseudo-tool de plan. No vive en el registro: la intercepta
 * `AgentLoop.stepNative`, así que no viaja al backend ni pasa por aprobaciones.
 */
export const PLAN_TOOL = 'update_plan';

/** Tope de pasos: el plan se repite en cada prompt, no puede crecer sin límite. */
export const MAX_PLAN_ITEMS = 20;

const MAX_PLAN_TEXT = 160;

export interface PlanItem {
  id: string;
  text: string;
  done: boolean;
}

/**
 * Normaliza los `items` que manda el modelo en `update_plan`.
 *
 * Acepta la lista completa (como un TODO list) y también entradas parciales
 * `{ id, done }` que sólo cambian el estado de un paso ya conocido, para que el
 * modelo pueda marcar progreso sin repetir la descripción de cada paso.
 *
 * Descarta entradas sin texto ni id conocido, ignora ids repetidos y recorta a
 * MAX_PLAN_ITEMS. Si `raw` no es un array devuelve el plan actual intacto.
 */
export function normalizePlan(raw: unknown, current: PlanItem[] = []): PlanItem[] {
  if (!Array.isArray(raw)) return current;

  const known = new Map(current.map((item) => [item.id, item]));
  const out: PlanItem[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const text = typeof item.text === 'string' ? item.text.trim().slice(0, MAX_PLAN_TEXT) : '';
    const done = item.done === true;

    if (!text) {
      const prev = id ? known.get(id) : undefined;
      if (!prev || seen.has(prev.id)) continue;
      seen.add(prev.id);
      out.push({ ...prev, done });
      continue;
    }

    const key = id || uid('plan');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, text, done });
  }

  return out.slice(0, MAX_PLAN_ITEMS);
}
