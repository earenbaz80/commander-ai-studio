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
  | 'shell-same-twice'
  | 'shell-same-after-failed-edit'
  | 'tool-write-twice'
  | 'tool-edit-same-twice'
  | 'tool-edit-same-three'
  | 'tool-edit-same-six'
  | 'read-loop'
  | 'read-after-edit'
  | 'rerun-same-command'
  | 'read-after-subagent'
  | 'browser-snapshot-twice'
  | 'shell-run-node-test'
  | 'test-mandatory-source-only'
  | 'test-mandatory-complete'
  | 'propose-edit'
  | 'propose-duplicate'
  | 'propose-long-diff'
  | 'propose-huge-diff'
  | 'tool-payload-false'
  | 'edit-already-applied'
  | 'git-diff-long'
  | 'slow-tool'
  | 'spawn-agents'
  | 'git-worktree-actions'
  | 'ask-user'
  | 'max-steps'
  | 'unknown-tool'
  | 'stream'
  | 'slow'
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
const FAKE_PROPOSAL_HINT =
  'Propuesta no aplicada: no se escribió en disco; el diff queda pendiente de aplicar.';
const READ_CALL: FunctionCall = { name: 'fs_read', args: { path: 'README.md' } };
const THREE_READ_CALLS: FunctionCall[] = [
  READ_CALL,
  { name: 'fs_read', args: { path: 'package.json' } },
  { name: 'fs_read', args: { path: 'AGENTS.md' } },
];
const WRITE_CALL: FunctionCall = { name: 'fs_write', args: { path: 'salida.txt', content: 'x' } };
const EDIT_CALL: FunctionCall = {
  name: 'fs_edit',
  args: { path: 'salida.txt', oldString: 'x', newString: 'y' },
};
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
// Lectura de navegador: repetirla con el mismo input no muta nada.
const BROWSER_SNAPSHOT_CALL: FunctionCall = { name: 'browser', args: { action: 'snapshot' } };
// G1-D1-04: tres lecturas legítimas y luego el modelo vuelve al mismo archivo.
// Las repeticiones no son consecutivas (alterna archivos), así que el detector
// tiene que contar por clave acumulada y no por racha seguida.
const READ_LOOP_CALLS: FunctionCall[] = [
  { name: 'fs_read', args: { path: 'slug.mjs' } },
  { name: 'fs_read', args: { path: 'slug.test.mjs' } },
  { name: 'fs_read', args: { path: 'package.json' } },
  { name: 'fs_read', args: { path: 'slug.mjs' } },
  { name: 'fs_read', args: { path: 'slug.mjs' } },
  { name: 'fs_read', args: { path: 'slug.mjs' } },
];

const SCENARIOS: FakeScenario[] = [
  'final',
  'tool',
  'tool-error',
  'tool-three',
  'tool-denied',
  'shell-same-twice',
  'shell-same-after-failed-edit',
  'tool-write-twice',
  'tool-edit-same-twice',
  'tool-edit-same-three',
  'tool-edit-same-six',
  'read-loop',
  'read-after-edit',
  'rerun-same-command',
  'read-after-subagent',
  'browser-snapshot-twice',
  'shell-run-node-test',
  'test-mandatory-source-only',
  'test-mandatory-complete',
  'propose-edit',
  'propose-duplicate',
  'propose-long-diff',
  'propose-huge-diff',
  'tool-payload-false',
  'edit-already-applied',
  'git-diff-long',
  'slow-tool',
  'spawn-agents',
  'git-worktree-actions',
  'ask-user',
  'max-steps',
  'unknown-tool',
  'stream',
  'slow',
  'llm-error',
];

