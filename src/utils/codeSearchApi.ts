/**
 * Cliente de búsqueda de código (P0 #2).
 */
import { getActiveProjectRoot } from '../agent/activeProject';

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

function rootParam(root?: string): string {
  return root !== undefined ? root : getActiveProjectRoot() || '';
}

/** Búsqueda difusa de archivos por ruta (para el picker de menciones `@`). */
export async function searchFiles(
  query: string,
  root?: string,
  limit = 50
): Promise<{ files: FileHit[]; error?: string }> {
  try {
    const res = await fetch(
      `/api/search/files?q=${encodeURIComponent(query)}&limit=${limit}&root=${encodeURIComponent(rootParam(root))}`
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) return { files: [], error: json.error || `HTTP ${res.status}` };
    return { files: (json.files || []) as FileHit[] };
  } catch (e: any) {
    return { files: [], error: e?.message || 'Error de red' };
  }
}

/** Búsqueda de contenido en el proyecto. */
export async function searchCode(
  query: string,
  root?: string,
  limit = 40
): Promise<{ results: CodeHit[]; semantic?: boolean; error?: string }> {
  try {
    const res = await fetch(
      `/api/search/code?q=${encodeURIComponent(query)}&limit=${limit}&root=${encodeURIComponent(rootParam(root))}`
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) return { results: [], error: json.error || `HTTP ${res.status}` };
    return { results: (json.results || []) as CodeHit[], semantic: json.semantic === true };
  } catch (e: any) {
    return { results: [], error: e?.message || 'Error de red' };
  }
}
