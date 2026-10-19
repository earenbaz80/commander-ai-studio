import { uid } from './id';
import type {
  AgentState,
  OrchestratorOptions,
  ToolContext,
  GitWorktreeCheckpoint,
} from './types';
import { getTool } from './registry';
import {
  createCheckpoint,
  restoreCheckpoint,
  listWorktreeCheckpoints as apiListWorktreeCheckpoints,
  createWorktreeCheckpoint as apiCreateWorktreeCheckpoint,
  restoreWorktreeCheckpoint as apiRestoreWorktreeCheckpoint,
} from '../utils/checkpointsApi';

const MUTATING_TOOLS = new Set(['fs.write', 'fs.edit', 'git.commit', 'git.checkout', 'git.merge']);

export class AgentOrchestrator {
  private state: AgentState;
  private opts: OrchestratorOptions;
  private ctx: ToolContext;
  private subAgents: Map<string, any> = new Map();
  private checkpoints: GitWorktreeCheckpoint[] = [];
  private currentPlan: any[] = [];
  private isExecutingPlan: boolean = false;
  private executionQueue: any[] = [];

  constructor(opts: OrchestratorOptions) {
    this.opts = opts;
    this.state = {
      task: null,
      plan: [],
      steps: [],
      thinking: false,
      running: false,
    };
    this.ctx = {
      cwd: opts.cwd,
      approve: opts.approve,
      log: (_entry: any) => {},
    };
  }

  getState(): AgentState {
    return this.state;
  }

  getSubAgents(): any[] {
    return Array.from(this.subAgents.values());
  }

  getCheckpoints(): GitWorktreeCheckpoint[] {
    return this.checkpoints;
  }

  /** true mientras el orquestador está ejecutando un plan. */
  isPlanExecuting(): boolean {
    return this.isExecutingPlan;
  }

  restoreState(s: any) {
    this.state = { ...s, running: false, thinking: false, currentStepId: undefined };
    this.emit();
  }

  start(task: any, plan?: any[]) {
    this.currentPlan = plan || [];
    this.executionQueue = [...this.currentPlan];
    this.state = {
      task,
      plan: this.currentPlan,
      steps: [],
      thinking: true,
      running: true,
      error: undefined,
      currentStepId: undefined,
      runCheckpointId: null,
    };
    this.emit();
  }

  stop() {
    this.state.running = false;
    this.state.thinking = false;
    this.emit();
  }

  setPlan(plan: any[]) {
    this.state.plan = plan;
    this.opts.onPlanChange(plan);
    this.emit();
  }

  addThought(title: string, content: string) {
    const step: any = {
      id: uid('step'),
      type: 'thought',
      title,
      content,
      status: 'completed',
      ts: Date.now(),
    };
    this.state.steps.push(step);
    this.opts.onStep(step);
    this.emit();
  }

