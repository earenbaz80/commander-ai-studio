/**
 * Índice persistente del repo (P0 #4).
 *
 * Construye un índice de archivos del proyecto (ruta + tamaño + mtime + hash de
 * contenido) y lo persiste en `.commander/index.json`. En arranques posteriores
 * se reconcilia de forma incremental: los archivos sin cambios (mismo tamaño y
 * mtime) conservan su hash guardado y NO se vuelven a leer; sólo se leen los
 * nuevos o modificados. Así el índice sobrevive a reinicios y las búsquedas
 * (searchFiles/searchCode) dejan de recorrer el filesystem en cada query.
 *
 * El índice se mantiene en memoria por root y se invalida cuando el agente
 * escribe/edita archivos (ver `invalidateIndex`).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SKIP_DIRS } from './codeSearch';

const INDEX_DIR = '.commander';
const INDEX_FILE = 'index.json';
const INDEX_VERSION = 1;
const MAX_INDEX_FILES = 6000;

export interface IndexFileEntry {
  /** Ruta relativa al root, con barras hacia delante. */
  path: string;
  size: number;
  mtimeMs: number;
  /** Hash corto del contenido (para detectar cambios sin releer). */
  hash: string;
}

export interface RepoIndex {
  version: number;
  root: string;
  builtAt: number;
  files: IndexFileEntry[];
}

// Caché en memoria por root canónico.
const cache = new Map<string, RepoIndex>();
const dirty = new Set<string>();

function indexPath(root: string): string {
  return path.join(root, INDEX_DIR, INDEX_FILE);
}

function hashContent(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
}

function isSkippable(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRS.has(name);
}

/** Lee el índice de disco. Devuelve null si no existe, está corrupto o es de otro root. */
function readIndex(root: string): RepoIndex | null {
  try {
    const raw = fs.readFileSync(indexPath(root), 'utf8');
    const parsed = JSON.parse(raw) as RepoIndex;
    if (parsed?.version !== INDEX_VERSION || !Array.isArray(parsed.files)) return null;
    if (parsed.root && parsed.root.replace(/\\/g, '/').toLowerCase() !== root.replace(/\\/g, '/').toLowerCase()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Escribe el índice de forma atómica (tmp + rename). Nunca debe romper una búsqueda. */
function saveIndex(root: string, idx: RepoIndex): void {
  try {
    const dir = path.join(root, INDEX_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const target = indexPath(root);
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(idx), 'utf8');
    fs.renameSync(tmp, target);
  } catch {
    /* sin permisos de escritura: el índice vive en memoria y sigue funcionando */
  }
}

/**
 * Reconcilia el índice con el estado actual del directorio.
 * Los archivos sin cambios (size + mtime) conservan su hash; el resto se lee.
 */
function reconcile(root: string, existing: RepoIndex | null): IndexFileEntry[] {
  const prev = new Map<string, IndexFileEntry>();
  if (existing) for (const f of existing.files) prev.set(f.path, f);

  const out: IndexFileEntry[] = [];
  let seen = 0;
  const stack: Array<{ dir: string; rel: string }> = [{ dir: root, rel: '' }];
  while (stack.length) {
    const { dir, rel } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (seen >= MAX_INDEX_FILES) break;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (isSkippable(e.name)) continue;
        stack.push({ dir: path.join(dir, e.name), rel: childRel });
      } else if (e.isFile()) {
        seen++;
        const abs = path.join(dir, e.name);
        let size = 0;
        let mtimeMs = 0;
        try {
          const st = fs.statSync(abs);
          size = st.size;
          mtimeMs = st.mtimeMs;
        } catch {
          continue;
        }
        const old = prev.get(childRel);
        if (old && old.size === size && old.mtimeMs === mtimeMs) {
          out.push(old); // sin cambios: conserva el hash guardado
        } else {
          let hash = '';
          try {
            const text = fs.readFileSync(abs, 'utf8');
            hash = hashContent(text);
          } catch {
            continue; // binario o sin acceso
          }
          out.push({ path: childRel, size, mtimeMs, hash });
        }
      }
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function loadOrBuild(root: string, refresh: boolean): RepoIndex {
  const existing = refresh ? null : readIndex(root);
  const files = reconcile(root, existing);
  const idx: RepoIndex = { version: INDEX_VERSION, root, builtAt: Date.now(), files };
  saveIndex(root, idx);
  return idx;
}

/**
 * Devuelve el índice del root (cargado de disco o reconstruido).
 * `refresh: true` fuerza una reconstrucción completa.
 */
export function getIndex(root: string, opts?: { refresh?: boolean }): RepoIndex {
  let canonical = root;
  try {
    canonical = fs.realpathSync.native(root);
  } catch {
    /* root aún no existe: usamos la ruta tal cual */
  }
  if (!opts?.refresh && cache.has(canonical) && !dirty.has(canonical)) {
    return cache.get(canonical)!;
  }
  const idx = loadOrBuild(canonical, !!opts?.refresh);
  cache.set(canonical, idx);
  dirty.delete(canonical);
  return idx;
}

/** Lista de archivos indexados (para searchFiles/searchCode). */
export function listIndexedFiles(root: string, opts?: { refresh?: boolean }): IndexFileEntry[] {
  return getIndex(root, opts).files;
}

/** Marca el índice de un root como obsoleto (la próxima query lo reconstruye). */
export function invalidateIndex(root: string): void {
  try {
    const canonical = fs.realpathSync.native(root);
    dirty.add(canonical);
    cache.delete(canonical);
  } catch {
    /* si no existe, nada que invalidar */
  }
}

/** Invalida todos los índices (útil al cambiar de proyecto). */
export function invalidateAll(): void {
  dirty.clear();
  cache.clear();
}
