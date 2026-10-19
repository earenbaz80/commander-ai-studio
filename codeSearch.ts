/**
 * Búsqueda de código en el proyecto.
 *
 * Sin dependencias externas ni embeddings: un buscador offline con ranking
 * ligero (nombre de archivo + densidad de coincidencias). Sirve para dos
 * cosas:
 *   • `searchFiles` → el picker de menciones `@` (búsqueda difusa de rutas).
 *   • `searchCode`  → búsqueda de contenido (líneas que coinciden).
 *
 * Todo se acota (tamaño de archivo, nº de archivos recorridos, nº de hits)
 * para poder ejecutarse bajo demanda sin bloquear.
 *
 * P0 #4 — Indexación persistente: las funciones aceptan una lista de archivos
 * ya indexada (`IndexedFile[]`) para NO recorrer el filesystem en cada query.
 * El índice vive en `repoIndex.ts` (`.commander/index.json`) y se actualiza
 * incrementalmente; aquí sólo se consume. Además, un LRU en memoria evita
 * releer archivos sin cambios entre búsquedas repetidas.
 */

import fs from 'fs';
import path from 'path';

export const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'release', 'out', 'coverage',
  '.git', '.next', '.nuxt', '.cache', '.vite', '.turbo', '.parcel-cache',
  '.commander',
]);

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB por archivo
const MAX_SCAN_FILES = 4000;
const MAX_LINE_LEN = 240;
const MAX_MATCHES_PER_FILE = 8;
const CONTENT_CACHE_MAX = 256;

/** Lockfiles y manifiestos generados: ruido, nunca código a buscar. */
const LOW_VALUE_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'composer.lock',
  'poetry.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'go.sum',
  'Pipfile.lock',
  'packages.lock.json',
  'npm-shrinkwrap.json',
  'deno.lock',
]);

export interface FileHit {
  path: string;
  score: number;
}

export interface CodeMatch {
  line: number;
  text: string;
}

export interface CodeHit {
  path: string;
  score: number;
  matches: CodeMatch[];
}

/** Entrada de archivo ya indexada (la consume searchFiles/searchCode). */
export interface IndexedFile {
  path: string;
  size: number;
  mtimeMs: number;
}

function isProbablyBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function readText(abs: string): string | null {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    const buf = fs.readFileSync(abs);
    if (isProbablyBinary(buf)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

// ── LRU de contenidos: evita releer archivos sin cambios entre queries ──
const contentCache = new Map<string, { size: number; mtimeMs: number; text: string | null }>();

function readTextCached(abs: string, size: number, mtimeMs: number): string | null {
  const hit = contentCache.get(abs);
  if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit.text;
  const text = readText(abs);
  if (contentCache.size >= CONTENT_CACHE_MAX) {
    const first = contentCache.keys().next().value;
    if (first !== undefined) contentCache.delete(first);
  }
  contentCache.set(abs, { size, mtimeMs, text });
  return text;
}

/** Recorre el proyecto y llama a `onFile(rel, abs)` por cada archivo. */
function walk(root: string, onFile: (rel: string, abs: string) => void): void {
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
      if (seen >= MAX_SCAN_FILES) return;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        stack.push({ dir: path.join(dir, e.name), rel: childRel });
      } else if (e.isFile()) {
        seen++;
        onFile(childRel, path.join(dir, e.name));
      }
    }
  }
}

function isSubsequence(q: string, s: string): boolean {
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) i++;
  }
  return i === q.length;
}

/** Puntúa una ruta contra la consulta (mayor = mejor). */
function pathScore(rel: string, query: string): number {
  const r = rel.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 1;
  const base = r.split('/').pop() || '';
  let score = 0;
  if (LOW_VALUE_FILES.has(base)) score -= 60;
  if (base === q) score += 120;
  else if (base.startsWith(q)) score += 70;
  else if (base.includes(q)) score += 45;
  if (r.includes('/' + q)) score += 30;
  else if (r.includes(q)) score += 20;
  if (!score && isSubsequence(q, r)) score += 12;
  // Penaliza profundidad y longitud: los archivos cercanos a la raíz puntúan más.
  score -= (r.split('/').length - 1) * 0.75;
  score -= Math.min(r.length, 120) * 0.01;
  return score;
}

/** Lista todas las rutas indexables (para el estado inicial del picker). */
export function listFiles(root: string, limit = 200, files?: IndexedFile[]): FileHit[] {
  if (files) return files.slice(0, limit).map((f) => ({ path: f.path, score: 0 }));
  const out: FileHit[] = [];
  walk(root, (rel) => {
    if (out.length < limit * 4) out.push({ path: rel, score: 0 });
  });
  return out.slice(0, limit);
}

