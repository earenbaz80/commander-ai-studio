/**
 * Sesiones de agente en el servidor (P1 #6).
 *
 * El bucle del agente (antes solo en el navegador, ver `src/agent/loop.ts`)
 * puede correr AQUÍ, en el servidor, y emitir su progreso por SSE. Ventajas:
 *   • La sesión sobrevive a que el cliente se desconecte (sigue corriendo).
 *   • Varios clientes pueden observar la misma sesión.
 *   • El cliente solo renderiza eventos; no ejecuta el bucle.
 *
 * Reutiliza toda la lógica existente sin duplicarla:
 *   • Tools  → `executeAgentTool` (mismo núcleo que /api/agent/run-tool).
 *   • LLM    → llamada interna a /api/{provider}/generate (mismos handlers).
 *   • Rules  → fs.read de AGENTS.md; MCP → mcpListTools.
 *
 * Las claves de los proveedores las pasa el cliente AL CREAR la sesión (igual
 * que hoy las envía en cada petición) y viven solo en memoria durante la sesión.
 */

import fs from 'node:fs';
import path from 'node:path';
import { uid } from './src/agent/id';
import { diffLines, toUnifiedDiff } from './src/utils/patch';
import { decide, needsHumanApproval } from './src/agent/permissionRules';
import { getPermissions } from './permissions';
import { toolDialectForModel, toOpenAITools } from './src/agent/providers';
import { AGENT_FUNCTION_DECLARATIONS, mapFunctionCall } from './src/agent/fnTools';
import { PLAN_TOOL, normalizePlan } from './src/agent/plan';
import { TOOL_REGISTRY } from './src/agent/registry';
import { loadMCPServers, mcpListTools } from './src/agent/mcp';
import { executeAgentTool } from './agentTools';
import { startSubAgent, finishSubAgent } from './subAgents';
import { getServerBaseUrl } from './serverRuntime';
import { GEMINI_DEFAULT_MODEL } from './src/config/geminiModels';
import {
  SESSION_SCHEMA_VERSION,
  normalizeSessionStatus,
  type ApprovalDecision,
  type ApprovalRequestV2,
  type CliEventPayload,
  type SessionPlanItemV2,
  type SessionStateV2,
  type SessionStepV2,
  type SessionTurnV2,
} from './src/agent/sessionTypes';
import { createSessionStore, isValidSessionId, type SessionStore } from './src/agent/sessionStore';
import { SessionEventBuffer, type SessionGoneReason } from './src/agent/sessionStream';

// ── Eventos SSE ──

export type AgentEvent =
  | { type: 'status'; status: string }
  | { type: 'thought'; title: string; content: string }
  | { type: 'plan'; plan: { id: string; text: string; done: boolean }[] }
  | { type: 'tool_call'; toolId: string; input: unknown }
  | { type: 'tool_result'; toolId: string; ok: boolean; data?: unknown; error?: string }
  | { type: 'approval_request'; approval: ApprovalRequestV2 }
  | { type: 'approval_result'; approvalId: string; decision: ApprovalDecision; reason?: string }
  | { type: 'finish'; answer: string }
  | { type: 'error'; error: string };

function streamSummary(data: unknown): string {
  try {
    return (JSON.stringify(data ?? '') || '').slice(0, 500);
  } catch {
    return String(data ?? '').slice(0, 500);
  }
}

/** Traduce el evento legado del servidor al sobre v2 que consume el SSE. */
function toCliPayload(evt: AgentEvent): CliEventPayload | null {
  switch (evt.type) {
    case 'status':
      return { type: 'status', text: evt.status };
    case 'thought':
      return { type: 'thought', text: evt.content };
    case 'plan':
      return { type: 'plan', plan: evt.plan };
    case 'tool_call':
      return { type: 'tool_call', tool: evt.toolId, input: evt.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool: evt.toolId,
        ok: evt.ok,
        summary: evt.ok ? streamSummary(evt.data) : (evt.error || 'error'),
      };
    case 'approval_request':
      return { type: 'approval_request', approval: evt.approval };
    case 'approval_result':
      return {
        type: 'approval_result',
        approvalId: evt.approvalId,
        decision: evt.decision,
        ...(evt.reason ? { reason: evt.reason } : {}),
      };
    case 'finish':
      return { type: 'answer', text: evt.answer };
    case 'error':
      return { type: 'error', text: evt.error };
    default:
      return null;
  }
}

function goneReasonForStatus(status: string): SessionGoneReason | null {
  if (status === 'done') return 'completed';
  if (status === 'error') return 'failed';
  if (status === 'stopped') return 'cancelled';
  return null;
}

/** El paso del servidor es exactamente el del contrato v2 (F1-01). */
export type AgentStep = SessionStepV2;

export type AgentPlanItem = SessionPlanItemV2;

/** Tope de pasos que se conservan; el store trunca al mismo número. */
const MAX_STEPS_IN_MEMORY = 200;

/** Tiempo máximo que una tool peligrosa espera una decisión (F1-04). */
export const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60_000;

/** Tope de decisiones recordadas para idempotencia; una sesión no crece sin fin. */
const MAX_RESOLVED_APPROVALS = 200;

const WRITE_TOOLS = new Set(['fs.write', 'fs.edit', 'git.commit']);

interface ApprovalOutcome {
  approved: boolean;
  decision: ApprovalDecision;
  id: string;
  reason?: string;
}

interface PendingApproval {
  request: ApprovalRequestV2;
  /** Entrada original: la regla de `allow-session` necesita el patrón real. */
  input: unknown;
  resolve: (outcome: ApprovalOutcome) => void;
  timer: ReturnType<typeof setTimeout> | null;
  /** Cargada de disco: no hay promesa esperando ni timer en este proceso. */
  detached?: boolean;
}

interface ResumedApproval {
  id: string;
  decision: ApprovalDecision;
  reason?: string;
  expiresAt: number;
}

interface ResolvedApproval {
  decision: ApprovalDecision;
  body: Record<string, unknown>;
}

interface ToolCallResult {
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  approval?: { id: string; decision: ApprovalDecision; reason?: string };
}

function isApprovalDecision(value: unknown): value is ApprovalDecision {
  return value === 'allow' || value === 'deny' || value === 'allow-session';
}

/** Oculta credenciales antes de mostrar/persistir una aprobación. */
function redactApprovalValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[recortado]';
  if (typeof value === 'string') {
    return value
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
      .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)\s*[:=]\s*)[^\s,;"']+/gi, '$1[redacted]')
      .slice(0, 20_000);
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => redactApprovalValue(entry, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    if (/^(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)$/i.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = redactApprovalValue(entry, depth + 1);
    }
  }
  return out;
}

/**
 * Diff unificado (contexto 3) para que el usuario vea qué va a cambiar.
 *
 * Usa el mismo motor que el escritorio (`src/utils/patch.ts`), así que una
 * `fs.edit` con varias regiones produce hunks separados y el CLI puede
 * enseñarlos con números de línea.
 */
function approvalDiff(rel: string, before: string, after: string, exists = true): string {
  const result = diffLines(before, after, 3);
  return toUnifiedDiff(rel, result, { exists }).slice(0, 20_000);
}

