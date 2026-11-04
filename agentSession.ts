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

import { uid } from './src/agent/id';
import { toolDialectForModel, toOpenAITools } from './src/agent/providers';
import { AGENT_FUNCTION_DECLARATIONS, mapFunctionCall } from './src/agent/fnTools';
import { PLAN_TOOL, normalizePlan } from './src/agent/plan';
import { TOOL_REGISTRY } from './src/agent/registry';
import { loadMCPServers, mcpListTools } from './src/agent/mcp';
import { executeAgentTool } from './agentTools';
import { startSubAgent, finishSubAgent } from './subAgents';
import { getServerBaseUrl } from './serverRuntime';
import { GEMINI_DEFAULT_MODEL } from './src/config/geminiModels';

// ── Eventos SSE ──

export type AgentEvent =
  | { type: 'status'; status: string }
  | { type: 'thought'; title: string; content: string }
  | { type: 'plan'; plan: { id: string; text: string; done: boolean }[] }
  | { type: 'tool_call'; toolId: string; input: unknown }
  | { type: 'tool_result'; toolId: string; ok: boolean; data?: unknown; error?: string }
  | { type: 'finish'; answer: string }
  | { type: 'error'; error: string };

export interface AgentStep {
  id: string;
  type: 'thought' | 'tool_call' | 'tool_result' | 'plan' | 'subagent';
  toolId?: string;
  title: string;
  content: string;
  input?: unknown;
  output?: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  durationMs?: number;
  ts: number;
}

export interface AgentPlanItem {
  id: string;
  text: string;
  done: boolean;
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
}

/** `idle`: sesión creada como contexto padre y nunca arrancada (no gasta tokens). */
export type SessionStatus = 'idle' | 'running' | 'done' | 'error' | 'stopped';

