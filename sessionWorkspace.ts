import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { addRoot, removeRoot, isInsideRoots } from './projects.ts';

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
import { execFileSync } from 'child_process';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

function isGitRepo(dir: string): boolean {
  try {
    execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function gitWorktreeAdd(src: string, dest: string, branch: string): boolean {
  try {
    execFileSync('git', ['-C', src, 'worktree', 'add', '-b', branch, dest], { stdio: 'ignore' });
    return true;
  } catch {
    try {
      execFileSync('git', ['-C', src, 'worktree', 'add', '--detach', dest], { stdio: 'ignore' });
      return true;
    } catch { return false; }
  }
}

function gitWorktreeRemove(src: string, dest: string): void {
  try { execFileSync('git', ['-C', src, 'worktree', 'remove', '--force', dest], { stdio: 'ignore' }); } catch {}
  try { execFileSync('git', ['-C', src, 'worktree', 'prune'], { stdio: 'ignore' }); } catch {}
}

const SESSIONS_DIR = process.env.SESSION_WORKSPACES_DIR
  ? path.resolve(process.env.SESSION_WORKSPACES_DIR)
  : path.join(os.tmpdir(), 'commander-ai-sessions');

const INDEX_FILE = path.join(SESSIONS_DIR, 'index.json');

interface SessionEntry { id: string; path: string; source: string; createdAt: number; }

function readIndex(): SessionEntry[] {
  try { const raw = fs.readFileSync(INDEX_FILE, 'utf8'); const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
}
function writeIndex(entries: SessionEntry[]) {
  try { fs.mkdirSync(SESSIONS_DIR, { recursive: true }); fs.writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2), 'utf8'); } catch { /* best effort */ }
}

function genId(): string { return `sess-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`; }

export function listSessions(): SessionEntry[] { return readIndex(); }

export function forkSessionWorkspace(sourcePath: string): { id: string; path: string } {
  if (!sourcePath || typeof sourcePath !== 'string') throw new Error('projectPath requerido');
  const src = path.resolve(sourcePath.trim());
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new Error('No existe o no es un directorio');
  if (!isInsideRoots(src)) throw new Error('Path fuera de los proyectos permitidos');

  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const id = genId();
  const dest = path.join(SESSIONS_DIR, id);
  const branch = `session-${id}`;

  let usedWorktree = false;
  if (isGitRepo(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    usedWorktree = gitWorktreeAdd(src, dest, branch);
  }
  if (!usedWorktree) {
    fs.mkdirSync(dest, { recursive: true });
    let fileCount = 0;
    let totalBytes = 0;
    function copyDir(from: string, to: string) {
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
        const srcPath = path.join(from, entry.name);
        const dstPath = path.join(to, entry.name);
        if (entry.isDirectory()) {
          fs.mkdirSync(dstPath, { recursive: true });
          copyDir(srcPath, dstPath);
        } else if (entry.isFile()) {
          const st = fs.statSync(srcPath);
          if (st.size > MAX_FILE_BYTES) continue;
          if (fileCount >= MAX_FILES) throw new Error('Demasiados archivos para clonar');
          if (totalBytes + st.size > MAX_TOTAL_BYTES) throw new Error('Proyecto demasiado grande para clonar');
          fs.copyFileSync(srcPath, dstPath);
          fileCount++;
          totalBytes += st.size;
        }
      }
    }
    try {
      copyDir(src, dest);
    } catch (e) {
      try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
      throw e;
    }
  }

  // Register as a project root so agent tools can operate on it.
  try { addRoot(dest); } catch { /* best effort; still return */ }

  const entry: SessionEntry = { id, path: dest, source: src, createdAt: Date.now() };
  const idx = readIndex();
  idx.push(entry);
  writeIndex(idx.slice(-50)); // keep last 50
  return { id, path: dest };
}

export function createGitWorktree(projectPath: string, threadId: string): { path: string; branch: string } {
  const src = path.resolve(projectPath.trim());
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new Error('No existe o no es un directorio');
  if (!isGitRepo(src)) throw new Error('No es un repositorio git');

  const repoName = path.basename(src);
  const shortId = threadId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 12) || 'wt';
  const dest = path.join(os.homedir(), '.commander', 'worktrees', shortId, repoName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  // Branch name
  const branch = `commander/${shortId}`;
  const ok = gitWorktreeAdd(src, dest, branch);
  if (!ok) throw new Error('No se pudo crear el worktree');

  // Copy ignored env files (Freebuff pattern)
  const envFiles = ['.env', '.env.local', '.env.development', '.env.development.local', '.infisical.json', '.vercel/project.json'];
  for (const f of envFiles) {
    const srcFile = path.join(src, f);
    const destFile = path.join(dest, f);
    try {
      if (fs.existsSync(srcFile) && fs.statSync(srcFile).isFile()) {
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        fs.copyFileSync(srcFile, destFile);
      }
    } catch { /* best effort */ }
  }
  // .freebuffignore force-includes
  try {
    const ignoreFile = path.join(src, '.freebuffignore');
    if (fs.existsSync(ignoreFile)) {
      const lines = fs.readFileSync(ignoreFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (const rel of lines) {
        const s = path.join(src, rel);
        const d = path.join(dest, rel);
        try {
          if (fs.existsSync(s)) {
            fs.mkdirSync(path.dirname(d), { recursive: true });
            if (fs.statSync(s).isDirectory()) {
              // shallow copy of directory
              fs.cpSync(s, d, { recursive: true, force: true });
            } else {
              fs.copyFileSync(s, d);
            }
          }
        } catch { /* best effort */ }
      }
    }
  } catch { /* best effort */ }

  // Bootstrap deps based on lockfile
  try {
    const lockfiles: { file: string; cmd: string; args: string[] }[] = [
      { file: 'pnpm-lock.yaml', cmd: 'pnpm', args: ['install', '--frozen-lockfile'] },
      { file: 'yarn.lock', cmd: 'yarn', args: ['install', '--frozen-lockfile'] },
      { file: 'package-lock.json', cmd: 'npm', args: ['ci'] },
      { file: 'bun.lockb', cmd: 'bun', args: ['install', '--frozen-lockfile'] },
      { file: 'bun.lock', cmd: 'bun', args: ['install', '--frozen-lockfile'] },
    ];
    for (const lf of lockfiles) {
      if (fs.existsSync(path.join(dest, lf.file))) {
        try { execFileSync(lf.cmd, lf.args, { cwd: dest, stdio: 'ignore', timeout: 300000 }); } catch { /* best effort */ }
        break;
      }
    }
    // Fallback: if package.json exists but no lockfile, npm install
    if (!lockfiles.some((lf) => fs.existsSync(path.join(dest, lf.file))) && fs.existsSync(path.join(dest, 'package.json'))) {
      try { execFileSync('npm', ['install'], { cwd: dest, stdio: 'ignore', timeout: 300000 }); } catch { /* best effort */ }
    }
  } catch { /* best effort */ }

  // Register as a root so the agent can access it
  try { addRoot(dest); } catch { /* already registered */ }

  return { path: dest, branch };
}
export function deleteSessionWorkspace(id: string): { removed: boolean } {
  if (!id || typeof id !== 'string') throw new Error('id requerido');
  const idx = readIndex();
  const entry = idx.find((e) => e.id === id);
  if (!entry) throw new Error('Sesión no encontrada');
  // Si fue un worktree git, removerlo limpiamente.
  try { gitWorktreeRemove(entry.source, entry.path); } catch {}
  try { fs.rmSync(entry.path, { recursive: true, force: true }); } catch {}
  try { removeRoot(entry.path); } catch { /* may not be registered */ }
  writeIndex(idx.filter((e) => e.id !== id));
  return { removed: true };
}