function approvalPreview(tool: string, input: any, cwd: string): { diff?: string; hunks?: unknown[] } {
  if (tool !== 'fs.write' && tool !== 'fs.edit') return {};
  try {
    const raw = String(input?.path || '').slice(0, 500);
    if (!raw) return {};
    const abs = path.resolve(cwd, raw);
    const rel = path.relative(cwd, abs).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return {};
    const exists = fs.existsSync(abs);
    const before = exists ? fs.readFileSync(abs, 'utf8').slice(0, 40_000) : '';
    let after = '';
    const hunks: unknown[] = [];
    if (tool === 'fs.write') {
      after = String(input?.content || '').slice(0, 40_000);
    } else {
      after = before;
      const edits = Array.isArray(input?.replacements) && input.replacements.length > 0
        ? input.replacements.slice(0, 50)
        : [{ oldString: input?.oldString, newString: input?.newString, replaceAll: input?.replaceAll }];
      for (const edit of edits) {
        const oldString = String(edit?.oldString || '');
        const newString = String(edit?.newString || '');
        if (!oldString) continue;
        hunks.push({ oldString: oldString.slice(0, 4_000), newString: newString.slice(0, 4_000) });
        after = edit?.replaceAll === true
          ? after.split(oldString).join(newString)
          : after.replace(oldString, () => newString);
      }
    }
    if (before === after) return hunks.length > 0 ? { hunks } : {};
    return { diff: approvalDiff(rel, before, after, exists), ...(hunks.length > 0 ? { hunks } : {}) };
  } catch {
    return {};
  }
}

/** Texto estable que representa el alcance de una regla `allow-session`. */
function approvalTarget(tool: string, input: any, cwd: string): string {
  if (tool === 'shell.run') return String(input?.command || '').trim().slice(0, 2_000);
  if (tool === 'fs.write' || tool === 'fs.edit') {
    const raw = String(input?.path || '').trim().replace(/\\/g, '/');
    if (!raw) return '';
    const abs = path.resolve(cwd, raw);
    const rel = path.relative(cwd, abs).replace(/\\/g, '/');
    return rel && !rel.startsWith('..') ? rel : raw;
  }
  if (tool === 'github.comment') {
    return JSON.stringify({ repo: input?.repo, url: input?.url, number: input?.number }).slice(0, 2_000);
  }
  return '*';
}

/** Serialización estable: el orden de las claves no cambia la identidad. */
function stableApprovalValue(value: unknown, depth = 0): string {
  if (depth > 12) return '"[recortado]"';
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableApprovalValue(entry, depth + 1)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableApprovalValue(record[key], depth + 1)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Una aprobación sólo vale para la llamada exacta: misma tool y mismos args. */
function approvalCallKey(tool: string, input: unknown): string {
  return `${tool}\u0000${stableApprovalValue(input)}`;
}

/** Estado v2 → estado interno legado (la UI y el SSE siguen esperando éste). */
function legacyStatus(status: SessionStateV2['status']): SessionStatus {
  switch (status) {
    case 'completed': return 'done';
    case 'failed': return 'error';
    case 'cancelled': return 'stopped';
    default: return status;
  }
}

export interface AgentKeys {
  OPENROUTER_API_KEY?: string;
  OLLAMA_HOST?: string;
  CUSTOM_BASE_URL?: string;
  CUSTOM_API_KEY?: string;
  OPENCODE_API_KEY?: string;
  CUSTOM_MODEL?: string;
}

export interface TaskToolInput {
  /** Objetivo específico del subagente. */
  goal: string;
  /** Instrucciones adicionales (opcional). */
  instructions?: string;
  /** Modelo a usar (por defecto el de la sesión padre). */
  model?: string;
  /** Tools permitidas (null = todas las del padre). */
  allowedTools?: string[] | null;
  /** Modo del subagente (build/plan/readonly). */
  mode?: 'build' | 'plan' | 'readonly';
  /** Límite de pasos. */
  maxSteps?: number;
  /** Plantilla de subagente (file-explorer, researcher, reviewer, planner). */
  template?: string;
}

export interface SessionConfig {
  goal: string;
  cwd: string;
  model?: string;
  keys?: AgentKeys;
  maxSteps?: number;
  /** Modo del agente (build/plan/readonly). */
  mode?: 'build' | 'plan' | 'readonly';
  /** Tools permitidas (null = todas). */
  allowedTools?: string[] | null;
  /**
   * Persistir el estado en `.commander/agent-sessions` (write-through).
   * Sólo lo piden el servidor y las sesiones que nacen de una petición HTTP:
   * los subagentes y las pruebas directas no deben llenar el disco.
   */
  persist?: boolean;
  /** Timeout de aprobaciones; 5 min por defecto (F1-04). */
  approvalTimeoutMs?: number;
}

/** `idle`: sesión creada como contexto padre y nunca arrancada (no gasta tokens). */
export type SessionStatus = 'idle' | 'running' | 'done' | 'error' | 'stopped';

const ALLOWED_TOOLS = ['fs.read', 'fs.write', 'fs.edit', 'fs.glob', 'fs.list', 'fs.grep', 'shell.run', 'shell.pty', 'read_diagnostics', 'git.status', 'git.diff', 'git.log', 'git.commit', 'web.fetch', 'web.search', 'code.run', 'mcp.call', 'mcp.list', 'task', 'spawn_agents', 'skill', 'github.comment'];

// ── LLM en el servidor (llamada interna a los endpoints existentes) ──

async function callLlmNative(
  cfg: SessionConfig,
  ctx: { goal: string; cwd: string; plan: AgentPlanItem[]; recentSteps: any[]; toolSchema: string; agentsMd: string; turns: { role: string; text: string }[]; systemExtra?: string }
  , signal?: AbortSignal
): Promise<{ thought: string; calls: { name: string; args: any }[] }> {
  const model = cfg.model || GEMINI_DEFAULT_MODEL;
  const dialect = toolDialectForModel(model);
  const turns = ctx.turns || [];
  const user = `OBJETIVO: ${ctx.goal}\nCWD: ${ctx.cwd}\n\nPLAN ACTUAL:\n${JSON.stringify(ctx.plan, null, 2)}\n\nULTIMOS PASOS:\n${JSON.stringify(ctx.recentSteps.slice(-10), null, 2)}\n\nHISTORIAL:\n${turns.slice(-8).map((t) => `${t.role.toUpperCase()}: ${t.text.slice(0, 1200)}`).join('\n\n')}\n\nTOOLS:\n${ctx.toolSchema}${ctx.systemExtra ? `\n${ctx.systemExtra}` : ''}`;
  const systemInstruction = `Eres un agente autónomo de código. Razona brevemente en texto y llama herramientas para avanzar hacia: ${ctx.goal}. Si el objetivo está cumplido, responde SOLO texto final sin llamar herramientas. Antes de editar, localiza el código con fs.glob/fs.grep y léelo con fs.read para tener el texto exacto: los cambios pequeños van con fs.edit y un oldString idéntico al del archivo.${ctx.agentsMd ? `\nREGLAS DEL REPO:\n${ctx.agentsMd.slice(0, 4000)}` : ''}`;

  if (dialect === 'json-text') return { thought: '', calls: [] };

  const route =
    dialect === 'gemini' ? '/api/gemini/generate'
    : model.startsWith('openrouter/') ? '/api/openrouter/generate'
    : model.startsWith('ollama/') ? '/api/ollama/generate'
    : model.startsWith('freebuff/') ? '/api/freebuff/generate'
    : '/api/custom/generate';

  const payload: Record<string, unknown> = {
    contents: user,
    prompt: user,
    systemInstruction,
    model: model.startsWith('custom/') ? (cfg.keys?.CUSTOM_MODEL || model) : model,
    temperature: 0.2,
    maxTokens: 2048,
    openrouterApiKey: cfg.keys?.OPENROUTER_API_KEY || undefined,
    ollamaHost: cfg.keys?.OLLAMA_HOST || undefined,
    baseURL: cfg.keys?.CUSTOM_BASE_URL || undefined,
    apiKey: cfg.keys?.CUSTOM_API_KEY || cfg.keys?.OPENCODE_API_KEY || undefined,
  };
  // La sesión corre en el servidor, sin usuario al otro lado: `ask_user` no
  // puede resolverse aquí y no se le ofrece al modelo.
  const declarations = AGENT_FUNCTION_DECLARATIONS.filter((d) => d.name !== 'ask_user');
  if (dialect === 'gemini') payload.tools = [{ functionDeclarations: declarations }];
  else payload.tools = toOpenAITools(declarations);

  const res = await fetch(`${getServerBaseUrl()}${route}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = await res.json();
  if (dialect === 'gemini') {
    const calls = (data.functionCalls || []).map((fc: any) => ({ name: fc.name, args: fc.args || {} }));
    return { thought: data.text || '', calls };
  }
  const calls = (data.toolCalls || []).map((tc: any) => ({ name: tc.name, args: tc.args || {} }));
  return { thought: data.text || data.choices?.[0]?.message?.content || '', calls };
}

async function callLlmJson(
  cfg: SessionConfig,
  ctx: { goal: string; cwd: string; plan: AgentPlanItem[]; recentSteps: any[]; toolSchema: string; agentsMd: string; history: { role: string; content: string }[] }
  , signal?: AbortSignal
): Promise<{ thought?: string; plan?: { id: string; text: string; done: boolean }[]; toolCalls?: { id: string; tool: string; input: unknown }[]; answer?: string; finish?: boolean }> {
  const model = cfg.model || GEMINI_DEFAULT_MODEL;
  const system = `Eres un agente autónomo pragmático para ingeniería de código.

REGLAS:
- Responde ÚNICAMENTE con JSON válido. Sin markdown. Sin texto fuera.
- Objetivo: cumplir ${ctx.goal} en ${ctx.cwd}.
- Puedes usar herramientas: ${ALLOWED_TOOLS.join(', ')}.
- Si necesitas leer archivos, usar fs.glob/fs.grep primero. Para docs web usa web.search/web.fetch.
- Tras editar código, usa read_diagnostics para verificar que no introdujiste errores de tipos o compilación (TypeScript, Python, Go o Rust según el proyecto).
- Puedes proponer VARIAS toolCalls independientes a la vez (se ejecutan en paralelo).
- Si vas a editar, lee el archivo completo para obtener contexto exacto.
- Para cambios pequeños usa fs.edit con oldString EXACTO. Para crear archivos usa fs.write.
- Si el comando shell es potencialmente destructivo, lo marcarás pero ejecutará solo con aprobación.
- Sé minimalista. Un tool_call a la vez si es incierto.
- Si ya cumpliste el objetivo, responde con {"finish": true, "answer": "..."}.
${ctx.agentsMd ? `\nREGLAS DEL REPO (AGENTS.md):\n${ctx.agentsMd.slice(0, 4000)}\n` : ''}

FORMATO JSON:
{
  "thought": "razonamiento breve",
  "plan": [{"id":"p1","text":"...","done":false}],
  "toolCalls": [{"id":"t1","tool":"fs.read","input":{"path":"..."}}],
  "answer": "respuesta final si terminas",
  "finish": false
}`;

  const user = `OBJETIVO: ${ctx.goal}
CWD: ${ctx.cwd}

PLAN ACTUAL:
${JSON.stringify(ctx.plan, null, 2)}

ULTIMOS PASOS:
${JSON.stringify(ctx.recentSteps.slice(-10), null, 2)}

HISTORIAL BREVE:
${JSON.stringify(ctx.history.slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 400) })), null, 2)}