  async runTool(toolId: string, input: unknown): Promise<any> {
    if (MUTATING_TOOLS.has(toolId)) {
      await this.ensureRunCheckpoint();
    }
    const tool = getTool(toolId);
    if (!tool) {
      const err = `Tool no encontrado: ${toolId}`;
      this.recordFailed('tool_call', toolId, err, input);
      return { ok: false, error: err };
    }

    let effectiveTool: any = tool;
    let effectiveInput: unknown = input;

    const requires = tool.requiresApproval(input, this.ctx);
    if (requires) {
      const req: any = {
        id: uid('step'),
        toolId: tool.id,
        title: `Aprobar ${tool.id}`,
        description: tool.description,
        danger: tool.danger,
        meta: { input },
      };
      const res = await this.ctx.approve(req);
      if (!res.approved) {
        this.recordFailed('tool_call', tool.id, `Denegado: ${res.reason || 'sin motivo'}`, input);
        return { ok: false, error: 'Aprobación denegada' };
      }
      if (res.override) {
        const overrideTool = getTool(res.override.toolId);
        if (overrideTool) {
          effectiveTool = overrideTool;
          effectiveInput = res.override.input;
        }
      }
    }

    const callStep: any = {
      id: uid('step'),
      type: 'tool_call',
      toolId: effectiveTool.id as any,
      title: `Llamando ${effectiveTool.id}`,
      content: '',
      input: effectiveInput,
      status: 'running',
      ts: Date.now(),
    };
    this.state.steps.push(callStep);
    this.state.currentStepId = callStep.id;
    this.opts.onStep(callStep);
    this.emit();

    const start = Date.now();
    try {
      const result = await effectiveTool.run(effectiveInput, this.ctx);
      const resStep: any = {
        id: uid('step'),
        type: 'tool_result',
        toolId: effectiveTool.id as any,
        title: result.ok ? `${effectiveTool.id} OK` : `${effectiveTool.id} ERROR`,
        content: String(result.ok ? 'ok' : (result.error || 'error')),
        input: effectiveInput,
        output: result,
        status: result.ok ? 'completed' : 'failed',
        durationMs: Date.now() - start,
        ts: Date.now(),
      };
      callStep.status = result.ok ? 'completed' : 'failed';
      callStep.durationMs = resStep.durationMs;
      this.state.steps.push(resStep);
      this.opts.onStep(resStep);
      this.state.currentStepId = undefined;
      this.emit();
      return result;
    } catch (e: any) {
      const err = e?.message || String(e);
      const resStep: any = {
        id: uid('step'),
        type: 'tool_result',
        toolId: effectiveTool.id as any,
        title: `${effectiveTool.id} ERROR`,
        content: String(err),
        input: effectiveInput,
        output: { ok: false, error: err },
        status: 'failed',
        durationMs: Date.now() - start,
        ts: Date.now(),
      };
      callStep.status = 'failed';
      callStep.durationMs = resStep.durationMs;
      this.state.steps.push(resStep);
      this.opts.onStep(resStep);
      this.state.currentStepId = undefined;
      this.emit();
      return { ok: false, error: err };
    }
  }

  private async ensureRunCheckpoint(): Promise<void> {
    if (this.state.runCheckpointId) return;
    try {
      const r = await createCheckpoint('Punto de control antes de ejecución del agente', this.ctx.cwd);
      if (r.ok && r.checkpoint) {
        this.state.runCheckpointId = r.checkpoint.id;
        this.emit();
      }
    } catch {
      // Silencioso
    }
  }

  public async rollbackRun(): Promise<any> {
    if (!this.state.runCheckpointId) return { ok: false, error: 'No hay checkpoint de ejecución' };
    const r = await restoreCheckpoint(this.state.runCheckpointId, this.ctx.cwd);
    this.state.runCheckpointId = null;
    this.emit();
    const transformed = {
      ok: r.ok,
      error: r.error,
      restored: r.restored ? (Array.isArray(r.restored) ? r.restored.length : 0) : undefined,
      deleted: r.deleted ? (Array.isArray(r.deleted) ? r.deleted.length : 0) : undefined,
      skipped: r.skipped ? (Array.isArray(r.skipped) ? r.skipped.length : 0) : undefined,
    };
    return transformed;
  }

  private recordFailed(type: any, toolId: string | undefined, error: string, input?: unknown) {
    const step: any = {
      id: uid('step'),
      type,
      toolId: toolId as any,
      title: 'Error',
      content: error,
      input,
      status: 'failed',
      ts: Date.now(),
    };
    this.state.steps.push(step);
    this.opts.onStep(step);
    this.state.error = error;
    this.emit();
  }

  // ========== NEW: Git Worktree Checkpoints ==========
  // Ojo: el orquestador vive en el navegador, así que la lógica git se delega
  // al servidor por HTTP. Importar `child_process` aquí rompería el bundle.

  async createWorktreeCheckpoint(label: string): Promise<any> {
    const r = await apiCreateWorktreeCheckpoint(label, this.ctx.cwd);
    if (!r.ok || !r.checkpoint) {
      throw new Error(r.error || 'No se pudo crear el checkpoint de worktree');
    }
    this.checkpoints.push(r.checkpoint);
    this.emit();
    return r.checkpoint;
  }

