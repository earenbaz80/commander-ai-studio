/**
 * Estado de los subagentes del servidor, vivo por SSE.
 *
 * Antes el panel los sondeaba cada 2 s y sólo mientras estaba montado: con la
 * pestaña cerrada no había nada actualizado, y al abrirla se veía el estado
 * viejo hasta el siguiente sondeo.
 *
 * Aquí se abre un único `EventSource` por sesión padre (se abre al registrar la
 * sesión, no al abrir el panel) y se guarda la última lista. El panel se
 * suscribe al store, así que al montarse pinta lo último que llegó y sigue al
 * día aunque haya estado cerrado.
 *
 * El stream también sabe si está caído. `EventSource` reintenta solo, pero su
 * backoff puede tardar decenas de segundos y no siempre avisa cuando la red
 * vuelve, así que:
 * - al volver la red (`online`) se reabre en el acto en vez de esperar;
 * - si `EventSource` se rinde del todo (respuesta 404/500, `readyState` CLOSED)
 *   reintentamos nosotros con backoff exponencial (1 s → 15 s);
 * - pero si la sesión padre ya no existe (404), no hay nada que reintentar: se
 *   marca `ended` y se deja de pedir. `EventSource` no dice el status HTTP, así
 *   que se comprueba con una consulta al endpoint JSON de subagentes;
 * - el panel recibe el estado de la conexión y lo muestra, para que un estado
 *   congelado no parezca un estado real.
 */

export interface SubAgentRow {
  id: string;
  goal: string;
  model: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  endedAt?: number;
  answer?: string;
  error?: string;
  steps: number;
}

export type SubAgentsConnectionState =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'offline'
  /** El servidor ya no conoce la sesión padre: reintentar no sirve. */
  | 'ended';

export interface SubAgentsConnection {
  /** Sesión padre a la que pertenece la conexión ('' si no hay ninguna). */
  sessionId: string;
  state: SubAgentsConnectionState;
}

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15000;

let rows: SubAgentRow[] = [];
let sessionId = '';
let source: EventSource | null = null;
let connection: SubAgentsConnection = { sessionId: '', state: 'idle' };
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = RETRY_BASE_MS;
let networkHooked = false;
const listeners = new Set<() => void>();

/** Referencia estable mientras no llegue un estado nuevo (useSyncExternalStore). */
export function getSubAgentsSnapshot(): SubAgentRow[] {
  return rows;
}

/** Referencia estable mientras no cambie el estado de la conexión. */
export function getSubAgentsConnectionSnapshot(): SubAgentsConnection {
  return connection;
}

export function subscribeSubAgentsStore(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* listener roto */ }
  }
}

function setRows(next: SubAgentRow[]): void {
  rows = next;
  emit();
}

