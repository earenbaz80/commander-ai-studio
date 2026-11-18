import { describe, expect, test } from 'vitest';
import {
  buildWebMTimeline,
  fitCanvasSize,
  pickWebMMimeType,
  webmFileName,
  WEBM_MAX_SIZE,
  WEBM_MIME_CANDIDATES,
} from '../../src/artifacts/webmTimeline';
import type { ArtifactFrame, BrowserRecordingArtifact } from '../../src/artifacts/types';

function frame(seq: number, atMs: number, data = `frame-${seq}`): ArtifactFrame {
  return {
    seq,
    ts: 1_000 + atMs,
    atMs,
    mimeType: 'image/jpeg',
    data,
    width: 1280,
    height: 800,
    url: 'http://localhost:3000/',
    title: 'app',
  };
}

function recording(frames: ArtifactFrame[], durationMs = 0): BrowserRecordingArtifact {
  return {
    id: 'rec-webm',
    kind: 'browser-recording',
    projectPath: 'C:/tmp/app',
    title: 'Checkout roto',
    createdAt: 1_000,
    durationMs,
    sessionId: 's1',
    viewport: { width: 1280, height: 800 },
    frames,
    comments: [],
  };
}

describe('pickWebMMimeType', () => {
  test('prefiere VP8 y cae a VP9 y al contenedor genérico', () => {
    expect(pickWebMMimeType(() => true)).toBe(WEBM_MIME_CANDIDATES[0]);
    expect(pickWebMMimeType((mime) => mime !== WEBM_MIME_CANDIDATES[0])).toBe(
      WEBM_MIME_CANDIDATES[1]
    );
    expect(pickWebMMimeType((mime) => mime === 'video/webm')).toBe('video/webm');
  });

  test('sin códec disponible devuelve null y no un MP4 falso', () => {
    expect(pickWebMMimeType(() => false)).toBeNull();
    expect(
      pickWebMMimeType(() => {
        throw new Error('sin encoder');
      })
    ).toBeNull();
  });
});

describe('fitCanvasSize', () => {
  test('un viewport 1280×800 entra en la caja 1280×720 sin aplastarse', () => {
    expect(fitCanvasSize({ width: 1280, height: 800 })).toEqual({ width: 1152, height: 720 });
    const sourceRatio = 1280 / 800;
    const fitted = fitCanvasSize({ width: 1280, height: 800 });
    expect(fitted.width / fitted.height).toBeCloseTo(sourceRatio, 3);
    expect(fitted.width).toBeLessThanOrEqual(WEBM_MAX_SIZE.width);
    expect(fitted.height).toBeLessThanOrEqual(WEBM_MAX_SIZE.height);
  });

  test('limita por el lado que sobra, no por los dos a la vez', () => {
    expect(fitCanvasSize({ width: 2560, height: 720 })).toEqual({ width: 1280, height: 360 });
    expect(fitCanvasSize({ width: 1280, height: 1600 })).toEqual({ width: 576, height: 720 });
  });

  test('no agranda una captura más pequeña que la caja', () => {
    expect(fitCanvasSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(fitCanvasSize({ width: 640, height: 480 })).toEqual({ width: 640, height: 480 });
    // Un móvil vertical también entra en la caja, escalado por alto.
    expect(fitCanvasSize({ width: 390, height: 844 })).toEqual({ width: 333, height: 720 });
  });

  test('un viewport inválido cae al tamaño por defecto sin deformar', () => {
    expect(fitCanvasSize({ width: 0, height: Number.NaN })).toEqual({ width: 1152, height: 720 });
    expect(fitCanvasSize(undefined)).toEqual({ width: 1152, height: 720 });
  });
});

describe('buildWebMTimeline', () => {
  test('una grabación de 30 s mantiene su duración y ordena los frames', () => {
    const timeline = buildWebMTimeline(
      recording([frame(3, 30_000), frame(1, 0), frame(2, 15_000)], 30_000)
    );

    expect(timeline.durationMs).toBe(30_000);
    expect(timeline.entries.map((entry) => entry.atMs)).toEqual([0, 15_000, 30_000]);
    expect(timeline.fps).toBe(12);
    expect(timeline.speed).toBe(1);
  });

  test('colapsa frames del mismo instante y reutiliza sources idénticos', () => {
    const timeline = buildWebMTimeline(
      recording([frame(1, 0, 'mismo'), frame(2, 0, 'mismo'), frame(3, 500, 'mismo')])
    );
    expect(timeline.entries).toEqual([
      { atMs: 0, frameIndex: 0 },
      { atMs: 500, frameIndex: 0 },
    ]);
    expect(timeline.sourceFrames).toEqual(['data:image/jpeg;base64,mismo']);
  });

  test('acota fps y velocidad', () => {
    const slow = buildWebMTimeline(recording([frame(1, 0)]), { fps: 0, speed: 0 });
    expect(slow.fps).toBe(1);
    expect(slow.speed).toBe(0.25);

    const fast = buildWebMTimeline(recording([frame(1, 0)]), { fps: 500, speed: 100 });
    expect(fast.fps).toBe(30);
    expect(fast.speed).toBe(8);
  });

  test('sin frames no hay entradas ni duración inventada', () => {
    const timeline = buildWebMTimeline(recording([], 0));
    expect(timeline.entries).toEqual([]);
    expect(timeline.durationMs).toBe(0);
  });
});

describe('webmFileName', () => {
  test('genera un nombre seguro y estable', () => {
    expect(webmFileName({ id: 'rec/1', title: 'Checkout roto: total' })).toBe(
      'grabacion-checkout-roto-total.webm'
    );
    expect(webmFileName({ id: 'rec/1', title: '   ' })).toBe('grabacion-rec-1.webm');
  });
});