TOOLS:
${ctx.toolSchema}`;

  const route = model.startsWith('custom/') ? '/api/custom/generate'
    : model.startsWith('openrouter/') ? '/api/openrouter/generate'
    : model.startsWith('pollinations/') ? '/api/pollinations/generate'
    : model.startsWith('freebuff/') ? '/api/freebuff/generate'
    : model.startsWith('ollama/') ? '/api/ollama/generate'
    : '/api/gemini/generate';

  const payload = {
    model: model.startsWith('custom/') ? (cfg.keys?.CUSTOM_MODEL || model) : model,
    contents: `${system}\n\n${user}`,
    prompt: `${system}\n\n${user}`,
    temperature: 0.2,
    maxTokens: 2048,
    openrouterApiKey: cfg.keys?.OPENROUTER_API_KEY || undefined,
    ollamaHost: cfg.keys?.OLLAMA_HOST || undefined,
    baseURL: cfg.keys?.CUSTOM_BASE_URL || undefined,
    apiKey: cfg.keys?.CUSTOM_API_KEY || cfg.keys?.OPENCODE_API_KEY || undefined,
  };

  const res = await fetch(`${getServerBaseUrl()}${route}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = await res.json();
  const text = data.text || data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const retry = await fetch(`${getServerBaseUrl()}${route}`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.startsWith('custom/') ? (cfg.keys?.CUSTOM_MODEL || model) : model,
        contents: `Tu respuesta anterior no fue JSON válido. Reemite EXACTAMENTE este JSON corregido, sin markdown ni texto extra:\n${cleaned.slice(0, 4000)}`,
        prompt: `Reemite solo JSON válido: ${cleaned.slice(0, 4000)}`,
        temperature: 0,
        maxTokens: 2048,
        openrouterApiKey: cfg.keys?.OPENROUTER_API_KEY || undefined,
        ollamaHost: cfg.keys?.OLLAMA_HOST || undefined,
        baseURL: cfg.keys?.CUSTOM_BASE_URL || undefined,
        apiKey: cfg.keys?.CUSTOM_API_KEY || cfg.keys?.OPENCODE_API_KEY || undefined,
      }),
    });
    if (!retry.ok) throw new Error(`LLM HTTP ${retry.status}`);
    const rdata = await retry.json();
    const rtext = (rdata.text || '{}').replace(/```json|```/g, '').trim();
    return JSON.parse(rtext);
  }
}

// ── Sesión ──

export class AgentSession {
  readonly id: string;
  /** Cuándo se creó: `listSessions` lo devolvía como 0, que no ordena nada. */
  readonly createdAt: number;
  private cfg: SessionConfig;
  private maxSteps: number;
  private status: SessionStatus = 'idle';
  private steps: AgentStep[] = [];
  private plan: AgentPlanItem[] = [];
  private turns: SessionTurnV2[] = [];
  /** Write-through al store; false en subagentes y sesiones de prueba. */
  private readonly persistEnabled: boolean;
  private answer = '';
  private lastError = '';
  private updatedAt: number;
  private agentsMd = '';
  private mcpSchema = '';
  private listeners = new Set<(evt: AgentEvent) => void>();
  /** Buffer reanudable del SSE (F1-03); sobrevive a las desconexiones. */
  private readonly eventStream: SessionEventBuffer;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Aborta la petición al proveedor que esté en vuelo. Sin esto `stop()` sólo
   * se notaba al volver de la llamada: decenas de segundos gastando tokens
   * después de haber pulsado «cancelar».
   */
  private abortCtrl = new AbortController();
  /** Quién cortó: el usuario (cancelación) o el límite de tiempo (fallo). */
  private stopReason: 'user' | 'timeout' | null = null;
  /** Aprobaciones pendientes por id (F1-04); puede haber varias en paralelo. */
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  /** Decisiones ya resueltas, para que repetir la misma petición sea idempotente. */
  private readonly resolvedApprovals = new Map<string, ResolvedApproval>();
  /** Reglas `allow-session` de esta instancia; nunca se escriben en disco. */
  private readonly sessionApprovalRules = new Set<string>();
  /**
   * Decisiones tomadas tras un reinicio para aprobaciones que ya no tienen
   * bucle esperando. Son de un solo uso y sólo valen para la llamada idéntica.
   */
  private readonly resumedApprovals = new Map<string, ResumedApproval>();
  private readonly approvalTimeoutMs: number;

