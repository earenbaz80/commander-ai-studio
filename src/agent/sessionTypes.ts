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

import { planStatusOf, type PlanStatus } from './plan';

export const SESSION_SCHEMA_VERSION = 2 as const;

/** Modo del agente, igual que en el resto de la app. */
export type SessionMode = 'build' | 'plan' | 'readonly';

/** Estado de la sesión en el contrato v2 (el estado interno legado se mapea). */
export type SessionStatusV2 = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Marca de una corrida que no debe contarse como muestra válida.
 *
 * La sesión sigue `cancelled` porque el prompt no se decidió; `invalid` dice
 * por qué y deja preparada la etiqueta de la repetición. No cambia el plazo de
 * la aprobación ni el estado de la tool: sólo evita publicar una muestra que
 * nació de una aprobación caducada.
 */
export interface RunInvalidation {
  reason: 'approval_expired';
  approvalId: string;
  /** Etiqueta con la que debe repetirse la corrida; no se lanza sola. */
  retryLabel: string;
}

/**
 * Siguiente etiqueta para una repetición: `CAL2-R01` → `CAL2-R01b` y, si esa
 * repetición también se invalida, `CAL2-R01b` → `CAL2-R01c`. No inventa una
 * corrida ni modifica el identificador original.
 */
export function nextRunLabel(label: unknown): string {
  const base =
    typeof label === 'string'
      ? label.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 120)
      : '';
  if (!base) return 'run-b';
  const suffix = /^(.*\d)([b-y])$/.exec(base);
  if (suffix) return `${suffix[1]}${String.fromCharCode(suffix[2].charCodeAt(0) + 1)}`;
  return `${base}b`;
}

/** Presupuesto de visibilidad de una aprobación pendiente (estado y TUI). */
export const APPROVAL_VISIBILITY_BUDGET_MS = 250;

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
  /** Decisión de aprobación que permitió/denegó la tool (F1-04). */
  approval?: {
    id: string;
    decision: ApprovalDecision;
    reason?: string;
    latencyMs?: number;
    /**
     * Ms desde la **primera tecla no decisoria** hasta la decisión.
     *
     * Es la latencia que mide lectura real: `latencyMs` arranca cuando se crea
     * la aprobación y arrastra el tiempo en que nadie miraba el panel. Alias
     * compatible de `readMs`; una decisión directa (`a`, `1`…) no produce
     * ninguno de los dos y queda marcada con `directDecision`. Ausente si el
     * prompt no recibió ninguna tecla (caducó, se abortó o no había TTY).
     */
    decisionMs?: number;
    /** Epoch ms en que la aprobación quedó pendiente en el estado. */
    pendingInStateAt?: number;
    /** Epoch ms en que el prompt empezó a preparar el menú. */
    promptStartedAt?: number;
    /** Epoch ms en que el menú quedó pintado por primera vez. */
    promptPaintedAt?: number;
    /** Aprobaciones por delante al entrar a la cola, incluida la que está en curso. */
    queueDepth?: number;
    /** Ms desde `createdAt` hasta `pendingInStateAt` (aparición en el estado). */
    stateMs?: number;
    /** Ms desde `pendingInStateAt` hasta `promptStartedAt`. */
    queueMs?: number;
    /** Epoch ms del primer aviso visible en la TUI (campana, título o renglón). */
    noticeAt?: number;
    /** Ms desde `createdAt` hasta `noticeAt`. */
    noticeMs?: number;
    /** La aprobación apareció en el estado dentro del presupuesto de 250 ms. */
    stateWithin250Ms?: boolean;
    /** El aviso apareció en la TUI dentro del presupuesto de 250 ms. */
    noticeWithin250Ms?: boolean;
    /** Epoch ms del primer input aceptado, haya decidido o no. */
    firstInputAt?: number;
    /** Epoch ms de la primera tecla que no decidió (flecha, `?`/`h`, etc.). */
    firstNonDecisionKeyAt?: number;
    /** Epoch ms en que se resolvió la aprobación. */
    decisionAt?: number;
    /** Ms desde `promptStartedAt` hasta `promptPaintedAt` (sólo pintado). */
    paintMs?: number;
    /** Ms desde `promptPaintedAt` hasta `firstInputAt`. */
    attentionMs?: number;
    /** Ms desde `firstNonDecisionKeyAt` hasta `decisionAt`. */
    readMs?: number;
    /** La primera tecla aceptada ya decidió: no hubo lectura previa. */
    directDecision?: boolean;
    /** Teclas descartadas por la cuarentena inicial del menú. */
    quarantinedKeys?: number;
    /** La cuarentena descartó al menos una tecla que decidía. */
    quarantinedDecision?: boolean;
    render?: ApprovalRenderFacts;
    /** La aprobación era una confirmación de un `shell.run` idéntico repetido. */
    repeatOf?: string;
  };
}

