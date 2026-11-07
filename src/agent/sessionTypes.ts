/**
 * Contrato de estado y eventos de sesión (F1-01).
 *
 * Fuente única para el servidor, el CLI (`--json`), el SSE y la TUI: todos
 * hablan el mismo sobre `{schemaVersion: 2, seq, sessionId}` y el mismo
 * `SessionStateV2`.
 *
 * El módulo no importa nada de Node ni del servidor a propósito: el CLI corre
 * en el proceso del usuario y tiene que poder importarlo tal cual.
 */

export const SESSION_SCHEMA_VERSION = 2 as const;

/** Modo del agente, igual que en el resto de la app. */
export type SessionMode = 'build' | 'plan' | 'readonly';

/** Estado de la sesión en el contrato v2 (el estado interno legado se mapea). */
export type SessionStatusV2 = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export type SessionStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type SessionStepType = 'thought' | 'tool_call' | 'tool_result' | 'plan' | 'subagent';

export interface SessionStepV2 {
  id: string;
  type: SessionStepType;
  toolId?: string;
  title: string;
  content: string;
  input?: unknown;
  output?: unknown;
  status: SessionStepStatus;
  durationMs?: number;
  ts: number;
}

export interface SessionPlanItemV2 {
  id: string;
  text: string;
  done: boolean;
}

export interface SessionTurnV2 {
  role: 'user' | 'assistant' | 'tool';
  text: string;
  ts: number;
}

/** Pregunta de `ask_user` (F1-06); aquí solo se define la forma. */
export interface QuestionV2 {
  id: string;
  header?: string;
  text: string;
  options?: string[];
  allowFreeText?: boolean;
}

export type ApprovalDecision = 'allow' | 'deny' | 'allow-session';

/** Aprobación pendiente (F1-04); el bucle todavía no la emite. */
export interface ApprovalRequestV2 {
  id: string;
  sessionId: string;
  tool: string;
  input: unknown;
  diff?: string;
  hunks?: unknown[];
  createdAt: number;
  expiresAt: number;
}

/**
 * Estado completo de una sesión ejecutable.
 *
 * `pendingApproval` existe desde ya para que F1-04 no tenga que cambiar la
 * forma persistida; hoy siempre es `null`.
 */
export interface SessionStateV2 {
  schemaVersion: 2;
  id: string;
  goal: string;
  cwd: string;
  model: string;
  mode: SessionMode;
  status: SessionStatusV2;
  turns: SessionTurnV2[];
  steps: SessionStepV2[];
  plan: SessionPlanItemV2[];
  pendingApproval: ApprovalRequestV2 | null;
  createdAt: number;
  updatedAt: number;
  /** Última respuesta final, si la hubo. */
  answer?: string;
  /** Último error, si la sesión falló. */
  error?: string;
}

/** Datos mínimos de la sesión que viajan en el primer evento. */
export interface SessionInfoV2 {
  id: string;
  goal: string;
  cwd: string;
  model: string;
  mode: SessionMode;
  status: SessionStatusV2;
}

/**
 * Cuerpo de un evento, sin el sobre.
 *
 * Se conservan los tipos que ya emitía el CLI y se añaden los que necesitan
 * approvals, preguntas y plan (F1-03/F1-04/F1-06) más `done`, que el CLI ya
 * escribía sin versión y también forma parte del contrato.
 */
export type CliEventPayload =
  | { type: 'session'; session: SessionInfoV2 }
  | { type: 'status'; text: string }
  /** Delta de texto del modelo durante el streaming. */
  | { type: 'chunk'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; ok: boolean; summary: string }
  | { type: 'plan'; plan: SessionPlanItemV2[] }
  | { type: 'approval_request'; approval: ApprovalRequestV2 }
  | {
      type: 'approval_result';
      approvalId: string;
      decision: ApprovalDecision;
      reason?: string;
    }
  | { type: 'question'; question: QuestionV2 }
  | { type: 'answer'; text: string }
  | { type: 'error'; text: string }
  | { type: 'done'; answer: string; steps: number };

export type CliEventType = CliEventPayload['type'];