  constructor(cfg: SessionConfig, restored?: SessionStateV2) {
    this.cfg = cfg;
    this.maxSteps = cfg.maxSteps ?? 20;
    this.persistEnabled = cfg.persist === true;
    const requestedTimeout = Number(cfg.approvalTimeoutMs);
    this.approvalTimeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? Math.min(requestedTimeout, DEFAULT_APPROVAL_TIMEOUT_MS)
      : DEFAULT_APPROVAL_TIMEOUT_MS;
    if (restored) {
      this.id = restored.id;
      this.createdAt = restored.createdAt || Date.now();
      this.updatedAt = restored.updatedAt || this.createdAt;
      this.status = legacyStatus(restored.status);
      this.steps = restored.steps.map((step) => ({ ...step }));
      this.plan = restored.plan.map((item) => ({ ...item }));
      this.turns = restored.turns.map((turn) => ({ ...turn }));
      this.answer = restored.answer ?? '';
      this.lastError = restored.error ?? '';
    } else {
      this.id = uid('sess');
      this.createdAt = Date.now();
      this.updatedAt = this.createdAt;
    }

    // Aprobaciones que quedaron pendientes cuando el proceso anterior murió:
    // se restauran sin promesa ni timer (nadie las espera en este proceso).
    let expiredOnLoad = 0;
    if (restored) {
      const restoredPending = restored.pendingApprovals && restored.pendingApprovals.length > 0
        ? restored.pendingApprovals
        : restored.pendingApproval
          ? [restored.pendingApproval]
          : [];
      const now = Date.now();
      for (const request of restoredPending.slice(0, 10)) {
        if (!request?.id || this.pendingApprovals.has(request.id)) continue;
        if (!(request.expiresAt > now)) {
          // La ventana venció mientras el servidor estaba caído: se cierra como
          // timeout y no se rearma nunca con una fecha nueva.
          this.resolvedApprovals.set(request.id, {
            decision: 'deny',
            body: { success: true, approvalId: request.id, decision: 'deny', reason: 'timeout' },
          });
          expiredOnLoad += 1;
          continue;
        }
        this.pendingApprovals.set(request.id, {
          request,
          input: request.input,
          resolve: () => {},
          timer: null,
          detached: true,
        });
      }
    }

    this.eventStream = new SessionEventBuffer(this.id);
    // Quita del disco las vencidas que se acaban de resolver.
    if (expiredOnLoad > 0) this.touch();
  }

  getStatus(): SessionStatus { return this.status; }
  getEventBuffer(): SessionEventBuffer { return this.eventStream; }
  getSteps(): AgentStep[] { return this.steps; }
  getPlan(): AgentPlanItem[] { return this.plan; }
  getGoal(): string { return this.cfg.goal; }
  getModel(): string { return this.cfg.model || GEMINI_DEFAULT_MODEL; }
  getConfig(): SessionConfig { return this.cfg; }
  getStopReason(): 'user' | 'timeout' | null { return this.stopReason; }
  setMode(mode: 'build' | 'plan' | 'readonly') { this.cfg.mode = mode; }
  setAllowedTools(tools: string[] | null) { this.cfg.allowedTools = tools; }

  /** Aprobaciones que esperan una decisión (para clientes y pruebas). */
  getPendingApprovals(): ApprovalRequestV2[] {
    return [...this.pendingApprovals.values()].map((pending) => pending.request);
  }

  /** ¿Hay un bucle en curso? `message` lo usa para responder 409. */
  isRunning(): boolean { return this.running; }

  /**
   * Añade un turno de usuario. No arranca: el endpoint decide si ejecuta, así
   * que una sesión persistida se puede seguir sin lanzar nada sola.
   */
  addMessage(text: string): SessionTurnV2 {
    const turn: SessionTurnV2 = {
      role: 'user',
      text: text.slice(0, 20_000),
      ts: Date.now(),
    };
    this.turns.push(turn);
    if (this.turns.length > 20) this.turns = this.turns.slice(-20);
    this.touch();
    return turn;
  }