export interface SessionPlanItemV2 {
  id: string;
  text: string;
  status: PlanStatus;
  files?: string[];
  criteria?: string;
  /** Derivado de `status`; se conserva para consumidores antiguos. */
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

/** Aprobación pendiente (F1-04). */
/**
 * Qué enseñó el prompt de aprobación antes de decidir.
 *
 * Lo rellena la TUI al pintar el menú (`promptApprovalDecision`) y viaja con la
 * aprobación hasta el paso de la sesión. Es la evidencia con la que se decide
 * la condición I2 del protocolo CAL2
 * (`docs/parity/g1-approval-remeasure.md` §12.3), sin depender de leer el log
 * del PTY a ojo.
 */
export interface ApprovalRenderFacts {
  /** El menú imprimió el diff de la tool. */
  diffShown: boolean;
  /** El render avisó de que el diff no cabía completo (`DIFF_MAX_LINES`). */
  diffTruncated: boolean;
  /** Se abrió el detalle de algún hunk con `?`/`¿`/`h`. */
  detailOpened: boolean;
  /** El prompt caducó sin decisión: se resolvió como `deny`. Sólo aparece si es `true`. */
  expired?: boolean;
}

export interface ApprovalRequestV2 {
  id: string;
  sessionId: string;
  tool: string;
  input: unknown;
  diff?: string;
  hunks?: unknown[];
  /**
   * Id de la ejecución idéntica anterior que exige confirmación explícita.
   * `'session'` cuando la anterior se ejecutó por `allow-session` sin prompt.
   */
  repeatOf?: string;
  createdAt: number;
  expiresAt: number;
  /** Epoch ms en que la aprobación quedó pendiente (estado local o sincronizado). */
  pendingInStateAt?: number;
  /** Epoch ms en que `promptApprovalDecision` empezó a preparar el menú. */
  promptStartedAt?: number;
  /** Aprobaciones por delante al entrar a la cola (0 = inmediata). */
  queueDepth?: number;
  /** Epoch ms del primer aviso visible en la TUI. Lo escribe el anuncio. */
  noticeAt?: number;
  /** Lo escribe el prompt al resolver; un pedido que no pasó por la TUI no lo trae. */
  render?: ApprovalRenderFacts;
  /**
   * Epoch ms de la primera tecla que recibió el prompt.
   *
   * Alias histórico de `firstInputAt`; se sigue escribiendo para no romper a
   * quien ya lee este campo. El nombre nuevo es `firstInputAt`.
   */
  firstKeyAt?: number;
  /**
   * Epoch ms del primer input aceptado, antes de interpretarlo.
   *
   * Incluye flechas, `?`/`h` y la propia decisión: marca que el operador estaba
   * delante. Sin input —caducidad, aborto o cuarentena— no existe.
   */
  firstInputAt?: number;
  /** Epoch ms en que el prompt resolvió la aprobación (decisión, aborto o caducidad). */
  decisionAt?: number;
  /**
   * Epoch ms en que el menú quedó pintado por primera vez.
   *
   * Es la referencia de la cuarentena inicial: lo que llegue antes de que pase
   * `APPROVAL_KEY_QUARANTINE_MS` se descarta para no leer un Enter heredado.
   */
  promptPaintedAt?: number;
  /**
   * Epoch ms de la primera tecla aceptada que **no** decide.
   *
   * Flechas, `j`/`k`, `?`/`¿`/`h` y teclas desconocidas abren la lectura. Las
   * teclas que deciden (`a`, `d`, `s`, `1`–`3`, Enter, `q`) no cuentan: si la
   * primera tecla aceptada decide, este campo queda ausente y `directDecision`
   * se marca. Esc y Ctrl+C tampoco cuentan: cierran sin decidir.
   */
  firstNonDecisionKeyAt?: number;
  /** La primera tecla aceptada decidió; no hay `firstNonDecisionKeyAt`. */
  directDecision?: boolean;
  /** Teclas descartadas al abrir el menú para no leer un Enter heredado. */
  quarantinedKeys?: number;
  /** La cuarentena descartó una tecla que habría decidido; la muestra no es limpia. */
  quarantinedDecision?: boolean;
}

/**
 * Estado completo de una sesión ejecutable.
 *
 * `pendingApproval` es la primera aprobación pendiente de la sesión (puede
 * haber varias tools esperando a la vez); se expone en el estado y en el stream
 * mientras la corrida sigue en este proceso. Cuando el bucle corre en el CLI,
 * el cliente la anuncia en su checkpoint y el servidor la conserva mientras la
 * sesión está `running`: es informativa y se resuelve en el proceso del CLI.
 */
/**
 * Propuesta de cambio guardada en la sesión. El diff no se aplicó: queda para
 * que `applyProposalToFile` lo aplique tras un reinicio o para contarlo en el
 * dogfooding.
 */
export interface SessionProposalV2 {
  proposalId: string;
  path: string;
  diff: string;
  /** Hash del contenido base sobre el que se calculó el diff. */
  baseHash: string;
  /** Hash del contenido que debe quedar tras aplicar el diff. */
  afterHash: string;
  /** Se marca al aplicar; una propuesta aplicada es idempotente. */
  applied: boolean;
  tool: string;
  createdAt: number;
  /** Primera vez que el usuario abrió su diff. */
  reviewedAt?: number;
  /** Momento en que se descartó explícitamente. */
  discardedAt?: number;
  /** Momento de la aplicación, si la hubo. */
  appliedAt?: number;
  /** Checkpoint creado antes de escribir, para poder deshacer. */
  checkpointId?: string;
}

/** Contadores acumulados del embudo de propuestas. */
export interface ProposalStatsV2 {
  created: number;
  duplicatesDropped: number;
  perFileCapDropped: number;
  totalCapDropped: number;
  reviewed: number;
  applied: number;
  discarded: number;
}

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
  /**
   * Todas las pendientes cuando hay más de una. `pendingApproval` sigue siendo
   * la primera para quien sólo conoce ese campo; esto permite reanudarlas tras
   * un reinicio del servidor.
   */
  pendingApprovals?: ApprovalRequestV2[];
  createdAt: number;
  updatedAt: number;
  /** Última respuesta final, si la hubo. */
  answer?: string;
  /** Último error, si la sesión falló. */
  error?: string;
  /** La corrida no es válida para medir y queda preparada su repetición. */
  invalid?: RunInvalidation;
  /**
   * Corte por llamadas idénticas, si lo hubo: qué guarda lo disparó, con qué
   * tool y en qué intento. Se guarda aparte de `error` para que el próximo
   * dogfooding lo cuente desde el archivo en vez de leer el PTY.
   */
  loopCut?: {
    guard: 'mutations' | 'reads';
    tool: string;
    attempts: number;
  };
  /** Propuestas generadas por `fs.propose.*`, para aplicar o auditar. */
  proposals?: SessionProposalV2[];
  /** Embudo acumulado; los contadores no se recalculan al deduplicar. */
  proposalStats?: ProposalStatsV2;
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
      /** Tiempo desde `approval_request.createdAt` hasta la decisión. */
      latencyMs?: number;
      /** Alias compatible de `readMs`: primera tecla no decisoria → decisión. */
      decisionMs?: number;
      /** Epoch ms en que la aprobación quedó pendiente en el estado. */
      pendingInStateAt?: number;
      /** Epoch ms en que el prompt empezó a preparar el menú. */
      promptStartedAt?: number;
      /** Epoch ms en que el menú quedó pintado por primera vez. */
      promptPaintedAt?: number;
      /** Aprobaciones por delante al entrar a la cola, incluida la que está en curso. */
      queueDepth?: number;
      /** Ms desde `createdAt` hasta `pendingInStateAt` (aparición en el estado). */
      stateMs?: number;
      /** Ms desde `pendingInStateAt` hasta `promptStartedAt`. */
      queueMs?: number;
      /** Epoch ms del primer aviso visible en la TUI. */
      noticeAt?: number;
      /** Ms desde `createdAt` hasta `noticeAt`. */
      noticeMs?: number;
      /** La aprobación apareció en el estado dentro del presupuesto de 250 ms. */
      stateWithin250Ms?: boolean;
      /** El aviso apareció en la TUI dentro del presupuesto de 250 ms. */
      noticeWithin250Ms?: boolean;
      /** Epoch ms del primer input aceptado, haya decidido o no. */
      firstInputAt?: number;
      /** Epoch ms de la primera tecla que no decidió. */
      firstNonDecisionKeyAt?: number;
      /** Epoch ms en que se resolvió la aprobación. */
      decisionAt?: number;
      /** Ms desde `promptStartedAt` hasta `promptPaintedAt` (sólo pintado). */
      paintMs?: number;
      /** Ms desde `promptPaintedAt` hasta `firstInputAt`. */
      attentionMs?: number;
      /** Ms desde `firstNonDecisionKeyAt` hasta `decisionAt`. */
      readMs?: number;
      /** La primera tecla aceptada ya decidió: no hubo lectura previa. */
      directDecision?: boolean;
      /** Teclas descartadas por la cuarentena inicial del menú. */
      quarantinedKeys?: number;
      /** La cuarentena descartó al menos una tecla que decidía. */
      quarantinedDecision?: boolean;
      /** Qué se pintó antes de decidir (I2 del protocolo CAL2). */
      render?: ApprovalRenderFacts;
      /** La aprobación era una confirmación de un `shell.run` idéntico repetido. */
      repeatOf?: string;
    }
  | { type: 'question'; question: QuestionV2 }
  | { type: 'answer'; text: string }
  | { type: 'error'; text: string }
  | { type: 'done'; answer: string; steps: number; invalid?: RunInvalidation };

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

