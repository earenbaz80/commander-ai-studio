import type { ToolDefinition } from '../types';
import { withActiveRoot } from '../activeProject';

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
  // list es de solo lectura; add/remove crean o borran directorios.
  requiresApproval: (input: any) => String(input?.action || '').trim().toLowerCase() !== 'list',
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

/** Conflictos git. Sin `resolve` es sólo inspección: devuelve el primer
 * bloque con las dos versiones (ours/theirs) y la ruta detectada. Con
 * `resolve: 'ours' | 'theirs'` aplica esa versión a todos los bloques del
 * archivo (`path`, o la ruta que indique la salida de merge) y lo deja sin
 * stagear. `all` trabaja sobre todo el merge: sin `resolve`/`stage`/`commit`/
 * `abort` consulta el estado, `stage` cierra con `git add`, `commit` completa
 * la fusión y `abort` la deshace restaurando el árbol. Modificar requiere
 * aprobación.
 *
 * Delega en el servidor: la versión anterior duplicaba el parseo aquí,
 * descartaba `theirs` y además ignoraba `resolve` sin avisar. */
export const gitConflictTool: ToolDefinition<any, any> = {
  id: 'git.conflict',
  description: 'Estado del merge, inspeccionar un conflicto (ours/theirs), resolver uno o todos (all), cerrarlo con git add (stage), completarlo con el commit de merge (commit) o abortarlo (abort).',
  danger: true,
  requiresApproval: (input: any) => {
    const side = String(input?.resolve || '').trim().toLowerCase();
    // Resolver escribe siempre; `stage`, `commit` y `abort` modifican índice,
    // historial o árbol (sólo aplican con `all`).
    return side === 'ours' || side === 'theirs'
      || (!!input?.all && (!!input?.stage || !!input?.commit || !!input?.abort));
  },
  run: async (input) => {
    const side = String(input?.resolve || '').trim().toLowerCase();
    if (input?.all) {
      // Sin resolve, stage, commit ni abort es una consulta de estado: el panel
      // la usa al abrirse.
      return callServer('git.conflict', {
        all: true,
        ...(side ? { resolve: side } : {}),
        ...(input?.stage ? { stage: true } : {}),
        ...(input?.commit ? { commit: true } : {}),
        ...(input?.abort ? { abort: true } : {}),
        ...(input?.message ? { message: String(input.message) } : {}),
      });
    }
    const output = String(input?.output || '');
    if (!output) return { ok: false, error: 'Sin output de git diff/merge' };
    if (side === 'ours' || side === 'theirs') {
      return callServer('git.conflict', { output, resolve: side, path: input?.path });
    }
    return callServer('git.conflict', { output });
  },
};

/**
 * Estado del merge en curso (sólo lectura). Va directo al servidor en vez de
 * pasar por el orquestador: consultar al abrir el panel no debe crear pasos
 * en la línea de tiempo del agente ni pedir aprobación.
 */
export async function gitConflictState(): Promise<any> {
  try {
    return await callServer('git.conflict', { all: true });
  } catch (e: any) {
    // Sin servidor no hay estado: el panel simplemente no lo muestra.
    return { ok: false, error: String(e?.message || e) };
  }
}
