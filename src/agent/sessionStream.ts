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
}

function writeEvent(res: SessionStreamSink, event: CliEventV2): void {
  res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${encodeEvent(event)}\n\n`);
}

function writeResync(res: SessionStreamSink, state: SessionStateV2, seq: number): void {
  res.write(`id: ${seq}\nevent: resync\ndata: ${JSON.stringify(state)}\n\n`);
}

function writeGone(
  res: SessionStreamSink,
  sessionId: string,
  reason: SessionGoneReason,
  seq: number
): void {
  res.write(
    `id: ${seq}\nevent: gone\ndata: ${JSON.stringify({ sessionId, reason })}\n\n`
  );
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

  const finish = (reason: SessionGoneReason) => {
    if (closed) return;
    closed = true;
    try {
      writeGone(res, source.id, reason, buffer.lastSeq);
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
    writeResync(res, state, buffer.lastSeq);
  } else {
    for (const event of replay.events) writeEvent(res, event);
  }

  const gone = buffer.goneReason ?? terminalReason(state.status);
  if (gone) {
    finish(gone);
    return cleanup;
  }

  unsubscribeEvent = buffer.subscribe((event) => {
    if (closed) return;
    try {
      writeEvent(res, event);
    } catch {
      cleanup();
    }
  });
  unsubscribeGone = buffer.subscribeGone(finish);

  timer = setInterval(() => {
    if (closed) return;
    try {
      res.write(': keep-alive\n\n');
    } catch {
      cleanup();
    }
  }, options.keepAliveMs ?? streamKeepAliveMs());
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
