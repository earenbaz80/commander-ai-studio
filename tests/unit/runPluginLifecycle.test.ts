import { describe, expect, it } from 'vitest';
import {
  httpPluginLifecycleTransport,
  RunPluginLifecycle,
} from '../../src/agent/pluginLifecycle';

const context = { sessionId: 'sess_1', root: '.', goal: 'probar', model: 'modelo' };

describe('RunPluginLifecycle', () => {
  it('espera el sessionStart y emite un solo cierre', async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lifecycle = new RunPluginLifecycle(async (hook) => {
      if (hook === 'sessionStart') await gate;
      events.push(hook);
    }, context);

    const started = lifecycle.start();
    // El usuario puede detener la corrida mientras `sessionStart` está en vuelo.
    const stopped = lifecycle.close({ kind: 'stopped', reason: 'user' });
    const late = lifecycle.close({ kind: 'error', error: 'no debe ganar' });
    release();

    await Promise.all([started, stopped, late]);
    expect(events).toEqual(['sessionStart', 'stop']);
  });

  it('ignora los hooks de modelo posteriores al cierre', async () => {
    const events: string[] = [];
    const lifecycle = new RunPluginLifecycle(async (hook) => {
      events.push(hook);
    }, context);

    await lifecycle.start();
    await lifecycle.close({ kind: 'done', answer: 'listo' });
    await lifecycle.beforeModel(1);
    await lifecycle.afterModel(1, true);

    expect(events).toEqual(['sessionStart', 'sessionEnd']);
  });

  it('un cierre antes de arrancar no deja un sessionStart tardío', async () => {
    const events: string[] = [];
    const lifecycle = new RunPluginLifecycle(async (hook) => {
      events.push(hook);
    }, context);

    await lifecycle.close({ kind: 'stopped', reason: 'user' });
    await lifecycle.start();

    expect(events).toEqual([]);
  });

  it('corta una petición HTTP que no responde', async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('abortado')));
      });
    const lifecycle = new RunPluginLifecycle(
      httpPluginLifecycleTransport({
        baseUrl: 'http://127.0.0.1:1',
        fetchImpl,
        timeoutMs: 10,
      }),
      context
    );

    const started = Date.now();
    await lifecycle.start();

    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