export const CLI_EVENT_TYPES: readonly CliEventType[] = [
  'session',
  'status',
  'chunk',
  'thought',
  'tool_call',
  'tool_result',
  'plan',
  'approval_request',
  'approval_result',
  'question',
  'answer',
  'error',
  'done',
];

export interface EventEnvelopeV2 {
  schemaVersion: 2;
  /** Monotónico por sesión, empezando en 1. */
  seq: number;
  sessionId: string;
}

/** Reparte el sobre sobre cada variante para que el narrowing por `type` funcione. */
type WithEnvelope<T> = T extends unknown ? EventEnvelopeV2 & T : never;

export type CliEventV2 = WithEnvelope<CliEventPayload>;

export function isCliEventType(value: unknown): value is CliEventType {
  return typeof value === 'string' && (CLI_EVENT_TYPES as readonly string[]).includes(value);
}

/** Construye un evento sellado con la versión y el `seq` indicados. */
export function makeEventV2<P extends CliEventPayload>(
  sessionId: string,
  seq: number,
  payload: P
): CliEventV2 {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    seq,
    sessionId,
    ...payload,
  } as CliEventV2;
}

/** Asigna el `seq` de una sesión: una instancia por corrida. */
export class EventSequencer {
  private value = 0;

  /**
   * `startSeq` permite continuar una sesión persistida sin reiniciar el
   * contador en 1. Los eventos históricos no se reemiten, pero el `seq` sigue
   * siendo creciente para los consumidores que ya vieron esa sesión.
   */
  constructor(readonly sessionId: string, startSeq = 0) {
    this.value = Math.max(0, Math.floor(Number(startSeq) || 0));
  }

  /** Último `seq` repartido (0 si todavía no se emitió nada). */
  get lastSeq(): number {
    return this.value;
  }

  next<P extends CliEventPayload>(payload: P): CliEventV2 {
    this.value += 1;
    return makeEventV2(this.sessionId, this.value, payload);
  }
}

/**
 * Serializador único del contrato (NDJSON de `--json`, `data:` del SSE, etc.).
 * Una línea de JSON, sin saltos internos.
 */
