/**
 * Cliente SSE del stream de sesión para la PWA emparejada (`/pair/session`).
 *
 * El servidor (`src/agent/sessionStream.ts`) sella cada frame con el `seq` de la
 * sesión como `id` y manda `event: resync` con el `SessionStateV2` completo
 * cuando el cursor ya no está en el buffer. Acá se usa `fetch` en vez de
 * `EventSource` por una razón concreta: `EventSource` no permite mandar
 * `Last-Event-ID` a mano, y sin eso una reconexión perdería los eventos que
 * pasaron mientras la red estaba caída.
 *
 * Reglas:
 *
 * - El cursor vive en `lastEventId`: se actualiza con cada frame y viaja como
 *   `Last-Event-ID` en la siguiente conexión.
 * - Al cortarse la conexión (error, EOF o caída de red) se reintenta con backoff
 *   exponencial, respetando `Retry-After` si el servidor lo manda (por ejemplo
 *   el 429 del rate limit del stream).
 * - 401/403/404 son definitivos: el dispositivo ya no está autorizado o la
 *   sesión no existe, y reintentar sólo gastaría peticiones. El stream queda
 *   cerrado.
 * - `event: gone` cierra la sesión: no se reconecta.
 * - `retryMs: 0` deja un solo intento, para tests y embebidos.
 */

export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface PairStreamFrame {
  /** `seq` del evento, o `null` si el frame no traía `id`. */
  id: number | null;
  /** `resync`, `gone`, el tipo del evento, o `message` si no declaraba ninguno. */
  event: string;
  /** `data` parseado como JSON; el texto crudo si no era JSON; `null` si vacío. */
  data: unknown;
}

export type PairStreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export const PAIR_STREAM_RETRY_MS = 1_000;
export const PAIR_STREAM_MAX_RETRY_MS = 8_000;
/** Cierres que no tiene sentido reintentar. */
const TERMINAL_STATUS = new Set([401, 403, 404]);

/**
 * Un bloque SSE (lo que va entre dos `\n\n`) a frame.
 *
 * Ignora comentarios y keep-alives (`: keep-alive`), admite `data` en varias
 * líneas y devuelve `null` para un bloque sin datos ni evento propio.
 */
export function parseSseBlock(raw: string): PairStreamFrame | null {
  const data: string[] = [];
  let event = 'message';
  let id: number | null = null;

  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') {
      event = value || 'message';
    } else if (field === 'data') {
      data.push(value);
    } else if (field === 'id') {
      const seq = Number(value);
      id = Number.isSafeInteger(seq) && seq >= 0 ? seq : null;
    }
  }

  if (data.length === 0 && event === 'message') return null;
  const text = data.join('\n');
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { id, event, data: parsed };
}

export interface PairSessionStreamOptions {
  /** Ruta del stream; la pantalla la arma con el id de la sesión. */
  url: string;
  /** `fetch` inyectable (tests). */
  fetchImpl?: FetchLike;
  /** Base del backoff; `0` deja un solo intento. */
  retryMs?: number;
  maxRetryMs?: number;
  onFrame: (frame: PairStreamFrame) => void;
  onStatus?: (status: PairStreamStatus) => void;
  onError?: (error: unknown) => void;
}

export class PairSessionStream {
  /** Último `seq` visto: es el `Last-Event-ID` de la próxima conexión. */
  lastEventId: number | null = null;
  private closed = false;
  private attempt = 0;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: PairSessionStreamOptions) {}

  /** Abre la primera conexión. Llamarlo dos veces mientras corre no duplica. */
  start(): void {
    if (this.controller || this.timer) return;
    this.closed = false;
    void this.connect();
  }

  /** Corta la conexión y no vuelve a reintentar. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.controller?.abort();
    this.controller = null;
  }

  private status(next: PairStreamStatus): void {
    this.options.onStatus?.(next);
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    const controller = new AbortController();
    this.controller = controller;
    this.status(this.attempt === 0 ? 'connecting' : 'reconnecting');

    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(this.options.url, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'text/event-stream',
          ...(this.lastEventId !== null ? { 'Last-Event-ID': String(this.lastEventId) } : {}),
        },
      });
    } catch (error) {
      this.controller = null;
      if (!this.closed) this.retryLater(null, error);
      return;
    }

    if (this.closed) return;
    if (!response.ok || !response.body) {
      this.controller = null;
      if (TERMINAL_STATUS.has(response.status)) {
        this.closed = true;
        this.status('closed');
        this.options.onError?.(new Error(`stream ${response.status}`));
        return;
      }
      this.retryLater(response.headers?.get?.('Retry-After') ?? null);
      return;
    }

    this.attempt = 0;
    this.status('open');
    try {
      await this.read(response, controller.signal);
    } catch (error) {
      if (!this.closed) this.options.onError?.(error);
    } finally {
      this.controller = null;
    }
    if (!this.closed) this.retryLater();
  }

  private async read(response: Response, signal: AbortSignal): Promise<void> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!this.closed && !signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = this.drain(buffer);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* el socket ya no está */
      }
    }
  }

  /** Emite los bloques completos del buffer y devuelve lo que quedó a medias. */
  private drain(buffer: string): string {
    let rest = buffer;
    let index: number;
    while ((index = rest.indexOf('\n\n')) >= 0) {
      const block = rest.slice(0, index);
      rest = rest.slice(index + 2);
      const frame = parseSseBlock(block);
      if (!frame) continue;
      if (frame.id !== null) this.lastEventId = frame.id;
      this.options.onFrame(frame);
      if (frame.event === 'gone') {
        this.close();
        return '';
      }
    }
    return rest;
  }

  private retryLater(retryAfter: string | null = null, error?: unknown): void {
    if (error) this.options.onError?.(error);
    const base = this.options.retryMs ?? PAIR_STREAM_RETRY_MS;
    if (this.closed || base <= 0) {
      this.status('closed');
      return;
    }
    const max = this.options.maxRetryMs ?? PAIR_STREAM_MAX_RETRY_MS;
    const backoff = Math.min(base * 2 ** this.attempt, max);
    this.attempt += 1;
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds) && seconds > 0 ? Math.max(backoff, seconds * 1_000) : backoff;
    this.status('reconnecting');
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
  }
}
