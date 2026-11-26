/**
 * Cliente SSE de la PWA emparejada (F3): parseo de frames, reconexión con
 * `Last-Event-ID`, `resync`/`gone`, backoff y cierres definitivos.
 *
 * El servidor real ya se prueba en `tests/agentStream.api.test.ts` y
 * `tests/agent/sessionStream.test.ts`; acá se fija el contrato del cliente sin
 * abrir sockets.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  PairSessionStream,
  type PairStreamFrame,
  type PairStreamStatus,
  parseSseBlock,
} from '../../src/pair/pairSessionStream';

function chunksResponse(chunks: string[], headers: Record<string, string> = {}) {
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: new TextEncoder().encode(chunks[index++]) }
            : { done: true, value: undefined },
        cancel: async () => {},
      }),
    },
  } as any;
}

/** Conexión abierta: entrega un bloque (si se pide) y después no cierra. */
function hangingResponse(chunk?: string) {
  let sent = false;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => {
          if (chunk && !sent) {
            sent = true;
            return { done: false, value: new TextEncoder().encode(chunk) };
          }
          return new Promise(() => {});
        },
        cancel: async () => {},
      }),
    },
  } as any;
}

function statusResponse(status: number, headers: Record<string, string> = {}) {
  return {
    ok: status < 400,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: null,
  } as any;
}

describe('parseSseBlock', () => {
  test('lee id, evento y JSON del data', () => {
    expect(parseSseBlock('id: 4\nevent: resync\ndata: {"id":"sess_1"}')).toEqual({
      id: 4,
      event: 'resync',
      data: { id: 'sess_1' },
    });
  });

  test('ignora comentarios y keep-alives', () => {
    expect(parseSseBlock(': keep-alive')).toBeNull();
  });

  test('junta data en varias líneas y cae al texto si no es JSON', () => {
    expect(parseSseBlock('event: status\ndata: hola\ndata: mundo')).toEqual({
      id: null,
      event: 'status',
      data: 'hola\nmundo',
    });
  });

  test('un id inválido no rompe el frame', () => {
    expect(parseSseBlock('id: abc\nevent: gone\ndata: {}')).toEqual({
      id: null,
      event: 'gone',
      data: {},
    });
  });
});

describe('reconexión', () => {
  test('reconecta con Last-Event-ID y aplica el resync nuevo', async () => {
    const headersSeen: Array<Record<string, string>> = [];
    const frames: PairStreamFrame[] = [];
    const retried = new Promise<void>((resolve) => {
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        headersSeen.push(headers);
        if (headersSeen.length === 1) {
          return chunksResponse(['id: 3\nevent: status\ndata: {"text":"paso"}\n\n']);
        }
        resolve();
        return hangingResponse('id: 5\nevent: resync\ndata: {"id":"sess_1","turns":[]}\n\n');
      });

      const stream = new PairSessionStream({
        url: '/api/agent/sessions/sess_1/stream',
        fetchImpl,
        retryMs: 1,
        onFrame: (frame) => frames.push(frame),
      });
      stream.start();
      void stream;
    });

    await retried;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(headersSeen[0]['Last-Event-ID']).toBeUndefined();
    expect(headersSeen[1]['Last-Event-ID']).toBe('3');
    expect(frames.map((frame) => frame.event)).toEqual(['status', 'resync']);
    expect(frames[1].data).toEqual({ id: 'sess_1', turns: [] });
  });

  test('un 401 no se reintenta: el dispositivo ya no está autorizado', async () => {
    const statuses: PairStreamStatus[] = [];
    const fetchImpl = vi.fn(async () => statusResponse(401));
    const stream = new PairSessionStream({
      url: '/x',
      fetchImpl,
      retryMs: 1,
      onFrame: () => {},
      onStatus: (status) => statuses.push(status),
    });
    stream.start();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('closed');
  });

  test('respeta el Retry-After del 429 del rate limit', async () => {
    const starts: number[] = [];
    const fetchImpl = vi.fn(async () => {
      starts.push(Date.now());
      if (starts.length === 1) return statusResponse(429, { 'retry-after': '0.02' });
      return statusResponse(401);
    });
    const stream = new PairSessionStream({
      url: '/x',
      fetchImpl,
      retryMs: 1,
      onFrame: () => {},
    });
    stream.start();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // El 429 esperó lo que dijo la cabecera (20 ms), no el backoff de 1 ms.
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(15);
  });

  test('gone cierra el stream y no vuelve a pedir', async () => {
    const fetchImpl = vi.fn(async () =>
      chunksResponse(['id: 9\nevent: gone\ndata: {"sessionId":"sess_1","reason":"completed"}\n\n'])
    );
    const frames: PairStreamFrame[] = [];
    const stream = new PairSessionStream({
      url: '/x',
      fetchImpl,
      retryMs: 1,
      onFrame: (frame) => frames.push(frame),
    });
    stream.start();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(frames.at(-1)?.event).toBe('gone');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('retryMs 0 deja un solo intento y publica el cierre', async () => {
    const statuses: PairStreamStatus[] = [];
    const fetchImpl = vi.fn(async () => chunksResponse(['id: 1\nevent: status\ndata: {}\n\n']));
    const stream = new PairSessionStream({
      url: '/x',
      fetchImpl,
      retryMs: 0,
      onFrame: () => {},
      onStatus: (status) => statuses.push(status),
    });
    stream.start();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('closed');
  });
});
