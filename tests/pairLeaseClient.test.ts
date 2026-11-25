/**
 * Cliente web del control lease (F3): renovación cada 30 s con el `seq`
 * vigente y traspaso que no habilita la escritura hasta ver un ack válido.
 *
 * Sin server ni esperas reales: `fetch`, reloj e intervalos se inyectan. Lo que
 * se fija es el contrato que usará la PWA: qué request sale en cada acción, con
 * qué `seq`, y en qué momento exacto `canWrite` pasa a true.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAIR_LEASE_CLIENT_RENEW_MS,
  createPairLeaseClient,
  type PairLeaseAck,
  type PairLeaseClientState,
} from '../src/pair/pairLeaseClient.js';
import type { PairLease } from '../src/pair/pairLease.js';

interface Call {
  method: string;
  url: string;
  body: any;
  credentials?: RequestCredentials;
}

function lease(overrides: Partial<PairLease> = {}): PairLease {
  return {
    sessionId: 'sess_f3',
    deviceId: 'dev_a',
    seq: 1,
    acquiredAt: 1_000,
    renewedAt: 1_000,
    expiresAt: 61_000,
    pending: null,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Respuesta que el test resuelve a mano para observar el estado en vuelo. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Cola de respuestas por ruta; cada entrada puede ser un valor o una promesa. */
function fakeFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: any, init: any) => {
    const call: Call = {
      method: String(init?.method ?? 'GET'),
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      credentials: init?.credentials,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { calls, impl };
}

function timers() {
  let callback: (() => unknown) | null = null;
  const cleared: unknown[] = [];
  let ms = 0;
  const setIntervalImpl = (fn: () => unknown, interval: number) => {
    callback = fn;
    ms = interval;
    return { id: 'timer' };
  };
  const clearIntervalImpl = (handle: unknown) => {
    cleared.push(handle);
  };
  const readCallback = () => callback;
  return {
    setIntervalImpl,
    clearIntervalImpl,
    get ms() {
      return ms;
    },
    get cleared() {
      return cleared;
    },
    // El getter evita que TS estreche el callback a null por el cierre.
    tick: (): unknown => {
      const fn = readCallback();
      return fn?.();
    },
  };
}

function client(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createPairLeaseClient>[0]> = {}
) {
  return createPairLeaseClient({
    sessionId: 'sess_f3',
    baseUrl: 'http://127.0.0.1:3280',
    fetchImpl,
    ...overrides,
  });
}

describe('cliente web del lease', () => {
  test('claim toma el control, manda la sesión y habilita la escritura', async () => {
    const net = fakeFetch(() =>
      json({ success: true, lease: lease({ seq: 4 }), mine: true, renewMs: 30_000 })
    );
    const leaseClient = client(net.impl);

    const result = await leaseClient.claim();

    assert.equal(result.ok, true);
    assert.equal(net.calls.length, 1);
    assert.equal(net.calls[0].method, 'POST');
    assert.equal(net.calls[0].url, 'http://127.0.0.1:3280/api/pair/lease');
    assert.deepEqual(net.calls[0].body, { sessionId: 'sess_f3' });
    assert.equal(net.calls[0].credentials, 'same-origin', 'la cookie del dispositivo viaja');
    assert.equal(leaseClient.getState().canWrite, true);
    assert.equal(leaseClient.getState().lease?.seq, 4);
    assert.equal(leaseClient.getState().phase, 'owned');
  });

  test('renueva cada 30 s con el seq vigente y avanza el testigo', async () => {
    let renewals = 0;
    const net = fakeFetch((call) => {
      if (call.url.endsWith('/api/pair/lease')) {
        return json({ success: true, lease: lease({ seq: 1 }), mine: true, renewMs: 30_000 });
      }
      renewals += 1;
      return json({ success: true, lease: lease({ seq: 1 + renewals }), mine: true });
    });
    const preset = timers();
    const leaseClient = client(net.impl, {
      setIntervalImpl: preset.setIntervalImpl,
      clearIntervalImpl: preset.clearIntervalImpl,
    });

    await leaseClient.claim();
    leaseClient.startRenewal();
    assert.equal(preset.ms, PAIR_LEASE_CLIENT_RENEW_MS);
    assert.equal(leaseClient.getState().renewalActive, true, 'la pantalla puede mostrar la renovación');

    await preset.tick();
    await preset.tick();

    const renewCalls = net.calls.filter((call) => call.url.endsWith('/renew'));
    assert.equal(renewCalls.length, 2);
    assert.deepEqual(renewCalls[0].body, { sessionId: 'sess_f3', seq: 1 });
    assert.deepEqual(renewCalls[1].body, { sessionId: 'sess_f3', seq: 2 }, 'usa el seq nuevo, no el viejo');
    assert.equal(leaseClient.getState().lease?.seq, 3);
    assert.equal(leaseClient.getState().canWrite, true);
    leaseClient.dispose();
  });

  test('los ticks no se solapan: una renovación en vuelo no dispara otra', async () => {
    const gate = deferred<Response>();
    let renews = 0;
    const net = fakeFetch((call) => {
      if (call.url.endsWith('/api/pair/lease')) {
        return json({ success: true, lease: lease({ seq: 1 }), mine: true });
      }
      renews += 1;
      return gate.promise;
    });
    const preset = timers();
    const leaseClient = client(net.impl, {
      setIntervalImpl: preset.setIntervalImpl,
      clearIntervalImpl: preset.clearIntervalImpl,
    });

    await leaseClient.claim();
    leaseClient.startRenewal();
    const first = preset.tick();
    const second = preset.tick();

    assert.equal(renews, 1, 'el segundo tick se descarta mientras el primero corre');
    gate.resolve(json({ success: true, lease: lease({ seq: 2 }), mine: true }));
    await Promise.all([first, second]);
    leaseClient.dispose();
  });

  test('un 409 al renovar corta el temporizador y deja la sesión en lectura', async () => {
    const net = fakeFetch((call) => {
      if (call.url.endsWith('/api/pair/lease')) {
        return json({ success: true, lease: lease({ seq: 1 }), mine: true });
      }
      return json({ success: false, code: 'LEASE_STALE', error: 'el control cambió' }, 409);
    });
    const preset = timers();
    const leaseClient = client(net.impl, {
      setIntervalImpl: preset.setIntervalImpl,
      clearIntervalImpl: preset.clearIntervalImpl,
    });

    await leaseClient.claim();
    leaseClient.startRenewal();
    await preset.tick();

    assert.equal(leaseClient.getState().canWrite, false);
    assert.equal(leaseClient.getState().phase, 'readonly');
    assert.equal(leaseClient.getState().lastError?.code, 'LEASE_STALE');
    assert.equal(leaseClient.getState().renewalActive, false);
    assert.equal(preset.cleared.length, 1, 'deja de renovar en vez de repetir el 409');

    const sent = net.calls.length;
    await preset.tick();
    assert.equal(net.calls.length, sent, 'sin temporizador no hay más renovaciones');
  });

  test('el traspaso no habilita la escritura antes del ack', async () => {
    const gate = deferred<Response>();
    const net = fakeFetch((call) => {
      if (call.url.endsWith('/api/pair/lease')) {
        return json({ success: true, lease: lease({ seq: 5 }), mine: true });
      }
      return gate.promise;
    });
    const leaseClient = client(net.impl, { deviceId: 'dev_a' });

    await leaseClient.claim();
    assert.equal(leaseClient.getState().canWrite, true);

    const pending = leaseClient.transfer({ toDeviceId: 'dev_b' });
    assert.equal(leaseClient.getState().canWrite, false, 'en vuelo ya no se escribe');
    assert.equal(leaseClient.getState().pending, true);

    const ack: PairLeaseAck = { deviceId: 'dev_b', seq: 6, at: 6_000 };
    gate.resolve(
      json({ success: true, lease: lease({ deviceId: 'dev_b', seq: 6, pending: null }), ack })
    );
    const result = await pending;

    assert.equal(result.ok, true);
    assert.deepEqual(leaseClient.getState().ack, ack);
    assert.equal(leaseClient.getState().pending, false);
    assert.equal(leaseClient.getState().lease?.deviceId, 'dev_b');
    assert.equal(leaseClient.getState().canWrite, false, 'el control es de otro: seguimos en lectura');
    assert.equal(net.calls.at(-1)?.body.seq, 5, 'el traspaso viaja con el seq vigente');
  });

  test('un traspaso sin ack verificable falla y no habilita la escritura', async () => {
    const net = fakeFetch((call) => {
      if (call.url.endsWith('/api/pair/lease')) {
        return json({ success: true, lease: lease({ seq: 3 }), mine: true });
      }
      return json({ success: true, lease: lease({ deviceId: 'dev_b', seq: 4 }) });
    });
    const leaseClient = client(net.impl, { deviceId: 'dev_a' });

    await leaseClient.claim();
    const result = await leaseClient.transfer({ toDeviceId: 'dev_b' });

    assert.equal(result.ok, false);
    assert.equal(leaseClient.getState().canWrite, false);
    assert.equal(leaseClient.getState().phase, 'readonly');
    assert.equal(leaseClient.getState().lastError?.code, 'LEASE_ACK_MISSING');
    assert.equal(leaseClient.getState().ack, null);
  });

  test('recibir el control por traspaso no habilita escribir hasta confirmarlo', async () => {
    let mode: 'inbound' | 'renewed' = 'inbound';
    const net = fakeFetch((call) => {
      if (call.method === 'GET') {
        return json({
          success: true,
          lease: lease({ deviceId: mode === 'inbound' ? 'dev_me' : 'dev_me', seq: mode === 'inbound' ? 9 : 10 }),
          mine: true,
        });
      }
      mode = 'renewed';
      return json({ success: true, lease: lease({ deviceId: 'dev_me', seq: 10 }), mine: true });
    });
    const leaseClient = client(net.impl, { deviceId: 'dev_me' });

    await leaseClient.refresh();
    assert.equal(leaseClient.getState().mine, true);
    assert.equal(leaseClient.getState().canWrite, false, 'un GET por sí solo no confirma el control');
    assert.equal(leaseClient.getState().phase, 'readonly');

    await leaseClient.renew();
    assert.equal(leaseClient.getState().canWrite, true);
    assert.equal(leaseClient.getState().phase, 'owned');
  });

  test('liberar devuelve la sesión a lectura y limpia el ack', async () => {
    const net = fakeFetch((call) => {
      if (call.url.endsWith('/api/pair/lease')) {
        return json({ success: true, lease: lease({ seq: 2 }), mine: true });
      }
      return json({ success: true, lease: lease({ deviceId: 'desktop', seq: 3, expiresAt: null }) });
    });
    const leaseClient = client(net.impl, { deviceId: 'dev_a' });

    await leaseClient.claim();
    const result = await leaseClient.release();

    assert.equal(result.ok, true);
    assert.equal(leaseClient.getState().canWrite, false);
    assert.equal(leaseClient.getState().lease?.deviceId, 'desktop');
    assert.equal(leaseClient.getState().ack, null);
    assert.equal(net.calls.at(-1)?.body.seq, 2);
  });

  test('los listeners reciben cada transición y se pueden dar de baja', async () => {
    const net = fakeFetch(() =>
      json({ success: true, lease: lease({ seq: 1 }), mine: true })
    );
    const leaseClient = client(net.impl);
    const seen: PairLeaseClientState[] = [];
    const unsubscribe = leaseClient.subscribe((state) => seen.push(state));

    await leaseClient.claim();
    assert.ok(seen.length >= 2, 'syncing y owned');
    assert.equal(seen.at(-1)?.canWrite, true);

    unsubscribe();
    const before = seen.length;
    await leaseClient.refresh();
    assert.equal(seen.length, before, 'tras la baja no llegan más estados');
  });
});
