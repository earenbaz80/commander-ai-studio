/**
 * Piezas puras de `preview` (arrancar y comprobar un dev server).
 *
 * Igual que `browserTarget`, aquí no hay red ni procesos: sólo decidir *qué*
 * URLs sondear. El driver (`previewServer.ts`) hace las peticiones.
 */

import { normalizeBrowserUrl, type UrlCheck } from './browserTarget';

/**
 * Puertos donde vive un dev server por defecto: Vite (5173/5174), Next/CRA
 * (3000), el propio servidor de Commander (3001), `vite preview` (4173) y los
 * genéricos de siempre.
 */
export const DEFAULT_PREVIEW_PORTS = [3000, 3001, 5173, 5174, 4173, 8080, 8000];

/**
 * Timeout de arranque por defecto. Corto a propósito: la petición HTTP que
 * espera se queda abierta todo este tiempo, así que si un dev server tarda más
 * es mejor devolver `ready: false` con el log y que el agente vuelva a mirar.
 */
export const DEFAULT_READY_TIMEOUT_MS = 30_000;
export const MAX_READY_TIMEOUT_MS = 180_000;
/** Un sondeo que no responde en esto no está listo (se reintenta en la vuelta siguiente). */
export const PROBE_TIMEOUT_MS = 1500;

/** URL local de un puerto. */
export function localUrl(port: number): string {
  return `http://localhost:${port}`;
}

/** Puerto válido (1-65535) o null. */
export function parsePort(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 65535) return null;
  return n;
}

/**
 * URLs a sondear, en orden de preferencia.
 * `url` manda si viene; si no, `port`; si tampoco, los puertos por defecto.
 */
export function previewCandidates(input: { url?: unknown; port?: unknown }): UrlCheck & { urls: string[] } {
  const rawUrl = String(input?.url ?? '').trim();
  if (rawUrl) {
    const check = normalizeBrowserUrl(rawUrl);
    if (!check.ok) return { ok: false, error: check.error, urls: [] };
    return { ok: true, url: check.url, urls: [check.url] };
  }
  if (input?.port !== undefined && input?.port !== null && input?.port !== '') {
    const port = parsePort(input.port);
    if (port === null) return { ok: false, error: `Puerto inválido: ${String(input.port).slice(0, 20)}`, urls: [] };
    const url = localUrl(port);
    return { ok: true, url, urls: [url] };
  }
  return { ok: true, url: '', urls: DEFAULT_PREVIEW_PORTS.map(localUrl) };
}

/** Timeout de espera acotado a [1s, 180s], con el valor por defecto si no se indica. */
export function readyTimeout(value: unknown): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_READY_TIMEOUT_MS;
  return Math.max(1000, Math.min(MAX_READY_TIMEOUT_MS, n));
}
