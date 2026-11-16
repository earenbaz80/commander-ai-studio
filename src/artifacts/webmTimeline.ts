/**
 * Parte pura de la exportación WebM (F2-09).
 *
 * Vive separada del codificador para que la línea de tiempo, la elección de
 * códec y el nombre del archivo se puedan probar sin DOM.
 */
import type { BrowserRecordingArtifact } from './types';

/** Códec preferido primero: VP8 es el más disponible en Chromium headless. */
export const WEBM_MIME_CANDIDATES = [
  'video/webm;codecs=vp8',
  'video/webm;codecs=vp9',
  'video/webm',
] as const;

export function pickWebMMimeType(isSupported: (mime: string) => boolean): string | null {
  for (const mime of WEBM_MIME_CANDIDATES) {
    try {
      if (isSupported(mime)) return mime;
    } catch {
      /* un navegador sin MediaRecorder se resuelve con el siguiente candidato */
    }
  }
  return null;
}

export interface WebMTimelineEntry {
  /** Momento del frame dentro de la grabación, en ms. */
  atMs: number;
  /** Índice dentro de `sourceFrames`. */
  frameIndex: number;
}

export interface WebMTimeline {
  entries: WebMTimelineEntry[];
  /** Sources únicos (data URL o base64) en el orden en que se usan. */
  sourceFrames: string[];
  durationMs: number;
  fps: number;
  speed: number;
}

export interface WebMTimelineOptions {
  fps?: number;
  speed?: number;
}

function frameSource(frame: BrowserRecordingArtifact['frames'][number]): string {
  const data = String(frame?.data ?? '');
  if (!data) return '';
  return data.startsWith('data:') ? data : `data:${frame.mimeType || 'image/jpeg'};base64,${data}`;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Línea de tiempo de la exportación: un cambio de frame por instante distinto.
 * Varios frames en el mismo milisegundo se colapsan (gana el último).
 */
export function buildWebMTimeline(
  recording: Pick<BrowserRecordingArtifact, 'frames' | 'durationMs'>,
  options: WebMTimelineOptions = {}
): WebMTimeline {
  const fps = Math.round(clampNumber(options.fps, 1, 30, 12));
  const speed = clampNumber(options.speed, 0.25, 8, 1);

  const byAt = new Map<number, string>();
  for (const frame of recording.frames ?? []) {
    const source = frameSource(frame);
    if (!source) continue;
    const atMs = Math.max(0, Math.round(Number.isFinite(frame.atMs) ? frame.atMs : 0));
    byAt.set(atMs, source);
  }

  const sourceFrames: string[] = [];
  const indexBySource = new Map<string, number>();
  const entries: WebMTimelineEntry[] = [];
  for (const atMs of [...byAt.keys()].sort((a, b) => a - b)) {
    const source = byAt.get(atMs) as string;
    let frameIndex = indexBySource.get(source);
    if (frameIndex === undefined) {
      frameIndex = sourceFrames.length;
      sourceFrames.push(source);
      indexBySource.set(source, frameIndex);
    }
    entries.push({ atMs, frameIndex });
  }

  const lastAtMs = entries[entries.length - 1]?.atMs ?? 0;
  const declared = Number.isFinite(recording.durationMs) ? Math.max(0, recording.durationMs) : 0;
  return {
    entries,
    sourceFrames,
    durationMs: Math.max(lastAtMs, declared),
    fps,
    speed,
  };
}

export function webmFileName(recording: Pick<BrowserRecordingArtifact, 'id' | 'title'>): string {
  const slug = String(recording.title ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const fallback = String(recording.id ?? 'grabacion')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .slice(0, 40);
  return `grabacion-${slug || fallback || 'local'}.webm`;
}
