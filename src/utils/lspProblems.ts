/**
 * Store global de diagnósticos del language server.
 *
 * El LSP publica `textDocument/publishDiagnostics` por archivo. Aquí los
 * acumulamos en memoria (clave = path normalizado) para alimentar el panel
 * "Problemas" del Workbench con todos los archivos abiertos.
 *
 * Se suscribe una sola vez a `window.electronAPI.lsp.onDiagnostics` y notifica
 * a los componentes vía `useSyncExternalStore`.
 */
import { useSyncExternalStore } from 'react';
import type { LSPDiagnostic } from '../hooks/useLSPClient';

export interface LspProblem {
  path: string;
  uri: string;
  severity: number;
  message: string;
  source?: string;
  /** 0-based. */
  line: number;
  /** 0-based. */
  character: number;
}

export interface LspProblemsGroup {
  path: string;
  uri: string;
  problems: LspProblem[];
}

export interface LspProblemCounts {
  error: number;
  warning: number;
  info: number;
  total: number;
}

interface LspApi {
  onDiagnostics: (
    callback: (params: { uri: string; diagnostics: LSPDiagnostic[] }) => void
  ) => () => void;
}

function getLspApi(): LspApi | undefined {
  if (typeof window === 'undefined') return undefined;
  const api = (window as unknown as { electronAPI?: { lsp?: LspApi } }).electronAPI;
  return api?.lsp;
}

/** Normaliza un path/uri a una clave comparable (sin esquema, `/`, minúsculas). */
export function normalizeProblemPath(p: string): string {
  return decodeURIComponent(p)
    .replace(/\\/g, '/')
    .replace(/^file:\/\/\/?/i, '')
    .replace(/^\/+/, '')
    .toLowerCase();
}

const entries = new Map<string, { uri: string; diagnostics: LSPDiagnostic[] }>();
let groups: LspProblemsGroup[] = [];
let counts: LspProblemCounts = { error: 0, warning: 0, info: 0, total: 0 };
const listeners = new Set<() => void>();
let attached = false;

function recompute(): void {
  const next: LspProblemsGroup[] = [];
  let error = 0;
  let warning = 0;
  let info = 0;
  for (const [path, entry] of entries) {
    if (entry.diagnostics.length === 0) continue;
    const problems: LspProblem[] = entry.diagnostics.map((d) => {
      if (d.severity === 1) error++;
      else if (d.severity === 2) warning++;
      else info++;
      return {
        path,
        uri: entry.uri,
        severity: d.severity,
        message: d.message,
        source: d.source,
        line: d.range.start.line,
        character: d.range.start.character,
      };
    });
    problems.sort((a, b) => a.line - b.line || a.character - b.character);
    next.push({ path, uri: entry.uri, problems });
  }
  next.sort((a, b) => a.path.localeCompare(b.path));
  groups = next;
  counts = { error, warning, info, total: error + warning + info };
  listeners.forEach((l) => l());
}

/** Engancha el store a la API LSP de Electron (idempotente). */
export function ensureProblemsAttached(): void {
  if (attached) return;
  const api = getLspApi();
  if (!api) return;
  attached = true;
  api.onDiagnostics(({ uri, diagnostics }) => {
    const key = normalizeProblemPath(uri);
    if (!diagnostics || diagnostics.length === 0) entries.delete(key);
    else entries.set(key, { uri, diagnostics });
    recompute();
  });
}

function subscribe(listener: () => void): () => void {
  ensureProblemsAttached();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getGroups(): LspProblemsGroup[] {
  return groups;
}

function getCounts(): LspProblemCounts {
  return counts;
}

/** Hook: suscripción al listado completo de problemas. */
export function useLspProblems(): LspProblemsGroup[] {
  return useSyncExternalStore(subscribe, getGroups, getGroups);
}

/** Hook: contadores (error/warning/info/total) para el badge de la pestaña. */
export function useLspProblemCounts(): LspProblemCounts {
  return useSyncExternalStore(subscribe, getCounts, getCounts);
}

/** Sólo para tests: resetea el estado en memoria. */
export function __resetProblemsForTests(): void {
  entries.clear();
  groups = [];
  counts = { error: 0, warning: 0, info: 0, total: 0 };
  attached = false;
  listeners.clear();
}
