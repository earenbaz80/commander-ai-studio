/**
 * Stream reanudable de sesiones (F1-03).
 *
 * El buffer vive en memoria, por sesión, y conserva los últimos 1.000 eventos.
 * El cliente reconecta con `Last-Event-ID` (o `?after=`); si el cursor todavía
 * está en el buffer se reemiten sólo los eventos que faltan, y si ya fue
 * desalojado se manda un `resync` con el `SessionStateV2` completo.
 *
 * Los eventos se sellan con el mismo contrato v2 del CLI (`seq`, `sessionId`,
 * `schemaVersion`) y el `id` SSE es exactamente el `seq`.
 */
import {
  EventSequencer,
  encodeEvent,
  type CliEventPayload,
  type CliEventV2,
  type SessionStateV2,
  type SessionStatusV2,
} from './sessionTypes';

export const MAX_STREAM_EVENTS = 1_000;
export const DEFAULT_STREAM_KEEPALIVE_MS = 15_000;
/**
 * Tope de un frame SSE (§6.6). Un turno o una salida de tool enorme se difunde
 * completo a cada cliente conectado; arriba de esto el evento se **rechaza**
 * con `event: error` en vez de truncarlo en silencio. El `resync` entra en el
 * tope como cualquier otro frame: si el estado no cabe, el cliente se entera.
 * `COMMANDER_STREAM_EVENT_MAX_BYTES` lo baja en pruebas y despliegues
 * ajustados; por debajo de 1 KB se ignora.
 */
export const MAX_STREAM_EVENT_BYTES = 512 * 1024;
export const STREAM_EVENT_MAX_ENV = 'COMMANDER_STREAM_EVENT_MAX_BYTES';
export const STREAM_EVENT_TOO_LARGE = 'STREAM_EVENT_TOO_LARGE';

export function streamEventMaxBytes(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env[STREAM_EVENT_MAX_ENV]);
  return Number.isFinite(configured) && configured >= 1024
    ? Math.floor(configured)
    : MAX_STREAM_EVENT_BYTES;
}
/**
 * Sin eventos durante este lapso el stream se cierra solo (`end`, sin `gone`) y
 * el cliente reconecta con `Last-Event-ID`. Así un teléfono que se durmió deja
 * de ocupar un cupo de concurrencia sin que nadie lo cierre a mano.
 */
export const DEFAULT_STREAM_IDLE_MS = 10 * 60_000;

export type SessionGoneReason = 'completed' | 'failed' | 'cancelled' | 'deleted';

export interface StreamReplay {
  events: CliEventV2[];
  resync: boolean;
  reason: 'evicted' | 'ahead' | null;
}

/**
 * Buffer de eventos de una sesión.
 *
 * `lastSeq` sobrevive al recorte; por eso un cliente que pide un `seq` menor
 * que `firstSeq - 1` sabe que perdió eventos y debe resincronizar.
 */
export class SessionEventBuffer {
  private readonly sequencer: EventSequencer;
  private events: CliEventV2[] = [];
  private gone: SessionGoneReason | null = null;
  private readonly eventListeners = new Set<(event: CliEventV2) => void>();
  private readonly goneListeners = new Set<(reason: SessionGoneReason) => void>();

  constructor(readonly sessionId: string, startSeq = 0) {
    this.sequencer = new EventSequencer(sessionId, startSeq);
  }

  get lastSeq(): number {
    return this.sequencer.lastSeq;
  }

  get firstSeq(): number {
    return this.events[0]?.seq ?? 0;
  }

  get size(): number {
    return this.events.length;
  }

  get goneReason(): SessionGoneReason | null {
    return this.gone;
  }

  /** Publica un evento y lo reparte a los suscriptores vivos. */
  publish(payload: CliEventPayload): CliEventV2 | null {
    if (this.gone) return null;
    const event = this.sequencer.next(payload);
    this.events.push(event);
    if (this.events.length > MAX_STREAM_EVENTS) {
      this.events.splice(0, this.events.length - MAX_STREAM_EVENTS);
    }
    for (const listener of this.eventListeners) {
      try { listener(event); } catch { /* un cliente roto no corta a los demás */ }
    }
    return event;
  }

  /**
   * Eventos posteriores a `after` y, si el cursor ya no sirve, la señal para
   * mandar el estado completo en vez de fingir que no faltó nada.
   */
  replay(after: number): StreamReplay {
    const cursor = Number.isFinite(after) ? Math.max(0, Math.floor(after)) : 0;
    if (cursor > this.lastSeq) {
      return { events: [], resync: true, reason: 'ahead' };
    }
    const first = this.firstSeq;
    if (first > 0 && cursor < first - 1) {
      return { events: [], resync: true, reason: 'evicted' };
    }
    return {
      events: this.events.filter((event) => event.seq > cursor),
      resync: false,
      reason: null,
    };
  }

