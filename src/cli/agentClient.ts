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
import { spawnBatchHadFailure, spawnChildrenFromResults, spawnFailureClosingMessage } from '../agent/spawnStreak';
import { toOpenAITools, toolDialectForModel } from '../agent/providers';
import { PLAN_TOOL } from '../agent/plan';
import { resolveEndpoint, resolveStreamEndpoint } from '../lib/aiProviders';
import { GEMINI_DEFAULT_MODEL } from '../config/geminiModels';
import { uid } from '../agent/id';
import {
  normalizeProposals,
  proposalStatsFor,
  type ProposalDropStats,
} from '../agent/proposals';
import {
  APPROVAL_VISIBILITY_BUDGET_MS,
  EventSequencer,
  decodeEvent,
  type ApprovalDecision,
  type ApprovalRenderFacts,
  type ApprovalRequestV2,
  type CliEventPayload,
  type CliEventV2,
  type QuestionV2,
  type RunInvalidation,
  type SessionMode,
  type SessionStateV2,
  type SessionStepV2,
  type SessionTurnV2,
  nextRunLabel,
} from '../agent/sessionTypes';
import { approvalDiffFor } from './approvalDiff.js';
import { LoopGuard, WORKSPACE_WRITE_TOOLS } from '../agent/identicalCalls';
import {
  AGENT_MAX_OUTPUT_TOKENS,
  AGENT_RETRY_MAX_OUTPUT_TOKENS,
  TRUNCATED_TURN_MESSAGE,
  isTruncatedTurn,
  isTruncationError,
} from '../agent/outputBudget';
import { MAX_VERIFY_REFUSALS, VerifyGate } from '../agent/verifyGate';

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
  /**
   * Resuelve una pregunta de `ask_user` en el cliente. Sin este callback (por
   * ejemplo en `--json` o sin TTY) la pregunta se cancela sin abrir un prompt.
   */
  askUser?: AskUserHandler;
  /**
   * Decide una tool mutante antes de ejecutarla. Sin callback se deniega
   * (headless/--json); el REPL y la TUI pasan el menú interactivo.
   */
  requestApproval?: (approval: ApprovalRequestV2) => Promise<ApprovalDecision | null>;
  /** Cancela el turno en vuelo (Ctrl+C del REPL). */
  signal?: AbortSignal;
  /** Modo del turno; plan/readonly no ofrecen tools que mutan el workspace. */
  mode?: SessionMode;
  /** Plantilla de agente visible en el prompt (F1-08). */
  agent?: string;
  /** Etiqueta legible de la corrida; si falta se usa el id de sesión. */
  runLabel?: string;
}

/** Resultado de una corrida, con el estado final para encadenar turnos. */
export interface RunAgentResult {
  answer: string;
  steps: number;
  sessionId: string;
  seq: number;
  state?: SessionStateV2;
  cancelled?: boolean;
  /** La aprobación caducó: la corrida no debe contarse y ya tiene etiqueta de repetición. */
  invalid?: RunInvalidation;
}

/** Respuesta que el cliente da a una pregunta de `ask_user`. */
export interface AskUserReply {
  answer: string | null;
  reason?: string;
}

