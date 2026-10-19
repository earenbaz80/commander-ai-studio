/**
 * Cliente de checkpoints del workspace (undo/restaurar) + Git worktree checkpoints.
 */
import { getActiveProjectRoot } from '../agent/activeProject';
import type { GitWorktreeCheckpoint } from '../agent/types';

export interface CheckpointFileEntry {
  path: string;
  existed: boolean;
  bytes?: number;
  captured?: boolean;
}

export interface CheckpointMeta {
  id: string;
  ts: number;
  label: string;
  tool?: string;
  files: CheckpointFileEntry[];
}

export interface RestoreResult {
  ok: boolean;
  restored?: string[];
  deleted?: string[];
  skipped?: string[];
  error?: string;
}

/** Resultado de restaurar un checkpoint de git worktree. */
export interface WorktreeRestoreResult {
  ok: boolean;
  checkpoint?: GitWorktreeCheckpoint;
  /** true si los cambios se trajeron al árbol de trabajo actual. */
  applied?: boolean;
  restoredFiles?: string[];
  error?: string;
}

function rootParam(root?: string): string {
  return root !== undefined ? root : getActiveProjectRoot() || '';
}

/** ========== FILE-BASED CHECKPOINTS ========== */

/** Lista los checkpoints del proyecto activo (file-based). */
export async function listCheckpoints(
  root?: string
): Promise<{ checkpoints: CheckpointMeta[]; error?: string }> {
  try {
    const res = await fetch(`/api/checkpoints?root=${encodeURIComponent(rootParam(root))}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) return { checkpoints: [], error: json.error || `HTTP ${res.status}` };
    return { checkpoints: (json.checkpoints || []) as CheckpointMeta[] };
  } catch (e: any) {
    return { checkpoints: [], error: e?.message || 'Error de red' };
  }
}

/** Crea un checkpoint manual de todo el proyecto (file-based). */
export async function createCheckpoint(
  label?: string,
  root?: string
): Promise<{ ok: boolean; checkpoint?: CheckpointMeta; error?: string }> {
  try {
    const res = await fetch('/api/checkpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: rootParam(root), label }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) return { ok: false, error: json.error || `HTTP ${res.status}` };
    return { ok: true, checkpoint: json.checkpoint as CheckpointMeta };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error de red' };
  }
}

/** Restaura un checkpoint file-based (revierte o elimina los archivos afectados). */
export async function restoreCheckpoint(id: string, root?: string): Promise<RestoreResult> {
  try {
    const res = await fetch('/api/checkpoints/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: rootParam(root), id }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) return { ok: false, error: json.error || `HTTP ${res.status}` };
    return {
      ok: true,
      restored: json.restored || [],
      deleted: json.deleted || [],
      skipped: json.skipped || [],
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error de red' };
  }
}

/** ========== GIT WORKTREE CHECKPOINTS (True Time-Travel) ========== */

/**
 * Lista los checkpoints de git worktree (true time-travel).
 * `isGit` permite a la UI explicar por qué la lista está vacía.
 */
export async function listWorktreeCheckpoints(
  root?: string
): Promise<{ checkpoints: GitWorktreeCheckpoint[]; isGit: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/checkpoints/worktree?root=${encodeURIComponent(rootParam(root))}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { checkpoints: [], isGit: json.isGit !== false, error: json.error || `HTTP ${res.status}` };
    }
    return {
      checkpoints: (json.checkpoints || []) as GitWorktreeCheckpoint[],
      isGit: json.isGit !== false,
      error: json.error,
    };
  } catch (e: any) {
    return { checkpoints: [], isGit: true, error: e?.message || 'Error de red' };
  }
}

/** Crea un checkpoint de git worktree (true time-travel). */
export async function createWorktreeCheckpoint(
  label?: string,
  root?: string
): Promise<{ ok: boolean; checkpoint?: GitWorktreeCheckpoint; error?: string }> {
  try {
    const res = await fetch('/api/checkpoints/worktree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: rootParam(root), label }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) return { ok: false, error: json.error || `HTTP ${res.status}` };
    return { ok: true, checkpoint: json.checkpoint as GitWorktreeCheckpoint };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error de red' };
  }
}

/**
 * Restaura a un checkpoint de git worktree.
 * `apply: false` (default) solo deja el worktree listo para comparar;
 * `apply: true` trae los cambios a tu árbol de trabajo.
 */
export async function restoreWorktreeCheckpoint(
  id: string,
  opts: { apply?: boolean; root?: string } = {}
): Promise<WorktreeRestoreResult> {
  try {
    const res = await fetch('/api/checkpoints/worktree/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: rootParam(opts.root), id, apply: opts.apply === true }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) return { ok: false, error: json.error || `HTTP ${res.status}` };
    return {
      ok: true,
      checkpoint: json.checkpoint as GitWorktreeCheckpoint | undefined,
      applied: json.applied === true,
      restoredFiles: (json.restoredFiles || []) as string[],
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error de red' };
  }
}

/** Borra un checkpoint de worktree y limpia su rama. */
export async function deleteWorktreeCheckpoint(
  id: string,
  root?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const qs = `root=${encodeURIComponent(rootParam(root))}&id=${encodeURIComponent(id)}`;
    const res = await fetch(`/api/checkpoints/worktree?${qs}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) return { ok: false, error: json.error || `HTTP ${res.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error de red' };
  }
}