  /** Proyección v2 del estado; es lo que devuelve `GET /sessions/:id`. */
  toState(): SessionStateV2 {
    const pending = this.pendingApprovalViews();
    return {
      schemaVersion: SESSION_SCHEMA_VERSION,
      id: this.id,
      goal: this.cfg.goal,
      cwd: this.cfg.cwd,
      model: this.getModel(),
      mode: this.cfg.mode ?? 'build',
      status: normalizeSessionStatus(this.status),
      turns: this.turns.map((turn) => ({ ...turn })),
      steps: this.steps.map((step) => ({ ...step })),
      plan: this.plan.map((item) => ({ ...item })),
      pendingApproval: pending[0] ?? null,
      ...(pending.length > 1 ? { pendingApprovals: pending } : {}),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      ...(this.answer ? { answer: this.answer } : {}),
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  /**
   * Reemplaza el estado con un checkpoint de un cliente.
   *
   * El CLI ejecuta el bucle en su proceso (para conservar streaming) y
   * sincroniza aquí cada avance. El servidor sigue siendo el dueño del estado:
   * sólo se aceptan turnos/pasos/plan, nunca un cambio de objetivo o cwd. Si el
   * bucle autoritativo está corriendo, el llamador debe responder 409.
   */
  replaceState(state: SessionStateV2): void {
    if (this.running) throw new Error('la sesión está en ejecución');
    const nextStatus = normalizeSessionStatus(state.status);
    this.status = legacyStatus(nextStatus);
    this.steps = state.steps.slice(-MAX_STEPS_IN_MEMORY).map((step) => ({ ...step }));
    this.plan = state.plan.slice(-100).map((item) => ({ ...item }));
    this.turns = state.turns.slice(-20).map((turn) => ({ ...turn }));
    this.answer = state.answer ?? '';
    this.lastError = state.error ?? '';
    this.stopReason = null;
    this.updatedAt = Date.now();
    this.touch();
    if (nextStatus === 'completed') this.eventStream.markGone('completed');
    else if (nextStatus === 'failed') this.eventStream.markGone('failed');
    else if (nextStatus === 'cancelled') this.eventStream.markGone('cancelled');
    else this.eventStream.reopen();
  }

  /**
   * Write-through: el estado se guarda en cada cambio relevante. Si el disco
   * falla no se tumba el bucle; la sesión sigue viviendo en memoria.
   */
  private touch(): void {
    this.updatedAt = Date.now();
    if (!this.persistEnabled) return;
    try {
      this.stateStore().save(this.toState());
    } catch { /* disco no disponible: queda en memoria */ }
  }

  private stateStore(): SessionStore {
    return createSessionStore();
  }

  addListener(fn: (evt: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(evt: AgentEvent) {
    const payload = toCliPayload(evt);
    if (payload) this.eventStream.publish(payload);
    for (const fn of this.listeners) {
      try { fn(evt); } catch { /* listener roto */ }
    }
    // Cada evento refleja un avance (estado, plan, tool…): se persiste aquí y
    // no en cada sitio que cambia el estado.
    this.touch();
    if (evt.type === 'status') {
      const reason = goneReasonForStatus(evt.status);
      if (reason) this.eventStream.markGone(reason);
    } else if (evt.type === 'error') {
      this.eventStream.markGone('failed');
    }
  }

  private addStep(step: Omit<AgentStep, 'id' | 'ts'>): AgentStep {
    const full: AgentStep = { ...step, id: uid('step'), ts: Date.now() };
    this.steps.push(full);
    if (this.steps.length > MAX_STEPS_IN_MEMORY) {
      this.steps = this.steps.slice(-MAX_STEPS_IN_MEMORY);
    }
    this.touch();
    return full;
  }

  private toolSchema(): string {
    return JSON.stringify(
      Object.values(TOOL_REGISTRY).map((t) => ({ id: t.id, description: t.description, danger: t.danger })),
      null,
      2
    ) + (this.mcpSchema ? `\n${this.mcpSchema}` : '');
  }

  async start() {
    if (this.running) return;
    // Un turno nuevo reabre el stream; el `seq` sigue desde el último emitido.
    this.eventStream.reopen();
    // Síncrono a propósito: dos `message` concurrentes ven el segundo como 409.
    this.running = true;
    // Sin esto la sesión corría pero `getStatus()` seguía diciendo `idle`: la
    // distinción entre «creada como padre» y «trabajando» se perdía.
    this.status = 'running';
    this.stopReason = null;
    this.lastError = '';
    if (this.turns.length === 0) {
      this.turns.push({ role: 'user', text: this.cfg.goal, ts: Date.now() });
    }
    this.emit({ type: 'status', status: 'running' });
    try {
      await this.loadContext();
      this.addStep({ type: 'thought', title: 'Inicio', content: `Objetivo: ${this.cfg.goal}\nCWD: ${this.cfg.cwd}`, status: 'completed' });
      await this.step();
    } catch (e: any) {
      // Cortado a mitad (cancelación o timeout): el aborto no es un fallo propio.
      if (this.stopReason) return;
      this.fail(e?.message || String(e));
    }
  }

  private async loadContext() {
    const candidates = ['AGENTS.md', '.cursorrules', 'CLAUDE.md', '.github/muse-instructions.md'];
    for (const f of candidates) {
      try {
        const r = await executeAgentTool('fs.read', { path: f, root: this.cfg.cwd });
        const text = r?.data?.content;
        if (r.ok && text) { this.agentsMd = String(text).slice(0, 4000); break; }
      } catch { /* sigue */ }
    }
    try {
      const servers = loadMCPServers().filter((s) => s.enabled).slice(0, 5);
      const parts: string[] = [];
      for (const s of servers) {
        try {
          const tools = await mcpListTools(s.url, (s as any).token);
          const names = tools.slice(0, 20).map((t) => t.name).join(', ');
          if (names) parts.push(`MCP ${s.url}: ${names} (usa mcp.call {serverUrl, tool, args})`);
        } catch { /* servidor caído */ }
      }
      this.mcpSchema = parts.join('\n').slice(0, 2000);
    } catch { /* sin MCP */ }
  }

  private fail(msg: string) {
    this.denyAllPending('failed');
    this.status = 'error';
    this.running = false;
    this.lastError = msg.slice(0, 4_000);
    this.emit({ type: 'error', error: msg });
  }

  stop(reason: 'user' | 'timeout' = 'user') {
    this.stopReason = reason;
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try { this.abortCtrl.abort(); } catch { /* ya abortado */ }
    // Ninguna tool puede quedar esperando una decisión que ya no llegará.
    this.denyAllPending(reason === 'timeout' ? 'timeout' : 'cancelled');
    // Cancelar una sesión idle también deja constancia; done/error se respetan.
    if (this.status !== 'done' && this.status !== 'error') this.status = 'stopped';
    this.emit({ type: 'status', status: this.status });
  }

  private toolBudget(): number {
    return Math.floor((this.maxSteps - this.steps.length) / 2);
  }

  private pendingApprovalViews(): ApprovalRequestV2[] {
    return [...this.pendingApprovals.values()].map((pending) => ({ ...pending.request }));
  }

  /** ¿Esta llamada necesita una decisión humana? */
  private requiresApproval(tool: string, input: any): boolean {
    const def = TOOL_REGISTRY[tool];
    if (!def) return false;
    if (WRITE_TOOLS.has(tool)) return true;
    try {
      return def.requiresApproval(input, {
        cwd: this.cfg.cwd,
        approve: async () => ({ approved: false, reason: 'aprobación anidada no soportada' }),
        log: () => {},
      });
    } catch {
      // Si una definición futura falla, no se ejecuta sin preguntar.
      return def.danger === true;
    }
  }

  private isAllowedForSession(tool: string, input: any): boolean {
    return this.sessionApprovalRules.has(`${tool}\u0000${approvalTarget(tool, input, this.cfg.cwd)}`);
  }

  /** Crea la petición, la publica y espera hasta que el cliente responda. */
  private requestApproval(tool: string, input: any): Promise<ApprovalOutcome> {
    // Si el modelo repite la llamada que quedó pendiente antes del reinicio, se
    // reengancha esa misma aprobación en vez de crear una segunda.
    const reusable = this.findDetachedApproval(tool, input);
    if (reusable) return this.awaitDetachedApproval(reusable);
    const now = Date.now();
    const request: ApprovalRequestV2 = {
      id: uid('apr'),
      sessionId: this.id,
      tool,
      input: redactApprovalValue(input),
      ...approvalPreview(tool, input, this.cfg.cwd),
      createdAt: now,
      expiresAt: now + this.approvalTimeoutMs,
    };

    return new Promise<ApprovalOutcome>((resolve) => {
      const pending: PendingApproval = { request, input, resolve, timer: null };
      this.pendingApprovals.set(request.id, pending);
      pending.timer = setTimeout(() => {
        this.finishApproval(pending, 'deny', 'timeout');
      }, Math.max(1, this.approvalTimeoutMs));
      // En Node, un timer de 5 min no debe mantener vivo el proceso de tests.
      (pending.timer as any)?.unref?.();
      this.emit({ type: 'approval_request', approval: request });
    });
  }

  /** ¿Hay una aprobación restaurada que corresponda a esta llamada exacta? */
  private findDetachedApproval(tool: string, input: any): PendingApproval | null {
    const key = approvalCallKey(tool, input);
    for (const pending of [...this.pendingApprovals.values()]) {
      if (!pending.detached) continue;
      if (approvalCallKey(pending.request.tool, pending.input) !== key) continue;
      if (!(pending.request.expiresAt > Date.now())) {
        this.finishApproval(pending, 'deny', 'timeout');
        continue;
      }
      pending.detached = false;
      return pending;
    }
    return null;
  }

  /**
   * Reengancha el bucle a una aprobación cargada de disco: vuelve a haber una
   * promesa esperando y corre el resto del timeout original.
   */
  private awaitDetachedApproval(pending: PendingApproval): Promise<ApprovalOutcome> {
    return new Promise<ApprovalOutcome>((resolve) => {
      pending.resolve = resolve;
      pending.timer = setTimeout(() => {
        this.finishApproval(pending, 'deny', 'timeout');
      }, Math.max(1, pending.request.expiresAt - Date.now()));
      (pending.timer as any)?.unref?.();
      this.emit({ type: 'approval_request', approval: pending.request });
    });
  }

  /** Consume la decisión de un solo uso para la llamada exacta, si existe. */
  private takeResumedApproval(
    tool: string,
    input: unknown
  ): { id: string; decision: ApprovalDecision; reason?: string } | null {
    const key = approvalCallKey(tool, input);
    const entry = this.resumedApprovals.get(key);
    if (!entry) return null;
    this.resumedApprovals.delete(key);
    if (!(entry.expiresAt > Date.now())) {
      // La ventana venció mientras la sesión estaba parada: fail closed.
      return { id: entry.id, decision: 'deny', reason: 'timeout' };
    }
    return {
      id: entry.id,
      decision: entry.decision,
      ...(entry.reason ? { reason: entry.reason } : {}),
    };
  }

  private finishApproval(
    pending: PendingApproval,
    decision: ApprovalDecision,
    reason?: string
  ): Record<string, unknown> {
    const id = pending.request.id;
    const existing = this.resolvedApprovals.get(id);
    if (existing) return existing.body;
    if (!this.pendingApprovals.delete(id)) {
      return this.resolvedApprovals.get(id)?.body || { success: false, error: 'aprobación no encontrada' };
    }
    if (pending.timer) { clearTimeout(pending.timer); pending.timer = null; }

    if (decision === 'allow-session') {
      const target = approvalTarget(pending.request.tool, pending.input, this.cfg.cwd);
      this.sessionApprovalRules.add(`${pending.request.tool}\u0000${target}`);
    }

    const cleanReason = typeof reason === 'string' && reason.trim()
      ? reason.trim().slice(0, 500)
      : undefined;
    // Una aprobación restaurada no tiene bucle esperando: la decisión se guarda
    // como permiso (o denegación) de un solo uso para la llamada exacta.
    const expiredOnResolve = pending.detached === true && !(pending.request.expiresAt > Date.now());
    if (pending.detached && !expiredOnResolve && (decision === 'allow' || decision === 'deny')) {
      this.resumedApprovals.set(approvalCallKey(pending.request.tool, pending.input), {
        id,
        decision,
        ...(cleanReason ? { reason: cleanReason } : {}),
        expiresAt: pending.request.expiresAt,
      });
    }
    const body: Record<string, unknown> = {
      success: true,
      approvalId: id,
      decision,
      ...(cleanReason ? { reason: cleanReason } : {}),
    };
    this.resolvedApprovals.set(id, { decision, body });
    while (this.resolvedApprovals.size > MAX_RESOLVED_APPROVALS) {
      const oldest = this.resolvedApprovals.keys().next().value as string | undefined;
      if (!oldest) break;
      this.resolvedApprovals.delete(oldest);
    }

    pending.resolve({
      approved: decision !== 'deny',
      decision,
      id,
      ...(cleanReason ? { reason: cleanReason } : {}),
    });
    this.emit({
      type: 'approval_result',
      approvalId: id,
      decision,
      ...(cleanReason ? { reason: cleanReason } : {}),
    });
    return body;
  }

  /** Deniega todas las pendientes; se usa al cancelar/fallar/borrar la sesión. */
  denyAllPending(reason: 'cancelled' | 'timeout' | 'failed'): void {
    for (const pending of [...this.pendingApprovals.values()]) {
      this.finishApproval(pending, 'deny', reason);
    }
  }

  /**
   * Resolución HTTP de una aprobación. Devuelve el status y el cuerpo exacto
   * para que el endpoint no tenga que inventar mensajes ni filtrar input.
   */
  resolveApproval(
    approvalId: string,
    decision: ApprovalDecision,
    reason?: string
  ): { status: number; body: Record<string, unknown> } {
    if (!isApprovalDecision(decision)) {
      return { status: 400, body: { success: false, error: 'decisión inválida' } };
    }
    const pending = this.pendingApprovals.get(approvalId);
    if (pending) {
      if (pending.detached && !(pending.request.expiresAt > Date.now())) {
        const body = this.finishApproval(pending, 'deny', 'timeout');
        return decision === 'deny'
          ? { status: 200, body }
          : { status: 409, body: { success: false, error: 'la aprobación expiró' } };
      }
      const body = this.finishApproval(pending, decision, reason);
      return { status: 200, body };
    }
    const resolved = this.resolvedApprovals.get(approvalId);
    if (!resolved) {
      return { status: 404, body: { success: false, error: 'aprobación no encontrada' } };
    }
    if (resolved.decision !== decision) {
      return {
        status: 409,
        body: { success: false, error: 'la aprobación ya fue resuelta con otra decisión' },
      };
    }
    return { status: 200, body: resolved.body };
  }

  private async runOne(call: { tool: string; input: any }): Promise<ToolCallResult> {
    let approval: ToolCallResult['approval'];
    // Reglas del escritorio (F1-07): `deny` corta aquí y en el motor de tools;
    // `allow` evita el prompt y `ask` lo fuerza aunque la tool no sea peligrosa.
    const rule = decide(call.tool, call.input, getPermissions(this.cfg.cwd).rules);
    if (rule === 'deny') {
      return {
        tool: call.tool,
        ok: false,
        error: `Denegado por regla de permisos del proyecto: ${call.tool}`,
      };
    }
    const needsApproval = needsHumanApproval(
      rule,
      this.requiresApproval(call.tool, call.input),
      this.isAllowedForSession(call.tool, call.input)
    );
    if (needsApproval) {
      if (this.stopReason) {
        return { tool: call.tool, ok: false, error: 'Aprobación denegada: cancelled' };
      }
      // Una aprobación que quedó pendiente al reiniciar el servidor se aplica
      // sólo a la llamada idéntica (tool + input) y una sola vez.
      const resumed = this.takeResumedApproval(call.tool, call.input);
      if (resumed) {
        approval = {
          id: resumed.id,
          decision: resumed.decision,
          ...(resumed.reason ? { reason: resumed.reason } : {}),
        };
        if (resumed.decision === 'deny') {
          return {
            tool: call.tool,
            ok: false,
            error: `Aprobación denegada: ${resumed.reason || 'sin motivo'}`,
            approval,
          };
        }
      } else {
        const outcome = await this.requestApproval(call.tool, call.input);
        approval = {
          id: outcome.id,
          decision: outcome.decision,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
        };
        if (!outcome.approved) {
          return {
            tool: call.tool,
            ok: false,
            error: `Aprobación denegada: ${outcome.reason || 'sin motivo'}`,
            approval,
          };
        }
      }
    }

    try {
      const result = await executeAgentTool(
        call.tool,
        { ...call.input, root: this.cfg.cwd },
        { signal: this.abortCtrl.signal, sessionId: this.id }
      );
      return {
        tool: call.tool,
        ok: result.ok,
        data: result.data,
        error: result.error,
        ...(approval ? { approval } : {}),
      };
    } catch (error: any) {
      return {
        tool: call.tool,
        ok: false,
        error: String(error?.message || error),
        ...(approval ? { approval } : {}),
      };
    }
  }

  private async runParallel(calls: { tool: string; input: any }[]): Promise<ToolCallResult[]> {
    const results = await Promise.allSettled(calls.map((call) => this.runOne(call)));
    return calls.map((call, index) => {
      const result = results[index];
      if (result.status === 'fulfilled') return result.value;
      return { tool: call.tool, ok: false, error: String((result.reason as any)?.message || result.reason) };
    });
  }

  private async step() {
    if (!this.running) return;
    if (this.steps.length >= this.maxSteps) {
      this.addStep({ type: 'thought', title: 'Límite', content: `maxSteps=${this.maxSteps} alcanzado.`, status: 'completed' });
      this.status = 'done';
      this.running = false;
      this.emit({ type: 'status', status: 'done' });
      return;
    }

    const recentSteps = this.steps.slice(-12).map((s) => ({
      id: s.id, type: s.type, toolId: s.toolId, title: s.title,
      content: (s.content || '').slice(0, 500), status: s.status, ts: s.ts,
    }));

    try {
      if (toolDialectForModel(this.cfg.model) !== 'json-text') {
        await this.stepNative(recentSteps);
      } else {
        await this.stepJson(recentSteps);
      }
    } catch (e: any) {
      if (this.stopReason) return;
      this.addStep({ type: 'thought', title: 'Error', content: e?.message || String(e), status: 'failed' });
      this.fail(e?.message || 'Error en el paso');
      return;
    }

    if (this.running) {
      this.timer = setTimeout(() => this.step(), 150);
    }
  }

  private async stepNative(recentSteps: any[]) {
    let native;
    try {
      native = await callLlmNative(this.cfg, {
        goal: this.cfg.goal, cwd: this.cfg.cwd, plan: this.plan, recentSteps,
        toolSchema: this.toolSchema(), agentsMd: this.agentsMd, turns: this.turns,
      }, this.abortCtrl.signal);
    } catch (e: any) {
      // Abortado: reintentar en modo JSON volvería a pedirle al proveedor justo
      // lo que el usuario acaba de cancelar.
      if (this.stopReason) return;
      this.addStep({ type: 'thought', title: 'Tool-use falló', content: `${e?.message || e}. Reintentando en modo JSON.`, status: 'failed' });
      return this.stepJson(recentSteps);
    }

    if (native.thought) {
      this.addStep({ type: 'thought', title: 'Razonamiento', content: native.thought.slice(0, 2000), status: 'completed' });
      this.emit({ type: 'thought', title: 'Razonamiento', content: native.thought.slice(0, 2000) });
    }

    // `update_plan` es una pseudo-tool: mueve el plan visible y no se ejecuta.
    // Se descartaba en el filtro, así que un turno que sólo planificaba se daba
    // por respuesta final («Objetivo completado.») sin tocar el workspace.
    const calls = native.calls || [];
    const planCalls = calls.filter((c) => c.name === PLAN_TOOL);
    if (planCalls.length > 0) {
      const next = planCalls.reduce(
        (acc, c) => normalizePlan((c.args as any)?.items, acc),
        this.plan
      );
      this.plan = next;
      this.emit({ type: 'plan', plan: next });
    }

    // El proveedor devuelve los nombres con guion bajo (`fs_write`), pero aquí
    // los tools son ids con punto (`fs.write`). Sin esta traducción el filtro
    // descartaba TODAS las llamadas: la sesión las veía como «sin salida» y
    // cerraba con «Objetivo completado» sin ejecutar ni una tool.
    const mapped = calls
      .filter((c) => c.name !== PLAN_TOOL)
      .map((c) => {
        const call = mapFunctionCall(c.name, c.args);
        return call ? { name: call.tool, args: call.input } : null;
      })
      .filter((c): c is { name: string; args: any } => c !== null)
      .filter((c) => ALLOWED_TOOLS.includes(c.name))
      .slice(0, 5);

    if (mapped.length === 0) {
      // Un turno que sólo actualizó el plan no es la respuesta final.
      if (planCalls.length > 0) {
        this.turns.push({ role: 'assistant', text: native.thought || '(plan actualizado)', ts: Date.now() });
        if (this.turns.length > 10) this.turns = this.turns.slice(-10);
        return;
      }
      this.turns.push({ role: 'assistant', text: native.thought || '(sin salida)', ts: Date.now() });
      if (this.turns.length > 10) this.turns = this.turns.slice(-10);
      const finalAnswer = native.thought || 'Objetivo completado.';
      this.answer = finalAnswer;
      this.addStep({ type: 'thought', title: 'Finalizado', content: finalAnswer, status: 'completed' });
      this.emit({ type: 'finish', answer: finalAnswer });
      this.status = 'done';
      this.running = false;
      this.emit({ type: 'status', status: 'done' });
      return;
    }

    const budget = this.toolBudget();
    if (budget <= 0) {
      this.turns.push({ role: 'assistant', text: native.thought || '(sin salida)', ts: Date.now() });
      this.status = 'done';
      this.running = false;
      this.emit({ type: 'status', status: 'done' });
      return;
    }
    const executable = mapped.slice(0, budget);

    this.turns.push({ role: 'assistant', text: `${native.thought || ''}\nCalls: ${executable.map((m) => m.name).join(', ')}`.slice(0, 2000), ts: Date.now() });
    if (this.turns.length > 10) this.turns = this.turns.slice(-10);

    for (const call of executable) {
      this.emit({ type: 'tool_call', toolId: call.name, input: call.args });
    }
    const results = await this.runParallel(executable.map((m) => ({ tool: m.name, input: m.args })));
    // Cancelado mientras corrían las tools: no se anotan resultados ni se sigue.
    if (this.stopReason) return;
    this.turns.push({ role: 'tool', text: `Resultados:\n${JSON.stringify(results).slice(0, 3000)}`, ts: Date.now() });
    if (this.turns.length > 10) this.turns = this.turns.slice(-10);

    for (const r of results) {
      this.addStep({
        type: 'tool_result', toolId: r.tool, title: r.tool,
        content: r.ok ? JSON.stringify(r.data ?? {}).slice(0, 2000) : (r.error || 'error'),
        input: executable.find((e) => e.name === r.tool)?.args, output: r.data, status: r.ok ? 'completed' : 'failed',
        ...(r.approval ? { approval: r.approval } : {}),
      });
      this.emit({ type: 'tool_result', toolId: r.tool, ok: r.ok, data: r.data, error: r.error });
    }
    const fails = results.filter((r) => !r.ok);
    if (fails.length > 0) {
      this.addStep({ type: 'thought', title: 'Tools con fallo', content: fails.map((f) => `${f.tool}: ${f.error}`).join('\n').slice(0, 1000), status: 'completed' });
    }
  }

  private async stepJson(recentSteps: any[]) {
    const llmRes = await callLlmJson(this.cfg, {
      goal: this.cfg.goal, cwd: this.cfg.cwd, plan: this.plan, recentSteps,
      toolSchema: this.toolSchema(), agentsMd: this.agentsMd, history: [],
    }, this.abortCtrl.signal);

    if (llmRes.plan && llmRes.plan.length > 0) {
      const p = llmRes.plan.map((x) => ({ id: x.id || uid('plan'), text: x.text, done: x.done ?? false }));
      this.plan = p;
      this.emit({ type: 'plan', plan: p });
    }
    if (llmRes.thought) {
      this.addStep({ type: 'thought', title: 'Razonamiento', content: llmRes.thought, status: 'completed' });
      this.emit({ type: 'thought', title: 'Razonamiento', content: llmRes.thought });
      this.turns.push({ role: 'assistant', text: llmRes.thought, ts: Date.now() });
    }
    if (llmRes.finish) {
      if (llmRes.answer) {
        this.answer = llmRes.answer;
        this.addStep({ type: 'thought', title: 'Finalizado', content: llmRes.answer, status: 'completed' });
        this.emit({ type: 'finish', answer: llmRes.answer });
        this.turns.push({ role: 'assistant', text: llmRes.answer, ts: Date.now() });
      }
      this.status = 'done';
      this.running = false;
      this.emit({ type: 'status', status: 'done' });
      return;
    }

    const calls = (llmRes.toolCalls || []).filter((tc) => ALLOWED_TOOLS.includes(tc.tool)).slice(0, 5);
    const budget = this.toolBudget();
    if (budget <= 0) { this.status = 'done'; this.running = false; this.emit({ type: 'status', status: 'done' }); return; }
    const executable = calls.slice(0, budget);

    if (executable.length > 0) {
      for (const call of executable) {
        this.emit({ type: 'tool_call', toolId: call.tool, input: call.input });
      }
      const results = await this.runParallel(executable.map((tc) => ({ tool: tc.tool, input: tc.input })));
      if (this.stopReason) return;
      this.turns.push({ role: 'tool', text: `Resultados:\n${JSON.stringify(results).slice(0, 3000)}`, ts: Date.now() });
      if (this.turns.length > 10) this.turns = this.turns.slice(-10);
      for (const r of results) {
        this.addStep({
          type: 'tool_result', toolId: r.tool, title: r.tool,
          content: r.ok ? JSON.stringify(r.data ?? {}).slice(0, 2000) : (r.error || 'error'),
          input: executable.find((e) => e.tool === r.tool)?.input, output: r.data, status: r.ok ? 'completed' : 'failed',
          ...(r.approval ? { approval: r.approval } : {}),
        });
        this.emit({ type: 'tool_result', toolId: r.tool, ok: r.ok, data: r.data, error: r.error });
      }
      const fails = results.filter((r) => !r.ok);
      if (fails.length > 0) {
        this.addStep({ type: 'thought', title: 'Tools con fallo', content: fails.map((f) => `${f.tool} error: ${f.error}`).join('\n').slice(0, 1000), status: 'completed' });
      }
    } else {
      this.addStep({ type: 'thought', title: 'Sin acción', content: 'LLM no propuso toolCalls ni finish. Forzando detención segura.', status: 'completed' });
      this.status = 'done';
      this.running = false;
      this.emit({ type: 'status', status: 'done' });
    }
  }
}

// ── Gestor de sesiones ──

const sessions = new Map<string, AgentSession>();

/** Tope del registro en memoria: una sesión padre por tarea se acumularía. */
const MAX_SESSIONS = 100;

function evictOldest(keepId?: string): void {
  if (sessions.size <= MAX_SESSIONS) return;
  const oldest = sessions.keys().next().value;
  if (oldest && oldest !== keepId) {
    const session = sessions.get(oldest);
    session?.denyAllPending('cancelled');
    session?.getEventBuffer().markGone('deleted');
    sessions.delete(oldest);
  }
}

export function createSession(cfg: SessionConfig): AgentSession {
  const s = new AgentSession(cfg);
  sessions.set(s.id, s);
  evictOldest(s.id);
  if (cfg.persist) {
    // Sin esto una sesión ejecutable no existiría en disco hasta su primer
    // cambio: un `GET` justo después de crearla daría 404 tras un reinicio.
    try { createSessionStore().save(s.toState()); } catch { /* disco no disponible */ }
  }
  return s;
}

/**
 * Bifurca una sesión existente en una sesión nueva.
 *
 * La copia conserva historial, pasos y plan —para que el nuevo hilo tenga
 * contexto— pero nace `idle`, sin respuesta ni error y con id propio. La sesión
 * origen no se toca: bifurcar es una lectura, no una mutación. Las claves viven
 * sólo en memoria y se heredan, igual que la configuración de ejecución.
 */
export function forkSession(sourceId: string): AgentSession | undefined {
  const source = getOrLoadSession(sourceId);
  if (!source) return undefined;
  const sourceCfg = source.getConfig();
  // JSON es suficiente: el estado v2 sólo tiene datos planos.
  const state = JSON.parse(JSON.stringify(source.toState())) as SessionStateV2;
  const now = Date.now();
  state.id = uid('sess');
  state.status = 'idle';
  state.pendingApproval = null;
  state.createdAt = now;
  state.updatedAt = now;
  delete state.answer;
  delete state.error;

  const session = new AgentSession(
    {
      goal: state.goal,
      cwd: state.cwd,
      model: state.model || sourceCfg.model,
      mode: state.mode,
      keys: sourceCfg.keys,
      maxSteps: sourceCfg.maxSteps,
      allowedTools: sourceCfg.allowedTools,
      approvalTimeoutMs: sourceCfg.approvalTimeoutMs,
      persist: true,
    },
    state
  );
  sessions.set(session.id, session);
  evictOldest(session.id);
  try { createSessionStore().save(session.toState()); } catch { /* disco no disponible */ }
  return session;
}

export function getSession(id: string): AgentSession | undefined {
  return sessions.get(id);
}

/**
 * Sesión en memoria o, si no está, cargada de disco.
 *
 * Carga lazy por id: no arranca nada solo. El estado persistido se reconstruye
 * en una `AgentSession` normal, así que `message`, `cancel` y `GET` funcionan
 * igual tras reiniciar el servidor.
 */
export function getOrLoadSession(id: string): AgentSession | undefined {
  const inMemory = sessions.get(id);
  if (inMemory) return inMemory;
  if (!isValidSessionId(id)) return undefined;
  let state: SessionStateV2 | null = null;
  try { state = createSessionStore().load(id); } catch { state = null; }
  if (!state) return undefined;
  const session = new AgentSession(
    {
      goal: state.goal,
      cwd: state.cwd,
      model: state.model || undefined,
      mode: state.mode,
      persist: true,
      maxSteps: 20,
    },
    state
  );
  sessions.set(session.id, session);
  evictOldest(session.id);
  return session;
}

export function listSessions(): Array<{ id: string; goal: string; model: string; status: SessionStatus; steps: number; createdAt: number }> {
  return Array.from(sessions.values()).map((s) => ({
    id: s.id, goal: s.getGoal(), model: s.getModel(), status: s.getStatus(), steps: s.getSteps().length, createdAt: s.createdAt,
  }));
}

export function stopSession(id: string): boolean {
  const s = getOrLoadSession(id);
  if (!s) return false;
  s.stop();
  return true;
}

/** Ejecuta un subagente (task tool) y devuelve su respuesta final. */
export async function executeTask(
  parentSessionId: string,
  input: TaskToolInput,
  parentKeys?: AgentKeys,
  parentCwd?: string
): Promise<{ ok: boolean; answer?: string; error?: string }> {
  const parent = getSession(parentSessionId);
  if (!parent) return { ok: false, error: `Sesión padre no encontrada: ${parentSessionId}` };

  const model = input.model || parent.getModel();
  const cwd = parentCwd || parent.getConfig().cwd;

  // Resolver plantilla si se pidió
  let resolvedAllowed = input.allowedTools;
  let resolvedMode = input.mode;
  let resolvedMax = input.maxSteps;
  if (input.template) {
    const { getTemplate } = await import('./src/agent/subagentTemplates');
    const tpl = getTemplate(String(input.template));
    if (tpl) {
      resolvedAllowed = input.allowedTools ?? tpl.allowedTools;
      resolvedMode = input.mode ?? tpl.defaultMode;
      resolvedMax = input.maxSteps ?? tpl.defaultMaxSteps;
    }
  }

  const session = createSession({
    goal: input.goal,
    cwd,
    model,
    keys: parentKeys,
    maxSteps: Math.min(Math.max(Number(resolvedMax) || 8, 1), 50),
  });

  // Sobrescribe permisos si se especifican
  if (resolvedMode) session.setMode(resolvedMode);
  if (resolvedAllowed) session.setAllowedTools(resolvedAllowed);

  const resultPromise = new Promise<{ ok: boolean; answer?: string; error?: string; cancelled?: boolean }>((resolve) => {
    // El timeout se cancela al resolver: si quedaba armado, el temporizador de
    // 120 s mantenía vivo el proceso del servidor (y cualquier runner de tests)
    // aunque el subagente hubiera terminado en milisegundos.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (r: { ok: boolean; answer?: string; error?: string; cancelled?: boolean }) => {
      if (timer) { clearTimeout(timer); timer = null; }
      resolve(r);
    };
    const cleanup = session.addListener((evt) => {
      if (evt.type === 'finish') {
        cleanup();
        done({ ok: true, answer: evt.answer });
      } else if (evt.type === 'error') {
        cleanup();
        done({ ok: false, error: evt.error });
      } else if (evt.type === 'status' && evt.status === 'stopped') {
        // Cancelado (o cortado por el timeout de abajo). Sin esta rama la
        // promesa no se resolvía hasta el límite de 120 s: el hijo ya no
        // trabajaba, pero el `spawn_agents` seguía esperando y la UI también.
        cleanup();
        const porTimeout = session.getStopReason() === 'timeout';
        done({
          ok: false,
          cancelled: !porTimeout,
          error: porTimeout ? 'Subagente excedió tiempo límite' : 'Cancelado',
        });
      } else if (evt.type === 'status' && evt.status === 'done') {
        // Si no hubo 'finish' explícito, busca la última respuesta
        const steps = session.getSteps();
        const last = steps.find((s) => s.type === 'thought' && s.title === 'Finalizado');
        cleanup();
        done({ ok: true, answer: last?.content || 'Subagente completado sin respuesta explícita' });
      }
    });
    // Timeout de seguridad
    timer = setTimeout(() => {
      cleanup();
      session.stop('timeout');
      done({ ok: false, error: 'Subagente excedió tiempo límite' });
    }, 120_000);
  });

  // La UI consulta esto mientras corre (y después, para ver cómo acabó): el
  // registro de sesiones borra al hijo al terminar, así que sin esta anotación
  // el panel vería la lista vacía justo cuando llega el resultado.
  startSubAgent({ id: session.id, parentSessionId, goal: input.goal, model });

  void session.start();
  try {
    const result = await resultPromise;
    finishSubAgent(session.id, {
      ok: result.ok,
      answer: result.answer,
      error: result.error,
      steps: session.getSteps().length,
      cancelled: result.cancelled,
    });
    return result;
  } finally {
    // El hijo es efímero: si se quedara en el registro, cada subagente dejaría
    // una sesión que nadie consulta y, al pasar de MAX_SESSIONS, el desalojo
    // podría tirar a la padre y dejar sin padre a los siguientes spawn_agents.
    removeSession(session.id);
  }
}

export function removeSession(id: string): void {
  // Cierra el SSE antes de sacar la sesión del registro: el cliente recibe
  // `gone` y no se queda esperando eventos que ya no van a llegar.
  const session = sessions.get(id);
  session?.denyAllPending('cancelled');
  session?.getEventBuffer().markGone('deleted');
  sessions.delete(id);
  // El borrado es también durable: si no, un `GET` posterior recargaría la
  // sesión desde disco y parecería que el DELETE no hizo nada.
  if (isValidSessionId(id)) {
    try { createSessionStore().remove(id); } catch { /* sin archivo */ }
  }
}