function setConnection(state: SubAgentsConnectionState, id: string = sessionId): void {
  if (connection.sessionId === id && connection.state === state) return;
  connection = { sessionId: id, state };
  emit();
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function closeSource(): void {
  if (source) {
    try { source.close(); } catch { /* ya cerrado */ }
    source = null;
  }
}

function clearRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/**
 * `EventSource` no expone el status HTTP del fallo, así que se comprueba si la
 * sesión padre sigue existiendo con una consulta al endpoint JSON (404 = no).
 * Un error de red no concluye nada: se sigue reintentando.
 */
async function probeSessionGone(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/agent/sessions/${encodeURIComponent(id)}/subagents`);
    return res.status === 404;
  } catch {
    return false;
  }
}

/**
 * Reintento propio, sólo para cuando `EventSource` se ha rendido del todo: en
 * un corte de red corriente él solo reintenta (y ahí no hay que duplicar).
 */
function scheduleRetry(): void {
  if (!sessionId) return;
  clearRetry();
  const delay = retryDelay;
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!sessionId) return;
    // Sin red no tiene sentido abrir: el handler de `online` reabrirá.
    if (isOffline()) {
      setConnection('offline');
      return;
    }
    openSource();
  }, delay);
}

/**
 * La sesión padre ya no existe: se suelta todo y se deja de pedir. No se
 * reintenta, porque el 404 no se arregla esperando.
 */
function markEnded(): void {
  closeSource();
  clearRetry();
  retryDelay = RETRY_BASE_MS;
  sessionId = '';
  setRows([]);
  setConnection('ended');
}

function openSource(): void {
  if (!sessionId || typeof EventSource === 'undefined') return;
  closeSource();
  const es = new EventSource(`/api/agent/sessions/${encodeURIComponent(sessionId)}/events`);
  source = es;
  es.addEventListener('subagents', (ev: MessageEvent) => {
    // Un evento que llegue después de cambiar de sesión pertenece al socket
    // viejo: pintarlo mezclaría hijos de otra tarea.
    if (source !== es) return;
    try {
      const data = JSON.parse(String(ev.data));
      setRows(Array.isArray(data?.subagents) ? data.subagents : []);
    } catch { /* evento ilegible */ }
  });
  // El servidor avisa de que la sesión padre desapareció y cierra la respuesta.
  // Hay que soltar el socket a mano: si no, `EventSource` reconectaría.
  es.addEventListener('gone', () => {
    if (source !== es) return;
    markEnded();
  });
  es.addEventListener('open', () => {
    if (source !== es) return;
    retryDelay = RETRY_BASE_MS;
    setConnection('live');
  });
  es.addEventListener('error', () => {
    if (source !== es) return;
    const offline = isOffline();
    // CLOSED = el navegador no va a reintentar por su cuenta.
    if (es.readyState === 2) {
      source = null;
      if (offline) {
        setConnection('offline');
        return;
      }
      setConnection('reconnecting');
      // ¿Falló por red o porque la sesión ya no está? Sólo el servidor lo sabe.
      const owner = sessionId;
      void probeSessionGone(owner).then((gone) => {
        // Mientras se comprobaba pudo cambiar la sesión o reabrirse el stream.
        if (owner !== sessionId || source) return;
        if (gone) {
          markEnded();
          return;
        }
        scheduleRetry();
      });
      return;
    }
    setConnection(offline ? 'offline' : 'reconnecting');
  });
}

/**
 * Al volver la red no se espera al backoff de `EventSource`: se tira el socket
 * muerto y se abre otro. `EventTarget` de Node también sirve, así que los tests
 * pueden disparar el evento sin navegador.
 */
function hookNetwork(): void {
  if (networkHooked || typeof window === 'undefined') return;
  networkHooked = true;
  window.addEventListener('online', () => {
    if (!sessionId || typeof EventSource === 'undefined') return;
    clearRetry();
    retryDelay = RETRY_BASE_MS;
    closeSource();
    setConnection('reconnecting');
    openSource();
  });
  window.addEventListener('offline', () => {
    if (!sessionId) return;
    // Los reintentos programados fallarían igual: se retoman al volver la red.
    clearRetry();
    setConnection('offline');
  });
}

/**
 * Abre el stream de la sesión padre (o lo cierra con `''`).
 *
 * Es idempotente: registrar dos veces la misma sesión no abre dos conexiones.
 * `EventSource` no existe en Node (tests, SSR), así que sin él el store queda
 * vacío en vez de reventar.
 */
export function setSubAgentsSession(id: string): void {
  const next = id || '';
  // Un reintento pendiente también cuenta como «ya está abierto».
  if (next === sessionId && (source || retryTimer || !next)) return;

  closeSource();
  clearRetry();
  retryDelay = RETRY_BASE_MS;
  sessionId = next;
  setRows([]);

  if (!sessionId) {
    setConnection('idle');
    return;
  }
  hookNetwork();
  if (typeof EventSource === 'undefined') {
    setConnection('idle');
    return;
  }
  if (isOffline()) {
    setConnection('offline');
    return;
  }
  setConnection('connecting');
  openSource();
}

export function closeSubAgentsSession(): void {
  closeSource();
  clearRetry();
  retryDelay = RETRY_BASE_MS;
  sessionId = '';
  setRows([]);
  setConnection('idle');
}

/** Sólo para tests: inyecta el estado sin abrir conexión. */
export function setSubAgentsRowsForTests(next: SubAgentRow[]): void {
  setRows(next);
}
