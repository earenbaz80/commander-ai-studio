/**
 * Registro de subagentes (sesiones hijas) para la UI.
 *
 * Las sesiones hijas se borran del registro de `AgentSession` al terminar (si se
 * quedaran, el tope de sesiones acabaría desalojando a la padre), pero el
 * cliente necesita verlas mientras corren y saber cómo acabaron. Este registro
 * es aparte, pequeño y acotado: guarda el objetivo, el estado y el resultado
 * final de cada subagente lanzado desde una sesión padre.
 *
 * No ejecuta nada ni habla con el LLM: sólo anota lo que `executeTask` ya sabe.
 */

export type SubAgentStatus = 'running' | 'completed' | 'failed';

export interface SubAgentRecord {
  id: string;
  parentSessionId: string;
  goal: string;
  model: string;
  status: SubAgentStatus;
  startedAt: number;
  endedAt?: number;
  /** Respuesta final del subagente (sólo si terminó bien). */
  answer?: string;
  error?: string;
  /** Pasos que alcanzó a dar, para distinguir «falló al arrancar» de «casi». */
  steps: number;
}

/** Tope global: son datos de observabilidad, no historial. */
export const MAX_SUB_AGENT_RECORDS = 50;

const records = new Map<string, SubAgentRecord>();

/**
 * Suscriptores por sesión padre (el endpoint SSE).
 *
 * Se notifica con la lista completa en vez de con un delta: son pocas filas y
 * así el cliente no puede quedarse con un estado incoherente si pierde un
 * evento.
 */
type SubAgentListener = (rows: SubAgentRecord[], opts?: { final?: boolean }) => void;
const listeners = new Map<string, Set<SubAgentListener>>();

function notify(parentSessionId: string, final = false): void {
  const set = listeners.get(parentSessionId);
  if (!set || set.size === 0) return;
  const rows = listSubAgents(parentSessionId);
  for (const fn of set) {
    try { fn(rows, final ? { final } : undefined); } catch { /* suscriptor roto */ }
  }
}

/**
 * Escucha los cambios de los hijos de una sesión padre.
 *
 * Devuelve la función para darse de baja: sin ella, cada pestaña cerrada
 * dejaría un listener escribiendo en un socket muerto.
 */
export function subscribeSubAgents(parentSessionId: string, fn: SubAgentListener): () => void {
  let set = listeners.get(parentSessionId);
  if (!set) { set = new Set(); listeners.set(parentSessionId, set); }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(parentSessionId);
  };
}

/**
 * Acota el registro. Primero se van los terminados más viejos, que ya nadie
 * mira; si todos siguen corriendo, se va el más antiguo igualmente para que el
 * proceso no crezca sin límite.
 */
function trim(): void {
  while (records.size > MAX_SUB_AGENT_RECORDS) {
    let victim: SubAgentRecord | null = null;
    for (const r of records.values()) {
      if (!victim) { victim = r; continue; }
      const victimDone = victim.status !== 'running';
      const rDone = r.status !== 'running';
      if (rDone && !victimDone) victim = r;
      else if (rDone === victimDone && r.startedAt < victim.startedAt) victim = r;
    }
    if (!victim) return;
    records.delete(victim.id);
  }
}

export function startSubAgent(input: { id: string; parentSessionId: string; goal: string; model: string }): SubAgentRecord {
  const record: SubAgentRecord = {
    id: input.id,
    parentSessionId: input.parentSessionId,
    goal: input.goal,
    model: input.model,
    status: 'running',
    startedAt: Date.now(),
    steps: 0,
  };
  records.set(record.id, record);
  trim();
  notify(record.parentSessionId);
  return record;
}

/** Cierra un subagente con su resultado. Idempotente: el primero gana. */
export function finishSubAgent(
  id: string,
  patch: { ok: boolean; answer?: string; error?: string; steps?: number }
): void {
  const record = records.get(id);
  if (!record || record.status !== 'running') return;
  record.status = patch.ok ? 'completed' : 'failed';
  record.endedAt = Date.now();
  record.answer = patch.ok ? patch.answer : undefined;
  record.error = patch.ok ? undefined : patch.error;
  if (typeof patch.steps === 'number') record.steps = patch.steps;
  notify(record.parentSessionId);
}

/** Subagentes de una sesión padre, del más reciente al más antiguo. */
export function listSubAgents(parentSessionId: string): SubAgentRecord[] {
  return Array.from(records.values())
    .filter((r) => r.parentSessionId === parentSessionId)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Al borrar la sesión padre se van sus hijos: ya no hay dónde mostrarlos.
 *
 * El último aviso va marcado como `final` para que quien esté escuchando (el
 * endpoint SSE) cierre la respuesta: si no, el panel se quedaría «en vivo» sin
 * nada que llegue nunca más. Después se sueltan los suscriptores, porque esa
 * sesión ya no existe.
 */
export function clearSubAgents(parentSessionId: string): void {
  for (const [id, r] of records) {
    if (r.parentSessionId === parentSessionId) records.delete(id);
  }
  notify(parentSessionId, true);
  listeners.delete(parentSessionId);
}

/** Sólo para tests: deja el registro como recién arrancado. */
export function resetSubAgentsForTests(): void {
  records.clear();
}
