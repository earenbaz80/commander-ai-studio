export type ToolId =
  | 'fs.read'
  | 'fs.write'
  | 'fs.edit'
  | 'fs.glob'
  | 'fs.grep'
  | 'shell.run'
  | 'shell.job'
  | 'browser'
  | 'preview'
  | 'read_diagnostics'
  | 'task'
  | 'git.status'
  | 'git.diff'
  | 'git.log'
  | 'git.commit'
  | 'git.worktree'
  | 'git.rebase'
  | 'git.conflict'
  | 'code.run'
  | 'web.fetch'
  | 'web.search';

export interface ToolContext {
  cwd: string;
  approve: (req: ApprovalRequest) => Promise<ApprovalResult>;
  log: (entry: ToolLogEntry) => void;
}

export interface ApprovalRequest {
  id: string;
  toolId: ToolId;
  title: string;
  description: string;
  danger: boolean;
  meta?: Record<string, any>;
}

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
  /**
   * Si la UI modificó la propuesta (p.ej. el usuario aplicó sólo algunos hunks
   * del diff), se ejecuta esta tool con estos inputs en lugar del original.
   */
  override?: { toolId: string; input: unknown };
}

export interface ToolLogEntry {
  id: string;
  ts: number;
  toolId: ToolId;
  input: unknown;
  output?: unknown;
  error?: string;
  durationMs: number;
  approved?: boolean;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, any>;
}

export interface ToolDefinition<Input = unknown, Output = unknown> {
  id: ToolId;
  description: string;
  danger: boolean;
  schema?: unknown;
  requiresApproval: (input: Input, ctx: ToolContext) => boolean;
  run: (input: Input, ctx: ToolContext) => Promise<ToolResult<Output>>;
}

export interface AgentStep {
  id: string;
  type: 'thought' | 'tool_call' | 'tool_result' | 'plan' | 'subagent';
  toolId?: ToolId;
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

export interface AgentTask {
  id: string;
  goal: string;
  cwd: string;
  maxSteps: number;
  /** Plan de ejecución (opcional, para sincronizar UI con orquestador). */
  plan?: Array<{ id: string; text: string; done: boolean }>;
}

export interface AgentState {
  task: AgentTask | null;
  plan: AgentPlanItem[];
  steps: AgentStep[];
  thinking: boolean;
  running: boolean;
  error?: string;
  currentStepId?: string;
  /** Checkpoint creado antes de la primera mutación del run (para rollback). */
  runCheckpointId?: string | null;
}

export interface OrchestratorOptions {
  cwd: string;
  maxSteps?: number;
  onStep: (step: AgentStep) => void;
  onPlanChange: (plan: AgentPlanItem[]) => void;
  onStateChange: (state: AgentState) => void;
  approve: (req: ApprovalRequest) => Promise<ApprovalResult>;
}

/** Git worktree checkpoint for true time-travel */
export interface GitWorktreeCheckpoint {
  id: string;
  worktreePath: string;
  branch: string;
  commit: string;
  timestamp: number;
  label: string;
}

/** Sub-agent configuration */
export interface SubAgentConfig {
  id: string;
  name: string;
  role: 'researcher' | 'coder' | 'reviewer' | 'planner' | 'custom';
  goal: string;
  cwd: string;
  tokensBudget: number;
  parentId: string;
  tokensUsed: number;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'paused';
  progress: number;
  currentTask: string;
  tasksCompleted: number;
  tasksTotal: number;
  startTime: number;
  endTime?: number;
  logs: SubAgentLog[];
  color: string;
}

export interface SubAgentLog {
  id: string;
  timestamp: number;
  type: 'info' | 'success' | 'error' | 'warning' | 'tool' | 'thought';
  message: string;
  tool?: string;
  duration?: number;
}

/** Task decomposition result */
export interface DecomposedTask {
  id: string;
  title: string;
  description: string;
  role: 'researcher' | 'coder' | 'reviewer' | 'planner';
  estimatedTokens: number;
  dependsOn: string[];
  priority: number;
}