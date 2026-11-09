/**
 * Servidor HTTP falso para el arnés E2E del CLI (F1-14).
 *
 * Imita sólo la superficie que consume `commander agent`:
 *   GET  /api/health
 *   POST /api/gemini/generate
 *   POST /api/gemini/stream   (SSE)
 *   POST /api/agent/run-tool
 *
 * No habla con ningún proveedor ni toca el servidor real. El guion se elige
 * por el marcador `SCENARIO:<nombre>` que el test escribe en la tarea; el CLI
 * lo manda dentro de `contents`/`prompt`. Cada instancia lleva su propio
 * contador de turnos y su registro de peticiones, así que los tests pueden
 * correr en paralelo sin compartir estado.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSessionState, type SessionStateV2 } from '../../src/agent/sessionTypes.js';

export type FakeScenario =
  | 'final'
  | 'tool'
  | 'tool-error'
  | 'tool-three'
  | 'tool-denied'
  | 'ask-user'
  | 'max-steps'
  | 'unknown-tool'
  | 'stream'
  | 'llm-error';

export interface FakeRequest {
  method: string;
  path: string;
  body: any;
}

export interface FakeAgentServer {
  baseUrl: string;
  requests: FakeRequest[];
  /** Siembra una sesión ya persistida (p. ej. cancelada) antes de `--resume`. */
  seedSession: (state: SessionStateV2) => void;
  close: () => Promise<void>;
}

interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

interface ModelTurn {
  status?: number;
  text: string;
  functionCalls: FunctionCall[];
}

const FINAL_TEXT = 'Listo: el faro funciona.';
const READ_CALL: FunctionCall = { name: 'fs_read', args: { path: 'README.md' } };
const THREE_READ_CALLS: FunctionCall[] = [
  READ_CALL,
  { name: 'fs_read', args: { path: 'package.json' } },
  { name: 'fs_read', args: { path: 'AGENTS.md' } },
];
const WRITE_CALL: FunctionCall = { name: 'fs_write', args: { path: 'salida.txt', content: 'x' } };
const ASK_CALL: FunctionCall = {
  name: 'ask_user',
  args: {
    header: 'Alcance',
    question: '¿Qué alcance uso?',
    options: ['mínimo', 'completo'],
    allowFreeText: true,
  },
};
const UNKNOWN_CALL: FunctionCall = { name: 'no_existe', args: {} };

const SCENARIOS: FakeScenario[] = [
  'final',
  'tool',
  'tool-error',
  'tool-three',
  'tool-denied',
  'ask-user',
  'max-steps',
  'unknown-tool',
  'stream',
  'llm-error',
];

function scenarioFrom(body: any): FakeScenario {
  const text = String(body?.contents ?? body?.prompt ?? '');
  const match = text.match(/SCENARIO:([a-z-]+)/);
  const value = match?.[1] as FakeScenario | undefined;
  return value && SCENARIOS.includes(value) ? value : 'final';
}

function turnFor(scenario: FakeScenario, turn: number): ModelTurn {
  switch (scenario) {
    case 'tool':
      return turn === 1
        ? { text: 'Voy a leer el README.', functionCalls: [READ_CALL] }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'tool-error':
      // Una tool válida y una desconocida en el mismo turno: el golden cubre
      // tool_call/tool_result y error sin renunciar a answer/done.
      return turn === 1
        ? { text: 'Voy a leer y probar una tool.', functionCalls: [READ_CALL, UNKNOWN_CALL] }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'tool-three':
      return turn <= THREE_READ_CALLS.length
        ? { text: `Leo el archivo ${turn}.`, functionCalls: [THREE_READ_CALLS[turn - 1]] }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'tool-denied':
      return turn === 1
        ? { text: 'Voy a escribir.', functionCalls: [WRITE_CALL] }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'ask-user':
      return turn === 1
        ? { text: 'Necesito confirmar el alcance.', functionCalls: [ASK_CALL] }
        : { text: 'Listo: alcance elegido.', functionCalls: [] };
    case 'max-steps':
      return { text: 'Sigo leyendo.', functionCalls: [READ_CALL] };
    case 'unknown-tool':
      return turn === 1
        ? { text: 'Pruebo una tool.', functionCalls: [UNKNOWN_CALL] }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'stream':
      return { text: 'Hola desde el SSE.', functionCalls: [] };
    case 'llm-error':
      return { status: 500, text: '', functionCalls: [] };
    case 'final':
    default:
      return { text: FINAL_TEXT, functionCalls: [] };
  }
}

function nextTurn(turns: Map<string, number>, scenario: FakeScenario): number {
  const turn = (turns.get(scenario) ?? 0) + 1;
  turns.set(scenario, turn);
  return turn;
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error('cuerpo de petición demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(text)),
  });
  res.end(text);
}

