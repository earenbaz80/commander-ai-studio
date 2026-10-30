/**
 * Store de subagentes del cliente (SSE).
 *
 * Se prueba con un `EventSource` falso: lo que importa es que abra una sola
 * conexión por sesión padre, que pinte cada lista que llega y que no deje
 * conexiones colgando al cambiar o cerrar la sesión. El estado tiene que seguir
 * actualizándose sin que el panel esté montado.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeSubAgentsSession,
  getSubAgentsConnectionSnapshot,
  getSubAgentsSnapshot,
  setSubAgentsSession,
  subscribeSubAgentsStore,
} from '../src/agent/subAgentsStream.js';

/**
 * Los `online`/`offline` se escuchan en `window`; un `EventTarget` sirve y deja
 * disparar los eventos desde Node sin navegador. Se crea una sola vez porque
 * el store engancha los listeners cuando abre la primera sesión.
 */
const ventana = new EventTarget();
(globalThis as any).window = ventana;

const navOriginal = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
/** `navigator` es de sólo lectura en Node: se sustituye con defineProperty. */
function setNavegador(onLine: boolean): void {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true });
}
function restaurarNavegador(): void {
  if (navOriginal) Object.defineProperty(globalThis, 'navigator', navOriginal);
  else delete (globalThis as any).navigator;
}

/**
 * `EventSource` no da el status HTTP del fallo, así que el store consulta el
 * endpoint JSON de subagentes. Aquí se responde 404 (sesión borrada) o un fallo
 * de red, sin tocar el servidor real.
 */
const fetchOriginal = globalThis.fetch;
function stubFetch(status: number | 'net-error'): { calls: string[] } {
  const calls: string[] = [];
  (globalThis as any).fetch = async (url: string) => {
    calls.push(String(url));
    if (status === 'net-error') throw new TypeError('sin red');
    return { status, ok: status < 400 } as Response;
  };
  return { calls };
}

async function waitFor(pred: () => boolean, ms: number): Promise<void> {
  const t0 = Date.now();
  while (!pred() && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  readyState = 0; // CONNECTING
  private listeners = new Map<string, ((ev: MessageEvent) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, fn: (ev: MessageEvent) => void): void {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  emit(name: string, payload: unknown): void {
    for (const fn of this.listeners.get(name) ?? []) {
      fn({ data: JSON.stringify(payload) } as MessageEvent);
    }
  }

  /** Simula el corte del stream con el `readyState` que dejaría el navegador. */
  fail(readyState: 0 | 2): void {
    this.readyState = readyState;
    for (const fn of this.listeners.get('error') ?? []) fn({} as MessageEvent);
  }

  open(): void {
    this.readyState = 1;
    for (const fn of this.listeners.get('open') ?? []) fn({} as MessageEvent);
  }
}

const row = (id: string, status: 'running' | 'completed' | 'failed', extra: Record<string, unknown> = {}) => ({
  id, parentSessionId: 'sess-1', goal: `tarea ${id}`, model: 'm', status, startedAt: 1, steps: 0, ...extra,
});

beforeEach(() => {
  closeSubAgentsSession();
  FakeEventSource.instances = [];
  (globalThis as any).EventSource = FakeEventSource;
  setNavegador(true);
});

afterEach(() => {
  // Un reintento pendiente dejaría timers vivos entre casos.
  closeSubAgentsSession();
  restaurarNavegador();
  (globalThis as any).fetch = fetchOriginal;
});

test('abre una sola conexión por sesión y pinta cada lista que llega', () => {
  setSubAgentsSession('sess-1');
  setSubAgentsSession('sess-1'); // idempotente

  assert.equal(FakeEventSource.instances.length, 1);
  assert.equal(FakeEventSource.instances[0].url, '/api/agent/sessions/sess-1/events');

  let notificaciones = 0;
  subscribeSubAgentsStore(() => { notificaciones += 1; });

  FakeEventSource.instances[0].emit('subagents', { subagents: [row('a', 'running'), row('b', 'completed', { answer: 'ok' })] });

  const rows = getSubAgentsSnapshot();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].answer, 'ok');
  assert.equal(notificaciones, 1);
});

test('el estado queda fresco aunque el panel no esté montado', () => {
  setSubAgentsSession('sess-1');
  FakeEventSource.instances[0].emit('subagents', { subagents: [row('a', 'completed', { answer: 'terminado' })] });

  // El panel se monta después: lee el snapshot ya actualizado, sin pedir nada.
  assert.equal(getSubAgentsSnapshot()[0].answer, 'terminado');
});

test('cambiar de sesión cierra la anterior y arranca limpio', () => {
  setSubAgentsSession('sess-1');
  FakeEventSource.instances[0].emit('subagents', { subagents: [row('a', 'running')] });
  assert.equal(getSubAgentsSnapshot().length, 1);

  setSubAgentsSession('sess-2');

  assert.equal(FakeEventSource.instances[0].closed, true);
  assert.equal(FakeEventSource.instances.length, 2);
  assert.equal(FakeEventSource.instances[1].url, '/api/agent/sessions/sess-2/events');
  assert.deepEqual(getSubAgentsSnapshot(), [], 'no se mezclan hijos de otra sesión');
});