/** Búsqueda difusa de archivos por ruta. */
export function searchFiles(root: string, query: string, limit = 50, files?: IndexedFile[]): FileHit[] {
  const q = (query || '').trim().replace(/^@/, '');
  if (!q) return listFiles(root, limit, files);
  const out: FileHit[] = [];
  const visit = (rel: string) => {
    const score = pathScore(rel, q);
    if (score > 0) out.push({ path: rel, score });
  };
  if (files) files.forEach((f) => visit(f.path));
  else walk(root, (rel) => visit(rel));
  out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return out.slice(0, limit);
}

/** Búsqueda de contenido: líneas que coinciden, agrupadas por archivo. */
export function searchCode(root: string, query: string, limit = 40, files?: IndexedFile[]): CodeHit[] {
  const q = (query || '').trim();
  if (!q) return [];
  const ql = q.toLowerCase();
  const tokens = ql.split(/\s+/).filter((t) => t.length >= 2);

  const hits: CodeHit[] = [];
  const visit = (rel: string, abs: string, size: number, mtimeMs: number): void => {
    const content = readTextCached(abs, size, mtimeMs);
    if (content == null) return;
    const lines = content.split('\n');

    const matches: CodeMatch[] = [];
    let literalCount = 0;
    const tokenSeen = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();
      if (lower.includes(ql)) {
        literalCount++;
        if (matches.length < MAX_MATCHES_PER_FILE) {
          matches.push({ line: i + 1, text: line.trim().slice(0, MAX_LINE_LEN) });
        }
      }
      if (tokens.length > 1) {
        for (const t of tokens) if (!tokenSeen.has(t) && lower.includes(t)) tokenSeen.add(t);
      }
    }

    // Sin coincidencia literal: acepta archivos que contengan TODOS los tokens.
    if (matches.length === 0 && tokens.length > 1 && tokenSeen.size === tokens.length) {
      for (let i = 0; i < lines.length && matches.length < MAX_MATCHES_PER_FILE; i++) {
        const lower = lines[i].toLowerCase();
        if (tokens.some((t) => lower.includes(t))) {
          matches.push({ line: i + 1, text: lines[i].trim().slice(0, MAX_LINE_LEN) });
        }
      }
    }

    if (matches.length === 0) return;
    const density = literalCount > matches.length ? Math.log2(literalCount + 1) : 0;
    hits.push({
      path: rel,
      score: matches.length * 3 + density + Math.max(0, pathScore(rel, q)),
      matches,
    });
  };

  if (files) {
    for (const f of files) visit(f.path, path.join(root, f.path), f.size, f.mtimeMs);
  } else {
    walk(root, (rel, abs) => {
      let size = 0;
      let mtimeMs = 0;
      try {
        const st = fs.statSync(abs);
        size = st.size;
        mtimeMs = st.mtimeMs;
      } catch { /* sin acceso */ }
      visit(rel, abs, size, mtimeMs);
    });
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}

// ==================== RE-RANKING SEMÁNTICO (capa opcional) ====================
// La búsqueda sigue siendo puramente léxica por defecto. Cuando se dispone de
// un proveedor de embeddings (p. ej. Gemini text-embedding con clave), se
// re-ordenan los resultados con similitud coseno fusionada al ranking léxico.
// Ante cualquier error (red, clave, formato) se devuelve el ranking original.

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den === 0 ? 0 : dot / den;
}

export interface SemanticRankResult {
  hits: CodeHit[];
  /** true si se re-ordenó con embeddings; false si se usó el ranking léxico. */
  ranked: boolean;
}

/**
 * Re-ordena los resultados léxicos con similitud semántica (híbrido).
 * `embedText` lo inyecta el caller (proveedor de embeddings). La fusión:
 * scoreFinal = scoreLéxico + weight * similitudCoseno. Fallback a léxico.
 */
export async function rerankByEmbeddings(
  query: string,
  hits: CodeHit[],
  embedText: (text: string) => Promise<number[]>,
  topK = 30,
  weight = 40
): Promise<SemanticRankResult> {
  if (!hits.length) return { hits, ranked: false };
  const pool = hits.slice(0, Math.max(topK, hits.length));
  try {
    const q = (query || '').trim().slice(0, 1000);
    if (!q) return { hits, ranked: false };
    const qv = await embedText(q);
    if (!qv || qv.length === 0) return { hits, ranked: false };

    const withVec = await Promise.all(
      pool.map(async (h) => {
        const text = `${h.matches.map((m) => m.text).join(' ')} ${h.path}`.slice(0, 1800);
        let vec: number[] | null = null;
        try {
          vec = await embedText(text);
        } catch {
          vec = null;
        }
        return { h, v: vec };
      })
    );

    const scored = withVec.map(({ h, v }) => ({
      h,
      s: h.score + weight * (v && v.length ? cosine(qv, v) : 1),
    }));
    scored.sort((a, b) => b.s - a.s || a.h.path.localeCompare(b.h.path));
    return { hits: scored.map((x) => x.h), ranked: true };
  } catch {
    return { hits, ranked: false };
  }
}
