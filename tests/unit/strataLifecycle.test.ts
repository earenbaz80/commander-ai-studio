import { EventEmitter } from 'node:events';
import { describe, expect, test, vi } from 'vitest';
import { StrataLifecycleManager } from '../../src/lib/strataLifecycle';

class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill() {
    if (this.exitCode === null) {
      this.exitCode = 0;
      this.emit('exit', 0, null);
    }
    return true;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const baseUrl = 'http://127.0.0.1:8080/v1';

function makeSpawn(onCall?: (args: string[]) => void) {
  const calls: string[][] = [];
  const spawn = ((command: string, args: string[]) => {
    calls.push([command, ...args]);
    onCall?.(args);
    const child = new FakeChild();
    if (args[1] === '--stop') {
      queueMicrotask(() => {
        if (child.exitCode !== null) return;
        child.exitCode = 0;
        child.emit('exit', 0, null);
      });
    }
    return child;
  }) as any;
  return { spawn, calls };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  let clock = 0;
  return {
    spawn: vi.fn(),
    fetch: vi.fn(),
    findBinary: () => '/fake/strata',
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    timeoutMs: 1_000,
    pollMs: 10,
    stopTimeoutMs: 100,
    ...overrides,
  } as any;
}

describe('StrataLifecycleManager', () => {
  test('arranca con modelo/contexto y espera a que /status confirme el modelo', async () => {
    let started = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!started) return json({}, 503);
      if (url.endsWith('/v1/models')) {
        return json({
          data: [{ id: 'actual-model', aliases: ['requested-alias'], status: { value: 'loaded' }, meta: { n_ctx: 32768 } }],
        });
      }
      if (url.endsWith('/v1/status')) {
        return json({ service: 'strata', loaded: true, model: 'actual-model', context: { native: 32768 } });
      }
      throw new Error(`URL inesperada: ${url}`);
    }) as unknown as typeof fetch;
    const { spawn, calls } = makeSpawn((args) => {
      if (args[0] === 'launch' && args[1] === '--model') started = true;
    });
    const manager = new StrataLifecycleManager(makeDeps({ fetch: fetcher, spawn }));

    const result = await manager.start({
      model: 'requested-alias',
      context: 32768,
      baseUrl,
    });

    expect(result.success).toBe(true);
    expect(result.state).toBe('running');
    expect(result.model).toBe('actual-model');
    expect(result.context).toBe(32768);
    expect(result.pid).toBe(4242);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      '/fake/strata',
      'launch',
      '--model',
      'requested-alias',
      '--context',
      '32768',
      '--port',
      '8080',
      '--no-tui',
      '--yes',
      '--output',
      'json',
    ]);
  });

  test('no declara éxito si /status confirma otro modelo', async () => {
    let started = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!started) return json({}, 503);
      if (url.endsWith('/v1/models')) {
        return json({ data: [{ id: 'requested-model', status: { value: 'loaded' } }] });
      }
      return json({ service: 'strata', loaded: true, model: 'otro-modelo', context: { native: 32768 } });
    }) as unknown as typeof fetch;
    const { spawn } = makeSpawn((args) => {
      if (args[0] === 'launch' && args[1] === '--model') started = true;
    });
    const manager = new StrataLifecycleManager(makeDeps({ fetch: fetcher, spawn }));

    const result = await manager.start({
      model: 'requested-model',
      context: 32768,
      baseUrl,
    });

    expect(result.success).toBe(false);
    expect(result.state).toBe('error');
    expect(result.error).toContain('otro-modelo');
  });

  test('falla con un mensaje claro si /status no confirma el modelo a tiempo', async () => {
    const fetcher = vi.fn(async () => json({}, 503)) as unknown as typeof fetch;
    const { spawn } = makeSpawn();
    const manager = new StrataLifecycleManager(
      makeDeps({ fetch: fetcher, spawn, timeoutMs: 30, pollMs: 10 })
    );

    const result = await manager.start({
      model: 'requested-model',
      context: 32768,
      baseUrl,
    });

    expect(result.success).toBe(false);
    expect(result.state).toBe('error');
    expect(result.error).toContain('no confirmó');
  });

  test('reinicia si cambia el contexto del mismo modelo', async () => {
    let phase: 'old' | 'stopped' | 'new' = 'old';
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/models')) {
        return json({ data: [{ id: 'actual-model', status: { value: 'loaded' } }] });
      }
      if (phase === 'stopped') return json({}, 503);
      return json({
        service: 'strata',
        loaded: true,
        model: 'actual-model',
        context: { native: phase === 'old' ? 32768 : 65536 },
      });
    }) as unknown as typeof fetch;
    const { spawn, calls } = makeSpawn((args) => {
      if (args[0] === 'launch' && args[1] === '--stop') phase = 'stopped';
      else phase = 'new';
    });
    const manager = new StrataLifecycleManager(makeDeps({ fetch: fetcher, spawn }));

    const result = await manager.start({
      model: 'actual-model',
      context: 65536,
      baseUrl,
    });

    expect(result.success).toBe(true);
    expect(result.context).toBe(65536);
    expect(calls.some((call) => call[1] === 'launch' && call[2] === '--stop')).toBe(true);
    expect(calls.some((call) => call[1] === 'launch' && call[2] === '--model')).toBe(true);
  });

  test('detiene el host y espera a que /status deje de responder', async () => {
    let statusCalls = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/models')) return json({ data: [{ id: 'actual-model' }] });
      statusCalls += 1;
      return statusCalls === 1
        ? json({ service: 'strata', loaded: true, model: 'actual-model' })
        : json({}, 503);
    }) as unknown as typeof fetch;
    const { spawn, calls } = makeSpawn();
    const manager = new StrataLifecycleManager(makeDeps({ fetch: fetcher, spawn }));

    const result = await manager.stop({ baseUrl });

    expect(result.success).toBe(true);
    expect(result.state).toBe('stopped');
    expect(calls[0]).toEqual(['/fake/strata', 'launch', '--stop']);
  });

  test('redacta la API key si el CLI la imprime en stderr', async () => {
    const secret = 'clave-cli-que-no-debe-salir';
    const fetcher = vi.fn(async () => json({}, 503)) as unknown as typeof fetch;
    const spawn = vi.fn(() => {
      const child = new FakeChild();
      queueMicrotask(() => child.stderr.emit('data', Buffer.from(`STRATA_API_KEY=${secret}\n`)));
      return child;
    }) as any;
    const manager = new StrataLifecycleManager(
      makeDeps({ fetch: fetcher, spawn, timeoutMs: 30, pollMs: 10 })
    );

    const result = await manager.start({
      model: 'un-modelo',
      context: 32768,
      baseUrl,
      apiKey: secret,
    });

    expect(result.success).toBe(false);
    expect(result.error || '').not.toContain(secret);
    expect(result.error || '').toContain('[redacted]');
  });

  test('sólo gestiona hosts en loopback', async () => {
    const { spawn } = makeSpawn();
    const manager = new StrataLifecycleManager(makeDeps({ spawn }));

    const result = await manager.start({
      model: 'actual-model',
      context: 32768,
      baseUrl: 'http://192.168.1.20:8080/v1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('loopback');
  });
});
