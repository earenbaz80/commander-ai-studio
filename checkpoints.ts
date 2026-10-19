/**
 * Checkpoints de workspace (undo/restaurar).
 *
 * Antes de cada escritura del agente (`fs.write` / `fs.edit`) se guarda el
 * estado PREVIO del archivo dentro de `<root>/.commander/checkpoints/<id>/`.
 * Restaurar un checkpoint revierte esas rutas a su contenido anterior (o las
 * elimina si no existían).
 *
 * Los checkpoints viven dentro del root y nunca salen de él; el árbol de
 * archivos los ignora porque empiezan por `.`.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const REL_DIR = path.join('.commander', 'checkpoints');
const MAX_CHECKPOINTS = 50;
const MAX_SNAPSHOT_FILES = 300;
const MAX_FILE_BYTES = 512 * 1024;

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'release', 'out', 'coverage',
  '.git', '.next', '.nuxt', '.cache', '.vite', '.turbo', '.parcel-cache',
  '.commander',
]);

export interface CheckpointFileEntry {
  /** Ruta relativa al root, con separadores `/`. */
  path: string;
  existed: boolean;
  bytes?: number;
  /** false si no se guardó el contenido (existe, pero demasiado grande). */
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
  restored: string[];
  deleted: string[];
  skipped: string[];
}

/**
 * Checkpoint basado en `git worktree`: guarda un estado real del repo en una
 * rama dedicada, permitiendo viajar en el tiempo sin tocar tu árbol de trabajo.
 */
export interface GitWorktreeCheckpoint {
  id: string;
  worktreePath: string;
  branch: string;
  commit: string;
  timestamp: number;
  label: string;
}

function ckptBase(root: string): string {
  return path.join(root, REL_DIR);
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Normaliza una ruta relativa y rechaza escapes. */
function safeRel(rel: string): string {
  const norm = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = norm.split('/');
  if (!norm || parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error(`Ruta de checkpoint inválida: ${rel}`);
  }
  return norm;
}

export interface CheckpointInput {
  path: string;
  existed: boolean;
  content?: string;
}

/** Crea un checkpoint con el contenido PREVIO de una o varias rutas. */
export function createCheckpoint(
  entries: CheckpointInput[],
  meta: { root: string; label: string; tool?: string }
): CheckpointMeta {
  const id = newId();
  const dir = path.join(ckptBase(meta.root), id);
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });

  const files: CheckpointFileEntry[] = [];
  for (const e of entries) {
    const rel = safeRel(e.path);
    const entry: CheckpointFileEntry = { path: rel, existed: !!e.existed };
    if (e.existed && typeof e.content === 'string') {
      const content = e.content.slice(0, MAX_FILE_BYTES);
      const dest = path.join(dir, 'files', rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, 'utf8');
      entry.bytes = content.length;
      entry.captured = true;
    }
    files.push(entry);
  }

  const full: CheckpointMeta = { id, ts: Date.now(), label: meta.label, tool: meta.tool, files };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(full, null, 2), 'utf8');
  prune(meta.root);
  return full;
}

/**
 * Snapshot automático del estado previo de una ruta.
 * Si el archivo es demasiado grande no guarda contenido (restore lo saltará).
 */
export function snapshotPath(root: string, relPath: string, label: string, tool?: string): CheckpointMeta {
  const rel = safeRel(relPath);
  const abs = path.join(root, rel);
  let existed = false;
  let content: string | undefined;
  let tooBig = false;
  try {
    existed = fs.existsSync(abs) && fs.statSync(abs).isFile();
    if (existed) {
      tooBig = fs.statSync(abs).size > MAX_FILE_BYTES;
      if (!tooBig) content = fs.readFileSync(abs, 'utf8');
    }
  } catch {
    existed = false;
  }
  const cp = createCheckpoint([{ path: rel, existed, content }], { root, label, tool });
  if (tooBig) {
    cp.files[0].captured = false;
    fs.writeFileSync(path.join(ckptBase(root), cp.id, 'meta.json'), JSON.stringify(cp, null, 2), 'utf8');
  }
  return cp;
}

/** Snapshot de todo el proyecto (bounded) — botón manual. */
export function snapshotProject(root: string, label = 'Punto de control manual'): CheckpointMeta {
  const entries: CheckpointInput[] = [];
  const walk = (dir: string, rel: string) => {
    if (entries.length >= MAX_SNAPSHOT_FILES) return;
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      if (entries.length >= MAX_SNAPSHOT_FILES) return;
      const childRel = rel ? `${rel}/${it.name}` : it.name;
      if (it.isDirectory()) {
        if (it.name.startsWith('.') || SKIP_DIRS.has(it.name)) continue;
        walk(path.join(dir, it.name), childRel);
      } else if (it.isFile()) {
        const abs = path.join(dir, it.name);
        let content: string | undefined;
        try {
          if (fs.statSync(abs).size <= MAX_FILE_BYTES) content = fs.readFileSync(abs, 'utf8');
        } catch {
          content = undefined;
        }
        entries.push({ path: childRel, existed: true, content });
      }
    }
  };
  walk(root, '');
  return createCheckpoint(entries, { root, label, tool: 'manual' });
}

