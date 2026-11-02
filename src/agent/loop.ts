import { uid } from './id';
import type { AgentOrchestrator } from './orchestrator';
import type { AgentTask } from './types';
import { callAgentLLM, callAgentLLMTools } from './llm';
import { mapFunctionCall } from './fnTools';
import { PLAN_TOOL, normalizePlan } from './plan';
import { modelSupportsTools, getContextWindow } from './providers';
import * as serverPersistence from './persistence';
import { TOOL_REGISTRY } from './registry';
import { loadMCPServers, mcpListTools, listRegistryServers, listRegistryServerTools } from './mcp';
import { RESULT_TURN_CHARS, TURN_CHARS, TURNS_BUDGET_CHARS, clipMiddle, compactTurns, serializeResults, createReadIndex, recordRead, ReadIndex } from './contextBudget';

const ALLOWED_TOOLS = ['fs.read', 'fs.write', 'fs.edit', 'fs.propose.write', 'fs.propose.edit', 'fs.glob', 'fs.grep', 'shell.run', 'shell.job', 'browser', 'preview', 'read_diagnostics', 'task', 'spawn_agents', 'skill', 'git.status', 'git.diff', 'git.log', 'git.commit', 'git.worktree', 'git.rebase', 'git.conflict', 'web.fetch', 'web.search', 'code.run', 'mcp.call', 'mcp.list', 'run_file_change_hooks', 'worktree.create'];

/**
 * Huella estable de una toolCall: misma tool y mismos argumentos (el orden de
 * las claves no cuenta).
 */
export function callSignature(tool: string, input: unknown): string {
  const stable = (value: any): any => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      const sorted: Record<string, any> = {};
      for (const key of Object.keys(value).sort()) sorted[key] = stable(value[key]);
      return sorted;
    }
    return value;
  };
  return `${tool} ${JSON.stringify(stable(input ?? {}))}`;
}

/**
 * Veces que se tolera repetir una llamada idéntica. A la tercera el bucle deja
 * de ejecutarla: en `pipeline-agujereado` el modelo releyó el mismo fichero
 * siete veces sin editar nunca, y cada relectura gastaba un paso más.
 */
export const BLOCK_AFTER_REPEATS = 3;

/**
 * Detector de llamadas repetidas.
 *
 * Un modelo que no encuentra lo que busca tiende a releer exactamente lo mismo
 * una y otra vez: gasta pasos y no avanza. El bucle se lo dice en vez de dejarlo
 * girar —y, a partir de la tercera, tampoco la ejecuta—. Una escritura limpia la
 * cuenta: después de editar, volver a leer el mismo sitio es legítimo.
 */

export class RepeatGuard {
  private counts = new Map<string, number>();

  /**
   * `true` cuando esta llamada idéntica ya se ejecutó `BLOCK_AFTER_REPEATS`
   * veces: el resultado ya está en contexto y repetirla no aporta nada.
   * Se consulta después de `track`, que es quien cuenta.
   */
  exhausted(call: { tool: string; input: unknown }): boolean {
    return (this.counts.get(callSignature(call.tool, call.input)) ?? 0) >= BLOCK_AFTER_REPEATS;
  }

  /** Cuenta las llamadas y devuelve las que repiten una firma ya vista. */
  track(calls: Array<{ tool: string; input: unknown }>): Array<{ tool: string; times: number }> {
    const repeated: Array<{ tool: string; times: number }> = [];
    for (const call of calls) {
      const key = callSignature(call.tool, call.input);
      const times = (this.counts.get(key) ?? 0) + 1;
      this.counts.set(key, times);
      if (times > 1) repeated.push({ tool: call.tool, times });
    }
    if (calls.some((call) => call.tool === 'fs.write' || call.tool === 'fs.edit')) this.reset();
    return repeated;
  }

  reset(): void {
    this.counts.clear();
  }
}

/** Capa LLM inyectable: permite tests deterministas sin red ni API keys. */
export interface AgentLLMClient {
  callJson: typeof callAgentLLM;
  callTools: typeof callAgentLLMTools;
}