test('cerrar la sesión corta el stream y vacía el estado', () => {
  setSubAgentsSession('sess-1');
  FakeEventSource.instances[0].emit('subagents', { subagents: [row('a', 'running')] });

  closeSubAgentsSession();

  assert.equal(FakeEventSource.instances[0].closed, true);
  assert.deepEqual(getSubAgentsSnapshot(), []);

  // Un evento tardío del socket viejo no vuelve a pintar filas.
  FakeEventSource.instances[0].emit('subagents', { subagents: [row('b', 'running')] });
  assert.deepEqual(getSubAgentsSnapshot(), []);
});

test('sin EventSource disponible (Node/SSR) no revienta', () => {
  (globalThis as any).EventSource = undefined;

  setSubAgentsSession('sess-1');

  assert.deepEqual(getSubAgentsSnapshot(), []);
  assert.equal(FakeEventSource.instances.length, 0);
});

test('el estado de la conexión sigue al socket', () => {
  setSubAgentsSession('sess-1');
  assert.equal(getSubAgentsConnectionSnapshot().state, 'connecting');

  FakeEventSource.instances[0].open();
  assert.equal(getSubAgentsConnectionSnapshot().state, 'live');

  // Corte corriente: el navegador reintenta solo, pero el panel ya lo sabe.
  FakeEventSource.instances[0].fail(0);
  assert.equal(getSubAgentsConnectionSnapshot().state, 'reconnecting');

  FakeEventSource.instances[0].open();
  assert.equal(getSubAgentsConnectionSnapshot().state, 'live');
});

test('al volver la red reabre el stream en el acto, sin esperar el backoff', () => {
  setSubAgentsSession('sess-1');
  FakeEventSource.instances[0].open();
  FakeEventSource.instances[0].fail(0);

  ventana.dispatchEvent(new Event('online'));

  assert.equal(FakeEventSource.instances[0].closed, true, 'el socket muerto se cierra');
  assert.equal(FakeEventSource.instances.length, 2, 'se abre uno nuevo de inmediato');
  assert.equal(FakeEventSource.instances[1].url, '/api/agent/sessions/sess-1/events');
  assert.equal(getSubAgentsConnectionSnapshot().state, 'reconnecting');

  // Al conectar, llega el estado completo y el panel vuelve a estar en vivo.
  FakeEventSource.instances[1].open();
  FakeEventSource.instances[1].emit('subagents', { subagents: [row('a', 'completed', { answer: 'al día' })] });
  assert.equal(getSubAgentsConnectionSnapshot().state, 'live');
  assert.equal(getSubAgentsSnapshot()[0].answer, 'al día');
});

test('sin red no abre el stream y lo dice', () => {
  setNavegador(false);

  setSubAgentsSession('sess-1');

  assert.equal(FakeEventSource.instances.length, 0);
  assert.equal(getSubAgentsConnectionSnapshot().state, 'offline');
});

test('si EventSource se rinde por un fallo del servidor, reintenta por su cuenta', async () => {
  const { calls } = stubFetch(500);
  setSubAgentsSession('sess-1');
  // CLOSED = el navegador no vuelve a intentarlo (respuesta que no es SSE).
  FakeEventSource.instances[0].fail(2);
  assert.equal(getSubAgentsConnectionSnapshot().state, 'reconnecting');

  await waitFor(() => FakeEventSource.instances.length === 2, 3000);

  assert.equal(calls[0], '/api/agent/sessions/sess-1/subagents', 'pregunta si la sesión existe');
  assert.equal(FakeEventSource.instances.length, 2, 'abre una conexión nueva tras el backoff');
  assert.equal(getSubAgentsConnectionSnapshot().state, 'reconnecting');
});

test('el aviso `gone` del servidor cierra el stream y no reconecta', () => {
  setSubAgentsSession('sess-1');
  FakeEventSource.instances[0].emit('subagents', { subagents: [row('a', 'running')] });

  FakeEventSource.instances[0].emit('gone', {});

  // Cerrar el socket es lo que evita que `EventSource` vuelva a conectar solo.
  assert.equal(FakeEventSource.instances[0].closed, true);
  assert.equal(getSubAgentsConnectionSnapshot().state, 'ended');
  assert.deepEqual(getSubAgentsSnapshot(), []);
});

test('si la sesión padre ya no existe (404) deja de reintentar', async () => {
  const { calls } = stubFetch(404);
  setSubAgentsSession('sess-1');
  FakeEventSource.instances[0].emit('subagents', { subagents: [row('a', 'running')] });

  FakeEventSource.instances[0].fail(2);
  await waitFor(() => getSubAgentsConnectionSnapshot().state === 'ended', 1000);

  assert.equal(calls.length, 1, 'una sola comprobación');
  assert.equal(getSubAgentsConnectionSnapshot().state, 'ended');
  assert.deepEqual(getSubAgentsSnapshot(), [], 'no queda estado de una sesión que ya no existe');

  // Ni el backoff ni la vuelta de la red insisten contra una sesión borrada.
  await new Promise((r) => setTimeout(r, 1200));
  ventana.dispatchEvent(new Event('online'));
  assert.equal(FakeEventSource.instances.length, 1);
  assert.equal(getSubAgentsConnectionSnapshot().state, 'ended');
});
