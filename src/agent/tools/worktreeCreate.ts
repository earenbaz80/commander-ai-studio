import type { ToolDefinition } from '../types';
import { getActiveProjectRoot } from '../activeProject';

// Direct HTTP (not via run-tool) for worktree create/list/remove
export interface WorktreeCreateInput {
  threadId: string;
  /** Ruta del proyecto. Si falta se usa el proyecto abierto. */
  projectPath?: string;
}
export interface WorktreeCreateOutput { worktreePath: string; branch: string; copied: string[]; bootstrapped: boolean; }

export const worktreeCreateTool: ToolDefinition<WorktreeCreateInput, WorktreeCreateOutput> = {
  id: 'worktree.create',
  description:
    'Crear un worktree git aislado para un thread (copia env, bootstrap de deps). Devuelve la ruta del ' +
    'worktree para usar como root en las demás tools.',
  danger: true,
  requiresApproval: () => true,
  run: async (input) => {
    // El modelo no conoce la ruta del proyecto: la aporta el root activo de la
    // app. El servidor la exige y la resuelve contra sus roots conocidos.
    const body = { threadId: input.threadId, projectPath: input.projectPath || getActiveProjectRoot() };
    const res = await fetch('/api/worktrees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: (err as any).error || `HTTP ${res.status}` };
    }
    return res.json();
  },
};