export const defaultAgentLLMClient: AgentLLMClient = {
  callJson: callAgentLLM,
  callTools: callAgentLLMTools,
};

export class AgentLoop {
  private orchestrator: AgentOrchestrator;
  private task: AgentTask | null = null;
  private running = false;
  private model?: string;
  private skills: string[] = [];
  private llm: AgentLLMClient;
  private agentsMd = '';
  private mcpSchema = '';
  private turns: { role: string; text: string }[] = [];
  private readIndex: ReadIndex = createReadIndex();
  private noProgressSteps = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private repeats = new RepeatGuard();

  constructor(orchestrator: AgentOrchestrator, model?: string, llmClient: AgentLLMClient = defaultAgentLLMClient) {
    this.orchestrator = orchestrator;
    this.model = model;
    this.llm = llmClient;
  }

  /**
   * Pre-vuelo compartido por `start` y `resume`: reglas del repo, tools MCP y
   * skills. No toca el log de pasos, así que no consume presupuesto de maxSteps.
   */
  private async prepare(): Promise<{ rules: { file: string; text: string } | null; mcpParts: string[] }> {
    const rules = await this.loadRepoRules();
    const mcpParts = await this.loadMCPTools();
    this.agentsMd = rules?.text ?? '';
    this.mcpSchema = mcpParts.join('\n').slice(0, 2000);
    // Skills disponibles (no bloqueante).
    try {
      const r = await fetch('/api/skills');
      if (r.ok) {
        const data = await r.json();
        this.skills = (data.skills || []).map((s: any) => s.id || s.name).filter(Boolean).slice(0, 50);
      }
    } catch { /* ignore */ }
    return { rules, mcpParts };
  }

  async start(task: AgentTask) {
    this.task = task;
    this.running = true;
    this.turns = [];
    this.repeats.reset();
    // El contador vive en el loop, que se reutiliza entre corridas del mismo
    // modelo: sin reiniciarlo, una corrida nueva hereda los fallos de la anterior.
    this.noProgressSteps = 0;
    void (async () => {
      try {
        await serverPersistence.createThread({ id: task.id, projectPath: task.cwd, title: task.goal.slice(0, 80), model: this.model });
        await serverPersistence.appendMessage(task.id, { requestId: `goal-${task.id}`, role: 'user', parts: { goal: task.goal, cwd: task.cwd }, ts: Date.now() });
      } catch { /* ignore */ }
    })();
    // Pre-vuelo ANTES de orchestrator.start() (que reinicia el log de steps).
    const { rules, mcpParts } = await this.prepare();
    this.orchestrator.start(task, task.plan);
    this.orchestrator.addThought('Inicio', `Objetivo: ${task.goal}\nCWD: ${task.cwd}`);
    if (rules) {
      this.orchestrator.addThought('Reglas repo', `Cargado ${rules.file} (${rules.text.length} chars)`);
    }
    if (mcpParts.length > 0) {
      this.orchestrator.addThought('MCP', `Servidores activos: ${mcpParts.length}`);
    }
    await this.step();
  }

  /**
   * Retoma una corrida interrumpida (app cerrada, recarga, servidor caído)
   * conservando sus pasos y su plan.
   *
   * El presupuesto se renueva: los pasos ya ejecutados no deben comerse el de
   * esta continuación, o el bucle moriría en el primer turno.
   */
  async resume(task: AgentTask) {
    const used = this.orchestrator.getState().steps.length;
    this.task = { ...task, maxSteps: (task.maxSteps ?? 40) + used };
    this.running = true;
    this.turns = [];
    this.repeats.reset();
    this.noProgressSteps = 0;
    const { rules, mcpParts } = await this.prepare();
    if (!this.orchestrator.resume()) {
      this.running = false;
      return;
    }
    this.orchestrator.addThought('Continuación', `Retomando «${task.goal}» tras una interrupción (${used} pasos previos)`);
    if (rules) {
      this.orchestrator.addThought('Reglas repo', `Cargado ${rules.file} (${rules.text.length} chars)`);
    }
    if (mcpParts.length > 0) {
      this.orchestrator.addThought('MCP', `Servidores activos: ${mcpParts.length}`);
    }
    await this.step();
  }

