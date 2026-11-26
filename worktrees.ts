import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ENV_FILES = ['.env', '.env.local', '.infisical.json', '.vercel/project.json'];
const FORCE_INCLUDE = '.freebuffignore';

export interface WorktreeResult { worktreePath: string; branch: string; copied: string[]; bootstrapped: boolean; }

function shortId(id: string): string { return id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'wt'; }

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function createWorktree(threadId: string, projectPath: string): WorktreeResult {
  const repoName = path.basename(projectPath);
  const base = path.join(os.homedir(), '.commander', 'worktrees', shortId(threadId), repoName);
  fs.mkdirSync(path.dirname(base), { recursive: true });
  if (fs.existsSync(base)) {
    // Reuse existing worktree
    const branch = runGit(base, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    return { worktreePath: base, branch, copied: [], bootstrapped: false };
  }
  const branch = `commander/${shortId(threadId)}`;
  runGit(projectPath, ['worktree', 'add', '-b', branch, base]);
  // Copy ignored env files
  const copied: string[] = [];
  for (const f of ENV_FILES) {
    const src = path.join(projectPath, f);
    const dst = path.join(base, f);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copied.push(f);
    }
  }
  // .freebuffignore force-includes
  const ignoreFile = path.join(projectPath, FORCE_INCLUDE);
  if (fs.existsSync(ignoreFile)) {
    const lines = fs.readFileSync(ignoreFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const rel of lines) {
      const src = path.join(projectPath, rel);
      const dst = path.join(base, rel);
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          fs.cpSync(src, dst, { recursive: true });
        } else {
          fs.copyFileSync(src, dst);
        }
        copied.push(rel);
      }
    }
  }
  // Bootstrap deps
  let bootstrapped = false;
  const lockfiles: [string, string, string[]][] = [
    ['pnpm-lock.yaml', 'pnpm', ['install', '--frozen-lockfile']],
    ['yarn.lock', 'yarn', ['install', '--frozen-lockfile']],
    ['package-lock.json', 'npm', ['ci']],
    ['bun.lockb', 'bun', ['install']],
  ];
  for (const [lock, bin, args] of lockfiles) {
    if (fs.existsSync(path.join(base, lock))) {
      try { execFileSync(bin, args, { cwd: base, stdio: 'ignore' }); bootstrapped = true; } catch { /* best effort */ }
      break;
    }
  }
  if (!bootstrapped && fs.existsSync(path.join(base, 'package.json'))) {
    try { execFileSync('npm', ['install'], { cwd: base, stdio: 'ignore' }); bootstrapped = true; } catch { /* best effort */ }
  }
  return { worktreePath: base, branch, copied, bootstrapped };
}

export interface WorktreeCleanupResult {
  /** `true` sólo si el registro del worktree ya no aparece en `git worktree list`. */
  ok: boolean;
  /** Motivo por el que no se pudo dejar limpio el registro; sólo con `ok:false`. */
  error?: string;
  /** Motivo del primer `remove`, aunque la poda posterior lo haya resuelto. */
  cause?: string;
  /** `true` si hubo que borrar el directorio y podar el registro a mano. */
  recovered?: boolean;
}

/** Ejecutor de git inyectable: las pruebas simulan un fallo parcial del `remove`. */
export type GitRunner = (cwd: string, args: string[]) => string;

/**
 * Ruta en su forma real, para comparar lo que git imprime con lo que pidió el
 * llamador.
 *
 * `path.resolve` no alcanza: en el runner de CI `os.tmpdir()` puede llegar en
 * forma corta (`RUNNER~1`) y `git worktree list` imprime la larga, así que dos
 * rutas del mismo directorio no coincidían y una limpieza buena se veía como
 * fallida. Se resuelve con `realpath` (que expande el nombre corto y los enlaces)
 * y, si el worktree ya no existe —el caso normal después de un `remove` a
 * medias—, se resuelve el **padre**, que sí existe, y se conserva el nombre.
 */
function canonicalPath(target: string): string {
  const abs = path.resolve(target);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    // Ya no existe: el padre sigue ahí y es el que lleva el nombre corto.
  }
  try {
    return path.join(fs.realpathSync.native(path.dirname(abs)), path.basename(abs));
  } catch {
    return abs;
  }
}

