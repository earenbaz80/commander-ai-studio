import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REMOTE_CACHE_TTL_MS = 60_000;
const MISS_CACHE_TTL_MS = 15_000;
const cache = new Map<string, { remote: string | null; at: number }>();

/**
 * Convierte las formas habituales del mismo remoto en una clave estable:
 * `git@github.com:Owner/Repo.git`, `https://github.com/owner/repo.git` y
 * `ssh://git@github.com:22/owner/repo` producen `github.com/owner/repo`.
 */
export function normalizeGitRemote(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  // Un remoto local no identifica el proyecto en otro equipo.
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('.')) return null;

  let host = '';
  let repo = '';
  if (!value.includes('://')) {
    const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(value);
    if (!scp) return null;
    host = scp[1];
    repo = scp[2];
  } else {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'file:') return null;
      host = parsed.hostname;
      repo = parsed.pathname;
    } catch {
      return null;
    }
  }

  repo = repo
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  if (!host || !repo) return null;
  // El host y la ruta se normalizan a minúsculas para que SSH y HTTPS del
  // mismo repositorio compartan clave entre equipos.
  return `${host.toLowerCase()}/${repo.toLowerCase()}`;
}

/** Lee `origin` del proyecto; cachea para no lanzar git en cada refresco. */
export function readProjectGitRemote(projectPath: string): string | null {
  const clean = String(projectPath || '').trim();
  if (!clean) return null;
  const key = path.resolve(clean);
  if (!fs.existsSync(key)) return null;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.remote ? REMOTE_CACHE_TTL_MS : MISS_CACHE_TTL_MS)) {
    return hit.remote;
  }

  let remote: string | null = null;
  try {
    const raw = execFileSync('git', ['-C', key, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      timeout: 1500,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    remote = normalizeGitRemote(raw);
  } catch {
    remote = null;
  }
  cache.set(key, { remote, at: Date.now() });
  return remote;
}