/**
 * Latencia de una aprobación ya resuelta.
 *
 * Sólo se acepta una medida no negativa: un `latencyMs` ausente es «no se midió»
 * y uno inválido no se convierte en 0, porque 0 es una medida legítima.
 */
function latencyFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Instante opcional: igual que una latencia, 0 no se confunde con ausencia. */
function momentFrom(value: unknown): number | undefined {
  return latencyFrom(value);
}

/** Contador opcional de teclas descartadas: entero no negativo. */
function countFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Evidencia de render de una aprobación.
 *
 * Sólo se acepta si trae `diffShown` booleano: un `render` a medias no se
 * completa con `false`, porque eso afirmaría que no se pintó el diff.
 */
export function renderFactsFrom(value: unknown): ApprovalRenderFacts | undefined {
  const obj = asRecord(value);
  if (!obj || typeof obj.diffShown !== 'boolean') return undefined;
  return {
    diffShown: obj.diffShown,
    diffTruncated: obj.diffTruncated === true,
    detailOpened: obj.detailOpened === true,
    ...(obj.expired === true ? { expired: true } : {}),
  };
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
  const approval = asRecord(obj.approval);
  if (
    approval &&
    typeof approval.id === 'string' &&
    (approval.decision === 'allow' || approval.decision === 'deny' || approval.decision === 'allow-session')
  ) {
    const latencyMs = latencyFrom(approval.latencyMs);
    const decisionMs = latencyFrom(approval.decisionMs);
    const pendingInStateAt = momentFrom(approval.pendingInStateAt);
    const promptStartedAt = momentFrom(approval.promptStartedAt);
    const promptPaintedAt = momentFrom(approval.promptPaintedAt);
    const queueDepth = countFrom(approval.queueDepth);
    const stateMs = latencyFrom(approval.stateMs);
    const queueMs = latencyFrom(approval.queueMs);
    const noticeAt = momentFrom(approval.noticeAt);
    const noticeMs = latencyFrom(approval.noticeMs);
    const firstInputAt = momentFrom(approval.firstInputAt) ?? momentFrom(approval.firstKeyAt);
    const firstNonDecisionKeyAt = momentFrom(approval.firstNonDecisionKeyAt);
    const decisionAt = momentFrom(approval.decisionAt);
    const paintMs = latencyFrom(approval.paintMs);
    const attentionMs = latencyFrom(approval.attentionMs);
    const readMs = latencyFrom(approval.readMs);
    const quarantinedKeys = countFrom(approval.quarantinedKeys);
    const repeatOf = typeof approval.repeatOf === 'string' ? text(approval.repeatOf, 200) : '';
    const render = renderFactsFrom(approval.render);
    step.approval = {
      id: approval.id,
      decision: approval.decision,
      ...(typeof approval.reason === 'string' ? { reason: approval.reason } : {}),
      ...(latencyMs === undefined ? {} : { latencyMs }),
      ...(decisionMs === undefined ? {} : { decisionMs }),
      ...(pendingInStateAt === undefined ? {} : { pendingInStateAt }),
      ...(promptStartedAt === undefined ? {} : { promptStartedAt }),
      ...(promptPaintedAt === undefined ? {} : { promptPaintedAt }),
      ...(queueDepth === undefined ? {} : { queueDepth }),
      ...(stateMs === undefined ? {} : { stateMs }),
      ...(queueMs === undefined ? {} : { queueMs }),
      ...(noticeAt === undefined ? {} : { noticeAt }),
      ...(noticeMs === undefined ? {} : { noticeMs }),
      ...(typeof approval.stateWithin250Ms === 'boolean'
        ? { stateWithin250Ms: approval.stateWithin250Ms }
        : {}),
      ...(typeof approval.noticeWithin250Ms === 'boolean'
        ? { noticeWithin250Ms: approval.noticeWithin250Ms }
        : {}),
      ...(firstInputAt === undefined ? {} : { firstInputAt }),
      ...(firstNonDecisionKeyAt === undefined ? {} : { firstNonDecisionKeyAt }),
      ...(decisionAt === undefined ? {} : { decisionAt }),
      ...(paintMs === undefined ? {} : { paintMs }),
      ...(attentionMs === undefined ? {} : { attentionMs }),
      ...(readMs === undefined ? {} : { readMs }),
      ...(approval.directDecision === true ? { directDecision: true } : {}),
      ...(quarantinedKeys === undefined ? {} : { quarantinedKeys }),
      ...(approval.quarantinedDecision === true ? { quarantinedDecision: true } : {}),
      ...(repeatOf ? { repeatOf } : {}),
      ...(render === undefined ? {} : { render }),
    };
  }
  return step;
}

