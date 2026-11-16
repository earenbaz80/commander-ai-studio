/**
 * Consola y red de una grabación (F2-09).
 *
 * El servidor ya guarda los eventos de la sesión de Playwright; este módulo
 * los recorta a la ventana de la grabación, les da una línea de tiempo relativa
 * a los frames y les aplica topes para que el artifact no crezca sin control.
 *
 * No hace red ni lee el estado del servidor: recibe lo que ya se capturó.
 */
import { redactSecrets } from './testEvidence';
import type { RecordingConsoleEntry, RecordingLogs, RecordingNetworkEntry } from './types';

export const MAX_RECORDING_CONSOLE = 200;
export const MAX_RECORDING_NETWORK = 300;
const MAX_CONSOLE_TEXT = 2_000;
const MAX_URL = 512;

export interface RawConsoleEntry {
  seq?: number;
  ts: number;
  type?: string;
  text?: string;
  url?: string;
}

export interface RawNetworkEntry {
  seq?: number;
  ts: number;
  kind?: 'http' | 'failed';
  method?: string;
  url?: string;
  status?: number;
  error?: string;
  durationMs?: number;
  resourceType?: string;
}

export interface RecordingLogsInput {
  startedAt: number;
  endedAt: number;
  console?: readonly RawConsoleEntry[];
  network?: readonly RawNetworkEntry[];
}

function clean(value: unknown, max: number): string {
  return redactSecrets(String(value ?? ''))
    .replace(/\u0000/g, '')
    .slice(0, max);
}

function relativeMs(ts: number, startedAt: number, durationMs: number): number {
  const value = Math.round(ts - startedAt);
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, value), Math.max(0, durationMs));
}

function dedupe<T extends { seq?: number; ts: number }>(entries: readonly T[]): T[] {
  const byKey = new Map<string, T>();
  entries.forEach((entry, index) => {
    const key = Number.isFinite(entry?.seq) ? `seq:${entry.seq}` : `i:${index}:${entry?.ts}`;
    if (!byKey.has(key)) byKey.set(key, entry);
  });
  return [...byKey.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Construye el bloque de logs de una grabación.
 *
 * Se queda con las entradas más recientes cuando hay más que el tope y deja
 * constancia de cuántas descartó; una entrada sin `ts` válido se ignora.
 */
export function buildRecordingLogs(input: RecordingLogsInput): RecordingLogs {
  const startedAt = Number.isFinite(input.startedAt) ? input.startedAt : 0;
  const endedAt = Math.max(startedAt, Number.isFinite(input.endedAt) ? input.endedAt : startedAt);
  const durationMs = endedAt - startedAt;

  const consoleEntries = dedupe(input.console ?? [])
    .filter((entry) => Number.isFinite(entry.ts) && entry.ts >= startedAt && entry.ts <= endedAt)
    .map<RecordingConsoleEntry>((entry) => ({
      atMs: relativeMs(entry.ts, startedAt, durationMs),
      ts: entry.ts,
      type: clean(entry.type || 'log', 20),
      text: clean(entry.text, MAX_CONSOLE_TEXT),
      ...(entry.url ? { url: clean(entry.url, MAX_URL) } : {}),
    }));

  const networkEntries = dedupe(input.network ?? [])
    .filter((entry) => Number.isFinite(entry.ts) && entry.ts >= startedAt && entry.ts <= endedAt)
    .map<RecordingNetworkEntry>((entry) => {
      const entryDuration = Number(entry.durationMs);
      return {
        atMs: relativeMs(entry.ts, startedAt, durationMs),
        ts: entry.ts,
        kind: entry.kind === 'failed' ? 'failed' : 'http',
        method: clean(entry.method || 'GET', 12),
        url: clean(entry.url, MAX_URL),
        ...(Number.isFinite(entry.status) ? { status: Number(entry.status) } : {}),
        ...(entry.error ? { error: clean(entry.error, 500) } : {}),
        durationMs: Number.isFinite(entryDuration) ? Math.max(0, Math.round(entryDuration)) : 0,
        ...(entry.resourceType ? { resourceType: clean(entry.resourceType, 40) } : {}),
      };
    });

  const consoleKept = consoleEntries.slice(-MAX_RECORDING_CONSOLE);
  const networkKept = networkEntries.slice(-MAX_RECORDING_NETWORK);
  const omitted = {
    console: consoleEntries.length - consoleKept.length,
    network: networkEntries.length - networkKept.length,
  };

  return {
    console: consoleKept,
    network: networkKept,
    ...(omitted.console || omitted.network ? { omitted } : {}),
  };
}
