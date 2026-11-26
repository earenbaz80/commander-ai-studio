import * as http from 'http';
import * as https from 'https';

/**
 * Cliente de sesiones del servidor (`/api/agent/sessions`).
 *
 * Es el mismo motor que usa el escritorio: el bucle, las tools y los permisos
 * viven en el servidor. La extensión sólo crea la sesión, consume el SSE y
 * resuelve aprobaciones por HTTP. Sin `vscode` aquí: se puede probar con Node.
 */

export interface ApprovalRequestV2 {
  id: string;
  sessionId?: string;
  tool: string;
  input?: { path?: string } & Record<string, unknown>;
  diff?: string;
  hunks?: unknown[];
  createdAt?: number;
  expiresAt?: number;
}

export interface ToolResultRef {
  path: string;
  line?: number;
  column?: number;
  text?: string;
}

export interface SessionEvent {
  type: string;
  seq?: number;
  refs?: ToolResultRef[];
  text?: string;
  content?: string;
  status?: string;
  tool?: string;
  input?: unknown;
  ok?: boolean;
  summary?: string;
  approval?: ApprovalRequestV2;
  approvalId?: string;
  decision?: string;
  reason?: string;
  answer?: string;
  steps?: number;
  error?: string;
  [key: string]: unknown;
}

export interface SessionState {
  id: string;
  status?: string;
  answer?: string;
  error?: string;
  pendingApproval?: ApprovalRequestV2 | null;
  steps?: unknown[];
}

export interface SessionHandlers {
  onEvent(event: SessionEvent): void;
  onResync?(state: SessionState): void;
  onGone?(reason: string): void;
  onError?(message: string): void;
}

interface JsonResult {
  status: number;
  ok: boolean;
  json: Record<string, any>;
  error?: string;
}

function transport(url: URL): typeof http | typeof https {
  return url.protocol === 'https:' ? https : http;
}