  stop() {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.orchestrator.stop();
  }

  private async loadRepoRules(): Promise<{ file: string; text: string } | null> {
    const candidates = ['AGENTS.md', '.cursorrules', 'CLAUDE.md', '.github/muse-instructions.md'];
    for (const f of candidates) {
      try {
        const r = await this.orchestrator.runTool('fs.read', { path: f });
        const text = (r as any)?.data?.content;
        if (r.ok && text) return { file: f, text: String(text).slice(0, 4000) };
      } catch { /* sigue */ }
    }
    return null;
  }

  private async loadMCPTools(): Promise<string[]> {
    const parts: string[] = [];
    // 1) Servidores MCP remotos por URL (localStorage, flujo original).
    try {
      const servers = loadMCPServers().filter((s) => s.enabled).slice(0, 5);
      for (const s of servers) {
        try {
          const tools = await mcpListTools(s.url, (s as any).token);
          const names = tools.slice(0, 20).map((t) => t.name).join(', ');
          if (names) parts.push(`MCP ${s.url}: ${names} (usa mcp.call {serverUrl, tool, args})`);
        } catch { /* servidor caído */ }
      }
    } catch { /* sin servidores URL */ }

    // 2) Servidores MCP del registro (commander.json → tools.mcp.servers),
    //    locales por comando. Se discovery vía backend stdio.
    try {
      const regs = await listRegistryServers();
      for (const r of regs.slice(0, 5)) {
        try {
          const tools = await listRegistryServerTools(r.name);
          const names = tools.slice(0, 20).map((t) => t.name).join(', ');
          if (names) parts.push(`MCP ${r.name} (local): ${names} (usa mcp.call {server:"${r.name}", tool, args})`);
        } catch { /* servidor local caído */ }
      }
    } catch { /* backend sin /api/mcp */ }

    return parts;
  }

  async spawnSubagent(goal: string, maxSteps = 8): Promise<string> {
    const subId = uid('sub');
    this.orchestrator.addThought('Subagente', `Lanzando ${subId}: ${goal}`);
    const subLoop = new AgentLoop(this.orchestrator, this.model, this.llm);
    subLoop.agentsMd = this.agentsMd;
    // Ejecuta como tarea acotada compartiendo orchestrator (steps quedan en log principal)
    const prevTask = this.task;
    this.task = prevTask ? { ...prevTask, goal, maxSteps } : { id: subId, goal, cwd: '.', maxSteps };
    for (let i = 0; i < maxSteps && this.running; i++) {
      await this.stepOnce();
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      const st = this.orchestrator.getState();
      const last = st.steps[st.steps.length - 1];
      if (last?.title === 'Finalizado') break;
    }
    if (prevTask) this.task = prevTask;
    return subId;
  }

  private pushTurn(role: string, text: string) {
    // Los turnos con resultados llevan el código que el modelo va a editar:
    // recortarlos al presupuesto de razonamiento lo dejaba leyendo a ciegas.
    const cap = role === 'user' ? RESULT_TURN_CHARS : TURN_CHARS;
    this.turns.push({ role, text: clipMiddle(text, cap) });
    // Persistencia durable (fire-and-forget).
    if (this.task) {
      void serverPersistence.appendMessage(this.task.id, { role, parts: { text: clipMiddle(text, cap) }, ts: Date.now() }).catch(() => { /* ignore */ });
    }
    // Puerta dura: solo compactamos cuando el contexto supera el 80% de la
    // ventana del modelo; por debajo, se conserva todo (sin resumir).
    const threshold = Math.floor(getContextWindow(this.model) * 4 * 0.8);
    const current = this.turns.reduce((a, t) => a + (t.text?.length || 0), 0);
    if (current > threshold) {
      const maxChars = Math.min(TURNS_BUDGET_CHARS, threshold);
      this.turns = compactTurns(this.turns, { maxChars, readIndex: this.readIndex });
    }
  }