function sendSse(res: http.ServerResponse, events: unknown[]): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end();
}

export async function startFakeAgentServer(): Promise<FakeAgentServer> {
  const requests: FakeRequest[] = [];
  const turns = new Map<string, number>();
  // Checkpoints de las sesiones que el CLI crea/sincroniza. No ejecuta el
  // bucle: el CLI lo hace y manda el estado con PUT /state.
  const sessions = new Map<string, SessionStateV2>();
  let sessionSeq = 0;
  const cloneState = (state: SessionStateV2): SessionStateV2 =>
    JSON.parse(JSON.stringify(state)) as SessionStateV2;

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let body: any = null;
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        body = await readJson(req);
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    requests.push({ method: req.method ?? '', path: url.pathname, body });

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/gemini/generate') {
      const scenario = scenarioFrom(body);
      const script = turnFor(scenario, nextTurn(turns, scenario));
      if (script.status) {
        sendJson(res, script.status, { error: 'fallo simulado del proveedor' });
        return;
      }
      sendJson(res, 200, { text: script.text, functionCalls: script.functionCalls });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/gemini/stream') {
      const scenario = scenarioFrom(body);
      const script = turnFor(scenario, nextTurn(turns, scenario));
      if (script.status) {
        sendJson(res, script.status, { error: 'fallo simulado del proveedor' });
        return;
      }
      if (scenario === 'stream') {
        sendSse(res, [
          { type: 'chunk', text: 'Hola ' },
          { type: 'chunk', text: 'desde ' },
          { type: 'chunk', text: 'el SSE.' },
          { type: 'done', fullText: script.text, functionCalls: [] },
        ]);
        return;
      }
      sendSse(res, [
        ...(script.text ? [{ type: 'chunk', text: script.text }] : []),
        { type: 'done', fullText: script.text, functionCalls: script.functionCalls },
      ]);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/agent/sessions') {
      const goal = String(body?.goal || '').trim();
      if (!goal) {
        sendJson(res, 400, { error: 'goal requerido' });
        return;
      }
      const mode = body?.mode === 'plan' || body?.mode === 'readonly' ? body.mode : 'build';
      const state = createSessionState({
        id: `sess_fake_${++sessionSeq}`,
        goal,
        cwd: String(body?.cwd || '/workspace/demo'),
        model: body?.model ? String(body.model) : 'gemini/fake',
        mode,
      });
      sessions.set(state.id, state);
      sendJson(res, 200, {
        success: true,
        session: { id: state.id, goal: state.goal, status: state.status },
        state,
      });
      return;
    }

    const sessionMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)$/);
    if (req.method === 'GET' && sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]);
      const state = sessions.get(id);
      if (!state) {
        sendJson(res, 404, { success: false, error: 'sesión no encontrada' });
        return;
      }
      sendJson(res, 200, { success: true, state });
      return;
    }

    const stateMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/state$/);
    if (req.method === 'PUT' && stateMatch) {
      const id = decodeURIComponent(stateMatch[1]);
      const state = body?.state as SessionStateV2 | undefined;
      if (!sessions.has(id) || !state || state.id !== id) {
        sendJson(res, 400, { success: false, error: 'estado inválido o de otra sesión' });
        return;
      }
      sessions.set(id, JSON.parse(JSON.stringify(state)) as SessionStateV2);
      sendJson(res, 200, { success: true, state: sessions.get(id) });
      return;
    }

    const forkMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/fork$/);
    if (req.method === 'POST' && forkMatch) {
      const id = decodeURIComponent(forkMatch[1]);
      const source = sessions.get(id);
      if (!source) {
        sendJson(res, 404, { success: false, error: 'sesión no encontrada' });
        return;
      }
      const copy = cloneState(source);
      const now = Date.now();
      copy.id = `sess_fake_${++sessionSeq}`;
      copy.status = 'idle';
      copy.pendingApproval = null;
      copy.createdAt = now;
      copy.updatedAt = now;
      delete copy.answer;
      delete copy.error;
      const text = String(body?.text ?? body?.message ?? '').trim();
      if (text) copy.turns.push({ role: 'user', text: text.slice(0, 20_000), ts: now });
      sessions.set(copy.id, copy);
      sendJson(res, 201, {
        success: true,
        session: { id: copy.id, goal: copy.goal, status: copy.status },
        state: copy,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/agent/run-tool') {
      if (body?.toolId === 'fs.write') {
        sendJson(res, 403, {
          error: 'Modo Sólo lectura: escritura bloqueada por la política del proyecto.',
        });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        data: { content: 'contenido de prueba', path: body?.input?.path ?? 'README.md' },
      });
      return;
    }

    sendJson(res, 404, { error: `ruta no simulada: ${req.method} ${url.pathname}` });
  }

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((error) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    seedSession: (state) => {
      sessions.set(state.id, cloneState(state));
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