const ALLOWED_TOOLS = ['fs.read', 'fs.write', 'fs.edit', 'fs.glob', 'fs.list', 'fs.grep', 'shell.run', 'shell.pty', 'read_diagnostics', 'git.status', 'git.diff', 'git.log', 'git.commit', 'web.fetch', 'web.search', 'code.run', 'mcp.call', 'mcp.list', 'task', 'spawn_agents', 'skill'];

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
  if (dialect === 'gemini') payload.tools = [{ functionDeclarations: AGENT_FUNCTION_DECLARATIONS }];
  else payload.tools = toOpenAITools();

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
- Tras editar código, usa read_diagnostics para verificar que no introdujiste errores de TypeScript.
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
  readonly createdAt = Date.now();
  private cfg: SessionConfig;
  private maxSteps: number;
  private status: SessionStatus = 'idle';
  private steps: AgentStep[] = [];
  private plan: AgentPlanItem[] = [];
  private turns: { role: string; text: string }[] = [];
  private agentsMd = '';
  private mcpSchema = '';
  private listeners = new Set<(evt: AgentEvent) => void>();
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

  constructor(cfg: SessionConfig) {
    this.id = uid('sess');
    this.cfg = cfg;
    this.maxSteps = cfg.maxSteps ?? 20;
  }

  getStatus(): SessionStatus { return this.status; }
  getSteps(): AgentStep[] { return this.steps; }
  getPlan(): AgentPlanItem[] { return this.plan; }
  getGoal(): string { return this.cfg.goal; }
  getModel(): string { return this.cfg.model || GEMINI_DEFAULT_MODEL; }
  getConfig(): SessionConfig { return this.cfg; }
  getStopReason(): 'user' | 'timeout' | null { return this.stopReason; }
  setMode(mode: 'build' | 'plan' | 'readonly') { this.cfg.mode = mode; }
  setAllowedTools(tools: string[] | null) { this.cfg.allowedTools = tools; }

  addListener(fn: (evt: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(evt: AgentEvent) {
    for (const fn of this.listeners) {
      try { fn(evt); } catch { /* listener roto */ }
    }
  }

  private addStep(step: Omit<AgentStep, 'id' | 'ts'>): AgentStep {
    const full: AgentStep = { ...step, id: uid('step'), ts: Date.now() };
    this.steps.push(full);
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
    this.running = true;
    // Sin esto la sesión corría pero `getStatus()` seguía diciendo `idle`: la
    // distinción entre «creada como padre» y «trabajando» se perdía.
    this.status = 'running';
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
    this.status = 'error';
    this.running = false;
    this.emit({ type: 'error', error: msg });
  }

  stop(reason: 'user' | 'timeout' = 'user') {
    this.stopReason = reason;
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try { this.abortCtrl.abort(); } catch { /* ya abortado */ }
    if (this.status === 'running') this.status = 'stopped';
    this.emit({ type: 'status', status: this.status });
  }

  private toolBudget(): number {
    return Math.floor((this.maxSteps - this.steps.length) / 2);
  }

  private async runParallel(calls: { tool: string; input: any }[]) {
    const results = await Promise.allSettled(
      calls.map((c) =>
        executeAgentTool(c.tool, { ...c.input, root: this.cfg.cwd }, { signal: this.abortCtrl.signal, sessionId: this.id }),
      )
    );
    return calls.map((c, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') return { tool: c.tool, ok: r.value.ok, data: r.value.data, error: r.value.error };
      return { tool: c.tool, ok: false, error: String((r.reason as any)?.message || r.reason) };
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
        this.turns.push({ role: 'model', text: native.thought || '(plan actualizado)' });
        if (this.turns.length > 10) this.turns = this.turns.slice(-10);
        return;
      }
      this.turns.push({ role: 'model', text: native.thought || '(sin salida)' });
      if (this.turns.length > 10) this.turns = this.turns.slice(-10);
      this.addStep({ type: 'thought', title: 'Finalizado', content: native.thought || 'Objetivo completado.', status: 'completed' });
      this.emit({ type: 'finish', answer: native.thought || 'Objetivo completado.' });
      this.status = 'done';
      this.running = false;
      this.emit({ type: 'status', status: 'done' });
      return;
    }

    const budget = this.toolBudget();
    if (budget <= 0) {
      this.turns.push({ role: 'model', text: native.thought || '(sin salida)' });
      this.status = 'done';
      this.running = false;
      this.emit({ type: 'status', status: 'done' });
      return;
    }
    const executable = mapped.slice(0, budget);

    this.turns.push({ role: 'model', text: `${native.thought || ''}\nCalls: ${executable.map((m) => m.name).join(', ')}`.slice(0, 2000) });
    if (this.turns.length > 10) this.turns = this.turns.slice(-10);

    const results = await this.runParallel(executable.map((m) => ({ tool: m.name, input: m.args })));
    // Cancelado mientras corrían las tools: no se anotan resultados ni se sigue.
    if (this.stopReason) return;
    this.turns.push({ role: 'user', text: `Resultados:\n${JSON.stringify(results).slice(0, 3000)}` });
    if (this.turns.length > 10) this.turns = this.turns.slice(-10);

    for (const r of results) {
      this.addStep({
        type: 'tool_result', toolId: r.tool, title: r.tool,
        content: r.ok ? JSON.stringify(r.data ?? {}).slice(0, 2000) : (r.error || 'error'),
        input: executable.find((e) => e.name === r.tool)?.args, output: r.data, status: r.ok ? 'completed' : 'failed',
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
      this.turns.push({ role: 'model', text: llmRes.thought });
    }
    if (llmRes.finish) {
      if (llmRes.answer) {
        this.addStep({ type: 'thought', title: 'Finalizado', content: llmRes.answer, status: 'completed' });
        this.emit({ type: 'finish', answer: llmRes.answer });
        this.turns.push({ role: 'model', text: llmRes.answer });
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
      const results = await this.runParallel(executable.map((tc) => ({ tool: tc.tool, input: tc.input })));
      if (this.stopReason) return;
      this.turns.push({ role: 'user', text: `Resultados:\n${JSON.stringify(results).slice(0, 3000)}` });
      if (this.turns.length > 10) this.turns = this.turns.slice(-10);
      for (const r of results) {
        this.addStep({
          type: 'tool_result', toolId: r.tool, title: r.tool,
          content: r.ok ? JSON.stringify(r.data ?? {}).slice(0, 2000) : (r.error || 'error'),
          input: executable.find((e) => e.tool === r.tool)?.input, output: r.data, status: r.ok ? 'completed' : 'failed',
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

export function createSession(cfg: SessionConfig): AgentSession {
  const s = new AgentSession(cfg);
  sessions.set(s.id, s);
  if (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest && oldest !== s.id) sessions.delete(oldest);
  }
  return s;
}

export function getSession(id: string): AgentSession | undefined {
  return sessions.get(id);
}

export function listSessions(): Array<{ id: string; goal: string; model: string; status: SessionStatus; steps: number; createdAt: number }> {
  return Array.from(sessions.values()).map((s) => ({
    id: s.id, goal: s.getGoal(), model: s.getModel(), status: s.getStatus(), steps: s.getSteps().length, createdAt: s.createdAt,
  }));
}

export function stopSession(id: string): boolean {
  const s = sessions.get(id);
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
  sessions.delete(id);
}