  async rollbackToWorktree(checkpointId: string): Promise<any> {
    const checkpoint = this.checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint) {
      return { ok: false, error: 'Checkpoint no encontrado' };
    }

    // `apply: true` trae los cambios al árbol de trabajo actual.
    const r = await apiRestoreWorktreeCheckpoint(checkpointId, {
      apply: true,
      root: this.ctx.cwd,
    });
    if (!r.ok) {
      return { ok: false, error: r.error };
    }

    this.checkpoints = [checkpoint];
    this.emit();

    return { ok: true, applied: true, restoredFiles: r.restoredFiles || [] };
  }

  getWorktreeCheckpoints() {
    return this.checkpoints;
  }

  /** Sincroniza la lista local con la del servidor. */
  async refreshWorktreeCheckpoints(): Promise<void> {
    const r = await apiListWorktreeCheckpoints(this.ctx.cwd);
    this.checkpoints = r.checkpoints;
    this.emit();
  }

  // ========== NEW: Sub-Agent Spawning ==========

  async executePlan(plan: any[]): Promise<void> {
    this.currentPlan = plan;
    this.executionQueue = plan.filter(p => !p.done).sort((a, b) => a.id.localeCompare(b.id));
    this.isExecutingPlan = true;
    
    for (const item of this.executionQueue) {
      if (!this.state.running) break;
      
      this.currentPlan = this.currentPlan.map(p => 
        p.id === item.id ? { ...p, done: false } : p
      );
      this.opts.onPlanChange(this.currentPlan);
      this.emit();

      const subTasks = await this.decomposePlanItem(item);
      
      for (const subTask of subTasks) {
        if (!this.state.running) break;
        
        if (subTask.estimatedTokens > 5000 || subTask.role === 'researcher') {
          await this.spawnSubAgent(subTask);
        } else {
          await this.executeSubTask(subTask);
        }
        
        this.currentPlan = this.currentPlan.map(p => 
          p.id === item.id ? { ...p, done: true } : p
        );
        this.opts.onPlanChange(this.currentPlan);
        this.emit();
      }
      
      this.isExecutingPlan = false;
    }
  }

  private async decomposePlanItem(item: any): Promise<any[]> {
    const prompt = `Descompon esta tarea en subtareas ejecutables:\nTarea: ${item.text}\n\nDevuelve JSON con subtareas:\n[\n  {\n    "id": "sub_1",\n    "title": "Título breve",\n    "description": "Descripción detallada",\n    "role": "researcher|coder|reviewer|planner",\n    "estimatedTokens": 2000,\n    "dependsOn": [],\n    "priority": 1\n  }\n]`;

    try {
      const response = await fetch('/api/decompose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.subtasks || this.fallbackDecomposition(item);
      }
    } catch {
      // Fallback to simple decomposition
    }
    
    return this.fallbackDecomposition(item);
  }

  private fallbackDecomposition(item: any): any[] {
    return [{
      id: `sub_${Date.now()}_1`,
      title: item.text,
      description: item.text,
      role: 'coder',
      estimatedTokens: 2000,
      dependsOn: [],
      priority: 1,
    }];
  }

  async spawnSubAgent(task: any): Promise<string> {
    const agentId = `agent_${uid()}`;
    const subAgent = {
      id: agentId,
      name: `SubAgent-${task.role}-${Date.now()}`,
      role: task.role,
      goal: task.description,
      cwd: this.ctx.cwd,
      tokensBudget: task.estimatedTokens,
      parentId: this.state.task?.id || 'main',
      tokensUsed: 0,
      status: 'idle',
      progress: 0,
      currentTask: '',
      tasksCompleted: 0,
      tasksTotal: 1,
      startTime: Date.now(),
      logs: [],
      color: this.getRandomColor(),
    };

    const worktreePath = await this.createWorktree(subAgent.id);
    
    const config = {
      ...subAgent,
      cwd: worktreePath,
    };

    this.subAgents.set(subAgent.id, config);
    this.emit();
    
    this.executeSubAgent(config).catch(err => {
      console.error('Sub-agent error:', err);
      const agent = this.subAgents.get(subAgent.id);
      if (agent) {
        agent.status = 'failed';
        agent.logs.push({
          id: uid('log'),
          timestamp: Date.now(),
          type: 'error',
          message: `Sub-agent failed: ${err.message}`,
        });
        this.emit();
      }
    });

    return subAgent.id;
  }

  private getRandomColor() {
    const colors = ['#00ffff', '#ff5555', '#ffff55', '#88ff88', '#ff88ff', '#55ffff', '#ffaa00', '#aa00ff'];
    return colors[this.subAgents.size % colors.length];
  }

  private async createWorktree(agentId: string): Promise<string> {
    // Cada sub-agente trabaja aislado en su propio worktree (vía servidor).
    const r = await apiCreateWorktreeCheckpoint(`Sub-agente ${agentId}`, this.ctx.cwd);
    if (!r.ok || !r.checkpoint) {
      console.warn('Worktree no disponible, usando el cwd principal:', r.error);
      return this.ctx.cwd;
    }
    this.checkpoints.push(r.checkpoint);
    this.emit();
    return r.checkpoint.worktreePath;
  }

  private async executeSubAgent(agent: any): Promise<void> {
    agent.status = 'running';
    agent.startTime = Date.now();
    this.emit();
    
    try {
      const subOrchestrator = new (this.constructor as any)({
        cwd: agent.cwd,
        approve: async (_req: any) => ({ approved: true, reason: 'auto-approved' }),
        onStep: (step: any) => {
          this.logSubAgent(agent.id, { ...step, type: 'tool', message: `${agent.currentTool || 'tool'}: ${step.content}`, tool: step.toolId });
        },
        onPlanChange: () => {},
        onStateChange: (state: any) => {
          const agentConfig = this.subAgents.get(agent.id);
          if (agentConfig) {
            agentConfig.status = state.running ? 'running' : 'idle';
            agentConfig.progress = state.plan.filter((p: any) => p.done).length / Math.max(1, state.plan.length) * 100;
          }
        },
      });

      await subOrchestrator.start({
        id: `task_${Date.now()}`,
        goal: agent.goal,
        cwd: agent.cwd,
        maxSteps: 20,
      });

      while (subOrchestrator.getState().running) {
        await new Promise(r => setTimeout(r, 500));
      }

      agent.status = subOrchestrator.getState().error ? 'failed' : 'completed';
      agent.endTime = Date.now();
      agent.progress = 100;
      
    } catch (error) {
      agent.status = 'failed';
      agent.logs.push({
        id: `log_${Date.now()}`,
        timestamp: Date.now(),
        type: 'error',
        message: `Sub-agent failed: ${error}`,
      });
    } finally {
      this.emit();
    }
  }

  private logSubAgent(agentId: string, log: any) {
    const agent = this.subAgents.get(agentId);
    if (agent) {
      agent.logs.push({ ...log, id: `log_${uid()}`, timestamp: Date.now() });
      if (agent.logs.length > 100) agent.logs.shift();
      this.emit();
    }
  }

  private async executeSubTask(task: any): Promise<void> {
    this.addThought(`Ejecutando: ${task.title}`, task.description);
    
    const toolId = this.selectToolForTask(task);
    const input = this.buildToolInput(task);
    
    const result = await this.runTool(toolId, input);
    
    if (!result.ok) {
      throw new Error(`Sub-task failed: ${result.error}`);
    }
  }

  private selectToolForTask(task: any): string {
    switch (task.role) {
      case 'researcher': return 'web.search';
      case 'coder': return 'fs.write';
      case 'reviewer': return 'git.diff';
      case 'planner': return 'task';
      default: return 'shell.run';
    }
  }

  private buildToolInput(task: any): any {
    switch (task.role) {
      case 'researcher':
        return { query: task.description, maxResults: 5 };
      case 'coder':
        return { path: 'src/temp.ts', content: `// TODO: ${task.description}` };
      case 'reviewer':
        return { path: 'src' };
      default:
        return { command: `echo "${task.description}"` };
    }
  }

  private emit() {
    this.opts.onStateChange({ ...this.state });
  }
}