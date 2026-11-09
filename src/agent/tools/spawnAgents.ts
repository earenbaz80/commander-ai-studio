import type { ToolDefinition } from '../types';
import { callAgentTool } from './runTool';
import { ensureServerSession } from '../activeSession';

export interface SpawnAgentsInput {
  agents: { goal: string; instructions?: string; model?: string; allowedTools?: string[] | null; mode?: 'build' | 'plan' | 'readonly'; maxSteps?: number; template?: string; worktree?: boolean; keepWorktree?: boolean }[];
  /** Opcional: la app lo rellena con la sesión que registró en el servidor. */
  parentSessionId?: string;
}
export interface SpawnAgentsOutput { results: { index: number; ok: boolean; answer?: string; error?: string }[]; spawned: number; capped: boolean; }

export const spawnAgentsTool: ToolDefinition<SpawnAgentsInput, SpawnAgentsOutput> = {
  id: 'spawn_agents',
  description:
    'Lanza hasta 6 subagentes en paralelo. Devuelve sus resultados. Úsalo para descomponer trabajo ' +
    'independiente. Cada agente puede correr en un worktree aislado (worktree:true). Requiere una ' +
    'sesión de servidor existente (la crea la tool task).',
  danger: false,
  requiresApproval: () => false,
  // Los subagentes corren en el servidor, con su propia sesión hija: aquí sólo
  // se reenvía la petición y se devuelve lo que el servidor conteste.
  // El id de la sesión padre lo pone la app (el modelo no puede conocerlo ni
  // inventarlo); se registra aquí, en el primer uso, en vez de al empezar la
  // tarea. Si el modelo manda otro id, manda el de la app.
  run: async (input) => {
    const parentSessionId = (await ensureServerSession()) || input.parentSessionId;
    return callAgentTool('spawn_agents', { ...input, parentSessionId });
  },
};
