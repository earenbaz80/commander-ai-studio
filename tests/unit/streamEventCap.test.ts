/**
 * Tope por frame SSE (G2 C4, §6.6 del modelo de amenazas).
 *
 * Un evento que no cabe se rechaza con `event: error` y **sin** `id`: el cursor
 * del cliente no puede avanzar sobre algo que no recibió, y nada se trunca en
 * silencio.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_STREAM_EVENT_BYTES,
  STREAM_EVENT_TOO_LARGE,
  SessionEventBuffer,
  attachSessionStream,
  streamEventMaxBytes,
} from '../../src/agent/sessionStream';
import { createSessionState } from '../../src/agent/sessionTypes';

class Sink {
  chunks: string[] = [];
  ended = false;
  writableEnded = false;
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  end(): void {
    this.ended = true;
    this.writableEnded = true;
  }
  text(): string {
    return this.chunks.join('');
  }
}

function setup(id: string, options: { maxEventBytes?: number } = {}) {
  const state = createSessionState({ id, goal: 'tope', cwd: '/tmp' });
  const buffer = new SessionEventBuffer(id);
  const sink = new Sink();
  const cleanup = attachSessionStream(
    { id, toState: () => state, getEventBuffer: () => buffer },
    0,
    sink,
    { keepAliveMs: 60_000, idleMs: 0, ...options }
  );
  return { buffer, sink, cleanup };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('tope por frame del stream', () => {
  it('rechaza el evento que no cabe, sin id y sin truncarlo', () => {
    const { buffer, sink, cleanup } = setup('sess_cap', { maxEventBytes: 1024 });

    buffer.publish({ type: 'status', text: 'x'.repeat(4096) });
    const text = sink.text();

    expect(text).toContain('event: error');
    expect(text).toContain(STREAM_EVENT_TOO_LARGE);
    expect(text).toContain('"max":1024');
    expect(text).not.toContain('id: 1');
    expect(text).not.toContain('xxxxxxxxxx');

    cleanup();
  });

  it('un evento dentro del tope sigue pasando con su id', () => {
    const { buffer, sink, cleanup } = setup('sess_cap_ok', { maxEventBytes: 1024 });

    buffer.publish({ type: 'status', text: 'ok' });
    const text = sink.text();

    expect(text).toContain('id: 1');
    expect(text).toContain('event: status');
    expect(text).not.toContain(STREAM_EVENT_TOO_LARGE);

    cleanup();
  });

  it('el tope sale del entorno y por debajo de 1 KB se ignora', () => {
    expect(streamEventMaxBytes({ COMMANDER_STREAM_EVENT_MAX_BYTES: '2048' })).toBe(2048);
    expect(streamEventMaxBytes({ COMMANDER_STREAM_EVENT_MAX_BYTES: '1023' })).toBe(
      MAX_STREAM_EVENT_BYTES
    );
    expect(streamEventMaxBytes({ COMMANDER_STREAM_EVENT_MAX_BYTES: 'basura' })).toBe(
      MAX_STREAM_EVENT_BYTES
    );
    expect(streamEventMaxBytes({})).toBe(MAX_STREAM_EVENT_BYTES);
  });
});
