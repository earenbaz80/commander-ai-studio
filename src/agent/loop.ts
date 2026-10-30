import { uid } from './id';
import type { AgentOrchestrator } from './orchestrator';
import type { AgentTask } from './types';
import { callAgentLLM, callAgentLLMTools } from './llm';
import { mapFunctionCall } from './fnTools';
import { PLAN_TOOL, normalizePlan } from './plan';
import { modelSupportsTools } from './providers';
import { TOOL_REGISTRY } from './registry';
import { loadMCPServers, mcpListTools, listRegistryServers, listRegistryServerTools } from './mcp';
import { TURN_CHARS, compactTurns, serializeResults } from './contextBudget';

const ALLOWED_TOOLS = ['fs.read', 'fs.write', 'fs.edit', 'fs.glob', 'fs.grep', 'shell.run', 'shell.job', 'browser', 'preview', 'read_diagnostics', 'task', 'git.status', 'git.diff', 'git.log', 'git.commit', 'git.worktree', 'git.rebase', 'git.conflict', 'web.fetch', 'web.search', 'code.run', 'mcp.call', 'mcp.list'];

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
  private llm: AgentLLMClient;
  private agentsMd = '';
  private mcpSchema = '';
  private turns: { role: string; text: string }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(orchestrator: AgentOrchestrator, model?: string, llmClient: AgentLLMClient = defaultAgentLLMClient) {
    this.orchestrator = orchestrator;
    this.model = model;
    this.llm = llmClient;
  }

  /**
   * Pre-vuelo compartido por `start` y `resume`: reglas del repo y tools MCP.
   * No toca el log de pasos, así que no consume presupuesto de maxSteps.
   */
  private async prepare(): Promise<{ rules: { file: string; text: string } | null; mcpParts: string[] }> {
    const rules = await this.loadRepoRules();
    const mcpParts = await this.loadMCPTools();
    this.agentsMd = rules?.text ?? '';
    this.mcpSchema = mcpParts.join('\n').slice(0, 2000);
    return { rules, mcpParts };
  }

  async start(task: AgentTask) {
    this.task = task;
    this.running = true;
    this.turns = [];
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
    this.turns.push({ role, text: text.slice(0, TURN_CHARS) });
    // Presupuesto: últimos turnos literales, los anteriores resumidos.
    this.turns = compactTurns(this.turns);
  }

  /** ToolCalls ejecutables con el presupuesto restante (cada call consume 2 steps: llamada + resultado). */
  private toolBudget(): number {
    const max = this.task?.maxSteps ?? 0;
    const used = this.orchestrator.getState().steps.length;
    return Math.floor((max - used) / 2);
  }

  /** addThought que nunca rompe el invariante steps.length <= maxSteps. */
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
            Object.values(TOOL_REGISTRY).map((t) => ({ id: t.id, description: t.description, danger: t.danger })),
            null,
            2
          ) + (this.mcpSchema ? `\n${this.mcpSchema}` : ''),
          recentSteps,
          plan,
          agentsMd: this.agentsMd,
          turns: this.turns,
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
      .filter((m): m is { tool: string; input: unknown } => !!m && ALLOWED_TOOLS.includes(m.tool))
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
    const results = await this.runParallel(executable);
    const fails = results.filter((r) => !r.ok);
    this.pushTurn('user', `Resultados:\n${serializeResults(results)}`);
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
          Object.values(TOOL_REGISTRY).map((t) => ({ id: t.id, description: t.description, danger: t.danger })),
          null,
          2
        ) + (this.mcpSchema ? `\n${this.mcpSchema}` : ''),
        recentSteps,
        plan,
        agentsMd: this.agentsMd,
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
      const results = await this.runParallel(executable);
      this.pushTurn('user', `Resultados:\n${serializeResults(results)}`);
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