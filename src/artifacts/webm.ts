/**
 * Exportación WebM de una grabación (F2-09).
 *
 * Los frames ya están en el artifact como JPEG; aquí se reproducen sobre un
 * `<canvas>` a su ritmo real y se codifican con `MediaRecorder` en el mismo
 * navegador. No hay MP4 falso ni recodificación en el servidor: si el entorno
 * no tiene encoder WebM se dice y se conservan frames + log.
 *
 * `speed` acelera la exportación (por ejemplo 10× en una prueba); a 1× la
 * duración del vídeo coincide con la de la grabación.
 */
import type { BrowserRecordingArtifact } from './types';
import {
  buildWebMTimeline,
  fitCanvasSize,
  pickWebMMimeType,
  webmFileName,
  type WebMTimelineOptions,
} from './webmTimeline';

/** Milisegundos extra para que el último frame no se corte al parar. */
const WEBM_HOLD_MS = 250;

export interface WebMExportSupport {
  supported: boolean;
  mimeType: string | null;
  reason: string;
}

/** ¿Puede este navegador exportar WebM? Si no, por qué. */
export function webmSupport(): WebMExportSupport {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      supported: false,
      mimeType: null,
      reason: 'La exportación WebM sólo existe en el navegador; se conservan frames y log.',
    };
  }
  if (typeof MediaRecorder === 'undefined') {
    return {
      supported: false,
      mimeType: null,
      reason: 'Este entorno no tiene encoder MediaRecorder; se conservan frames y log.',
    };
  }
  const canvas = document.createElement('canvas');
  if (typeof canvas.captureStream !== 'function') {
    return {
      supported: false,
      mimeType: null,
      reason: 'El lienzo no puede capturar un stream; se conservan frames y log.',
    };
  }
  const mimeType = pickWebMMimeType((mime) => MediaRecorder.isTypeSupported(mime));
  if (!mimeType) {
    return {
      supported: false,
      mimeType: null,
      reason: 'No hay códec WebM disponible; se conservan frames y log.',
    };
  }
  return { supported: true, mimeType, reason: '' };
}

export interface WebMExportOptions extends WebMTimelineOptions {
  onProgress?: (fraction: number, atMs: number) => void;
  signal?: AbortSignal;
}

export interface WebMExportResult {
  blob: Blob;
  filename: string;
  durationMs: number;
  /** Tamaño real del lienzo codificado (con la relación de aspecto original). */
  width: number;
  height: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Exportación cancelada'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Exportación cancelada'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo decodificar un frame de la grabación'));
    image.src = source;
  });
}

/**
 * Reproduce los frames en tiempo real y los codifica en WebM.
 *
 * Lanza si no hay encoder; en ese caso la vista debe ofrecer frames + log en
 * vez de un vídeo inventado.
 */
export async function exportRecordingWebM(
  recording: BrowserRecordingArtifact,
  options: WebMExportOptions = {}
): Promise<WebMExportResult> {
  const support = webmSupport();
  if (!support.supported || !support.mimeType) {
    throw new Error(support.reason || 'El navegador no puede codificar WebM');
  }

  const timeline = buildWebMTimeline(recording, options);
  if (timeline.entries.length === 0) {
    throw new Error('La grabación no tiene frames que exportar');
  }

  // Caja máxima con relación de aspecto: un 1280×800 se codifica 1152×720 en
  // vez de aplastarse a 1280×720.
  const { width, height } = fitCanvasSize(recording.viewport);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo crear el lienzo para exportar');

  const images = await Promise.all(timeline.sourceFrames.map(loadImage));
  const stream = canvas.captureStream(timeline.fps) as MediaStream;
  const recorder = new MediaRecorder(stream, {
    mimeType: support.mimeType,
    videoBitsPerSecond: 2_000_000,
  });
  const chunks: BlobPart[] = [];
  const finished = new Promise<void>((resolve, reject) => {
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      resolve();
    };
    recorder.onerror = () => reject(new Error('La codificación WebM falló'));
  });

  const draw = (frameIndex: number) => {
    const image = images[frameIndex];
    if (!image) return;
    context.fillStyle = 'black';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
  };

  try {
    recorder.start(250);
    draw(timeline.entries[0].frameIndex);
    const startedAt = performance.now();
    let drawn = timeline.entries[0].frameIndex;
    for (const entry of timeline.entries) {
      await sleep(startedAt + entry.atMs / timeline.speed - performance.now(), options.signal);
      if (entry.frameIndex !== drawn) {
        draw(entry.frameIndex);
        drawn = entry.frameIndex;
      }
      options.onProgress?.(
        timeline.durationMs > 0 ? Math.min(1, entry.atMs / timeline.durationMs) : 1,
        entry.atMs
      );
    }
    await sleep(
      startedAt + (timeline.durationMs + WEBM_HOLD_MS) / timeline.speed - performance.now(),
      options.signal
    );
    options.onProgress?.(1, timeline.durationMs);
    recorder.stop();
    await finished;
  } catch (error) {
    if (recorder.state !== 'inactive') recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }

  const mimeType = support.mimeType.split(';')[0] || 'video/webm';
  const blob = new Blob(chunks, { type: mimeType });
  if (!blob.size) throw new Error('El codificador no devolvió datos');

  return {
    blob,
    filename: webmFileName(recording),
    durationMs: timeline.durationMs,
    width,
    height,
  };
}
