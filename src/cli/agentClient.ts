/**
 * Cliente headless del agente para el CLI (`commander agent`).
 *
 * No ejecuta las tools en el proceso del CLI: habla por HTTP con el servidor
 * embebido de Commander AI Studio (`npm run dev` o `commander serve`) y reutiliza
 * los mismos endpoints que la app:
 *
 *   • `GET  /api/health`              → disponibilidad del servidor.
 *   • `POST /api/{provider}/generate` → LLM con function calling nativo.
 *   • `POST /api/agent/run-tool`      → ejecución de tools en sandbox.
 *
 * El bucle es deliberadamente mínimo (scaffold): pensar → ejecutar tools →
 * repetir hasta que el modelo responda sin toolCalls o se alcance `maxSteps`.
 * La UI de terminal (colores, spinner, etc.) es responsabilidad del llamador
 * a través de `onEvent`.
 */
import { AGENT_FUNCTION_DECLARATIONS, mapFunctionCall } from '../agent/fnTools';
import { toOpenAITools, toolDialectForModel } from '../agent/providers';
import { PLAN_TOOL } from '../agent/plan';
import { resolveEndpoint, resolveStreamEndpoint } from '../lib/aiProviders';
import { GEMINI_DEFAULT_MODEL } from '../config/geminiModels';
import { uid } from '../agent/id';
import {
  EventSequencer,
  decodeEvent,
  type ApprovalDecision,
  type CliEventPayload,
  type CliEventV2,
  type SessionStateV2,
  type SessionStepV2,
  type SessionTurnV2,
} from '../agent/sessionTypes';

/**
 * Nombre heredado del contrato. A partir de F1-01 es el evento v2 completo
 * (`schemaVersion`, `seq` y `sessionId` incluidos); se conserva para no romper
 * a quien ya lo importaba.
 */
export type CliAgentEvent = CliEventV2;

export interface RunAgentOptions {
  /** URL base del servidor embebido (sin barra final). */
  serverUrl: string;
  /** Objetivo en lenguaje natural. */
  task: string;
  /** Raíz del proyecto sobre la que operan las tools. */
  cwd: string;
  /** Modelo ya prefijado (p. ej. `ollama/llama3`, o un id plano de Gemini). */
  model?: string;
  /** Máximo de pasos del bucle. */
  maxSteps?: number;
  /**
   * Emite el texto del modelo en vivo (SSE). Solo aplica a los modelos del
   * dialecto Gemini; el resto cae automáticamente a la llamada sin streaming.
   */
  stream?: boolean;
  /** Callback de progreso: eventos v2 con `seq` y `sessionId`. */
  onEvent?: (event: CliEventV2) => void;
  /** Id fijo de sesión; los tests y los goldens lo usan para ser deterministas. */
  sessionId?: string;
  /** Objetivo original de la sesión; en resume/fork `task` es el turno nuevo. */
  goal?: string;
  /** Estado persistido que se continúa (resume/fork). */
  resumeFrom?: SessionStateV2;
  /**
   * Crear una sesión en el servidor y sincronizar cada avance. Lo activa el CLI
   * en las corridas normales para que `--resume` tenga algo que continuar. Los
   * tests directos y el golden no lo activan: no tocan la red de sesiones.
   */
  persistSession?: boolean;
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Quita barras finales para componer URLs de forma segura. */
export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '');
}

/** Comprueba que el servidor responde en `/api/health`. */
export async function checkHealth(
  serverUrl: string
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(`${normalizeServerUrl(serverUrl)}/api/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { status?: string };
    return { ok: true, detail: data.status };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Ejecuta una tool del agente en el servidor. */
export async function runTool(
  serverUrl: string,
  toolId: string,
  input: unknown
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const res = await fetch(`${normalizeServerUrl(serverUrl)}/api/agent/run-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId, input }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String(data.error ?? `HTTP ${res.status}`) };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ruta de generación del servidor según el dialecto del modelo. */
function generateRoute(model: string): string {
  return resolveEndpoint(model);
}

/** Ruta SSE de streaming, o `null` si el modelo no la soporta. */
function streamRoute(model: string): string | null {
  return resolveStreamEndpoint(model);
}