/** Resuelve una pregunta en el cliente; sin handler la pregunta se cancela. */
export type AskUserHandler = (question: QuestionV2) => Promise<AskUserReply>;

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
  input: unknown,
  signal?: AbortSignal
): Promise<{ ok: boolean; data?: unknown; error?: string; code?: string; hint?: string }> {
  const failed = (body: Record<string, unknown>, fallback: string) => ({
    ok: false as const,
    error: String(body.error ?? fallback),
    ...(typeof body.code === 'string' ? { code: body.code } : {}),
    ...(typeof body.hint === 'string' ? { hint: body.hint } : {}),
  });
  try {
    const res = await fetch(`${normalizeServerUrl(serverUrl)}/api/agent/run-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId, input }),
      signal,
    });
    const raw = await res.text().catch(() => '');
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const data = isRecord(parsed) ? parsed : {};
    if (!res.ok) return failed(data, `HTTP ${res.status}`);
    // Un 200 sin JSON no es una tool que fue bien: puede ser un proxy, una
    // página de error o un cuerpo vacío. Antes se devolvía `{ok:true,data:{}}`.
    if (!isRecord(parsed)) {
      return { ok: false, error: raw.trim() ? 'HTTP 200 con JSON inválido' : 'HTTP 200 sin cuerpo' };
    }
    // Un 200 puede traer `ok:false` (p. ej. un `fs.edit` que no encontró el
    // `oldString`): sin esto el paso quedaba `completed`.
    if (data.ok === false) return failed(data, 'la tool devolvió ok:false');
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Plazo normal de una aprobación: no se toca fuera del arnés de tests. */
const APPROVAL_TTL_MS = 5 * 60_000;

/**
 * TTL de la aprobación. El override sólo existe para el arnés E2E, que necesita
 * caducar un prompt sin esperar cinco minutos; nunca alarga el plazo normal.
 */
function approvalTtlMs(): number {
  if (process.env.COMMANDER_TEST_MODE !== '1') return APPROVAL_TTL_MS;
  const requested = Number(process.env.COMMANDER_TEST_APPROVAL_TTL_MS);
  if (!Number.isFinite(requested) || requested <= 0) return APPROVAL_TTL_MS;
  return Math.min(requested, APPROVAL_TTL_MS);
}

/** Ruta de generación del servidor según el dialecto del modelo. */
function generateRoute(model: string): string {
  return resolveEndpoint(model);
}

/** Ruta SSE de streaming, o `null` si el modelo no la soporta. */
function streamRoute(model: string): string | null {
  return resolveStreamEndpoint(model);
}

/** Funciones que pueden mutar el workspace o un servicio externo. */
const MUTATING_FUNCTIONS = new Set([
  'fs_write',
  'fs_edit',
  'shell_run',
  'shell_job',
  'shell_pty',
  'browser',
  'preview',
  'code_fix',
  'task',
  'spawn_agents',
  'git_commit',
  'git_worktree',
  'git_rebase',
  'git_conflict',
  'code_run',
  'run_file_change_hooks',
  'worktree_create',
  'mcp_call',
  'linear',
  'github_comment',
]);

/** Ids de tools que no se ofrecen ni se ejecutan en plan/readonly. */
const MUTATING_TOOLS = new Set([
  'fs.write',
  'fs.edit',
  'shell.run',
  'shell.job',
  'shell.pty',
  'browser',
  'preview',
  'code.fix',
  'task',
  'spawn_agents',
  'git.commit',
  'git.worktree',
  'git.rebase',
  'git.conflict',
  'code.run',
  'run_file_change_hooks',
  'worktree.create',
  'mcp.call',
  'linear',
  'github.comment',
]);

/**
 * ¿Esta llamada concreta pasa por el prompt de aprobación?
 *
 * `git.worktree action=list` sólo consulta (`git worktree list`), así que no
 * pide permiso; `add`/`remove` crean o borran directorios y siguen pasando por
 * el gate. En modo plan/readonly la tool entera sigue bloqueada (ver el filtro
 * de `mode !== 'build'`).
 */
function needsApproval(tool: string, input: Record<string, unknown>): boolean {
  if (!MUTATING_TOOLS.has(tool)) return false;
  if (tool === 'git.worktree') {
    return String(input.action ?? '').trim().toLowerCase() !== 'list';
  }
  return true;
}


/** Archivo de test que el CLI acepta en la forma canónica de `node --test`. */
const TEST_FILE_PATTERN = /(?:^|[\\/])[^\\/]+\.(?:test|spec)\.[cm]?[jt]sx?$/i;

/**
 * Política de herramientas del CLI: los tests se verifican con `shell.run` y
 * la forma `node --test <archivo>`. Si el modelo propone `node <test>`, se
 * normaliza antes de pedir aprobación para que el comando ejecutado sea el
 * canónico y esté dentro de la allowlist.
 */
export function normalizeTestCommand(command: unknown): string {
  const text = typeof command === 'string' ? command.trim() : '';
  if (!text || /^node\s+--test(?:\s|$)/i.test(text)) return text;
  const match = text.match(/^node\s+("([^"]+)"|'([^']+)'|(\S+))$/i);
  if (!match) return text;
  const target = (match[2] ?? match[3] ?? match[4] ?? '').replace(/\\/g, '/');
  return TEST_FILE_PATTERN.test(target) ? `node --test ${match[1]}` : text;
}

/**
 * Huella estable de un `shell.run`. Incluye cwd, timeout y flags: dos comandos
 * con el mismo texto pero distinto contexto no son la misma ejecución.
 */
function shellRunFingerprint(input: Record<string, unknown>): string {
  return JSON.stringify(input, Object.keys(input).sort());
}

/**
 * Reconstruye las ejecuciones de `shell.run` que ya están en el estado.
 *
 * Al reanudar, el mapa en memoria nace vacío; sin esto la primera repetición
 * del comando ya ejecutado volvería a pedir una aprobación normal. Se recorre
 * en orden para que una mutación posterior borre la huella, igual que durante
 * la corrida original.
 */
function reconstructExecutedShellRuns(steps: SessionStepV2[]): Map<string, string> {
  const executed = new Map<string, string>();
  for (const step of steps) {
    if (step.type !== 'tool_result' || !step.toolId) continue;
    if (step.toolId !== 'shell.run') {
      // Una mutación posterior invalida las verificaciones anteriores. Un
      // shell.run no se limpia a sí mismo: su propia huella debe sobrevivir
      // para exigir confirmación si se repite.
      if (step.status === 'completed' && WORKSPACE_WRITE_TOOLS.has(step.toolId)) {
        executed.clear();
      }
      continue;
    }
    // Un deny no ejecutó la tool; un allow/allow-session sí, aunque el
    // resultado haya fallado. Los estados viejos sin approval se aceptan si
    // el paso quedó completado.
    if (step.approval?.decision === 'deny') continue;
    const approvedId = step.approval?.id ?? (step.status === 'completed' ? 'session' : undefined);
    if (!approvedId) continue;
    const input =
      step.input && typeof step.input === 'object'
        ? { ...(step.input as Record<string, unknown>) }
        : null;
    if (!input || typeof input.command !== 'string') continue;
    input.command = normalizeTestCommand(input.command);
    executed.set(shellRunFingerprint(input), approvedId);
  }
  return executed;
}

const TEST_CHANGE_PATTERN =
  /(?:\bañade|\bañadir|\bagrega|\bagregar|\bcrea|\bcrear|\bincluye|\bincluir|\bescribe|\bescribir|\badd|\bcreate|\binclude|\bwrite)\b[^.\n]{0,80}\b(?:test|prueba|spec|cobertura)\b|\b(?:test|prueba)\b[^.\n]{0,60}\b(?:cubra|cubrir|cobertura|cover)\b/i;

const TEST_PATH_PATTERN = /(?:^|[\\/])[^\\/]+\.(?:test|spec)\.[cm]?[jt]sx?$/i;

/**
 * Avisos de «test obligatorio» antes de cerrar la corrida. El modelo que ignora
 * la política y sigue intentando cerrar sin test no debe gastar `maxSteps`
 * repitiendo el recordatorio (G1-T2-READ-LOOP).
 */
const MAX_TEST_POLICY_REMINDERS = 2;

/** ¿El objetivo pide añadir o cubrir un test nuevo? */
export function requiresTestChange(goal: unknown): boolean {
  return TEST_CHANGE_PATTERN.test(String(goal ?? ''));
}

/** ¿La ruta corresponde a un archivo de test? */
export function isTestPath(value: unknown): boolean {
  return typeof value === 'string' && TEST_PATH_PATTERN.test(value);
}

const CLI_TOOL_POLICY =
  ' POLÍTICA DE HERRAMIENTAS: para verificar tests usa siempre shell.run con la forma exacta ' +
  '`node --test <archivo>`; no uses code.run para tests ni `node <archivo>`. code.run no está ' +
  'disponible en el CLI. Si el objetivo pide añadir o cubrir un test, edita un archivo de test y ejecuta ' +
  '`node --test` después; no cierres sin ambos.';

/** En build no hay fs.apply: la propuesta no cambia nada y hay que decirlo. */
const CLI_BUILD_PROPOSE_POLICY =
  ' En el CLI no hay fs.apply: fs.propose.* devuelve un diff pero no aplica; para cambiar archivos usa ' +
  'fs.edit/fs.write y no cierres una propuesta como aplicada.';

/** En plan/revisión proponer es la salida: el cambio se revisa, no se aplica. */
const CLI_REVIEW_PROPOSE_POLICY =
  ' En este modo proponer es la vía: usa fs.propose.write/fs.propose.edit para devolver el diff; no ' +
  'intentes aplicar cambios.';

/** Cuerpo común de la petición al LLM (compartido por streaming y no-streaming). */
function buildPayload(
  opts: RunAgentOptions,
  history: string[],
  dialect: ReturnType<typeof toolDialectForModel>,
  maxTokens: number = AGENT_MAX_OUTPUT_TOKENS
): Record<string, unknown> {
  const model = opts.model || GEMINI_DEFAULT_MODEL;
  const objective = opts.goal || opts.task;
  const user =
    `OBJETIVO: ${objective}\nCWD: ${opts.cwd}\n\n` +
    (history.length
      ? `HISTORIAL:\n${history.join('\n')}`
      : 'Aún no hay pasos. Empieza explorando el proyecto.');

  const mode = opts.mode ?? 'build';
  let systemInstruction =
    'Eres un agente autónomo de código. Razona brevemente y llama herramientas ' +
    `para avanzar hacia: ${objective}. Si el objetivo está cumplido, responde ` +
    'SOLO texto final sin llamar herramientas.';
  if (mode === 'plan') {
    systemInstruction +=
      ' MODO PLAN: diseña, explora y propone; no edites archivos ni ejecutes comandos que muten el workspace.';
  } else if (mode === 'readonly') {
    systemInstruction +=
      ' MODO REVISIÓN: inspecciona y reporta; no modifiques archivos ni el repositorio.';
  }
  if (opts.agent) {
    systemInstruction += ` PLANTILLA DE AGENTE: ${opts.agent}.`;
  }
  systemInstruction += CLI_TOOL_POLICY;
  systemInstruction += mode === 'build' ? CLI_BUILD_PROPOSE_POLICY : CLI_REVIEW_PROPOSE_POLICY;

  const payload: Record<string, unknown> = {
    contents: user,
    prompt: user,
    systemInstruction,
    model,
    temperature: 0.2,
    maxTokens,
  };
  // El CLI no pinta el plan y su bucle manda los nombres tal cual al backend:
  // no le ofrecemos `update_plan`, que aquí no existe como tool. En plan y
  // readonly tampoco se ofrecen las tools que mutan.
  const declarations = AGENT_FUNCTION_DECLARATIONS.filter(
    (d) =>
      d.name !== PLAN_TOOL &&
      d.name !== 'code_run' &&
      (mode === 'build' || !MUTATING_FUNCTIONS.has(d.name))
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
    signal: opts.signal,
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
    try {
      return await streamModel(opts, history, route, onChunk);
    } catch (e) {
      // Un stream cortado por presupuesto no cierra la corrida: cae al turno
      // sin streaming, que reintenta con más salida.
      if (!isTruncationError(e) || opts.signal?.aborted) throw e;
    }
  }

  const send = (maxTokens: number) =>
    fetch(`${normalizeServerUrl(opts.serverUrl)}${generateRoute(model)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(opts, history, dialect, maxTokens)),
      signal: opts.signal,
    });
  const readTurn = async (response: Response) => {
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
    return (await response.json()) as {
      text?: string;
      functionCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
      toolCalls?: { name: string; args?: Record<string, unknown> }[];
      choices?: { message?: { content?: string } }[];
      finishReason?: unknown;
      error?: unknown;
    };
  };

  let data = await readTurn(await send(AGENT_MAX_OUTPUT_TOKENS));
  // `finish_reason: length` sin contenido ni tool calls no es una respuesta
  // final (G1-EMPTY-TURN): un reintento con más presupuesto de salida y, si
  // vuelve cortado, la corrida falla en vez de cerrarse vacía.
  if (isTruncatedTurn(data)) {
    data = await readTurn(await send(AGENT_RETRY_MAX_OUTPUT_TOKENS));
    if (isTruncatedTurn(data)) throw new Error(TRUNCATED_TURN_MESSAGE);
  }

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

/** Tope del diff de una propuesta en el historial; el resto de tools sigue en 500. */
const PROPOSAL_HISTORY_LIMIT = 12_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Guarda la propuesta en el checkpoint para que sobreviva al proceso. */
function rememberProposal(state: SessionStateV2 | null, tool: string, data: unknown): void {
  if (!state || !isRecord(data) || !isRecord(data.data)) return;
  const proposal = data.data;
  if (
    typeof proposal.proposalId !== 'string' ||
    typeof proposal.path !== 'string' ||
    typeof proposal.diff !== 'string' ||
    typeof proposal.baseHash !== 'string'
  ) return;
  const known = state.proposals ?? [];
  if (known.some((item) => item.proposalId === proposal.proposalId)) return;
  const drops: ProposalDropStats = { duplicates: 0, perFileCap: 0, totalCap: 0 };
  const stats = proposalStatsFor(known, state.proposalStats);
  state.proposals = normalizeProposals(
    [
      ...known,
      {
        proposalId: proposal.proposalId,
        path: proposal.path,
        diff: proposal.diff,
        baseHash: proposal.baseHash,
        afterHash: typeof proposal.afterHash === 'string' ? proposal.afterHash : '',
        applied: false,
        tool,
        createdAt: Date.now(),
      },
    ],
    drops
  );
  state.proposalStats = {
    ...stats,
    created: stats.created + 1,
    duplicatesDropped: stats.duplicatesDropped + drops.duplicates,
    perFileCapDropped: stats.perFileCapDropped + drops.perFileCap,
    totalCapDropped: stats.totalCapDropped + drops.totalCap,
  };
}

/**
 * Texto del resultado que recibe el modelo. Un resultado con `diff` (propuesta)
 * lleva el diff entero hasta el tope; `summarize` lo cortaba a 500 caracteres
 * dentro del JSON y el modelo decidía sobre un diff incompleto.
 */
function historyResult(data: unknown): string {
  const inner = isRecord(data) && isRecord(data.data) ? data.data : null;
  // Sólo las propuestas: `git.diff` también trae `diff`, pero no es un cambio
  // pendiente de revisar y no debe ocupar 12 KB de historial.
  if (inner && typeof inner.diff === 'string' && typeof inner.proposalId === 'string') {
    const { diff, ...rest } = inner;
    const header = JSON.stringify(rest);
    const room = Math.max(0, PROPOSAL_HISTORY_LIMIT - header.length - 80);
    if (diff.length <= room) return `${header}\n--- DIFF ---\n${diff}`;
    return (
      `${header}\n--- DIFF ---\n${diff.slice(0, room)}\n` +
      `[diff truncado: ${room} de ${diff.length} caracteres]`
    );
  }
  return summarize(data);
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

export interface LoadServerSessionOptions {
  /** `attach` necesita leer una sesión que está corriendo; `--resume` no. */
  allowRunning?: boolean;
}

/** Carga una sesión persistida para `--resume` o para adjuntarse a su stream. */
export async function loadServerSession(
  serverUrl: string,
  id: string,
  options: LoadServerSessionOptions = {}
): Promise<SessionStateV2> {
  const res = await fetch(sessionEndpoint(serverUrl, `/${encodeURIComponent(id)}`), {
    signal: AbortSignal.timeout(10_000),
  });
  return readSessionState(res, options.allowRunning !== true);
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

/** Resumen de sesión que devuelve `GET /api/agent/sessions`. */
export interface ServerSessionSummary {
  id: string;
  goal: string;
  model?: string;
  status?: string;
  steps?: number;
  createdAt?: number;
}

/** Lista las sesiones guardadas para `/resume` y `/fork` sin id. */
export async function listServerSessions(serverUrl: string): Promise<ServerSessionSummary[]> {
  const res = await fetch(sessionEndpoint(serverUrl, ''), {
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    sessions?: unknown;
    error?: string;
  };
  if (!res.ok || !body.success) throw new Error(String(body.error || `HTTP ${res.status}`));
  if (!Array.isArray(body.sessions)) return [];
  return body.sessions
    .filter((item): item is ServerSessionSummary => {
      return Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string');
    })
    .slice(0, 20);
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
        mode: opts.mode || 'build',
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
export async function saveServerState(serverUrl: string, state: SessionStateV2): Promise<void> {
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

/** Convierte los argumentos de `ask_user` al contrato de pregunta del CLI. */
function questionFromInput(input: Record<string, unknown>): QuestionV2 | null {
  const text = typeof input.question === 'string' ? input.question.trim() : '';
  if (!text) return null;
  const header = typeof input.header === 'string' ? input.header.trim() : '';
  const options = Array.isArray(input.options)
    ? input.options
        .map((option) => String(option ?? '').trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const question: QuestionV2 = {
    id: uid('q'),
    text,
    allowFreeText: input.allowFreeText !== false,
  };
  if (header) question.header = header;
  if (options.length) question.options = options;
  return question;
}

/**
 * Ejecuta el bucle del agente hasta terminar o agotar `maxSteps`.
 *
 * Con `persistSession` (lo activa el CLI) la corrida crea una sesión en el
 * servidor y sincroniza turnos/pasos en cada avance; con `resumeFrom` continúa
 * una sesión existente sin repetir el historial. El bucle sigue siendo local
 * para conservar el streaming hasta que F1-03 lo mueva al servidor.
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const resumed = opts.resumeFrom
    ? (JSON.parse(JSON.stringify(opts.resumeFrom)) as SessionStateV2)
    : null;
  // Un turno reanudado no hereda el corte del turno anterior: si vuelve a
  // cortarse, `loopCut` tiene que describir el corte nuevo.
  if (resumed) delete resumed.loopCut;
  const requestedMode = opts.mode ?? resumed?.mode ?? 'build';
  opts = { ...opts, mode: requestedMode };
  let sessionId = resumed?.id || opts.sessionId || '';
  let state: SessionStateV2 | null = resumed;
  let syncEnabled = Boolean(resumed);
  let cancelled = false;

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
  const done = (
    answer: string,
    steps: number,
    invalid?: RunInvalidation
  ): RunAgentResult => ({
    answer,
    steps,
    sessionId: sequencer.sessionId,
    seq: sequencer.lastSeq,
    ...(state ? { state } : {}),
    ...(cancelled ? { cancelled: true } : {}),
    ...(invalid ? { invalid } : {}),
  });
  const maxSteps = Math.max(1, opts.maxSteps ?? 25);
  const approvedForSession = new Set<string>();
  // shell.run ejecutado → id de la aprobación que lo permitió (o 'session').
  // Una repetición idéntica exige confirmación explícita, nunca reutiliza la
  // aprobación anterior; una mutación exitosa del workspace limpia la huella.
  const executedShellRuns = reconstructExecutedShellRuns(state?.steps ?? []);
  let testEditStep = 0;
  let testRunStep = 0;
  let testPolicyReminders = 0;
  // Escalada común: la 2.ª repetición avisa, la 3.ª falla y la 4.ª corta.
  const loopGuard = new LoopGuard();
  // Gate de verificación: tras editar código exige una ejecución de tests,
  // build o typecheck posterior y no deja cerrar mientras esté en rojo.
  const verifyGate = new VerifyGate();
  // Tandas seguidas de `spawn_agents` con algún hijo fallido. El bucle del
  // servidor ya corta a la segunda (`spawnFailureStreak` en
  // `AgentSession.stepNative`); el CLI corre el suyo y no lo tenía, así que
  // G1-T10-06 lanzó seis tandas hasta agotar el presupuesto.
  let spawnFailureStreak = 0;
  const goal = state?.goal || opts.goal || opts.task;
  const model = opts.model || state?.model || GEMINI_DEFAULT_MODEL;
  const mode = opts.mode ?? state?.mode ?? 'build';
  // A partir de aquí todo (incluido el prompt y el evento `session`) usa el
  // objetivo persistido, el modelo y el modo reales de la sesión reanudada.
  opts = { ...opts, goal, model, mode };
  if (state) {
    state.model = model;
    state.mode = mode;
  }
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
  /**
   * Retira del estado la aprobación que se acaba de resolver.
   *
   * El servidor persiste el checkpoint tal cual llega, así que borrarla aquí es
   * lo que evita que un `GET` siga anunciando un prompt que ya no existe.
   */
  const clearPendingApproval = async (): Promise<void> => {
    if (!state) return;
    const announced = state.pendingApproval !== null || Boolean(state.pendingApprovals?.length);
    state.pendingApproval = null;
    delete state.pendingApprovals;
    if (!announced) return;
    state.updatedAt = Date.now();
    await sync();
  };
  const markCancelled = async (text = 'Turno cancelado.'): Promise<void> => {
    if (cancelled) return;
    cancelled = true;
    emit({ type: 'error', text });
    if (state) {
      state.status = 'cancelled';
      state.error = text;
      // Abortar o caducar cierra el prompt: no puede quedar anunciado.
      state.pendingApproval = null;
      delete state.pendingApprovals;
      state.updatedAt = Date.now();
      await sync();
    }
  };

  if (state) {
    addTurn({ role: 'user', text: opts.task });
    state.status = 'running';
    delete state.answer;
    delete state.error;
    // Una corrida nueva sobre la misma sesión no hereda la invalidez anterior.
    delete state.invalid;
    // Una aprobación que dejó abierta la corrida anterior no sigue pendiente al
    // reanudar: el prompt que la esperaba murió con aquel proceso. Si hace
    // falta, este turno la vuelve a pedir.
    state.pendingApproval = null;
    delete state.pendingApprovals;
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
      mode,
      status: 'running',
    },
  });

  for (let i = 0; i < maxSteps; i++) {
    if (opts.signal?.aborted) {
      await markCancelled();
      return done('', steps);
    }
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
      if (opts.signal?.aborted) {
        await markCancelled();
        return done('', steps);
      }
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
      if (requiresTestChange(goal) && !(testEditStep > 0 && testRunStep > testEditStep)) {
        testPolicyReminders += 1;
        if (testPolicyReminders > MAX_TEST_POLICY_REMINDERS) {
          const text =
            `Política de test obligatorio: ${MAX_TEST_POLICY_REMINDERS + 1} avisos sin editar un test ` +
            'y ejecutar `node --test`; se corta la corrida para no gastar los pasos que quedan. La ' +
            'tarea queda sin verificar.';
          emit({ type: 'error', text });
          history.push(`SISTEMA: ${text}`);
          await addStep({
            type: 'thought',
            title: 'Corte por política de test',
            content: text,
            status: 'failed',
          });
          if (state) {
            state.answer = text;
            state.status = 'failed';
            state.error = text;
            state.updatedAt = Date.now();
            await sync();
          }
          emit({ type: 'answer', text });
          return done(text, steps);
        }
        const text =
          'Política de test obligatorio: edita un archivo de test y ejecuta `node --test` después ' +
          'antes de cerrar la tarea.';
        emit({ type: 'error', text });
        history.push(`SISTEMA: ${text}`);
        await addStep({ type: 'thought', title: 'Test obligatorio', content: text, status: 'failed' });
        continue;
      }
      // Gate de verificación: sin una ejecución en verde posterior a la última
      // edición de código no hay respuesta final. Se devuelve al modelo con la
      // salida real del comando; a la tercera intentona la corrida queda failed.
      if (verifyGate.needsVerification()) {
        const evidence = verifyGate.evidence();
        const refusals = verifyGate.refusal();
        const rojo = Boolean(evidence && !evidence.ok);
        if (refusals > MAX_VERIFY_REFUSALS) {
          const motivo = rojo && evidence
            ? `Gate de verificación: \`${evidence.command}\` salió con exit ${evidence.exitCode ?? 'no disponible'} después de la última edición. No se cierra la tarea sin verde.`
            : `Gate de verificación: no se verificó después de la última edición de código: ejecuta \`${verifyGate.suggestedCommand()}\` y no cierres hasta que salga en verde.`;
          emit({ type: 'error', text: motivo });
          history.push(`SISTEMA: ${motivo}`);
          await addStep({
            type: 'thought',
            title: 'Gate de verificación',
            content: motivo,
            status: 'failed',
          });
          if (state) {
            state.answer = motivo;
            state.status = 'failed';
            state.error = motivo;
            state.updatedAt = Date.now();
            await sync();
          }
          emit({ type: 'answer', text: motivo });
          return done(motivo, steps);
        }
        const text = rojo && evidence
          ? `Gate de verificación: \`${evidence.command}\` sigue en rojo (exit ${evidence.exitCode ?? 'desconocido'}) después de tu última edición. No cierres: corrige el fallo y vuelve a ejecutar la verificación.${evidence.output ? `\n${evidence.output}` : ''}`
          : `Gate de verificación: editaste código y no hay una verificación posterior. Ejecuta \`${verifyGate.suggestedCommand()}\` con shell.run antes de cerrar; si sale en rojo, corrige y repite.`;
        emit({ type: 'error', text });
        history.push(`SISTEMA: ${text}`);
        await addStep({ type: 'thought', title: 'Gate de verificación', content: text, status: 'failed' });
        continue;
      }
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
    // Resultados de `spawn_agents` de esta tanda, para la guarda de racha.
    const spawnRuns: { tool: string; ok: boolean; data?: unknown }[] = [];
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
      if (mode !== 'build' && MUTATING_TOOLS.has(mapped.tool)) {
        const text = `Tool bloqueada en modo ${mode}: ${mapped.tool}`;
        emit({ type: 'error', text });
        history.push(`TOOL ${mapped.tool} → ERROR: ${text}`);
        await addStep({
          type: 'thought',
          title: 'Tool bloqueada',
          content: text,
          status: 'failed',
        });
        continue;
      }
      if (mapped.tool === 'code.run') {
        const text =
          'Política del CLI: code.run no está disponible; verifica tests con shell.run y ' +
          '`node --test <archivo>`.';
        emit({ type: 'error', text });
        history.push(`TOOL ${mapped.tool} → ERROR: ${text}`);
        await addStep({ type: 'thought', title: 'Política de tools', content: text, status: 'failed' });
        continue;
      }
      if (mapped.tool === 'shell.run' && typeof input.command === 'string') {
        input.command = normalizeTestCommand(input.command);
      }
      const shellRunKey = mapped.tool === 'shell.run' ? shellRunFingerprint(input) : undefined;
      // `repeatOf` es la ejecución previa: su presencia ya marca la repetición.
      const repeatOf = shellRunKey ? executedShellRuns.get(shellRunKey) : undefined;
      const repeat = loopGuard.repeat(mapped.tool, input);
      if (repeat) {
        if (repeat.action === 'cut') {
          const text = repeat.message;
          emit({ type: 'error', text });
          addTurn({ role: 'tool', text: `TOOL ${mapped.tool} → ERROR: ${text}` });
          await addStep({
            type: 'tool_result',
            toolId: mapped.tool,
            title: mapped.tool,
            content: text,
            input: mapped.input,
            output: { skipped: 'loop', ...repeat.cut },
            status: 'failed',
          });
          await addStep({ type: 'thought', title: 'Bucle de tool detectado', content: text, status: 'failed' });
          if (state) {
            state.answer = text;
            state.status = 'failed';
            state.error = text;
            state.loopCut = repeat.cut;
            state.updatedAt = Date.now();
            await sync();
          }
          emit({ type: 'answer', text });
          return done(text, steps);
        }
        // La sesión sigue, que `maxSteps` ya acota el resto.
        const summary = repeat.message;
        const warned = repeat.action === 'warn';
        emit({ type: 'tool_result', tool: mapped.tool, ok: warned, summary });
        history.push(`TOOL ${mapped.tool} → ${summary}`);
        addTurn({ role: 'tool', text: `TOOL ${mapped.tool} → ${summary}` });
        await addStep({
          type: 'tool_result',
          toolId: mapped.tool,
          title: mapped.tool,
          content: summary,
          input: mapped.input,
          output: { skipped: 'duplicate' },
          status: warned ? 'completed' : 'failed',
        });
        if (!warned) {
          await addStep({
            type: 'thought',
            title: 'Bucle de tool detectado',
            content: summary,
            status: 'completed',
          });
        }
        continue;
      }
      let approval:
        | {
            id: string;
            decision: ApprovalDecision;
            reason?: string;
            latencyMs?: number;
            decisionMs?: number;
            pendingInStateAt?: number;
            promptStartedAt?: number;
            promptPaintedAt?: number;
            queueDepth?: number;
            stateMs?: number;
            queueMs?: number;
            noticeAt?: number;
            noticeMs?: number;
            stateWithin250Ms?: boolean;
            noticeWithin250Ms?: boolean;
            firstInputAt?: number;
            firstNonDecisionKeyAt?: number;
            decisionAt?: number;
            paintMs?: number;
            attentionMs?: number;
            readMs?: number;
            directDecision?: boolean;
            quarantinedKeys?: number;
            quarantinedDecision?: boolean;
            render?: ApprovalRenderFacts;
            repeatOf?: string;
          }
        | undefined;
      // `fs.propose.write`/`fs.propose.edit` no están aquí a propósito: devuelven
      // un diff y no tocan disco (G1-D3 §6.3). Pedir aprobación sin enseñar el
      // diff sólo añade ruido; lo que escribe de verdad es `fs.write`, que sí
      // pasa por este prompt.
      if (needsApproval(mapped.tool, input)) {
        const approvalKey = `${goal}\u0000${mapped.tool}`;
        // `allow-session` no puede auto-permitir una repetición idéntica: el
        // mismo comando ya ejecutado vuelve a pasar por confirmación explícita.
        if (repeatOf !== undefined || !approvedForSession.has(approvalKey)) {
          const requestedAt = Date.now();
          // Sin `diff` el menú no pinta el hunk y `approval.render` queda en `false`.
          const diff = approvalDiffFor(mapped.tool, input, opts.cwd);
          const request: ApprovalRequestV2 = {
            id: uid('apr'),
            sessionId: sequencer.sessionId,
            tool: mapped.tool,
            input: mapped.input,
            ...(diff === undefined ? {} : { diff }),
            ...(repeatOf === undefined ? {} : { repeatOf }),
            createdAt: requestedAt,
            expiresAt: requestedAt + approvalTtlMs(),
            // El bucle local no usa ApprovalQueue: el prompt es el único que
            // puede abrirse y no hay otra aprobación delante.
            queueDepth: 0,
          };
          // La aprobación queda pendiente aunque no haya una sesión persistida
          // (corridas directas/goldens): ese instante es el inicio de la cola.
          request.pendingInStateAt = Date.now();
          emit({ type: 'approval_request', approval: request });
          // Quien no está delante del menú sólo ve el estado: un `attach`, el
          // escritorio o el `GET` de la sesión. Sin esto el prompt queda abierto
          // sin que nadie lo sepa (G1-D4-05 esperó 801 s). La decisión sigue
          // viviendo en la promesa de este proceso: esto la anuncia, no la resuelve.
          if (state) {
            state.pendingApproval = request;
            state.updatedAt = request.pendingInStateAt;
            await sync();
          }
          let decision: ApprovalDecision | null = null;
          let reason: string | undefined;
          try {
            if (opts.requestApproval) decision = await opts.requestApproval(request);
            else reason = 'sin terminal interactiva';
          } catch (e) {
            decision = 'deny';
            reason = e instanceof Error ? e.message : String(e);
          }
          if (opts.signal?.aborted) {
            await markCancelled();
            return done('', steps);
          }
          // `render` lo escribe el prompt al resolver: qué se pintó y si caducó
          // (I2 del protocolo CAL2). Lo caducado no se puede aprobar después.
          const expired = request.render?.expired === true;
          // En una repetición, `allow-session` sólo vale para esta confirmación:
          // no amplía el permiso de sesión ni auto-permite la próxima.
          const finalDecision = expired
            ? 'deny'
            : repeatOf !== undefined && decision === 'allow-session'
              ? 'allow'
              : (decision ?? 'deny');
          if (expired) reason = 'expired';
          else if (!decision && !reason) reason = 'sin decisión';
          const decidedAt = Date.now();
          const latencyMs = Math.max(0, decidedAt - requestedAt);
          // La bitácora separa los tres tramos del ciclo. `latencyMs` sigue
          // midiendo desde `createdAt` y no se toca; `decisionMs`/`readMs`
          // arrancan en la primera tecla no decisoria.
          const pendingInStateAt =
            typeof request.pendingInStateAt === 'number' && Number.isFinite(request.pendingInStateAt)
              ? request.pendingInStateAt
              : undefined;
          const promptStartedAt =
            typeof request.promptStartedAt === 'number' && Number.isFinite(request.promptStartedAt)
              ? request.promptStartedAt
              : undefined;
          const promptPaintedAt =
            typeof request.promptPaintedAt === 'number' && Number.isFinite(request.promptPaintedAt)
              ? request.promptPaintedAt
              : undefined;
          const noticeAt =
            typeof request.noticeAt === 'number' && Number.isFinite(request.noticeAt)
              ? request.noticeAt
              : undefined;
          const firstInputAt =
            typeof request.firstInputAt === 'number' && Number.isFinite(request.firstInputAt)
              ? request.firstInputAt
              : typeof request.firstKeyAt === 'number' && Number.isFinite(request.firstKeyAt)
                ? request.firstKeyAt
                : undefined;
          const firstNonDecisionKeyAt =
            typeof request.firstNonDecisionKeyAt === 'number' &&
            Number.isFinite(request.firstNonDecisionKeyAt)
              ? request.firstNonDecisionKeyAt
              : undefined;
          const decisionAt =
            typeof request.decisionAt === 'number' && Number.isFinite(request.decisionAt)
              ? request.decisionAt
              : decidedAt;
          request.decisionAt = decisionAt;
          const stateMs =
            pendingInStateAt === undefined || requestedAt <= 0
              ? undefined
              : Math.max(0, pendingInStateAt - requestedAt);
          const noticeMs =
            noticeAt === undefined || requestedAt <= 0 ? undefined : Math.max(0, noticeAt - requestedAt);
          const stateWithin250Ms =
            stateMs === undefined ? undefined : stateMs <= APPROVAL_VISIBILITY_BUDGET_MS;
          const noticeWithin250Ms =
            noticeMs === undefined ? undefined : noticeMs <= APPROVAL_VISIBILITY_BUDGET_MS;
          const queueMs =
            pendingInStateAt === undefined || promptStartedAt === undefined
              ? undefined
              : Math.max(0, promptStartedAt - pendingInStateAt);
          const paintMs =
            promptStartedAt === undefined || promptPaintedAt === undefined
              ? undefined
              : Math.max(0, promptPaintedAt - promptStartedAt);
          const attentionMs =
            promptPaintedAt === undefined || firstInputAt === undefined
              ? undefined
              : Math.max(0, firstInputAt - promptPaintedAt);
          const readMs =
            firstNonDecisionKeyAt === undefined
              ? undefined
              : Math.max(0, decisionAt - firstNonDecisionKeyAt);
          // CAL2: la latencia que describe lectura se mide desde la primera
          // tecla que no decide. `latencyMs` se conserva (incluye el tiempo sin
          // nadie delante) para no romper las muestras ya publicadas. `readMs`
          // es el nombre de la bitácora y `decisionMs` su alias compatible:
          // ambos sólo existen si hubo una tecla de lectura previa. Una decisión
          // directa se marca con `directDecision` y no inventa 0 ms.
          if (finalDecision === 'allow-session') approvedForSession.add(approvalKey);
          const render = request.render ? { render: request.render } : {};
          const mediciones = {
            ...(stateMs === undefined ? {} : { stateMs, stateWithin250Ms }),
            ...(queueMs === undefined ? {} : { queueMs }),
            ...(noticeMs === undefined ? {} : { noticeMs, noticeWithin250Ms }),
            ...(paintMs === undefined ? {} : { paintMs }),
            ...(attentionMs === undefined ? {} : { attentionMs }),
            ...(readMs === undefined ? {} : { readMs, decisionMs: readMs }),
          };
          const instrumentacion = {
            ...(repeatOf === undefined ? {} : { repeatOf }),
            ...(pendingInStateAt === undefined ? {} : { pendingInStateAt }),
            ...(promptStartedAt === undefined ? {} : { promptStartedAt }),
            ...(promptPaintedAt === undefined ? {} : { promptPaintedAt }),
            ...(typeof request.queueDepth === 'number' && Number.isFinite(request.queueDepth)
              ? { queueDepth: request.queueDepth }
              : {}),
            ...(noticeAt === undefined ? {} : { noticeAt }),
            ...(firstInputAt === undefined ? {} : { firstInputAt }),
            ...(firstNonDecisionKeyAt === undefined ? {} : { firstNonDecisionKeyAt }),
            decisionAt,
            ...(request.directDecision === true ? { directDecision: true } : {}),
            ...(typeof request.quarantinedKeys === 'number' && Number.isFinite(request.quarantinedKeys)
              ? { quarantinedKeys: request.quarantinedKeys }
              : {}),
            ...(request.quarantinedDecision === true ? { quarantinedDecision: true } : {}),
          };
          approval = {
            id: request.id,
            decision: finalDecision,
            ...(reason ? { reason } : {}),
            latencyMs,
            ...mediciones,
            ...instrumentacion,
            ...render,
          };
          emit({
            type: 'approval_result',
            approvalId: request.id,
            decision: finalDecision,
            ...(reason ? { reason } : {}),
            latencyMs,
            ...mediciones,
            ...instrumentacion,
            ...render,
          });
          await clearPendingApproval();
          if (finalDecision === 'deny') {
            const text = `ERROR: aprobación denegada${reason ? ` (${reason})` : ''}: ${mapped.tool}`;
            emit({ type: 'tool_result', tool: mapped.tool, ok: false, summary: text });
            history.push(`TOOL ${mapped.tool} → ${text}`);
            addTurn({ role: 'tool', text: `TOOL ${mapped.tool} → ${text}` });
            await addStep({
              type: 'tool_result',
              toolId: mapped.tool,
              title: mapped.tool,
              content: text,
              input: mapped.input,
              status: 'failed',
              approval,
            });
            // Una aprobación que caduca no deja la sesión esperando otro intento.
            // La corrida se marca `invalid` (no se publica como muestra) y se
            // deja preparada la etiqueta de repetición; no se relanza sola.
            if (expired) {
              const invalid: RunInvalidation = {
                reason: 'approval_expired',
                approvalId: request.id,
                retryLabel: nextRunLabel(opts.runLabel?.trim() || sequencer.sessionId),
              };
              if (state) state.invalid = invalid;
              await markCancelled(
                `Aprobación caducada: nadie la decidió antes de expiresAt. Corrida invalid; repetir con etiqueta ${invalid.retryLabel}.`
              );
              return done('', steps, invalid);
            }
            continue;
          }
        }
      }
      emit({ type: 'tool_call', tool: mapped.tool, input: mapped.input });
      await addStep({
        type: 'tool_call',
        toolId: mapped.tool,
        title: mapped.tool,
        content: summarize(mapped.input ?? {}, 500),
        input: mapped.input,
        status: 'running',
        ...(approval ? { approval } : {}),
      });
      if (mapped.tool === 'ask_user') {
        const question = questionFromInput(input);
        if (!question) {
          const text = 'ERROR: ask_user requiere question';
          emit({ type: 'error', text });
          history.push(`TOOL ask_user → ${text}`);
          await addStep({ type: 'thought', title: 'ask_user inválida', content: text, status: 'failed' });
          continue;
        }

        emit({ type: 'question', question });
        let reply: AskUserReply = {
          answer: null,
          reason: opts.askUser ? 'sin respuesta' : 'sin terminal interactiva',
        };
        if (opts.askUser) {
          try {
            const resolved = await opts.askUser(question);
            if (resolved) reply = resolved;
          } catch (e) {
            reply = { answer: null, reason: e instanceof Error ? e.message : String(e) };
          }
        }
        if (opts.signal?.aborted) {
          await markCancelled();
          return done('', steps);
        }

        const answer = typeof reply.answer === 'string' ? reply.answer.trim() : '';
        if (answer) {
          const summary = `respuesta: ${answer}`;
          emit({ type: 'tool_result', tool: mapped.tool, ok: true, summary });
          history.push(`TOOL ${mapped.tool} → ${summary}`);
          addTurn({ role: 'tool', text: `PREGUNTA: ${question.text}\nRESPUESTA: ${answer}` });
          await addStep({
            type: 'tool_result',
            toolId: mapped.tool,
            title: mapped.tool,
            content: summary,
            input: mapped.input,
            output: { answer },
            status: 'completed',
          });
        } else {
          const text = `ERROR: pregunta cancelada${reply.reason ? ` (${reply.reason})` : ''}`;
          emit({ type: 'tool_result', tool: mapped.tool, ok: false, summary: text });
          history.push(`TOOL ${mapped.tool} → ${text}`);
          addTurn({ role: 'tool', text: `PREGUNTA: ${question.text}\n${text}` });
          await addStep({
            type: 'tool_result',
            toolId: mapped.tool,
            title: mapped.tool,
            content: text,
            input: mapped.input,
            status: 'failed',
          });
        }
        continue;
      }
      // `task` y `spawn_agents` los lanza la app, no el modelo: el servidor
      // necesita el id de la sesión padre y el modelo no puede conocerlo (el
      // bucle del servidor hace lo mismo en `agentSession.runOne`). Sin esto el
      // CLI recibía «parentSessionId requerido» en el tercer paso de T10.
      const toolInput: Record<string, unknown> = { ...input, root: opts.cwd };
      if (mapped.tool === 'task' || mapped.tool === 'spawn_agents') {
        toolInput.parentSessionId = sessionId;
      }
      const result = await runTool(opts.serverUrl, mapped.tool, toolInput, opts.signal);
      if (mapped.tool === 'spawn_agents') {
        // La guarda mira el resultado tal como llega del endpoint
        // (`{ ok, data: { results, spawned, capped } }`), no el texto del paso.
        spawnRuns.push({ tool: mapped.tool, ok: result.ok, data: result.data });
      }
      if (shellRunKey) {
        executedShellRuns.set(shellRunKey, approval?.id ?? 'session');
      }
      if (result.ok && mapped.tool !== 'shell.run' && WORKSPACE_WRITE_TOOLS.has(mapped.tool)) {
        // El workspace cambió: la misma verificación vuelve a ser legítima.
        executedShellRuns.clear();
      }
      if (opts.signal?.aborted) {
        await markCancelled();
        return done('', steps);
      }
      // El `hint` del servidor (p. ej. «posiblemente ya aplicado») tiene que
      // llegar al modelo: es lo que evita que relea el archivo para averiguarlo.
      const failure = `ERROR: ${result.error}${result.hint ? ` — ${result.hint}` : ''}`;
      const summary = result.ok ? summarize(result.data) : failure;
      const historyText = result.ok ? historyResult(result.data) : failure;
      if (result.ok) {
        loopGuard.succeeded(mapped.tool, input);
        rememberProposal(state, mapped.tool, result.data);
        if ((mapped.tool === 'fs.edit' || mapped.tool === 'fs.write') && isTestPath(input.path)) {
          testEditStep = steps;
          testPolicyReminders = 0;
        }
        if (mapped.tool === 'fs.edit' || mapped.tool === 'fs.write') {
          verifyGate.noteEdit(input.path, steps);
          // El empujón va en cuanto se edita, no sólo al intentar cerrar.
          if (verifyGate.needsVerification()) {
            const nudge = `Editaste código (${String(input.path ?? '')}): ejecuta \`${verifyGate.suggestedCommand()}\` con shell.run antes de dar el cambio por bueno.`;
            emit({ type: 'status', text: nudge });
            history.push(`SISTEMA: ${nudge}`);
          }
        }
        if (
          mapped.tool === 'shell.run' &&
          typeof input.command === 'string' &&
          /^node\s+--test(?:\s|$)/i.test(input.command)
        ) {
          testRunStep = steps;
          testPolicyReminders = 0;
        }
      }
      emit({ type: 'tool_result', tool: mapped.tool, ok: result.ok, summary });
      history.push(`TOOL ${mapped.tool} → ${historyText}`);
      // `turns` es estado para attach/UI: no duplicamos ahí el diff completo.
      addTurn({ role: 'tool', text: `TOOL ${mapped.tool} → ${summary}` });
      await addStep({
        type: 'tool_result',
        toolId: mapped.tool,
        title: mapped.tool,
        content: result.ok ? summarize(result.data, 2_000) : failure,
        input: mapped.input,
        output: result.data,
        status: result.ok ? 'completed' : 'failed',
      });
      if (mapped.tool === 'shell.run' && typeof input.command === 'string') {
        verifyGate.noteRun(input.command, result, steps);
      }
    }

    // El modelo puede re-lanzar `spawn_agents` cuando falla algún hijo
    // (G1-D5-08, G1-D5-10 y G1-T10-06). A la segunda tanda seguida con algún
    // hijo fallido se cierra informando, con el mismo texto que el servidor.
    const hijos = spawnChildrenFromResults(spawnRuns);
    spawnFailureStreak = spawnBatchHadFailure(hijos) ? spawnFailureStreak + 1 : 0;
    if (spawnFailureStreak >= 2) {
      // Mismo texto que el bucle del servidor (`spawnFailureClosingMessage`).
      const answer = spawnFailureClosingMessage(hijos);
      addTurn({ role: 'assistant', text: answer });
      await addStep({ type: 'thought', title: 'Finalizado', content: answer, status: 'completed' });
      if (state) {
        state.answer = answer;
        state.status = 'completed';
        state.updatedAt = Date.now();
        await sync();
      }
      emit({ type: 'answer', text: answer });
      return done(answer, steps);
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