export function encodeEvent(event: CliEventV2): string {
  return JSON.stringify(event);
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

/**
 * Lectura tolerante de un evento.
 *
 * - Acepta la línea JSON o el objeto ya parseado.
 * - Ignora (y conserva) campos desconocidos: un emisor futuro no rompe al
 *   consumidor actual.
 * - Devuelve `null` para JSON inválido, para algo que no es un objeto o para un
 *   `type` no documentado, en vez de lanzar.
 */
export function decodeEvent(input: string | unknown): CliEventV2 | null {
  const raw = typeof input === 'string' ? parseJson(input) : input;
  const obj = asRecord(raw);
  if (!obj || !isCliEventType(obj.type)) return null;
  const seq = typeof obj.seq === 'number' && Number.isFinite(obj.seq) ? obj.seq : 0;
  return {
    ...obj,
    schemaVersion: SESSION_SCHEMA_VERSION,
    seq,
    sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : '',
  } as CliEventV2;
}

/** Marca de estado v2; migra los estados legados del servidor. */
export function normalizeSessionStatus(value: unknown): SessionStatusV2 {
  switch (value) {
    case 'idle':
    case 'running':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return value;
    // Estados internos de `AgentSession` antes de este contrato.
    case 'done':
      return 'completed';
    case 'error':
      return 'failed';
    case 'stopped':
      return 'cancelled';
    default:
      return 'idle';
  }
}

function normalizeMode(value: unknown): SessionMode {
  return value === 'plan' || value === 'readonly' ? value : 'build';
}

function text(value: unknown, max = 20_000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function timestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function turnFrom(raw: unknown): SessionTurnV2 | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const role = obj.role === 'assistant' || obj.role === 'tool' ? obj.role : 'user';
  return { role, text: text(obj.text, 8_000), ts: timestamp(obj.ts, 0) };
}

function stepFrom(raw: unknown): SessionStepV2 | null {
  const obj = asRecord(raw);
  if (!obj || typeof obj.id !== 'string' || !obj.id) return null;
  const type: SessionStepType =
    obj.type === 'tool_call' || obj.type === 'tool_result' || obj.type === 'plan' || obj.type === 'subagent'
      ? obj.type
      : 'thought';
  const status: SessionStepStatus =
    obj.status === 'pending' || obj.status === 'running' || obj.status === 'failed' || obj.status === 'cancelled'
      ? obj.status
      : 'completed';
  const step: SessionStepV2 = {
    id: obj.id,
    type,
    title: text(obj.title, 500),
    content: text(obj.content),
    status,
    ts: timestamp(obj.ts, 0),
  };
  if (typeof obj.toolId === 'string') step.toolId = obj.toolId;
  if (obj.input !== undefined) step.input = obj.input;
  if (obj.output !== undefined) step.output = obj.output;
  if (typeof obj.durationMs === 'number') step.durationMs = obj.durationMs;
  return step;
}

function planItemFrom(raw: unknown): SessionPlanItemV2 | null {
  const obj = asRecord(raw);
  if (!obj || typeof obj.id !== 'string' || !obj.id) return null;
  return { id: obj.id, text: text(obj.text, 500), done: obj.done === true };
}

function approvalFrom(raw: unknown): ApprovalRequestV2 | null {
  const obj = asRecord(raw);
  if (!obj || typeof obj.id !== 'string' || !obj.id) return null;
  return {
    id: obj.id,
    sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : '',
    tool: text(obj.tool, 200),
    input: obj.input,
    ...(typeof obj.diff === 'string' ? { diff: obj.diff } : {}),
    ...(Array.isArray(obj.hunks) ? { hunks: obj.hunks } : {}),
    createdAt: timestamp(obj.createdAt, 0),
    expiresAt: timestamp(obj.expiresAt, 0),
  };
}

function listOf<T>(value: unknown, mapper: (raw: unknown) => T | null, max: number): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value) {
    const parsed = mapper(entry);
    if (parsed) out.push(parsed);
    if (out.length >= max) break;
  }
  return out;
}

/** Estado inicial de una sesión recién creada. */
export function createSessionState(init: {
  id: string;
  goal: string;
  cwd: string;
  model?: string;
  mode?: SessionMode;
}): SessionStateV2 {
  const now = Date.now();
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: init.id,
    goal: init.goal,
    cwd: init.cwd,
    model: init.model || '',
    mode: init.mode || 'build',
    status: 'idle',
    turns: [],
    steps: [],
    plan: [],
    pendingApproval: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Serialización del estado (misma forma que se guarda en disco). */
export function encodeSessionState(state: SessionStateV2): string {
  return JSON.stringify(state);
}

/**
 * Lectura tolerante de un estado.
 *
 * Los campos desconocidos se conservan, los que faltan toman un valor por
 * defecto y los estados legados (`done`/`error`/`stopped`) se migran. Nunca
 * lanza: un archivo corrupto devuelve `null`.
 */
export function decodeSessionState(input: string | unknown): SessionStateV2 | null {
  const raw = typeof input === 'string' ? parseJson(input) : input;
  const obj = asRecord(raw);
  if (!obj || typeof obj.id !== 'string' || !obj.id) return null;

  const now = Date.now();
  const createdAt = timestamp(obj.createdAt, now);
  const updatedAt = timestamp(obj.updatedAt, createdAt);
  const state: SessionStateV2 = {
    ...obj,
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: obj.id,
    goal: text(obj.goal, 2_000),
    cwd: text(obj.cwd, 2_000),
    model: text(obj.model, 300),
    mode: normalizeMode(obj.mode),
    status: normalizeSessionStatus(obj.status),
    turns: listOf(obj.turns, turnFrom, 100),
    steps: listOf(obj.steps, stepFrom, 1_000),
    plan: listOf(obj.plan, planItemFrom, 100),
    pendingApproval: approvalFrom(obj.pendingApproval),
    createdAt,
    updatedAt,
  };
  if (typeof obj.answer === 'string') state.answer = obj.answer;
  if (typeof obj.error === 'string') state.error = obj.error;
  return state;
}
