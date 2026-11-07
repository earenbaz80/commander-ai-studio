/**
 * Stream reanudable (F1-03): buffer, cursor, resync, gone y keep-alive.
 *
 * Se prueba con un sink en memoria y timers falsos para no depender de un
 * socket real; el endpoint HTTP se cubre en `tests/agentStream.api.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STREAM_KEEPALIVE_MS,
  MAX_STREAM_EVENTS,
  SessionEventBuffer,
  attachSessionStream,
  parseStreamCursor,
} from '../../src/agent/sessionStream';
import { createSessionState, type SessionStateV2 } from '../../src/agent/sessionTypes';

class FakeSink {
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

function source(state: SessionStateV2, buffer: SessionEventBuffer) {
  return {
    id: state.id,
    toState: () => state,
    getEventBuffer: () => buffer,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionEventBuffer', () => {
  it('conserva 1.000 eventos y detecta un cursor desalojado', () => {
    const buffer = new SessionEventBuffer('sess_buffer');
    for (let i = 1; i <= MAX_STREAM_EVENTS + 5; i++) {
      buffer.publish({ type: 'status', text: `paso ${i}` });
    }

    expect(buffer.size).toBe(MAX_STREAM_EVENTS);
    expect(buffer.firstSeq).toBe(6);
    expect(buffer.lastSeq).toBe(MAX_STREAM_EVENTS + 5);

    const evicted = buffer.replay(0);
    expect(evicted.resync).toBe(true);
    expect(evicted.reason).toBe('evicted');

    const exact = buffer.replay(5);
    expect(exact.resync).toBe(false);
    expect(exact.events).toHaveLength(MAX_STREAM_EVENTS);
    expect(exact.events[0].seq).toBe(6);

    expect(buffer.replay(buffer.lastSeq).events).toHaveLength(0);
    expect(buffer.replay(buffer.lastSeq + 1).resync).toBe(true);
    expect(buffer.replay(buffer.lastSeq + 1).reason).toBe('ahead');
  });

  it('avisa gone una sola vez y reabre sin reiniciar el seq', () => {
    const buffer = new SessionEventBuffer('sess_gone');
    const reasons: string[] = [];
    buffer.subscribeGone((reason) => reasons.push(reason));
    buffer.publish({ type: 'status', text: 'running' });
    buffer.markGone('cancelled');
    buffer.markGone('completed');

    expect(reasons).toEqual(['cancelled']);
    expect(buffer.goneReason).toBe('cancelled');

    buffer.reopen();
    expect(buffer.goneReason).toBeNull();
    const next = buffer.publish({ type: 'status', text: 'running' });
    expect(next?.seq).toBe(2);
  });
});

describe('attachSessionStream', () => {
  it('reemite el buffer, manda keep-alive y cierra con gone', () => {
    vi.useFakeTimers();
    const state = createSessionState({
      id: 'sess_stream',
      goal: 'stream',
      cwd: '/workspace',
    });
    const buffer = new SessionEventBuffer(state.id);
    const sink = new FakeSink();
    const cleanup = attachSessionStream(source(state, buffer), 0, sink, {
      keepAliveMs: DEFAULT_STREAM_KEEPALIVE_MS,
    });

    buffer.publish({ type: 'status', text: 'running' });
    expect(sink.text()).toContain('id: 1');
    expect(sink.text()).toContain('event: status');

    vi.advanceTimersByTime(DEFAULT_STREAM_KEEPALIVE_MS);
    expect(sink.text()).toContain(': keep-alive');

    buffer.markGone('completed');
    expect(sink.text()).toContain('event: gone');
    expect(sink.ended).toBe(true);
    cleanup();
  });

  it('manda resync cuando el cursor ya no existe', () => {
    const state = createSessionState({
      id: 'sess_resync',
      goal: 'resync',
      cwd: '/workspace',
    });
    state.status = 'running';
    state.steps = [
      {
        id: 'step_1',
        type: 'thought',
        title: 'Hecho',
        content: 'algo',
        status: 'completed',
        ts: Date.now(),
      },
    ];
    const buffer = new SessionEventBuffer(state.id);
    const sink = new FakeSink();
    const cleanup = attachSessionStream(source(state, buffer), 999, sink, {
      keepAliveMs: 60_000,
    });

    expect(sink.text()).toContain('event: resync');
    expect(sink.text()).toContain('"id":"sess_resync"');
    expect(sink.text()).not.toContain('event: gone');
    cleanup();
  });

  it('el cleanup desconecta al cliente sin parar la sesión', () => {
    const state = createSessionState({
      id: 'sess_cleanup',
      goal: 'cleanup',
      cwd: '/workspace',
    });
    const buffer = new SessionEventBuffer(state.id);
    const sink = new FakeSink();
    const cleanup = attachSessionStream(source(state, buffer), 0, sink);
    cleanup();

    buffer.publish({ type: 'status', text: 'running' });
    expect(sink.text()).toBe('');
    expect(buffer.lastSeq).toBe(1);
    expect(buffer.goneReason).toBeNull();
  });

  it('cierra una sesión terminal cargada de disco con resync + gone', () => {
    const state = createSessionState({
      id: 'sess_terminal',
      goal: 'terminal',
      cwd: '/workspace',
    });
    state.status = 'completed';
    state.answer = 'listo';
    const buffer = new SessionEventBuffer(state.id);
    const sink = new FakeSink();
    attachSessionStream(source(state, buffer), 0, sink, { keepAliveMs: 60_000 });

    expect(sink.text()).toContain('event: resync');
    expect(sink.text()).toContain('event: gone');
    expect(sink.text()).toContain('"reason":"completed"');
    expect(sink.ended).toBe(true);
  });
});

describe('parseStreamCursor', () => {
  it('prioriza after, acepta Last-Event-ID y rechaza cursores inválidos', () => {
    expect(parseStreamCursor(undefined, undefined)).toBe(0);
    expect(parseStreamCursor('12', '3')).toBe(12);
    expect(parseStreamCursor(undefined, '3')).toBe(3);
    expect(parseStreamCursor(['4'], undefined)).toBe(4);
    expect(parseStreamCursor('-1', undefined)).toBeNull();
    expect(parseStreamCursor('abc', undefined)).toBeNull();
    expect(parseStreamCursor('1.5', undefined)).toBeNull();
  });
});