function invalidationFrom(raw: unknown): RunInvalidation | undefined {
  const obj = asRecord(raw);
  if (
    !obj ||
    obj.reason !== 'approval_expired' ||
    typeof obj.approvalId !== 'string' ||
    typeof obj.retryLabel !== 'string'
  ) {
    return undefined;
  }
  const approvalId = text(obj.approvalId, 200);
  const retryLabel = text(obj.retryLabel, 200);
  if (!approvalId || !retryLabel) return undefined;
  return { reason: 'approval_expired', approvalId, retryLabel };
}

function planItemFrom(raw: unknown): SessionPlanItemV2 | null {
  const obj = asRecord(raw);
  if (!obj || typeof obj.id !== 'string' || !obj.id) return null;
  // Estados guardados antes de F1-13 sólo tienen `done`: se migran sin perder
  // pasos (true → done, false → pending).
  const status = planStatusOf(obj.status, obj.done) ?? 'pending';
  const files = Array.isArray(obj.files)
    ? [...new Set(
        obj.files
          .filter((value): value is string => typeof value === 'string')
          .map((value) => text(value, 300))
          .filter(Boolean)
      )].slice(0, 20)
    : [];
  const criteria = typeof obj.criteria === 'string' && obj.criteria.trim()
    ? text(obj.criteria, 500)
    : '';
  return {
    id: obj.id,
    text: text(obj.text, 500),
    status,
    done: status === 'done',
    ...(files.length > 0 ? { files } : {}),
    ...(criteria ? { criteria } : {}),
  };
}