/** Cuerpo común de la petición al LLM (compartido por streaming y no-streaming). */
function buildPayload(
  opts: RunAgentOptions,
  history: string[],
  dialect: ReturnType<typeof toolDialectForModel>
): Record<string, unknown> {
  const model = opts.model || GEMINI_DEFAULT_MODEL;
  const objective = opts.goal || opts.task;
  const user =
    `OBJETIVO: ${objective}\nCWD: ${opts.cwd}\n\n` +
    (history.length
      ? `HISTORIAL:\n${history.join('\n')}`
      : 'Aún no hay pasos. Empieza explorando el proyecto.');

  const systemInstruction =
    'Eres un agente autónomo de código. Razona brevemente y llama herramientas ' +
    `para avanzar hacia: ${objective}. Si el objetivo está cumplido, responde ` +
    'SOLO texto final sin llamar herramientas.';

  const payload: Record<string, unknown> = {
    contents: user,
    prompt: user,
    systemInstruction,
    model,
    temperature: 0.2,
    maxTokens: 2048,
  };
  // El CLI no pinta el plan y su bucle manda los nombres tal cual al backend:
  // no le ofrecemos `update_plan`, que aquí no existe como tool.
  const declarations = AGENT_FUNCTION_DECLARATIONS.filter(
    (d) => d.name !== PLAN_TOOL && d.name !== 'ask_user'
  );
  payload.tools =
    dialect === 'gemini'
      ? [{ functionDeclarations: declarations }]
      : toOpenAITools(declarations);
  return payload;
}

/** Resultado de una vuelta del LLM. */
interface ModelTurn {
  thought: string;
  calls: ToolCall[];
  /** ¿La respuesta se recibió por streaming (chunks)? */
  streamed: boolean;
}

/** Una vuelta del LLM consumiendo el endpoint SSE (tokens en vivo). */
async function streamModel(
  opts: RunAgentOptions,
  history: string[],
  route: string,
  onChunk: (text: string) => void
): Promise<ModelTurn> {
  const dialect = toolDialectForModel(opts.model || GEMINI_DEFAULT_MODEL);
  const res = await fetch(`${normalizeServerUrl(opts.serverUrl)}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(buildPayload(opts, history, dialect)),
  });
  if (!res.ok || !res.body) throw new Error(`LLM HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let calls: ToolCall[] = [];

  const handleEvent = (raw: string) => {
    const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
    if (!dataLine) return;
    const json = dataLine.slice(5).trim();
    if (!json || json === '[DONE]') return;
    let evt: {
      type?: string;
      text?: string;
      fullText?: string;
      functionCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
      error?: string;
      message?: string;
    };
    try {
      evt = JSON.parse(json);
    } catch {
      return;
    }
    if (evt.type === 'error') {
      throw new Error(evt.error || evt.message || 'Error del stream');
    }
    if (evt.type === 'chunk' && evt.text) {
      fullText += evt.text;
      onChunk(evt.text);
    } else if (evt.type === 'done') {
      if (typeof evt.fullText === 'string' && evt.fullText) fullText = evt.fullText;
      calls = (evt.functionCalls || []).map((fc) => ({ name: fc.name, args: fc.args || {} }));
    }
  };

  // SSE separa eventos por doble salto de línea; buffer para chunks partidos.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) handleEvent(part);
  }
  if (buffer.trim()) handleEvent(buffer);

  return { thought: fullText, calls, streamed: true };
}