  /** Turn-spend breaker: si N pasos seguidos no producen ningún cambio, se corta. */
  private trackProgress(results: Array<{ tool: string; ok: boolean }>) {
    const progressed = results.some((r) => r.ok);
    if (progressed) {
      this.noProgressSteps = 0;
    } else {
      this.noProgressSteps += 1;
      if (this.noProgressSteps >= 8) {
        this.addThoughtCapped('Límite de pasos', '8 pasos seguidos sin cambios: se detiene para evitar bucle.');
        this.pushTurn('user', 'CORTE: llevas 8 pasos sin producir ningún cambio en el workspace. Detente y reporta qué bloquea el avance, o pide instrucciones al usuario.');
        this.stop();
      }
    }
  }

  /** Registra en el índice de lecturas los fs.read exitosos, para que sobrevivan a la compactación. */
  private recordReads(calls: Array<{ tool: string; input: unknown }>, results: Array<{ tool: string; ok: boolean; data?: unknown; error?: unknown }>) {
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      const r = results[i];
      if (!r?.ok || c.tool !== 'fs.read') continue;
      const input = (c.input || {}) as { path?: string };
      const data = (r.data || {}) as { startLine?: number; endLine?: number; totalLines?: number };
      if (!input.path) continue;
      recordRead(this.readIndex, String(input.path), Number(data.startLine) || 1, Number(data.endLine) || 0, Number(data.totalLines) || 0);
    }
  }

  /** Turno con el lote de resultados, ya recortado al presupuesto del turno. */
  private pushResults(results: Array<{ tool: string; ok: boolean; data?: unknown; error?: unknown }>) {
    const prefix = 'Resultados:\n';
    this.pushTurn('user', prefix + serializeResults(results, RESULT_TURN_CHARS - prefix.length));
  }

  /**
   * Deja fuera las llamadas que ya no aportan nada. A la tercera lectura
   * idéntica se le dice al modelo que el resultado lo tiene arriba y que edite
   * o termine, en vez de dejarlo gastar otro paso releyendo lo mismo.
   */
  private dropExhausted(calls: Array<{ tool: string; input: unknown }>) {
    const blocked = calls.filter((call) => this.repeats.exhausted(call));
    if (blocked.length === 0) return calls;
    const tools = blocked.map((call) => call.tool).join(', ');
    this.addThoughtCapped('Lectura repetida', `No se reejecutó ${tools}: el resultado ya está en contexto`);
    this.pushTurn(
      'user',
      `BLOQUEADO: ya leíste exactamente eso (${tools}) y el resultado sigue en el historial. ` +
        'Releerlo no añade nada: si te falta un dato, lee OTRO rango u otro fichero; ' +
        'si ya lo sabes, haz la edición con fs.edit o termina con una respuesta.'
    );
    return calls.filter((call) => !this.repeats.exhausted(call));
  }

  /** ToolCalls ejecutables con el presupuesto restante (cada call consume 2 steps: llamada + resultado). */
  private toolBudget(): number {
    const max = this.task?.maxSteps ?? 0;
    const used = this.orchestrator.getState().steps.length;
    return Math.floor((max - used) / 2);
  }

  /** addThought que nunca rompe el invariante steps.length <= maxSteps. */
  /** Aviso al modelo: repetir la misma lectura no aporta y gasta pasos. */
  private warnRepeats(repeated: Array<{ tool: string; times: number }>) {
    if (repeated.length === 0) return;
    const detail = repeated.map((item) => `${item.tool} (${item.times}ª vez)`).join(', ');
    this.addThoughtCapped('Llamada repetida', `Repitió una llamada idéntica: ${detail}`);
    this.pushTurn(
      'user',
      `AVISO: repetiste exactamente la misma tool con los mismos argumentos (${detail}). ` +
        'Ya tienes ese resultado: no vuelvas a leerlo, usa lo que sabes y da el siguiente paso.'
    );
  }

  private addThoughtCapped(title: string, content: string) {
    const max = this.task?.maxSteps ?? Infinity;
    if (this.orchestrator.getState().steps.length < max) {
      this.orchestrator.addThought(title, content);
    }
  }

  private async stepOnce() {
    if (!this.running || !this.task) return;
    if (this.orchestrator.getState().steps.length >= this.task.maxSteps) {
      this.stop();
      return;
    }

    const state = this.orchestrator.getState();
    const recentSteps = state.steps.slice(-12).map((s) => ({
      id: s.id,
      type: s.type,
      toolId: s.toolId,
      title: s.title,
      content: (s.content || '').slice(0, 500),
      status: s.status,
      ts: s.ts,
    }));

    // Vía nativa (function calling) para modelos con dialecto Gemini/OpenAI;
    // JSON-texto como fallback para Pollinations/HF (sin tool-calling nativo).
    if (modelSupportsTools(this.model)) {
      await this.stepNative(recentSteps, state.plan);
    } else {
      await this.stepJson(recentSteps, state.plan);
    }

    if (this.running) {
      this.timer = setTimeout(() => this.step(), 400);
    }
  }
  private async runParallel(calls: { tool: string; input: unknown }[]) {
    const results = await Promise.allSettled(
      calls.map((c) => this.orchestrator.runTool(c.tool, c.input))
    );
    return calls.map((c, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') return { tool: c.tool, ok: r.value.ok, data: r.value.data, error: r.value.error };
      return { tool: c.tool, ok: false, error: String((r.reason as any)?.message || r.reason) };
    });
  }

  private async stepNative(recentSteps: any[], plan: any[]) {
    if (!this.task) return;
    let native;
    try {
      native = await this.llm.callTools(
        {
          goal: this.task.goal,
          cwd: this.task.cwd,
          history: [],
          toolSchema: JSON.stringify(
            Object.values(TOOL_REGISTRY).map((t) => ({ id: t.id, description: t.description, danger: t.danger, endsAgentStep: t.endsAgentStep !== false })),
            null,
            2
          ) + (this.mcpSchema ? `\n${this.mcpSchema}` : ''),
          recentSteps,
          plan,
          agentsMd: this.agentsMd,
          turns: this.turns,
          skills: this.skills,
        },
        { model: this.model }
      );
    } catch (e: any) {
      this.addThoughtCapped('Tool-use falló', `${e?.message || e}. Reintentando en modo JSON.`);
      return this.stepJson(recentSteps, plan);
    }

    if (native.thought) {
      this.orchestrator.addThought('Razonamiento', native.thought.slice(0, 2000));
    }

    // El modelo pedido no respondió: queda como paso visible, no como un aviso
    // escondido en el texto de la respuesta.
    if (native.fallback) {
      this.addThoughtCapped(
        'Modelo sustituido',
        `${native.fallback.from} no respondió; respondió ${native.fallback.to}`
      );
    }

    // `update_plan` es una pseudo-tool: la consume el bucle y nunca llega al
    // registro ni al backend. En la vía nativa el modelo no tiene campo `plan`,
    // así que ésta es su única forma de mover el plan que ve la UI.
    const calls = native.calls || [];
    const planCalls = calls.filter((c) => c.name === PLAN_TOOL);
    if (planCalls.length > 0) {
      const next = planCalls.reduce(
        (acc, c) => normalizePlan((c.args as any)?.items, acc),
        this.orchestrator.getState().plan
      );
      this.orchestrator.setPlan(next);
    }

    const mapped = calls
      .map((c) => mapFunctionCall(c.name, c.args))
      .filter((m): m is { tool: string; input: unknown } => !!m && !!m.input && ALLOWED_TOOLS.includes(m.tool))
      .slice(0, 5);

    if (mapped.length === 0) {
      // Un turno que sólo actualizó el plan no es la respuesta final.
      if (planCalls.length > 0) {
        this.pushTurn('model', native.thought || '(plan actualizado)');
        return;
      }
      // Sin calls = respuesta final
      this.pushTurn('model', native.thought || '(sin salida)');
      this.addThoughtCapped('Finalizado', native.thought || 'Objetivo completado.');
      this.stop();
      return;
    }

    // Presupuesto: no ejecutar tools si no caben call+result dentro de maxSteps
    const budget = this.toolBudget();
    if (budget <= 0) {
      this.pushTurn('model', native.thought || '(sin salida)');
      this.stop();
      return;
    }
    const executable = mapped.slice(0, budget);
    if (executable.length < mapped.length) {
      this.addThoughtCapped('Límite', `Recortando a ${executable.length} toolCall(s) por maxSteps=${this.task.maxSteps}`);
    }

    this.pushTurn('model', `${native.thought || ''}\nCalls: ${executable.map((m) => m.tool).join(', ')}`.slice(0, 2000));
    const repeated = this.repeats.track(executable);
    const results = await this.runParallel(this.dropExhausted(executable));
    this.recordReads(executable, results);
    const fails = results.filter((r) => !r.ok);
    if (results.length > 0) this.pushResults(results);
    this.trackProgress(results);
    this.warnRepeats(repeated.filter((item) => item.times < BLOCK_AFTER_REPEATS));
    if (fails.length > 0) {
      this.addThoughtCapped('Tools con fallo', fails.map((f) => `${f.tool}: ${f.error}`).join('\n').slice(0, 1000));
    }
  }

  private async stepJson(recentSteps: any[], plan: any[]) {
    if (!this.task) return;
    const llmRes = await this.llm.callJson(
      {
        goal: this.task.goal,
        cwd: this.task.cwd,
        history: [],
        toolSchema: JSON.stringify(
          Object.values(TOOL_REGISTRY).map((t) => ({ id: t.id, description: t.description, danger: t.danger, endsAgentStep: t.endsAgentStep !== false })),
          null,
          2
        ) + (this.mcpSchema ? `\n${this.mcpSchema}` : ''),
        recentSteps,
        plan,
        agentsMd: this.agentsMd,
        skills: this.skills,
      },
      { model: this.model }
    );

    if (llmRes.plan && llmRes.plan.length > 0) {
      const p = llmRes.plan.map((x) => ({
        id: x.id || uid('plan'),
        text: x.text,
        done: x.done ?? false,
      }));
      this.orchestrator.setPlan(p);
    }

    if (llmRes.thought) {
      this.orchestrator.addThought('Razonamiento', llmRes.thought);
      this.pushTurn('model', llmRes.thought);
    }

    if (llmRes.finish) {
      if (llmRes.answer) {
        this.addThoughtCapped('Finalizado', llmRes.answer);
        this.pushTurn('model', llmRes.answer);
      }
      this.stop();
      return;
    }

    const calls = (llmRes.toolCalls || [])
      .filter((tc) => ALLOWED_TOOLS.includes(tc.tool))
      .slice(0, 5)
      .map((tc) => ({ tool: tc.tool, input: tc.input }));
    const rejected = (llmRes.toolCalls || []).filter((tc) => !ALLOWED_TOOLS.includes(tc.tool));
    if (rejected.length > 0) {
      this.addThoughtCapped('Tool rechazado', `No permitido: ${rejected.map((r) => String(r.tool).slice(0, 80)).join(', ')}`);
    }

    // Presupuesto: no ejecutar tools si no caben call+result dentro de maxSteps
    const budget = this.toolBudget();
    if (budget <= 0) {
      this.stop();
      return;
    }
    const executable = calls.slice(0, budget);
    if (executable.length < calls.length) {
      this.addThoughtCapped('Límite', `Recortando a ${executable.length} toolCall(s) por maxSteps=${this.task.maxSteps}`);
    }

    if (executable.length > 0) {
      const repeated = this.repeats.track(executable);
      const results = await this.runParallel(this.dropExhausted(executable));
      this.recordReads(executable, results);
      if (results.length > 0) this.pushResults(results);
      this.trackProgress(results);
      this.warnRepeats(repeated.filter((item) => item.times < BLOCK_AFTER_REPEATS));
      const fails = results.filter((r) => !r.ok);
      if (fails.length > 0) {
        this.addThoughtCapped('Tool falló', fails.map((f) => `${f.tool} error: ${f.error}`).join('\n').slice(0, 1000));
      }
    } else {
      this.addThoughtCapped('Sin acción', 'LLM no propuso toolCalls ni finish. Forzando detención segura.');
      this.stop();
      return;
    }
  }

  private async step() {
    return this.stepOnce();
  }
}