function approvalFrom(raw: unknown): ApprovalRequestV2 | null {
  const obj = asRecord(raw);
  if (!obj || typeof obj.id !== 'string' || !obj.id) return null;
  const pendingInStateAt = momentFrom(obj.pendingInStateAt);
  const promptStartedAt = momentFrom(obj.promptStartedAt);
  const queueDepth = countFrom(obj.queueDepth);
  const noticeAt = momentFrom(obj.noticeAt);
  const repeatOf = typeof obj.repeatOf === 'string' ? text(obj.repeatOf, 200) : '';
  return {
    id: obj.id,
    sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : '',
    tool: text(obj.tool, 200),
    input: obj.input,
    ...(typeof obj.diff === 'string' ? { diff: obj.diff } : {}),
    ...(Array.isArray(obj.hunks) ? { hunks: obj.hunks } : {}),
    ...(repeatOf ? { repeatOf } : {}),
    createdAt: timestamp(obj.createdAt, 0),
    expiresAt: timestamp(obj.expiresAt, 0),
    ...(pendingInStateAt === undefined ? {} : { pendingInStateAt }),
    ...(promptStartedAt === undefined ? {} : { promptStartedAt }),
    ...(queueDepth === undefined ? {} : { queueDepth }),
    ...(noticeAt === undefined ? {} : { noticeAt }),
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
  const pendingApprovals = listOf(obj.pendingApprovals, approvalFrom, 10);
  if (pendingApprovals.length > 0) state.pendingApprovals = pendingApprovals;
  if (typeof obj.answer === 'string') state.answer = obj.answer;
  if (typeof obj.error === 'string') state.error = obj.error;
  const invalid = invalidationFrom(obj.invalid);
  if (invalid) state.invalid = invalid;
  else delete state.invalid;
  return state;
}
