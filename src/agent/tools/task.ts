import type { ToolDefinition } from '../types';
import { callAgentTool } from './runTool';
import { ensureServerSession } from '../activeSession';

/**
 * Tool `task`: lanza un subagente en el servidor (P1 #7).
 *
 * El trabajo ocurre en el servidor (`executeTask` crea una AgentSession hija),
 * así que el cliente reenvía la llamada por `/api/agent/run-tool`. Antes
 * devolvía un `{ ok:false, error:'task se ejecuta en el servidor' }` escrito a
 * mano: el modelo recibía un fallo que el servidor nunca dio y no podía hacer
 * nada con él.
 *
 * La sesión padre se registra de forma perezosa, igual que en `spawn_agents`:
 * el modelo no puede conocer ese id, lo pone la app desde la tarea anotada.
 */
export interface TaskToolInput {
  goal: string;
  instructions?: string;
  model?: string;
  allowedTools?: string[] | null;
  mode?: 'build' | 'plan' | 'readonly';
  maxSteps?: number;
  /** ID de la sesión padre (lo inyecta la app; opcional en la declaración). */
  parentSessionId?: string;
  /** Claves opcionales para el subagente. */
  keys?: Record<string, string>;
}

export const taskTool: ToolDefinition<TaskToolInput, { answer: string }> = {
  id: 'task',
  description: 'Lanza un subagente con su propio objetivo y contexto. Devuelve la respuesta final del subagente.',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => {
    const parentSessionId = (await ensureServerSession()) || input.parentSessionId;
    return callAgentTool('task', { ...input, parentSessionId });
  },
};