function fakeProposalDiff(prefix: string, lines: number): string {
  return Array.from(
    { length: lines },
    (_, index) => `+${prefix} linea ${index} ${'x'.repeat(24)}`
  ).join('\n');
}

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
    case 'shell-same-twice':
      return turn <= 2
        ? {
            text: turn === 1 ? 'Corro el test.' : 'Repito el mismo test.',
            functionCalls: [{ name: 'shell_run', args: { command: 'node --test math.test.mjs' } }],
          }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'shell-same-after-failed-edit':
      // El test corre, una edición falla (no cambia el workspace) y el mismo
      // test se repite: la huella de shell.run debe seguir viva.
      return turn === 1
        ? {
            text: 'Corro el test.',
            functionCalls: [{ name: 'shell_run', args: { command: 'node --test math.test.mjs' } }],
          }
        : turn === 2
          ? {
              text: 'Intento editar.',
              functionCalls: [{ name: 'fs_edit', args: { path: 'fallo.txt', oldString: 'a', newString: 'b' } }],
            }
          : turn === 3
            ? {
                text: 'Repito el mismo test.',
                functionCalls: [{ name: 'shell_run', args: { command: 'node --test math.test.mjs' } }],
              }
            : { text: FINAL_TEXT, functionCalls: [] };
    case 'tool-write-twice':
      return turn === 1
        ? { text: 'Voy a escribir la primera salida.', functionCalls: [WRITE_CALL] }
        : turn === 2
          ? {
              text: 'Ahora escribo la segunda salida.',
              functionCalls: [{ name: 'fs_write', args: { path: 'salida2.txt', content: 'y' } }],
            }
          : { text: FINAL_TEXT, functionCalls: [] };
    case 'tool-edit-same-twice':
      return turn <= 2
        ? { text: `Edito la misma salida (${turn}).`, functionCalls: [EDIT_CALL] }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'tool-edit-same-three':
      // CAL2-R02/R03: el modelo reemite la misma edición tres veces seguidas.
      return turn <= 3
        ? { text: `Edito la misma salida (${turn}).`, functionCalls: [EDIT_CALL] }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'tool-edit-same-six':
      // CAL2-R19: el modelo reemitió la misma edición seis veces y agotó los pasos
      // sin llegar a verificar. El corte tiene que llegar antes del tope.
      return turn <= 6
        ? { text: `Edito la misma salida (${turn}).`, functionCalls: [EDIT_CALL] }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'read-after-subagent':
      // Leer, releer (aviso) y lanzar un subagente que puede haber editado el
      // archivo: la relectura posterior tiene que ejecutarse.
      return turn <= 2
        ? { text: `Leo (${turn}).`, functionCalls: [READ_CALL] }
        : turn === 3
          ? {
              text: 'Lanzo un subagente.',
              functionCalls: [
                { name: 'spawn_agents', args: { agents: [{ goal: 'Añade maxLength a slug.mjs' }] } },
              ],
            }
          : turn === 4
            ? { text: 'Releo tras el subagente.', functionCalls: [READ_CALL] }
            : { text: FINAL_TEXT, functionCalls: [] };
    case 'rerun-same-command':
      // Editar y volver a correr el mismo test es el bucle normal de trabajo.
      // Bajo el guardia viejo (que vigilaba `shell.run`) la segunda ejecución se
      // saltaba con «Sin cambios: shell.run ya se aplicó».
      return turn === 1
        ? { text: 'Edito el test.', functionCalls: [{ name: 'fs_edit', args: { path: 'slug.test.mjs', oldString: 'a', newString: 'b' } }] }
        : turn === 2
          ? { text: 'Corro el test.', functionCalls: [{ name: 'shell_run', args: { command: 'node --test slug.test.mjs' } }] }
          : turn === 3
            ? { text: 'Ajusto el test.', functionCalls: [{ name: 'fs_edit', args: { path: 'slug.test.mjs', oldString: 'b', newString: 'c' } }] }
            : turn === 4
              ? { text: 'Vuelvo a correr el mismo test.', functionCalls: [{ name: 'shell_run', args: { command: 'node --test slug.test.mjs' } }] }
              : { text: FINAL_TEXT, functionCalls: [] };
    case 'read-loop':
      // La 4.ª lectura de `slug.mjs` corta la corrida; las tres primeras claves
      // (una por archivo) sí llegan a ejecutarse.
      return turn <= READ_LOOP_CALLS.length
        ? { text: `Leo (${turn}).`, functionCalls: [READ_LOOP_CALLS[turn - 1]] }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'read-after-edit':
      // Leer, releer (aviso), verificar con shell.run —eso vacía la ventana— y
      // volver a leer: no es un bucle y la sesión termina bien.
      return turn <= 2
        ? { text: `Leo (${turn}).`, functionCalls: [READ_CALL] }
        : turn === 3
          ? {
              text: 'Verifico antes de releer.',
              functionCalls: [{ name: 'shell_run', args: { command: 'node slug.test.mjs' } }],
            }
          : turn <= 5
            ? { text: `Releo (${turn}).`, functionCalls: [READ_CALL] }
            : { text: FINAL_TEXT, functionCalls: [] };
    case 'browser-snapshot-twice':
      return turn <= 2
        ? { text: `Releo la página (${turn}).`, functionCalls: [BROWSER_SNAPSHOT_CALL] }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'propose-edit':
      return turn === 1
        ? {
            text: 'Propongo la edición.',
            functionCalls: [
              {
                name: 'fs_propose_edit',
                args: { path: 'slug.mjs', oldString: 'a', newString: 'b' },
              },
            ],
          }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'propose-duplicate':
      // Dos llamadas con distinto `newString` pero el fake devuelve el mismo
      // diff: el estado debe guardar una sola propuesta (dedupe por contenido).
      return turn === 1
        ? {
            text: 'Propongo la edición dos veces.',
            functionCalls: [
              {
                name: 'fs_propose_edit',
                args: { path: 'slug.mjs', oldString: 'a', newString: 'b' },
              },
              {
                name: 'fs_propose_edit',
                args: { path: 'slug.mjs', oldString: 'a', newString: 'c' },
              },
            ],
          }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'propose-long-diff':
      return turn === 1
        ? {
            text: 'Propongo el cambio largo.',
            functionCalls: [
              {
                name: 'fs_propose_edit',
                args: { path: 'largo.txt', oldString: 'a', newString: 'b' },
              },
            ],
          }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'propose-huge-diff':
      return turn === 1
        ? {
            text: 'Propongo el cambio enorme.',
            functionCalls: [
              {
                name: 'fs_propose_edit',
                args: { path: 'enorme.txt', oldString: 'a', newString: 'b' },
              },
            ],
          }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'tool-payload-false':
      // `runTool` recibe HTTP 200 con `ok:false`: el paso tiene que quedar failed.
      return turn === 1
        ? {
            text: 'Edito el archivo.',
            functionCalls: [
              { name: 'fs_edit', args: { path: 'fallo.txt', oldString: 'a', newString: 'b' } },
            ],
          }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'git-diff-long':
      return turn === 1
        ? {
            text: 'Reviso el diff.',
            functionCalls: [{ name: 'git_diff', args: {} }],
          }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'edit-already-applied':
      return turn === 1
        ? {
            text: 'Edito el archivo.',
            functionCalls: [
              { name: 'fs_edit', args: { path: 'ya.txt', oldString: 'viejo', newString: 'nuevo' } },
            ],
          }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'test-mandatory-source-only':
      return turn === 1
        ? {
            text: 'Edito el código, pero no el test.',
            functionCalls: [{ name: 'fs_edit', args: { path: 'slug.mjs', oldString: 'a', newString: 'b' } }],
          }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'test-mandatory-complete':
      return turn === 1
        ? {
            text: 'Edito el código.',
            functionCalls: [{ name: 'fs_edit', args: { path: 'slug.mjs', oldString: 'a', newString: 'b' } }],
          }
        : turn === 2
          ? {
              text: 'Añado el test.',
              functionCalls: [
                { name: 'fs_edit', args: { path: 'slug.test.mjs', oldString: 'a', newString: 'b' } },
              ],
            }
          : turn === 3
            ? {
                text: 'Ejecuto el test.',
                functionCalls: [{ name: 'shell_run', args: { command: 'node math.test.mjs' } }],
              }
            : { text: FINAL_TEXT, functionCalls: [] };
    case 'shell-run-node-test':
      return turn === 1
        ? {
            text: 'Verifico el test con la forma corta.',
            functionCalls: [{ name: 'shell_run', args: { command: 'node math.test.mjs' } }],
          }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'slow-tool':
      return turn === 1
        ? { text: 'Voy a leer lento.', functionCalls: [{ name: 'fs_read', args: { path: 'slow.txt' } }] }
        : { text: FINAL_TEXT, functionCalls: [] };
    case 'spawn-agents':
      // `spawn_agents` no lleva `parentSessionId` en los argumentos del modelo:
      // lo inyecta el bucle del CLI, y el test comprueba que llega al servidor.
      return turn === 1
        ? {
            text: 'Lanzo dos subagentes.',
            functionCalls: [
              {
                name: 'spawn_agents',
                args: {
                  agents: [
                    { goal: 'Escribe hijo-a.txt', worktree: true, allowedTools: ['fs.read', 'fs.write'] },
                    { goal: 'Escribe hijo-b.txt', worktree: true, allowedTools: ['fs.read', 'fs.write'] },
                  ],
                },
              },
            ],
          }
        : { text: 'Listo: dos hijos.', functionCalls: [] };
    case 'git-worktree-actions':
      // `list` es sólo lectura; `add` y `remove` crean o borran directorios y
      // deben seguir pidiendo aprobación (G1-D4 §6, hallazgo de G1-D4-05).
      if (turn === 1) {
        return { text: 'Listo los worktrees.', functionCalls: [{ name: 'git_worktree', args: { action: 'list' } }] };
      }
      if (turn === 2) {
        return {
          text: 'Creo un worktree.',
          functionCalls: [{ name: 'git_worktree', args: { action: 'add', path: 'wt-demo' } }],
        };
      }
      if (turn === 3) {
        return {
          text: 'Lo quito.',
          functionCalls: [{ name: 'git_worktree', args: { action: 'remove', path: 'wt-demo' } }],
        };
      }
      return { text: FINAL_TEXT, functionCalls: [] };
    case 'ask-user':
      return turn === 1
        ? { text: 'Necesito confirmar el alcance.', functionCalls: [ASK_CALL] }
        : { text: 'Listo: alcance elegido.', functionCalls: [] };
    case 'max-steps':
      // Un archivo distinto por turno: el test mide el tope de pasos, no el
      // guardia de lecturas repetidas (G1-T2-READ-LOOP), que cortaría antes.
      return {
        text: 'Sigo leyendo.',
        functionCalls: [{ name: 'fs_read', args: { path: `archivo-${turn}.md` } }],
      };
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
  let proposalSeq = 0;
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
      if (scenario === 'slow') {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        if (res.destroyed) return;
      }
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
      if (scenario === 'slow') {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        if (res.destroyed) return;
      }
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
      if (body?.toolId === 'fs.read' && body?.input?.path === 'slow.txt') {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        if (res.destroyed) return;
      }
      if (body?.toolId === 'fs.write') {
        sendJson(res, 403, {
          error: 'Modo Sólo lectura: escritura bloqueada por la política del proyecto.',
        });
        return;
      }
      if (body?.toolId === 'fs.edit' && body?.input?.path === 'fallo.txt') {
        // HTTP 200 con `ok:false`: el caso real de un `oldString` que ya no está.
        sendJson(res, 200, { ok: false, error: 'oldString no encontrado en el archivo' });
        return;
      }
      if (body?.toolId === 'git.diff') {
        sendJson(res, 200, {
          ok: true,
          data: { diff: fakeProposalDiff('gitdifflarga', 60), files: ['a.ts'] },
        });
        return;
      }
      if (body?.toolId === 'fs.read' && body?.input?.path === 'html.txt') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html>no es json</html>');
        return;
      }
      if (body?.toolId === 'fs.read' && body?.input?.path === 'vacio.txt') {
        res.writeHead(200);
        res.end();
        return;
      }
      if (body?.toolId === 'fs.edit' && body?.input?.path === 'ya.txt') {
        sendJson(res, 200, {
          ok: false,
          code: 'ALREADY_APPLIED',
          error: 'oldString no encontrado en el archivo; el newString ya está en el archivo',
          hint: 'Posiblemente ya aplicado: el newString ya está en el archivo; no hace falta releerlo.',
        });
        return;
      }
      if (body?.toolId === 'fs.propose.edit' && body?.input?.path === 'largo.txt') {
        sendJson(res, 200, {
          ok: true,
          data: {
            applied: false,
            proposalId: 'prop_fake_largo',
            baseHash: 'sha256:fake-largo',
            afterHash: 'sha256:fake-largo-after',
            hint: FAKE_PROPOSAL_HINT,
            path: 'largo.txt',
            changed: true,
            additions: 60,
            diff: fakeProposalDiff('largo', 60),
          },
        });
        return;
      }
      if (body?.toolId === 'fs.propose.edit' && body?.input?.path === 'enorme.txt') {
        sendJson(res, 200, {
          ok: true,
          data: {
            applied: false,
            proposalId: 'prop_fake_enorme',
            baseHash: 'sha256:fake-enorme',
            afterHash: 'sha256:fake-enorme-after',
            hint: FAKE_PROPOSAL_HINT,
            path: 'enorme.txt',
            changed: true,
            additions: 500,
            diff: fakeProposalDiff('enorme', 500),
          },
        });
        return;
      }
      if (String(body?.toolId).startsWith('fs.propose.')) {
        sendJson(res, 200, {
          ok: true,
          data: {
            applied: false,
            proposalId: `prop_fake_${++proposalSeq}`,
            baseHash: 'sha256:fake',
            afterHash: 'sha256:fake-after',
            hint: FAKE_PROPOSAL_HINT,
            path: String(body?.input?.path ?? 'slug.mjs'),
            changed: true,
            diff: '+nuevo\\n-viejo',
          },
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