  subscribe(listener: (event: CliEventV2) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Avisa una sola vez del cierre; un suscriptor tardío lo recibe igual. */
  subscribeGone(listener: (reason: SessionGoneReason) => void): () => void {
    if (this.gone) {
      listener(this.gone);
      return () => {};
    }
    this.goneListeners.add(listener);
    return () => this.goneListeners.delete(listener);
  }

  markGone(reason: SessionGoneReason): void {
    if (this.gone) return;
    this.gone = reason;
    const listeners = [...this.goneListeners];
    this.goneListeners.clear();
    for (const listener of listeners) {
      try { listener(reason); } catch { /* el cierre de un cliente no frena al resto */ }
    }
    // El stream terminó: nadie más debe recibir eventos de esta corrida.
    this.eventListeners.clear();
  }

  /**
   * Reabre el buffer para un turno nuevo de una sesión que ya había cerrado.
   * El `seq` NO se reinicia: los consumidores que ya vieron la sesión siguen
   * teniendo un orden monotónico.
   */
  reopen(): void {
    this.gone = null;
  }
}

export interface SessionStreamSource {
  readonly id: string;
  toState(): SessionStateV2;
  getEventBuffer(): SessionEventBuffer;
}

export interface SessionStreamSink {
  write(chunk: string): unknown;
  end(): unknown;
  readonly writableEnded?: boolean;
}

export interface AttachSessionStreamOptions {
  keepAliveMs?: number;
  /**
   * Cierra el stream si no hubo **eventos** en este lapso (el keep-alive no
   * cuenta como actividad). `0` lo desactiva.
   */
  idleMs?: number;
  /** Tope de un frame de evento; por defecto, `streamEventMaxBytes()`. */
  maxEventBytes?: number;
}

function frameEvent(event: CliEventV2): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${encodeEvent(event)}\n\n`;
}

function frameResync(state: SessionStateV2, seq: number): string {
  return `id: ${seq}\nevent: resync\ndata: ${JSON.stringify(state)}\n\n`;
}

function frameGone(sessionId: string, reason: SessionGoneReason, seq: number): string {
  return `id: ${seq}\nevent: gone\ndata: ${JSON.stringify({ sessionId, reason })}\n\n`;
}

/**
 * Rechazo de un frame demasiado grande. Va **sin** `id` a propósito: el cursor
 * del cliente no puede avanzar sobre un evento que no recibió, y el `resync`
 * sigue siendo el camino para recuperar el estado.
 */
function frameEventRejected(eventType: string, bytes: number, max: number): string {
  return `event: error\ndata: ${JSON.stringify({
    code: STREAM_EVENT_TOO_LARGE,
    event: eventType,
    bytes,
    max,
  })}\n\n`;
}

function terminalReason(status: SessionStatusV2): SessionGoneReason | null {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return null;
}

function hasHistory(state: SessionStateV2): boolean {
  return state.steps.length > 0 || state.turns.length > 0 || state.status !== 'idle';
}

/** Keep-alive de 15 s; configurable sólo para pruebas de integración. */
export function streamKeepAliveMs(): number {
  const configured = Number(process.env.COMMANDER_STREAM_KEEPALIVE_MS);
  return Number.isFinite(configured) && configured >= 50
    ? Math.floor(configured)
    : DEFAULT_STREAM_KEEPALIVE_MS;
}

/** Ventana de inactividad; `0` la desactiva (sólo para pruebas). */
export function streamIdleMs(): number {
  const configured = Number(process.env.COMMANDER_STREAM_IDLE_MS);
  return Number.isFinite(configured) && configured >= 0
    ? Math.floor(configured)
    : DEFAULT_STREAM_IDLE_MS;
}

/**
 * Escribe el stream en una respuesta ya abierta y devuelve el cleanup.
 *
 * El cleanup sólo desuscribe y apaga el keep-alive: desconectar al cliente no
 * detiene la corrida del servidor.
 */
export function attachSessionStream(
  source: SessionStreamSource,
  after: number,
  res: SessionStreamSink,
  options: AttachSessionStreamOptions = {}
): () => void {
  const buffer = source.getEventBuffer();
  const state = source.toState();
  const replay = buffer.replay(after);
  // Una sesión cargada de disco no tiene buffer en memoria: el primer cliente
  // necesita el estado completo aunque pida `after=0`.
  const restored = buffer.lastSeq === 0 && hasHistory(state);
  const resync = replay.resync || restored || after > buffer.lastSeq;

  let closed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeEvent: (() => void) | null = null;
  let unsubscribeGone: (() => void) | null = null;
  let lastEventAt = Date.now();
  let lastKeepAliveAt = lastEventAt;
  /** Escrituras seguidas con el buffer lleno: el cliente dejó de leer. */
  let stalled = 0;
  const maxEventBytes = options.maxEventBytes ?? streamEventMaxBytes();

  const cleanup = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    unsubscribeEvent?.();
    unsubscribeEvent = null;
    unsubscribeGone?.();
    unsubscribeGone = null;
  };

  /**
   * Cierra sin anunciar `gone`: la sesión sigue viva y el cliente reconecta con
   * `Last-Event-ID`. Es la salida del corte por inactividad y por consumidor
   * lento; `finish` queda para las sesiones que terminaron de verdad.
   */
  const closeQuietly = () => {
    if (closed) return;
    closed = true;
    cleanup();
    try {
      if (!res.writableEnded) res.end();
    } catch {
      /* ya cerrado */
    }
  };

  /** Bytes UTF-8 del frame, sin depender de `Buffer` (esto también corre en el server). */
  const frameBytes = (frame: string): number => new TextEncoder().encode(frame).length;

  /**
   * Escribe un frame y vigila la presión del socket (`write` === false).
   * `eventType` sólo llega en frames de evento: ahí se aplica el tope por frame
   * y, si no cabe, se rechaza con `event: error` en vez de truncarlo.
   */
  const send = (frame: string, eventType?: string): void => {
    if (closed) return;
    let payload = frame;
    if (eventType) {
      const bytes = frameBytes(frame);
      if (bytes > maxEventBytes) payload = frameEventRejected(eventType, bytes, maxEventBytes);
    }
    let drained: unknown;
    try {
      drained = res.write(payload);
    } catch {
      closeQuietly();
      return;
    }
    if (eventType) lastEventAt = Date.now();
    stalled = drained === false ? stalled + 1 : 0;
    if (stalled >= 2) closeQuietly();
  };

  const finish = (reason: SessionGoneReason) => {
    if (closed) return;
    closed = true;
    try {
      res.write(frameGone(source.id, reason, buffer.lastSeq));
    } catch {
      /* el socket ya no está */
    }
    cleanup();
    try {
      if (!res.writableEnded) res.end();
    } catch {
      /* ya cerrado */
    }
  };

  if (resync) {
    send(frameResync(state, buffer.lastSeq), 'resync');
  } else {
    for (const event of replay.events) send(frameEvent(event), event.type);
  }

  const gone = buffer.goneReason ?? terminalReason(state.status);
  if (gone) {
    finish(gone);
    return cleanup;
  }

  unsubscribeEvent = buffer.subscribe((event) => send(frameEvent(event), event.type));
  unsubscribeGone = buffer.subscribeGone(finish);

  const idleMs = options.idleMs ?? streamIdleMs();
  const keepAliveMs = options.keepAliveMs ?? streamKeepAliveMs();
  // Un solo timer para las dos cosas: despierta lo necesario para revisar la
  // inactividad y manda el keep-alive cuando toca.
  const tickMs = Math.max(25, idleMs > 0 ? Math.min(keepAliveMs, idleMs) : keepAliveMs);
  timer = setInterval(() => {
    if (closed) return;
    const now = Date.now();
    if (idleMs > 0 && now - lastEventAt >= idleMs) {
      closeQuietly();
      return;
    }
    if (now - lastKeepAliveAt < keepAliveMs) return;
    lastKeepAliveAt = now;
    try {
      res.write(': keep-alive\n\n');
    } catch {
      closeQuietly();
    }
  }, tickMs);
  // No mantener el proceso del servidor vivo sólo por un stream ocioso.
  (timer as unknown as { unref?: () => void }).unref?.();

  return cleanup;
}

function firstCursorValue(value: unknown): string | number | undefined {
  if (Array.isArray(value)) return firstCursorValue(value[0]);
  if (typeof value === 'string' || typeof value === 'number') return value;
  return undefined;
}

/**
 * Lee el cursor de `?after=` o de `Last-Event-ID`.
 *
 * `null` significa cursor inválido (por ejemplo `-1` o `abc`); el endpoint
 * responde 400 antes de abrir el SSE.
 */
export function parseStreamCursor(query: unknown, header: unknown): number | null {
  const raw = firstCursorValue(query) ?? firstCursorValue(header);
  if (raw === undefined || raw === null || raw === '') return 0;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}