/** Una vuelta del LLM: pensamiento + posibles toolCalls. */
async function callModel(
  opts: RunAgentOptions,
  history: string[],
  onChunk?: (text: string) => void
): Promise<ModelTurn> {
  const model = opts.model || GEMINI_DEFAULT_MODEL;
  const dialect = toolDialectForModel(model);
  if (dialect === 'json-text') {
    throw new Error(
      `El modelo "${model}" no soporta function calling nativo. Usa un modelo Gemini u OpenAI-compatible.`
    );
  }

  // Streaming en vivo (solo dialectos con endpoint SSE).
  const route = streamRoute(model);
  if (opts.stream && route && onChunk) {
    return streamModel(opts, history, route, onChunk);
  }

  const res = await fetch(`${normalizeServerUrl(opts.serverUrl)}${generateRoute(model)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPayload(opts, history, dialect)),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);

  const data = (await res.json()) as {
    text?: string;
    functionCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
    toolCalls?: { name: string; args?: Record<string, unknown> }[];
    choices?: { message?: { content?: string } }[];
  };

  const calls =
    dialect === 'gemini'
      ? (data.functionCalls || []).map((fc) => ({ name: fc.name, args: fc.args || {} }))
      : (data.toolCalls || []).map((tc) => ({ name: tc.name, args: tc.args || {} }));
  const thought =
    dialect === 'gemini'
      ? data.text || ''
      : data.text || data.choices?.[0]?.message?.content || '';
  return { thought, calls, streamed: false };
}

/** Recorta la salida de una tool para no inundar la terminal. */
function summarize(data: unknown, max = 500): string {
  if (data == null) return '(sin datos)';
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Respuesta de la API de sesiones; el estado siempre es v2. */
interface SessionStateResponse {
  success?: boolean;
  state?: SessionStateV2;
  error?: string;
  /** Sólo lo devuelve GET: hay un bucle autoritativo en el servidor. */
  running?: boolean;
}

function sessionEndpoint(serverUrl: string, suffix: string): string {
  return `${normalizeServerUrl(serverUrl)}/api/agent/sessions${suffix}`;
}

/** Lee y valida una respuesta de sesión sin asumir que el cuerpo es JSON. */
async function readSessionState(res: Response, rejectRunning = false): Promise<SessionStateV2> {
  const body = (await res.json().catch(() => ({}))) as SessionStateResponse;
  if (!res.ok) throw new Error(String(body.error || `HTTP ${res.status}`));
  if (!body.state || typeof body.state.id !== 'string' || !body.state.id) {
    throw new Error('respuesta sin estado de sesión');
  }
  if (rejectRunning && body.running === true) {
    throw new Error('la sesión está en ejecución; cancélala antes de reanudarla');
  }
  return body.state;
}

/** Carga una sesión persistida para `--resume`. */
export async function loadServerSession(serverUrl: string, id: string): Promise<SessionStateV2> {
  const res = await fetch(sessionEndpoint(serverUrl, `/${encodeURIComponent(id)}`), {
    signal: AbortSignal.timeout(10_000),
  });
  return readSessionState(res, true);
}

/** Bifurca una sesión en el servidor para `--fork`; la fuente no se muta. */
export async function forkServerSession(serverUrl: string, id: string): Promise<SessionStateV2> {
  const res = await fetch(sessionEndpoint(serverUrl, `/${encodeURIComponent(id)}/fork`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run: false }),
    signal: AbortSignal.timeout(10_000),
  });
  return readSessionState(res);
}

/**
 * Responde a una aprobación pendiente de una sesión del servidor (F1-04).
 *
 * El CLI recibe el `approval_request` por el SSE y devuelve la decisión aquí.
 * Repetir la misma decisión es idempotente; una distinta responde 409.
 */
export async function respondApproval(
  serverUrl: string,
  sessionId: string,
  approvalId: string,
  decision: ApprovalDecision,
  reason?: string
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  try {
    const res = await fetch(
      `${sessionEndpoint(serverUrl, `/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, ...(reason !== undefined ? { reason } : {}) }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    if (!res.ok) {
      return { ok: false, status: res.status, data, error: String(data?.error || `HTTP ${res.status}`) };
    }
    return { ok: true, status: res.status, data };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Crea la sesión que respaldará una corrida normal del CLI. */
async function createServerSession(opts: RunAgentOptions): Promise<SessionStateV2 | null> {
  try {
    const res = await fetch(sessionEndpoint(opts.serverUrl, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: opts.task,
        cwd: opts.cwd,
        model: opts.model || GEMINI_DEFAULT_MODEL,
        maxSteps: opts.maxSteps ?? 25,
        persist: true,
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as SessionStateResponse;
    return body.state && typeof body.state.id === 'string' ? body.state : null;
  } catch {
    return null;
  }
}

/** Checkpoint best-effort: un fallo de disco/red no debe tumbar el agente. */
async function saveServerState(serverUrl: string, state: SessionStateV2): Promise<void> {
  try {
    await fetch(sessionEndpoint(serverUrl, `/${encodeURIComponent(state.id)}/state`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
      signal: AbortSignal.timeout(4_000),
    });
  } catch {
    /* la corrida local sigue; el siguiente checkpoint reintenta */
  }
}

export interface ConsumeSessionStreamOptions {
  serverUrl: string;
  sessionId: string;
  /** Cursor inicial; normalmente el último `seq` ya renderizado. */
  after?: number;
  signal?: AbortSignal;
  onEvent?: (event: CliEventV2) => void;
  /** El servidor desalojó el cursor: hay que reemplazar el estado local. */
  onResync?: (state: SessionStateV2) => void;
  onGone?: (reason: string) => void;
  /** Intentos de reconexión después de la primera conexión (por defecto 3). */
  maxRetries?: number;
  /** Backoff por caída; por defecto 250 ms → 1 s → 2 s. */
  retryDelaysMs?: readonly number[];
}

export interface ConsumeSessionStreamResult {
  lastSeq: number;
  resyncs: number;
  reconnects: number;
  gone?: string;
}

interface SseReadResult {
  lastSeq: number;
  resyncs: number;
  gone?: string;
  /** Error de red a mitad del stream; el cursor parcial ya está actualizado. */
  error?: unknown;
}

function abortError(): Error {
  const error = new Error('stream abortado');
  error.name = 'AbortError';
  return error;
}

function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Parser SSE incremental del stream de sesiones.
 *
 * Acepta comentarios de keep-alive, varios `data:` por evento y eventos sin
 * `id`; la deduplicación se hace por `seq`, no por el orden de llegada.
 */
async function readSessionSse(
  body: ReadableStream<Uint8Array>,
  initialSeq: number,
  options: ConsumeSessionStreamOptions
): Promise<SseReadResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  let eventId: number | undefined;
  let dataLines: string[] = [];
  let lastSeq = initialSeq;
  let resyncs = 0;
  let gone: string | undefined;

  const dispatch = (): boolean => {
    if (dataLines.length === 0) {
      eventName = 'message';
      eventId = undefined;
      return false;
    }
    const data = dataLines.join('\n');
    const id = eventId;
    const name = eventName;
    eventName = 'message';
    eventId = undefined;
    dataLines = [];

    if (name === 'resync') {
      try {
        const state = JSON.parse(data) as SessionStateV2;
        if (state && typeof state.id === 'string' && state.id) options.onResync?.(state);
      } catch {
        /* un resync ilegible no debe tumbar el CLI */
      }
      // El resync reemplaza el cursor: el servidor puede mandar un id menor
      // que el que traía el cliente si la sesión se reinició.
      if (typeof id === 'number') lastSeq = id;
      resyncs += 1;
      return false;
    }

    if (name === 'gone') {
      try {
        const payload = JSON.parse(data) as { reason?: unknown };
        gone = typeof payload?.reason === 'string' ? payload.reason : 'gone';
      } catch {
        gone = 'gone';
      }
      options.onGone?.(gone);
      return true;
    }

    const event = decodeEvent(data);
    if (event) {
      const seq = event.seq > 0 ? event.seq : id ?? 0;
      if (seq > lastSeq) {
        lastSeq = seq;
        options.onEvent?.(event);
      }
    }
    if (typeof id === 'number' && id > lastSeq) lastSeq = id;
    return false;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const raw = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (raw === '') {
          if (dispatch()) {
            await reader.cancel().catch(() => {});
            return { lastSeq, resyncs, gone };
          }
        } else if (raw.startsWith(':')) {
          // Comentario de keep-alive.
        } else {
          const colon = raw.indexOf(':');
          const field = colon >= 0 ? raw.slice(0, colon) : raw;
          let value = colon >= 0 ? raw.slice(colon + 1) : '';
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'event') eventName = value;
          else if (field === 'id') {
            const parsed = Number(value);
            if (Number.isSafeInteger(parsed) && parsed >= 0) eventId = parsed;
          } else if (field === 'data') dataLines.push(value);
        }
        newline = buffer.indexOf('\n');
      }
    }
    if (buffer.trim()) {
      const raw = buffer.replace(/\r$/, '');
      if (raw.startsWith('data:')) dataLines.push(raw.slice(5).replace(/^ /, ''));
    }
    if (dispatch()) return { lastSeq, resyncs, gone };
    return { lastSeq, resyncs };
  } catch (error) {
    // Un corte a mitad de stream conserva lo ya deduplicado: la reconexión
    // empieza en `lastSeq`, no en el cursor inicial.
    return { lastSeq, resyncs, gone, error };
  } finally {
    try { reader.releaseLock(); } catch { /* ya liberado */ }
  }
}

/**
 * Consume `GET /api/agent/sessions/:id/stream` con reconexión y deduplicación.
 *
 * Se reconecta hasta 3 veces con 250 ms → 1 s → 2 s. Un `gone` termina el
 * consumo; un `resync` reemplaza el estado local y continúa desde el `id` del
 * evento. Desconectar este cliente no detiene la corrida del servidor.
 */
export async function consumeSessionStream(
  options: ConsumeSessionStreamOptions
): Promise<ConsumeSessionStreamResult> {
  let lastSeq = Math.max(0, Math.floor(Number(options.after) || 0));
  let reconnects = 0;
  let resyncs = 0;
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 3));
  const delays = options.retryDelaysMs ?? [250, 1_000, 2_000];

  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw abortError();
    let fatal: Error | null = null;
    try {
      const query = `?after=${encodeURIComponent(String(lastSeq))}`;
      const url = `${normalizeServerUrl(options.serverUrl)}/api/agent/sessions/${encodeURIComponent(options.sessionId)}/stream${query}`;
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      if (lastSeq > 0) headers['Last-Event-ID'] = String(lastSeq);
      const response = await fetch(url, { headers, signal: options.signal });
      if (response.status === 404) {
        fatal = new Error('sesión no encontrada');
      } else if (!response.ok) {
        fatal = new Error(`HTTP ${response.status}`);
      } else if (!response.body) {
        fatal = new Error('el stream no tiene cuerpo');
      } else {
        const type = response.headers.get('content-type') || '';
        if (!type.includes('text/event-stream')) {
          const text = await response.text().catch(() => '');
          fatal = new Error(`respuesta no SSE: ${type || 'sin content-type'} ${text.slice(0, 200)}`);
        } else {
          const result = await readSessionSse(response.body, lastSeq, options);
          lastSeq = result.lastSeq;
          resyncs += result.resyncs;
          if (result.gone) {
            return { lastSeq, resyncs, reconnects, gone: result.gone };
          }
          if (result.error) throw result.error;
        }
      }
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      if (fatal) throw fatal;
      if (attempt >= maxRetries) throw error;
    }

    if (fatal) throw fatal;
    if (attempt >= maxRetries) throw new Error('el stream terminó sin evento gone');
    const delay = delays[Math.min(attempt, delays.length - 1)] ?? 0;
    reconnects += 1;
    await waitForRetry(delay, options.signal);
  }
}

/**
 * Ejecuta el bucle del agente hasta terminar o agotar `maxSteps`.
 *
 * Con `persistSession` (lo activa el CLI) la corrida crea una sesión en el
 * servidor y sincroniza turnos/pasos en cada avance; con `resumeFrom` continúa
 * una sesión existente sin repetir el historial. El bucle sigue siendo local
 * para conservar el streaming hasta que F1-03 lo mueva al servidor.
 */
export async function runAgent(
  opts: RunAgentOptions
): Promise<{ answer: string; steps: number; sessionId: string; seq: number }> {
  const resumed = opts.resumeFrom
    ? (JSON.parse(JSON.stringify(opts.resumeFrom)) as SessionStateV2)
    : null;
  let sessionId = resumed?.id || opts.sessionId || '';
  let state: SessionStateV2 | null = resumed;
  let syncEnabled = Boolean(resumed);

  // Las corridas normales del CLI dejan una sesión reanudable. Los tests
  // directos/goldens fijan `sessionId` y no habilitan `persistSession`, así que
  // no hacen peticiones de sesión y su contrato queda determinista.
  if (!sessionId && opts.persistSession) {
    const created = await createServerSession(opts);
    if (created) {
      state = created;
      sessionId = created.id;
      syncEnabled = true;
    }
  }
  if (!sessionId) sessionId = uid('sess');

  const sequencer = new EventSequencer(sessionId, state?.steps.length ?? 0);
  const onEvent = opts.onEvent ?? (() => {});
  const emit = (payload: CliEventPayload) => onEvent(sequencer.next(payload));
  const done = (answer: string, steps: number) => ({
    answer,
    steps,
    sessionId: sequencer.sessionId,
    seq: sequencer.lastSeq,
  });
  const maxSteps = Math.max(1, opts.maxSteps ?? 25);
  const goal = state?.goal || opts.goal || opts.task;
  const model = opts.model || state?.model || GEMINI_DEFAULT_MODEL;
  // A partir de aquí todo (incluido el prompt y el evento `session`) usa el
  // objetivo persistido y el modelo real de la sesión reanudada.
  opts = { ...opts, goal, model };
  const history: string[] = resumed
    ? (resumed.turns || []).map((turn) => `${turn.role.toUpperCase()}: ${turn.text}`)
    : [];
  if (resumed) history.push(`USER: ${opts.task}`);
  let steps = 0;

  const sync = async () => {
    if (!state || !syncEnabled) return;
    await saveServerState(opts.serverUrl, state);
  };
  const addStep = async (step: Omit<SessionStepV2, 'id' | 'ts'>) => {
    if (!state) return;
    state.steps.push({ ...step, id: uid('step'), ts: Date.now() });
    if (state.steps.length > 200) state.steps = state.steps.slice(-200);
    state.updatedAt = Date.now();
    await sync();
  };
  const addTurn = (turn: Omit<SessionTurnV2, 'ts'>) => {
    if (!state) return;
    state.turns.push({ ...turn, text: turn.text.slice(0, 8_000), ts: Date.now() });
    if (state.turns.length > 20) state.turns = state.turns.slice(-20);
    state.updatedAt = Date.now();
  };

  if (state) {
    addTurn({ role: 'user', text: opts.task });
    state.status = 'running';
    delete state.answer;
    delete state.error;
    state.updatedAt = Date.now();
    await sync();
  }

  // Primer evento: identifica la sesión antes de cualquier progreso. Así un
  // consumidor que se conecte tarde sabe a quién pertenecen los `seq`.
  emit({
    type: 'session',
    session: {
      id: sequencer.sessionId,
      goal,
      cwd: opts.cwd,
      model,
      mode: state?.mode || 'build',
      status: 'running',
    },
  });

  for (let i = 0; i < maxSteps; i++) {
    steps = i + 1;
    emit({ type: 'status', text: `Paso ${steps}/${maxSteps}: pensando…` });

    let thought = '';
    let calls: ToolCall[] = [];
    let streamed = false;
    try {
      ({ thought, calls, streamed } = await callModel(opts, history, (text) =>
        emit({ type: 'chunk', text })
      ));
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      emit({ type: 'error', text });
      if (state) {
        state.status = 'failed';
        state.error = text;
        state.updatedAt = Date.now();
        await sync();
      }
      return done('', steps);
    }

    if (thought) {
      addTurn({ role: 'assistant', text: thought });
      await addStep({
        type: 'thought',
        title: 'Razonamiento',
        content: thought.slice(0, 2_000),
        status: 'completed',
      });
    }
    // Con streaming el texto ya se vio en vivo; no lo repetimos.
    if (thought && !streamed) emit({ type: 'thought', text: thought });

    if (calls.length === 0) {
      const answer = thought || '(el modelo no devolvió respuesta)';
      addTurn({ role: 'assistant', text: answer });
      await addStep({ type: 'thought', title: 'Finalizado', content: answer, status: 'completed' });
      if (state) {
        state.answer = answer;
        state.status = 'completed';
        state.updatedAt = Date.now();
        await sync();
      }
      emit({ type: 'answer', text: answer });
      return done(thought, steps);
    }

    history.push(`ASISTENTE: ${thought}`);
    for (const call of calls) {
      // El modelo devuelve el nombre de la función (`fs_read`), no el id de la
      // tool del servidor (`fs.read`). Sin esta traducción el endpoint responde
      // "tool desconocida" y el agente headless no puede hacer nada.
      const mapped = mapFunctionCall(call.name, call.args);
      if (!mapped) {
        const text = `Tool desconocida devuelta por el modelo: ${call.name}`;
        emit({ type: 'error', text });
        history.push(`TOOL ${call.name} → ERROR: ${text}`);
        await addStep({ type: 'thought', title: 'Tool desconocida', content: text, status: 'failed' });
        continue;
      }
      const input =
        mapped.input && typeof mapped.input === 'object'
          ? (mapped.input as Record<string, unknown>)
          : {};
      emit({ type: 'tool_call', tool: mapped.tool, input: mapped.input });
      await addStep({
        type: 'tool_call',
        toolId: mapped.tool,
        title: mapped.tool,
        content: summarize(mapped.input ?? {}, 500),
        input: mapped.input,
        status: 'running',
      });
      const result = await runTool(opts.serverUrl, mapped.tool, {
        ...input,
        root: opts.cwd,
      });
      const summary = result.ok ? summarize(result.data) : `ERROR: ${result.error}`;
      emit({ type: 'tool_result', tool: mapped.tool, ok: result.ok, summary });
      history.push(`TOOL ${mapped.tool} → ${summary}`);
      addTurn({ role: 'tool', text: `TOOL ${mapped.tool} → ${summary}` });
      await addStep({
        type: 'tool_result',
        toolId: mapped.tool,
        title: mapped.tool,
        content: result.ok ? summarize(result.data, 2_000) : `ERROR: ${result.error}`,
        input: mapped.input,
        output: result.data,
        status: result.ok ? 'completed' : 'failed',
      });
    }
  }

  const text = `Se alcanzó el límite de ${maxSteps} pasos sin obtener respuesta final.`;
  emit({ type: 'error', text });
  if (state) {
    state.status = 'failed';
    state.error = text;
    state.updatedAt = Date.now();
    await sync();
  }
  return done('', steps);
}
