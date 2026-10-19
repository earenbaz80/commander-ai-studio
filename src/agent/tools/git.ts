import type { ToolDefinition } from '../types';
import { withActiveRoot } from '../activeProject';
import { uid } from '../id';

async function callServer(toolId: string, input: any): Promise<any> {
  const res = await fetch('/api/agent/run-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId, input: withActiveRoot(input || {}) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: (err as any).error || `HTTP ${res.status}` };
  }
  return res.json();
}

export const gitStatusTool: ToolDefinition<any, any> = {
  id: 'git.status',
  description: 'git status corto del workspace (vía servidor).',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callServer('git.status', input || {}),
};

export const gitDiffTool: ToolDefinition<any, any> = {
  id: 'git.diff',
  description: 'git diff del workspace o de un archivo (vía servidor).',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callServer('git.diff', input || {}),
};

export const gitLogTool: ToolDefinition<any, any> = {
  id: 'git.log',
  description: 'Últimos commits del workspace (vía servidor).',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callServer('git.log', input || {}),
};

export const gitCommitTool: ToolDefinition<any, any> = {
  id: 'git.commit',
  description: 'git add -A + commit (vía servidor, requiere aprobación).',
  danger: true,
  requiresApproval: () => true,
  run: async (input) => callServer('git.commit', input || {}),
};

/** Herramientas git avanzadas: worktree, rebase, conflicto. */
export const gitWorktreeTool: ToolDefinition<any, any> = {
  id: 'git.worktree',
  description: 'Gestionar worktrees (list/add/remove) del workspace.',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => {
    const action = String(input.action || '').trim().toLowerCase();
    if (!action) return { ok: false, error: 'action requerido (list/add/remove)' };
    return callServer('git.worktree', { action, ...input });
  },
};

export const gitRebaseTool: ToolDefinition<any, any> = {
  id: 'git.rebase',
  description: 'Iniciar / abortar / continuar rebase (via servidor).',
  danger: true,
  requiresApproval: () => true,
  run: async (input) => {
    const action = String(input.action || '').trim().toLowerCase();
    if (!action) return { ok: false, error: 'action requerido (start/continue/abort)' };
    return callServer('git.rebase', { action, ...input });
  },
};

/** Muestra inline de conflictos (primer bloque @@). Devuelve la línea
 * conflictiva y las dos opciones (theirs/ours) para que el agente las
 * evalúe y proponga una resolución. */
export const gitConflictTool: ToolDefinition<any, any> = {
  id: 'git.conflict',
  description: 'Mostrar primer bloque de conflicto git y opciones de resolución.',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => {
    const output = String(input?.output || '');
    if (!output) return { ok: false, error: 'Sin output de git diff/merge' };
    // Buscar el primer bloque de conflicto: ^<<<<<<<, ^=======, ^>>>>>>>>
    const re = /^<<<<<<< [^\n]+\n(.+?)\n======+\n(.+?)\n>>>>>>>/ms;
    const m = output.match(re);
    if (!m) return { ok: false, error: 'No hay bloque de conflicto detectable' };
    const ours = m[1].trim(); // lo que tenemos local
    // Elours = m[2].trim(); // lo entrante (opcional)
    return {
      ok: true,
      data: {
        conflictId: uid('conflict'),
        ours,
        // ours es el contenido local; el otro lado se extrae del output completo si es necesario
      },
    };
  },
};
