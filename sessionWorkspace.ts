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