/** Compara dos rutas por su forma real; Windows y macOS no distinguen mayúsculas. */
function sameWorktreePath(a: string, b: string): boolean {
  const norm = (p: string) => canonicalPath(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' || process.platform === 'darwin'
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b);
}

function firstGitError(error: unknown): string {
  const raw = String((error as any)?.stderr || (error as any)?.message || error);
  return raw.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || 'error desconocido';
}

function isWorktreeRegistered(projectPath: string, worktreePath: string): boolean {
  return listWorktrees(projectPath).some((w) => sameWorktreePath(w.path, worktreePath));
}

/**
 * Retira un worktree y **verifica el registro**, no sólo el comando.
 *
 * `git worktree remove` puede fallar a medias (o el directorio puede haber
 * desaparecido por fuera) y dejar una entrada `prunable` en
 * `.git/worktrees`: el directorio no está, pero `git worktree list` la cuenta
 * y el check 6 de T10 la ve como fuga. Si tras el `remove` la ruta sigue
 * registrada, se borra lo que quede del directorio y se poda antes de darse
 * por vencido. No lanza: devuelve el motivo para que el llamador lo anote.
 */
export function removeWorktreeSafe(
  worktreePath: string,
  projectPath: string,
  force = false,
  branch?: string,
  run: GitRunner = runGit
): WorktreeCleanupResult {
  const args = ['worktree', 'remove', worktreePath];
  if (force) args.push('--force');
  let cause: string | undefined;
  let recovered = false;
  try {
    run(projectPath, args);
  } catch (e) {
    cause = firstGitError(e);
  }

  let registered = true;
  try {
    registered = isWorktreeRegistered(projectPath, worktreePath);
  } catch (e) {
    // Sin poder leer el registro no se puede afirmar que quedó limpio.
    cause = cause ?? firstGitError(e);
  }

  if (registered) {
    recovered = true;
    try { fs.rmSync(worktreePath, { recursive: true, force: true }); } catch (e) { cause = cause ?? firstGitError(e); }
    try {
      run(projectPath, ['worktree', 'prune']);
    } catch (e) {
      cause = cause ?? firstGitError(e);
    }
    try {
      registered = isWorktreeRegistered(projectPath, worktreePath);
    } catch {
      registered = true;
    }
  }

  if (registered) {
    return {
      ok: false,
      recovered,
      error: cause ?? `el worktree sigue registrado: ${worktreePath}`,
      ...(cause ? { cause } : {}),
    };
  }
  if (branch) {
    try { run(projectPath, ['branch', '-D', branch]); } catch { /* la rama ya no existe */ }
  }
  // El directorio padre queda vacío tras retirar el worktree; si otro proceso
  // lo usa, `rmdir` falla y no tocamos nada.
  try { fs.rmdirSync(path.dirname(worktreePath)); } catch { /* no vacío */ }
  // `error` sigue reservado para `ok:false`; con `ok:true` el fallo resuelto
  // viaja en `cause`, para que quede registrado qué pasó aunque se recupere.
  return { ok: true, recovered, ...(cause ? { cause } : {}) };
}

/** API clásica: mismo trabajo, pero lanza si el registro no quedó limpio. */
export function removeWorktree(
  worktreePath: string,
  projectPath: string,
  force = false,
  branch?: string
): void {
  const result = removeWorktreeSafe(worktreePath, projectPath, force, branch);
  if (!result.ok) throw new Error(result.error || `No se pudo retirar el worktree: ${worktreePath}`);
}

export function listWorktrees(projectPath: string): { path: string; head: string; branch: string }[] {
  const out = runGit(projectPath, ['worktree', 'list', '--porcelain']);
  const blocks = out.split(/\r?\n\r?\n/).filter(Boolean);
  return blocks.map((b) => {
    const lines = b.split(/\r?\n/);
    const get = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length) || '';
    return { path: get('worktree '), head: get('HEAD '), branch: get('branch ').replace('refs/heads/', '') };
  });
}
