import { uid } from './id';

/**
 * Nombre de la pseudo-tool de plan. No vive en el registro: la intercepta
 * `AgentLoop.stepNative`, así que no viaja al backend ni pasa por aprobaciones.
 */
export const PLAN_TOOL = 'update_plan';

/** Tope de pasos: el plan se repite en cada prompt, no puede crecer sin límite. */
export const MAX_PLAN_ITEMS = 20;

const MAX_PLAN_TEXT = 160;
const MAX_PLAN_FILES = 20;
const MAX_FILE_LEN = 300;
const MAX_CRITERIA = 500;

export type PlanStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

const PLAN_STATUSES: PlanStatus[] = ['pending', 'in_progress', 'done', 'blocked'];

export interface PlanItem {
  id: string;
  text: string;
  status: PlanStatus;
  /** Archivos que toca el paso (opcional). */
  files?: string[];
  /** Criterio de aceptación del paso (opcional). */
  criteria?: string;
  /** Derivado de `status`; se conserva para consumidores antiguos. */
  done: boolean;
}

/** Plan anterior a F1-13 (`done` sin `status`) u otro consumidor compatible. */
export interface PlanItemLike {
  id: string;
  text: string;
  status?: PlanStatus;
  files?: string[];
  criteria?: string;
  done?: boolean;
}

/** Glifo del plan para la TUI y el REPL. `blocked` nunca es un check. */
export function planGlyph(status: PlanStatus): string {
  if (status === 'done') return '✔';
  if (status === 'in_progress') return '▸';
  if (status === 'blocked') return '!';
  return '☐';
}

/** Normaliza un estado suelto; acepta el antiguo `done` booleano. */
export function planStatusOf(value: unknown, done?: unknown): PlanStatus | null {
  if (typeof value === 'string' && PLAN_STATUSES.includes(value as PlanStatus)) {
    return value as PlanStatus;
  }
  if (done === true) return 'done';
  if (done === false) return 'pending';
  return null;
}

function normalizeFiles(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const files = [...new Set(
    raw
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().slice(0, MAX_FILE_LEN))
      .filter(Boolean)
  )].slice(0, MAX_PLAN_FILES);
  return files;
}

function buildItem(prev: PlanItemLike | undefined, entry: Record<string, unknown>): PlanItem | null {
  const rawId = typeof entry.id === 'string' ? entry.id.trim() : '';
  const rawText = typeof entry.text === 'string' ? entry.text.trim().slice(0, MAX_PLAN_TEXT) : '';
  const text = rawText || prev?.text || '';
  if (!text) return null;

  const status =
    planStatusOf(entry.status, entry.done) ?? planStatusOf(prev?.status, prev?.done) ?? 'pending';
  const files = normalizeFiles(entry.files) ?? prev?.files;
  const rawCriteria =
    typeof entry.criteria === 'string' ? entry.criteria.trim().slice(0, MAX_CRITERIA) : '';
  const criteria = rawCriteria || prev?.criteria;
  return {
    id: rawId || prev?.id || uid('plan'),
    text,
    status,
    done: status === 'done',
    ...(files && files.length > 0 ? { files } : {}),
    ...(criteria ? { criteria } : {}),
  };
}

/**
 * Normaliza los `items` que manda el modelo en `update_plan`.
 *
 * Acepta la lista completa (como un TODO list) y también entradas parciales
 * `{ id, status }` o `{ id, done }` que sólo cambian el estado de un paso ya
 * conocido, sin repetir el texto. Las entradas nuevas sin `status` nacen
 * `pending`; las parciales conservan archivos y criterios si no los reenvían.
 * Descarta entradas sin texto ni id conocido, ignora ids repetidos y recorta a
 * MAX_PLAN_ITEMS. Si `raw` no es un array devuelve el plan actual intacto.
 */
export function normalizePlan(raw: unknown, current: PlanItemLike[] = []): PlanItem[] {
  if (!Array.isArray(raw)) {
    // Un plan inválido no borra el actual, pero sí se devuelve con la forma
    // completa (status + done) para que el estado persistido sea homogéneo.
    return current
      .map((item) => buildItem(undefined, item as unknown as Record<string, unknown>))
      .filter((item): item is PlanItem => item !== null);
  }

  const known = new Map(current.map((item) => [item.id, item]));
  const out: PlanItem[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const rawId = typeof item.id === 'string' ? item.id.trim() : '';
    const hasText = typeof item.text === 'string' && item.text.trim().length > 0;
    const prev = rawId ? known.get(rawId) : undefined;
    if (!hasText && !prev) continue;

    const built = buildItem(prev, item);
    if (!built || seen.has(built.id)) continue;
    seen.add(built.id);
    out.push(built);
  }

  return out.slice(0, MAX_PLAN_ITEMS);
}
