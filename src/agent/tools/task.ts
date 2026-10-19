import type { ToolDefinition } from '../types';

/**
 * Tool `task`: lanza un subagente en el servidor (P1 #7).
 *
 * Esta tool no se ejecuta en el cliente; es invocada por el LLM y el
 * servidor la resuelve vía `executeTask` (crea una AgentSession hija).
 * Aquí solo declaramos su interfaz para que el registro del cliente la conozca.
 */
export interface TaskToolInput {
  goal: string;
  instructions?: string;
  model?: string;
  allowedTools?: string[] | null;
  mode?: 'build' | 'plan' | 'readonly';
  maxSteps?: number;
  /** ID de la sesión padre (inyectado por el orquestador/cliente). */
  parentSessionId: string;
  /** Claves opcionales para el subagente. */
  keys?: Record<string, string>;
}

export const taskTool: ToolDefinition<TaskToolInput, { answer: string }> = {
  id: 'task',
  description: 'Lanza un subagente con su propio objetivo y contexto. Devuelve la respuesta final del subagente.',
  danger: false,
  requiresApproval: () => false,
  // El cliente no ejecuta esta tool; el servidor la maneja internamente.
  run: async () => ({ ok: false, error: 'task se ejecuta en el servidor' }),
};