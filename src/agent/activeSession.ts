import { closeSubAgentsSession, setSubAgentsSession } from './subAgentsStream';

/**
 * Sesión de agente activa (lado servidor).
 *
 * Los subagentes (`spawn_agents`) necesitan un `parentSessionId` que exista en
 * el registro del servidor: heredan de ahí modelo, cwd y límites. El modelo no
 * puede conocer ese id, así que la app lo resuelve aquí, igual que el root
 * activo en `activeProject.ts`.
 *
 * El registro es perezoso: empezar, restaurar o continuar una tarea sólo deja
 * anotados objetivo, cwd y modelo. La sesión se crea la primera vez que una tool
 * la pide, así que mirar una tarea restaurada no ensucia el registro del
 * servidor con sesiones que nadie va a usar. Crear la sesión NO arranca el bucle
 * del LLM (eso lo hace el cliente): sirve de contexto padre, sin gastar tokens
 * por duplicado.
 */

export interface TaskSessionInfo {
  taskId: string;
  goal: string;
  cwd: string;
  model?: string;
}

let activeSessionId = '';
let currentTask: TaskSessionInfo | null = null;
/** Tarea cuya sesión ya confirmó el servidor: evita un POST por cada tool. */
let registeredTaskId = '';
let inflight: { taskId: string; promise: Promise<string> } | null = null;

export function setActiveSessionId(id: string): void {
  activeSessionId = id || '';
}

export function getActiveSessionId(): string {
  return activeSessionId;
}

/**
 * Anota la tarea en curso sin hablar con el servidor.
 *
 * Restaurar y luego continuar son dos gestos seguidos sobre la misma tarea:
 * ambos llaman aquí y no se duplica nada porque no hay petición.
 */
export function rememberTask(info: TaskSessionInfo | null): void {
  currentTask = info && info.taskId ? info : null;
}

export function getRememberedTask(): TaskSessionInfo | null {
  return currentTask;
}

export interface RegisterSessionInput {
  goal: string;
  cwd: string;
  model?: string;
  maxSteps?: number;
}

/**
 * Registra la sesión padre en el servidor y recuerda su id.
 *
 * Si falla, deja el id vacío en vez de conservar el de la tarea anterior: un id
 * viejo apuntaría a una sesión de otro objetivo y los subagentes heredarían el
 * cwd y el modelo equivocados.
 */
export async function registerServerSession(input: RegisterSessionInput): Promise<string> {
  try {
    const res = await fetch('/api/agent/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body: any = await res.json().catch(() => ({}));
    const id = res.ok && body?.session?.id ? String(body.session.id) : '';
    setActiveSessionId(id);
    // El stream de subagentes vive atado a la sesión, no al panel: se abre aquí
    // para que haya estado fresco aunque la pestaña esté cerrada.
    if (id) setSubAgentsSession(id);
    else closeSubAgentsSession();
    return id;
  } catch {
    setActiveSessionId('');
    closeSubAgentsSession();
    return '';
  }
}

/**
 * Devuelve el id de sesión padre de la tarea recordada, registrándola si aún no
 * está. Sin tarea recordada devuelve `''`: el llamador decide qué hacer con eso.
 *
 * Deduplica por `taskId`, incluida la llamada en vuelo: dos tools que necesiten
 * el padre a la vez comparten un solo POST.
 */
export async function ensureServerSession(info?: TaskSessionInfo): Promise<string> {
  const task = info ?? currentTask;
  if (!task?.taskId) return '';
  if (registeredTaskId === task.taskId && activeSessionId) return activeSessionId;
  if (inflight && inflight.taskId === task.taskId) return inflight.promise;

  const promise = registerServerSession({ goal: task.goal, cwd: task.cwd, model: task.model })
    // Sólo se recuerda lo que el servidor confirmó: un fallo debe poder
    // reintentarse en la siguiente llamada de la misma tarea.
    .then((id) => {
      if (id) registeredTaskId = task.taskId;
      return id;
    })
    .finally(() => {
      if (inflight?.taskId === task.taskId) inflight = null;
    });
  inflight = { taskId: task.taskId, promise };
  return promise;
}

/** Olvida la tarea y su sesión (al parar o al cerrar la tarea). */
export function clearActiveSession(): void {
  activeSessionId = '';
  registeredTaskId = '';
  currentTask = null;
  closeSubAgentsSession();
}