function requestJson(
  baseUrl: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<JsonResult> {
  return new Promise((resolve) => {
    const url = new URL(path, baseUrl);
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = transport(url).request(
      url,
      {
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) }
          : undefined,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json: Record<string, any> = {};
          try {
            json = raw ? JSON.parse(raw) : {};
          } catch {
            json = {};
          }
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300 && json.success !== false,
            json,
            error: typeof json.error === 'string' ? json.error : undefined,
          });
        });
      }
    );
    req.on('error', (error) => {
      resolve({ status: 0, ok: false, json: {}, error: error.message });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

export interface CreateSessionOptions {
  cwd: string;
  model?: string;
  maxSteps?: number;
}

export class AgentSession {
  sessionId: string | undefined;

  private readonly baseUrl: string;
  private readonly handlers: SessionHandlers;
  private streamRequest: http.ClientRequest | undefined;
  private buffer = '';
  private seq = 0;
  private disposed = false;
  private gone = false;
  private streaming = false;

  constructor(baseUrl: string, handlers: SessionHandlers) {
    this.baseUrl = baseUrl;
    this.handlers = handlers;
  }

  /** Crea una sesión ejecutable y se engancha al stream. */
  async create(goal: string, options: CreateSessionOptions): Promise<string> {
    const model = (options.model ?? '').trim();
    const result = await requestJson(this.baseUrl, 'POST', '/api/agent/sessions', {
      goal,
      cwd: options.cwd,
      run: true,
      maxSteps: options.maxSteps ?? 25,
      ...(model ? { model } : {}),
    });
    const id = result.json?.session?.id;
    if (!result.ok || typeof id !== 'string') {
      throw new Error(result.error || `no se pudo crear la sesión (HTTP ${result.status})`);
    }
    this.sessionId = id;
    this.follow();
    return id;
  }

  /**
   * Se engancha a una sesión que ya existe (panel reabierto, VS Code
   * reiniciado): recupera el estado y reabre el SSE sólo si sigue corriendo.
   */
  async attach(id: string): Promise<SessionState> {
    const result = await requestJson(
      this.baseUrl,
      'GET',
      `/api/agent/sessions/${encodeURIComponent(id)}`
    );
    if (!result.ok) {
      throw new Error(result.error || `la sesión no existe (HTTP ${result.status})`);
    }
    this.sessionId = id;
    const state = (result.json.state ?? { id }) as SessionState;
    this.handlers.onResync?.(state);
    if (result.json.running || state.status === 'running') this.follow();
    return state;
  }

  /** Añade un turno a la sesión existente y la arranca. */
  async message(text: string): Promise<void> {
    if (!this.sessionId) throw new Error('la sesión no existe');
    const result = await requestJson(
      this.baseUrl,
      'POST',
      `/api/agent/sessions/${encodeURIComponent(this.sessionId)}/message`,
      { text }
    );
    if (!result.ok) {
      throw new Error(result.error || `la sesión no aceptó el turno (HTTP ${result.status})`);
    }
    // La corrida anterior cerró su SSE: hay que abrir uno nuevo para ver este
    // turno (mismo id, el servidor reabre el buffer sin reiniciar el `seq`).
    this.reconnectStream();
  }

  /** Resuelve una aprobación pendiente. Devuelve el error del servidor, si lo hay. */
  async decide(approvalId: string, decision: 'allow' | 'deny'): Promise<string | null> {
    if (!this.sessionId) return 'la sesión no existe';
    const result = await requestJson(
      this.baseUrl,
      'POST',
      `/api/agent/sessions/${encodeURIComponent(this.sessionId)}/approvals/${encodeURIComponent(approvalId)}`,
      { decision }
    );
    return result.ok ? null : result.error || `no se pudo resolver la aprobación (HTTP ${result.status})`;
  }

  async cancel(): Promise<void> {
    if (!this.sessionId) return;
    await requestJson(
      this.baseUrl,
      'POST',
      `/api/agent/sessions/${encodeURIComponent(this.sessionId)}/cancel`
    );
  }

  /** Abre el SSE desde el último `seq` conocido (el servidor reemite el buffer). */
  follow(): void {
    if (!this.sessionId || this.disposed || this.streaming) return;
    const url = new URL(
      `/api/agent/sessions/${encodeURIComponent(this.sessionId)}/stream?after=${this.seq}`,
      this.baseUrl
    );
    const req = transport(url).request(
      url,
      { method: 'GET', headers: { Accept: 'text/event-stream', Connection: 'keep-alive' } },
      (res) => {
        // Un stream que ya fue reemplazado no debe reportar ni entregar nada.
        if (this.streamRequest !== req) {
          res.resume();
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          this.streaming = false;
          this.handlers.onError?.(`el stream respondió HTTP ${res.statusCode ?? 0}`);
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => this.consume(chunk));
        res.on('end', () => {
          if (this.streamRequest !== req) return;
          this.streaming = false;
          if (!this.disposed && !this.gone) this.handlers.onError?.('el stream se cerró');
        });
      }
    );
    req.on('error', (error) => {
      if (this.streamRequest !== req) return;
      this.streaming = false;
      if (!this.disposed) this.handlers.onError?.(error.message);
    });
    this.streamRequest = req;
    this.streaming = true;
    // `http.request` no envía nada hasta `end()`: sin esto el SSE nunca abre.
    req.end();
  }

  /** Reemplaza el SSE actual por uno nuevo (turno posterior a un `gone`). */
  private reconnectStream(): void {
    this.streamRequest?.destroy();
    this.streamRequest = undefined;
    this.streaming = false;
    this.buffer = '';
    this.follow();
  }

  dispose(): void {
    this.disposed = true;
    this.streaming = false;
    this.streamRequest?.destroy();
    this.streamRequest = undefined;
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n\n');
    while (index !== -1) {
      const frame = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      this.handleFrame(frame);
      index = this.buffer.indexOf('\n\n');
    }
  }

  private handleFrame(frame: string): void {
    let eventName = 'message';
    let data = '';
    for (const rawLine of frame.split(/\r?\n/)) {
      if (rawLine.startsWith(':')) continue; // keep-alive
      const line = rawLine.trimEnd();
      if (line.startsWith('id:')) {
        const seq = Number(line.slice(3).trim());
        if (Number.isFinite(seq)) this.seq = Math.max(this.seq, seq);
      } else if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data += (data ? '\n' : '') + line.slice(5).trimStart();
      }
    }
    if (!data) return;

    let payload: any;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }

    if (eventName === 'resync') {
      this.handlers.onResync?.(payload as SessionState);
      return;
    }
    if (eventName === 'gone') {
      this.gone = true;
      this.handlers.onGone?.(String(payload?.reason ?? 'gone'));
      return;
    }
    this.handlers.onEvent(payload as SessionEvent);
  }
}
