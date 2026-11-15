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

export type SubAgentStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Una tool que el hijo llamó y cómo acabó.
 *
 * Existe porque la sesión hija se borra al terminar: sin esto, un «no informó
 * la denegación» no se puede distinguir de «no le pasó», que es justo lo que
 * necesita la medición de T10 (`G1-SUBAGENT-CLOSE`).
 */
export interface SubAgentCall {
  tool: string;
  /** `true` si la tool respondió bien, `false` si falló o la denegaron, `null` si no hubo resultado. */
  ok: boolean | null;
  /** Error o motivo tal como lo devolvió la tool (recortado). */
  error?: string;
}

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
  /** Tools llamadas y su resultado, en orden. Sale en `/subagents`. */
  calls?: SubAgentCall[];
  /** Títulos de los pasos del hijo, en orden. Sale en `/subagents`. */
  stepTitles?: string[];
}

/**
 * Títulos de los pasos de un hijo, para saber cómo cerró.
 *
 * `calls` dice si llamó tools; esto dice si hubo razonamiento antes de cerrar.
 * Un cierre con `[Razonamiento, Finalizado]` es un turno que decidió no llamar
 * nada; uno con sólo `[Finalizado]` es el turno vacío del proveedor, que sin
 * este dato se veía igual desde fuera.
 */
export function summarizeStepTitles(
  steps: Array<{ type?: string; title?: string; toolId?: string }>,
  max = 40
): string[] {
  const titles = steps.map((step) => String(step.title || step.toolId || step.type || 'paso'));
  return titles.length > max ? titles.slice(-max) : titles;
}

/**
 * Resume los pasos de un hijo en llamadas + resultado.
 *
 * Empareja cada `tool_result` con la última llamada pendiente de la misma tool,
 * que es como los emite el bucle: una llamada, un resultado. Una llamada sin
 * resultado (cancelada a mitad) queda con `ok:null` en vez de desaparecer.
 */
export function summarizeCalls(
  steps: Array<{ type?: string; toolId?: string; output?: unknown }>,
  max = 40
): SubAgentCall[] {
  const calls: SubAgentCall[] = [];
  for (const step of steps) {
    if (step.type === 'tool_call' && step.toolId) {
      calls.push({ tool: step.toolId, ok: null });
      continue;
    }
    if (step.type !== 'tool_result' || !step.toolId) continue;
    const output = (step.output ?? {}) as { ok?: unknown; error?: unknown };
    let tail = -1;
    for (let i = calls.length - 1; i >= 0; i -= 1) {
      if (calls[i].tool === step.toolId && calls[i].ok === null) { tail = i; break; }
    }
    const ok = output.ok !== false;
    const error = typeof output.error === 'string' && output.error !== '' ? output.error.slice(0, 300) : undefined;
    if (tail >= 0) {
      calls[tail] = { ...calls[tail], ok, ...(error ? { error } : {}) };
    } else {
      // Resultado sin llamada previa: se anota igual, no se descarta el dato.
      calls.push({ tool: step.toolId, ok, ...(error ? { error } : {}) });
    }
  }
  return calls.length > max ? calls.slice(-max) : calls;
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
  patch: { ok: boolean; answer?: string; error?: string; steps?: number; cancelled?: boolean; calls?: SubAgentCall[]; stepTitles?: string[] }
): void {
  const record = records.get(id);
  if (!record || record.status !== 'running') return;
  record.status = patch.cancelled ? 'cancelled' : patch.ok ? 'completed' : 'failed';
  record.endedAt = Date.now();
  record.answer = patch.ok ? patch.answer : undefined;
  record.error = patch.ok ? undefined : patch.error;
  if (typeof patch.steps === 'number') record.steps = patch.steps;
  if (patch.calls) record.calls = patch.calls;
  if (patch.stepTitles) record.stepTitles = patch.stepTitles;
  notify(record.parentSessionId);
}

/**
 * Marca como cancelados los hijos que sigan corriendo y devuelve sus ids.
 *
 * El registro se toca ANTES de pararlos: el cierre de cada hijo llega después
 * (con `ok:false`) y `finishSubAgent` ya no reescribe un estado terminado, así
 * que el panel no cambia de «cancelado» a «falló» a mitad de la cancelación.
 *
 * Quien llama es quien tiene las sesiones a mano (`stopSession`), porque este
 * módulo sólo anota lo que pasa y no ejecuta nada.
 */
export function cancelSubAgents(parentSessionId: string): string[] {
  const ids: string[] = [];
  for (const r of records.values()) {
    if (r.parentSessionId !== parentSessionId || r.status !== 'running') continue;
    r.status = 'cancelled';
    r.endedAt = Date.now();
    r.error = 'Cancelado por el usuario';
    ids.push(r.id);
  }
  if (ids.length > 0) notify(parentSessionId);
  return ids;
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
