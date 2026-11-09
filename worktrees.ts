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

export function removeWorktree(
  worktreePath: string,
  projectPath: string,
  force = false,
  branch?: string
): void {
  const args = ['worktree', 'remove', worktreePath];
  if (force) args.push('--force');
  runGit(projectPath, args);
  if (branch) {
    try { runGit(projectPath, ['branch', '-D', branch]); } catch { /* la rama ya no existe */ }
  }
  // El directorio padre queda vacío tras retirar el worktree; si otro proceso
  // lo usa, `rmdir` falla y no tocamos nada.
  try { fs.rmdirSync(path.dirname(worktreePath)); } catch { /* no vacío */ }
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
