import type { ToolDefinition } from '../types';
import { callAgentTool } from './runTool';

export interface RunFileChangeHooksInput { path: string; }
export interface RunFileChangeHooksOutput { ran: boolean; output?: string; error?: string; }

export const runFileChangeHooksTool: ToolDefinition<RunFileChangeHooksInput, RunFileChangeHooksOutput> = {
  id: 'run_file_change_hooks',
  description: 'Corre el formateador (prettier) sobre un archivo recién modificado. Devuelve la salida o el error.',
  danger: false,
  requiresApproval: () => false,
  // El formateador vive en el servidor y escribe el archivo: el root tiene que
  // viajar para que resuelva la ruta contra el proyecto abierto.
  run: async (input) => callAgentTool('run_file_change_hooks', input),
};