export function listCheckpoints(root: string): CheckpointMeta[] {
  const base = ckptBase(root);
  if (!fs.existsSync(base)) return [];
  const out: CheckpointMeta[] = [];
  for (const name of fs.readdirSync(base)) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(base, name, 'meta.json'), 'utf8')) as CheckpointMeta;
      if (meta && meta.id && Array.isArray(meta.files)) out.push(meta);
    } catch {
      /* checkpoint corrupto: se ignora */
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/** Crea la carpeta padre y comprueba que, resuelto el symlink, siga dentro del root. */
function assertParentInsideRoot(root: string, abs: string): void {
  const parent = path.dirname(abs);
  fs.mkdirSync(parent, { recursive: true });
  const realRoot = fs.realpathSync.native(root);
  const realParent = fs.realpathSync.native(parent);
  const rel = path.relative(realRoot, realParent);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Restauración fuera del proyecto (symlink): ${abs}`);
  }
}

export function restoreCheckpoint(root: string, id: string): RestoreResult {
  const safeId = String(id || '').replace(/[^\w.-]/g, '');
  const dir = path.join(ckptBase(root), safeId);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as CheckpointMeta;

  const restored: string[] = [];
  const deleted: string[] = [];
  const skipped: string[] = [];

  for (const e of meta.files) {
    let rel: string;
    try {
      rel = safeRel(e.path);
    } catch {
      continue;
    }
    const abs = path.join(root, rel);
    if (e.existed) {
      const src = path.join(dir, 'files', rel);
      if (fs.existsSync(src)) {
        assertParentInsideRoot(root, abs);
        if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink()) fs.unlinkSync(abs);
        fs.writeFileSync(abs, fs.readFileSync(src));
        restored.push(rel);
      } else {
        skipped.push(rel);
      }
    } else if (fs.existsSync(abs)) {
      fs.rmSync(abs, { force: true });
      deleted.push(rel);
    }
  }
  return { restored, deleted, skipped };
}

/** Mantiene solo los checkpoints más recientes. */
function prune(root: string): void {
  const base = ckptBase(root);
  if (!fs.existsSync(base)) return;
  const dirs = fs.readdirSync(base);
  if (dirs.length <= MAX_CHECKPOINTS) return;
  const withTime = dirs.map((name) => {
    try {
      return { name, ts: fs.statSync(path.join(base, name)).mtimeMs };
    } catch {
      return { name, ts: 0 };
    }
  });
  withTime.sort((a, b) => b.ts - a.ts);
  for (const d of withTime.slice(MAX_CHECKPOINTS)) {
    try {
      fs.rmSync(path.join(base, d.name), { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ==================== GIT WORKTREE CHECKPOINTS ====================

/** Carpeta donde viven los worktrees de checkpoint (dentro del root, ignorada por git). */
const WT_DIR = path.join('.commander', 'worktrees');
const WT_META = path.join('.commander', 'worktree-checkpoints.json');
const MAX_WORKTREE_CHECKPOINTS = 20;
const GIT_TIMEOUT_MS = 20000;

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

function wtBase(root: string): string {
  return path.join(root, WT_DIR);
}

function wtIndexPath(root: string): string {
  return path.join(root, WT_META);
}

/** true si `root` está dentro de un repositorio git. */
export function isGitRepo(root: string): boolean {
  try {
    return git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

/** Rama donde se guardan los checkpoints; se crea si no existe. */
export function worktreeBranch(root: string): string {
  const name = 'commander/checkpoints';
  try {
    git(root, ['rev-parse', '--verify', name]);
  } catch {
    try {
      git(root, ['branch', name]);
    } catch {
      /* si ya existe o falla, seguimos */
    }
  }
  return name;
}

function readIndex(root: string): GitWorktreeCheckpoint[] {
  try {
    const raw = fs.readFileSync(wtIndexPath(root), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GitWorktreeCheckpoint[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(root: string, list: GitWorktreeCheckpoint[]): void {
  const p = wtIndexPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(list, null, 2));
}

/** Elimina el worktree y la rama de un checkpoint (best-effort). */
function removeWorktree(root: string, cp: GitWorktreeCheckpoint): void {
  try {
    if (fs.existsSync(cp.worktreePath)) {
      git(root, ['worktree', 'remove', '--force', cp.worktreePath]);
    }
  } catch {
    /* best-effort: puede estar ya desmontado */
  }
  try {
    fs.rmSync(cp.worktreePath, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  try {
    git(root, ['worktree', 'prune']);
  } catch {
    /* best-effort */
  }
  try {
    git(root, ['branch', '-D', cp.branch]);
  } catch {
    /* best-effort: rama ya borrada */
  }
}

/** Lista los checkpoints de worktree del root, más reciente primero. */
export function listWorktreeCheckpoints(
  root: string
): { checkpoints: GitWorktreeCheckpoint[]; error?: string } {
  if (!root) return { checkpoints: [], error: 'root requerido' };
  if (!fs.existsSync(root)) return { checkpoints: [], error: 'El proyecto no existe' };
  if (!isGitRepo(root)) {
    return { checkpoints: [], error: 'El proyecto no es un repositorio git' };
  }
  return { checkpoints: readIndex(root) };
}

/**
 * Crea un checkpoint real: commit del estado actual en una rama dedicada y un
 * `git worktree` adicional apuntando a ese commit.
 */
export function createWorktreeCheckpoint(
  root: string,
  label?: string
): { checkpoint?: GitWorktreeCheckpoint; error?: string } {
  if (!root) return { error: 'root requerido' };
  if (!fs.existsSync(root)) return { error: 'El proyecto no existe' };
  if (!isGitRepo(root)) return { error: 'El proyecto no es un repositorio git' };

  try {
    const ts = Date.now();
    const id = `${ts.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const branch = `${worktreeBranch(root)}-cp-${id}`;
    const worktreePath = path.join(wtBase(root), id);
    const safeLabel = String(label || 'Checkpoint').slice(0, 200);

    fs.mkdirSync(wtBase(root), { recursive: true });

    // Rama detached desde HEAD actual con un único commit de estado.
    git(root, ['branch', branch]);
    git(root, ['add', '-A']);
    let commit = '';
    try {
      const staged = git(root, ['diff', '--cached', '--quiet']);
      if (staged === '' || staged === undefined) commit = git(root, ['rev-parse', 'HEAD']);
    } catch {
      commit = git(root, ['rev-parse', 'HEAD']);
    }
    // `git commit` crea el commit cuando hay cambios; si no hay, reutiliza HEAD.
    try {
      git(root, ['-c', 'user.email=commander@local', '-c', 'user.name=Commander',
        'commit', '--allow-empty', '-m', `commander checkpoint: ${safeLabel}`]);
    } catch {
      /* nada que commitear */
    }
    commit = git(root, ['rev-parse', branch]);

    git(root, ['worktree', 'add', '--detach', worktreePath, branch]);

    const cp: GitWorktreeCheckpoint = {
      id,
      worktreePath,
      branch,
      commit,
      timestamp: ts,
      label: safeLabel,
    };

    const list = [cp, ...readIndex(root)];
    // Poda: conserva los N más recientes y limpia sus worktrees.
    for (const old of list.slice(MAX_WORKTREE_CHECKPOINTS)) {
      removeWorktree(root, old);
    }
    writeIndex(root, list.slice(0, MAX_WORKTREE_CHECKPOINTS));

    return { checkpoint: cp };
  } catch (e: any) {
    return { error: e?.message || 'Error creando checkpoint de worktree' };
  }
}

/**
 * Restaura el proyecto al estado de un checkpoint. Por defecto solo deja el
 * worktree listo para inspeccionar (modo comparación); con `apply: true` trae
 * los cambios a tu árbol de trabajo.
 */
export function restoreWorktreeCheckpoint(
  root: string,
  id: string,
  opts: { apply?: boolean } = {}
): {
  ok: boolean;
  checkpoint?: GitWorktreeCheckpoint;
  applied?: boolean;
  restoredFiles?: string[];
  error?: string;
} {
  if (!root) return { ok: false, error: 'root requerido' };
  if (!isGitRepo(root)) return { ok: false, error: 'El proyecto no es un repositorio git' };

  const safeId = String(id || '').replace(/[^\w.-]/g, '');
  if (!safeId) return { ok: false, error: 'id requerido' };

  const cp = readIndex(root).find((c) => c.id === safeId);
  if (!cp) return { ok: false, error: 'Checkpoint no encontrado' };

  try {
    let restoredFiles: string[] = [];
    if (opts.apply) {
      // Aplica el estado del checkpoint al árbol de trabajo actual.
      const changed = git(root, ['diff', '--name-only', `${cp.commit}`, '--']);
      restoredFiles = changed ? changed.split('\n').filter(Boolean) : [];
      git(root, ['checkout', cp.commit, '--', '.']);
      restoredFiles.push('.');
    }

    // El worktree debe existir para poder explorar el checkpoint.
    if (!fs.existsSync(cp.worktreePath)) {
      fs.mkdirSync(wtBase(root), { recursive: true });
      git(root, ['worktree', 'add', '--detach', cp.worktreePath, cp.branch]);
    }

    return { ok: true, checkpoint: cp, applied: !!opts.apply, restoredFiles };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error restaurando checkpoint' };
  }
}

/** Borra un checkpoint y su worktree. */
export function deleteWorktreeCheckpoint(
  root: string,
  id: string
): { ok: boolean; error?: string } {
  const safeId = String(id || '').replace(/[^\w.-]/g, '');
  if (!safeId) return { ok: false, error: 'id requerido' };
  if (!isGitRepo(root)) return { ok: false, error: 'El proyecto no es un repositorio git' };

  const list = readIndex(root);
  const cp = list.find((c) => c.id === safeId);
  if (!cp) return { ok: false, error: 'Checkpoint no encontrado' };

  try {
    removeWorktree(root, cp);
    writeIndex(root, list.filter((c) => c.id !== safeId));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error borrando checkpoint' };
  }
}
