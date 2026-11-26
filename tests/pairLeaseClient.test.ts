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

  test('la escritura de sesión viaja con el seq del lease', async () => {
    const net = fakeFetch((call) => {
      if (call.url.endsWith('/api/pair/lease')) {
        return json({ success: true, lease: lease({ seq: 6 }), mine: true });
      }
      return json({ success: true, state: { sessionId: 'sess_f3' } }, 202);
    });
    const leaseClient = client(net.impl);

    await leaseClient.claim();
    const result = await leaseClient.sendMessage({ text: 'hola' });

    assert.equal(result.ok, true);
    const write = net.calls.at(-1)!;
    assert.equal(write.method, 'POST');
    assert.equal(write.url, 'http://127.0.0.1:3280/api/agent/sessions/sess_f3/message');
    assert.deepEqual(write.body, { text: 'hola', seq: 6 });
    assert.equal(write.credentials, 'same-origin', 'la cookie del dispositivo viaja');
    assert.equal(leaseClient.getState().canWrite, true, 'una escritura aceptada confirma el control');
  });

  test('un LEASE_STALE refresca el estado y reintenta con el seq nuevo', async () => {
    let writes = 0;
    const net = fakeFetch((call) => {
      if (call.url.endsWith('/api/pair/lease')) {
        return json({ success: true, lease: lease({ seq: 4 }), mine: true });
      }
      if (call.method === 'GET') {
        return json({ success: true, lease: lease({ seq: 7 }), mine: true });
      }
      writes += 1;
      if (writes === 1) {
        return json({ success: false, code: 'LEASE_STALE', error: 'el control cambió' }, 409);
      }
      return json({ success: true, state: { sessionId: 'sess_f3' } }, 202);
    });
    const leaseClient = client(net.impl);

    await leaseClient.claim();
    const result = await leaseClient.sendMessage({ text: 'hola' });

    assert.equal(result.ok, true);
    assert.deepEqual(
      net.calls.map((call) => `${call.method} ${call.url.replace('http://127.0.0.1:3280', '')}`),
      [
        'POST /api/pair/lease',
        'POST /api/agent/sessions/sess_f3/message',
        'GET /api/pair/lease?sessionId=sess_f3',
        'POST /api/agent/sessions/sess_f3/message',
      ],
      'entre la escritura vieja y el reintento se relee el estado'
    );
    const messages = net.calls.filter((call) => call.url.endsWith('/message'));
    assert.equal(messages[0].body.seq, 4);
    assert.equal(messages[1].body.seq, 7, 'reintenta con el seq que devolvió el refresh');
    assert.equal(leaseClient.getState().lease?.seq, 7);
    assert.equal(leaseClient.getState().canWrite, true);
  });

  test('un LEASE_STALE con el control en otro dispositivo no reintenta', async () => {
    const net = fakeFetch((call) => {
      if (call.url.endsWith('/api/pair/lease')) {
        return json({ success: true, lease: lease({ seq: 4 }), mine: true });
      }
      if (call.method === 'GET') {
        return json({ success: true, lease: lease({ deviceId: 'dev_b', seq: 8 }), mine: false });
      }
      return json({ success: false, code: 'LEASE_STALE', error: 'el control cambió' }, 409);
    });
    const leaseClient = client(net.impl);

    await leaseClient.claim();
    const result = await leaseClient.sendMessage({ text: 'hola' });

    if (result.ok) assert.fail('sin el control no se escribe');
    assert.equal(result.error.code, 'LEASE_STALE');
    assert.equal(
      net.calls.filter((call) => call.url.endsWith('/message')).length,
      1,
      'sin reintento: el control ya es de otro'
    );
    assert.equal(leaseClient.getState().lease?.deviceId, 'dev_b', 'el estado quedó refrescado');
    assert.equal(leaseClient.getState().canWrite, false);
  });

  test('sin lease conocido la escritura no sale a la red', async () => {
    const net = fakeFetch(() => json({ success: true, lease: lease(), mine: true }));
    const leaseClient = client(net.impl);

    const result = await leaseClient.sendMessage({ text: 'hola' });

    if (result.ok) assert.fail('sin seq no se escribe');
    assert.equal(result.error.code, 'LEASE_NO_STATE');
    assert.equal(net.calls.length, 0);
  });

  test('la decisión de una aprobación viaja con el seq del lease', async () => {
    const net = fakeFetch((call) => {
      if (call.url.endsWith('/api/pair/lease')) {
        return json({ success: true, lease: lease({ seq: 6 }), mine: true });
      }
      return json({ success: true, decision: 'allow', state: { sessionId: 'sess_f3' } });
    });
    const leaseClient = client(net.impl);

    await leaseClient.claim();
    const result = await leaseClient.resolveApproval('apr_1', { decision: 'allow', reason: 'panel' });

    assert.equal(result.ok, true);
    const write = net.calls.at(-1)!;
    assert.equal(write.method, 'POST');
    assert.equal(
      write.url,
      'http://127.0.0.1:3280/api/agent/sessions/sess_f3/approvals/apr_1'
    );
    assert.deepEqual(write.body, { decision: 'allow', reason: 'panel', seq: 6 });
    assert.equal(write.credentials, 'same-origin', 'la cookie del dispositivo viaja');
    assert.equal(leaseClient.getState().canWrite, true, 'aprobar confirma el control');
  });

  test('un LEASE_STALE al aprobar refresca el estado y reintenta con el seq nuevo', async () => {
    let decisions = 0;
    const net = fakeFetch((call) => {
      if (call.url.endsWith('/api/pair/lease')) {
        return json({ success: true, lease: lease({ seq: 4 }), mine: true });
      }
      if (call.method === 'GET') {
        return json({ success: true, lease: lease({ seq: 7 }), mine: true });
      }
      decisions += 1;
      if (decisions === 1) {
        return json({ success: false, code: 'LEASE_STALE', error: 'el control cambió' }, 409);
      }
      return json({ success: true, decision: 'deny', state: { sessionId: 'sess_f3' } });
    });
    const leaseClient = client(net.impl);

    await leaseClient.claim();
    const result = await leaseClient.resolveApproval('apr_2', {
      decision: 'deny',
      reason: 'sin revisar',
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      net.calls.map((call) => `${call.method} ${call.url.replace('http://127.0.0.1:3280', '')}`),
      [
        'POST /api/pair/lease',
        'POST /api/agent/sessions/sess_f3/approvals/apr_2',
        'GET /api/pair/lease?sessionId=sess_f3',
        'POST /api/agent/sessions/sess_f3/approvals/apr_2',
      ],
      'entre la decisión vieja y el reintento se relee el estado'
    );
    const sent = net.calls.filter((call) => call.url.includes('/approvals/'));
    assert.equal(sent[0].body.seq, 4);
    assert.equal(sent[1].body.seq, 7, 'reintenta con el seq que devolvió el refresh');
    assert.deepEqual(
      sent[1].body,
      { decision: 'deny', reason: 'sin revisar', seq: 7 },
      'el reintento conserva la decisión'
    );
    assert.equal(leaseClient.getState().canWrite, true);
  });

  test('sin lease conocido la aprobación no sale a la red', async () => {
    const net = fakeFetch(() => json({ success: true, lease: lease(), mine: true }));
    const leaseClient = client(net.impl);

    const result = await leaseClient.resolveApproval('apr_3', { decision: 'allow' });

    if (result.ok) assert.fail('sin seq no se aprueba');
    assert.equal(result.error.code, 'LEASE_NO_STATE');
    assert.equal(net.calls.length, 0);
  });

  test('cancelar, bifurcar y arrancar, guardar estado y aplicar una propuesta van firmadas', async () => {
    const net = fakeFetch((call) => {
      if (call.url.endsWith('/api/pair/lease')) {
        return json({ success: true, lease: lease({ seq: 8 }), mine: true });
      }
      return json({ success: true, state: { sessionId: 'sess_f3' } });
    });
    const leaseClient = client(net.impl);

    await leaseClient.claim();
    const cancelled = await leaseClient.cancel();
    const forked = await leaseClient.forkAndRun({ text: 'seguí' });
    const saved = await leaseClient.saveState({ id: 'sess_f3', status: 'idle' });
    const applied = await leaseClient.applyProposal('prop_1');

    assert.equal(cancelled.ok, true);
    assert.equal(forked.ok, true);
    assert.equal(saved.ok, true);
    assert.equal(applied.ok, true);
    const writes = net.calls.slice(1).map((call) => ({
      method: call.method,
      path: call.url.replace('http://127.0.0.1:3280', ''),
      body: call.body,
      credentials: call.credentials,
    }));
    assert.deepEqual(writes, [
      {
        method: 'POST',
        path: '/api/agent/sessions/sess_f3/cancel',
        body: { seq: 8 },
        credentials: 'same-origin',
      },
      {
        method: 'POST',
        path: '/api/agent/sessions/sess_f3/fork',
        body: { text: 'seguí', run: true, seq: 8 },
        credentials: 'same-origin',
      },
      {
        method: 'PUT',
        path: '/api/agent/sessions/sess_f3/state',
        body: { state: { id: 'sess_f3', status: 'idle' }, seq: 8 },
        credentials: 'same-origin',
      },
      {
        method: 'POST',
        path: '/api/agent/sessions/sess_f3/proposals/prop_1/apply',
        body: { seq: 8 },
        credentials: 'same-origin',
      },
    ]);
    assert.equal(leaseClient.getState().canWrite, true, 'cada escritura aceptada confirma el control');
  });

  test('un LEASE_STALE al aplicar una propuesta reintenta con el seq nuevo', async () => {
    let applies = 0;
    const net = fakeFetch((call) => {
      if (call.url.endsWith('/api/pair/lease')) {
        return json({ success: true, lease: lease({ seq: 2 }), mine: true });
      }
      if (call.method === 'GET') {
        return json({ success: true, lease: lease({ seq: 5 }), mine: true });
      }
      applies += 1;
      if (applies === 1) {
        return json({ success: false, code: 'LEASE_STALE', error: 'el testigo cambió' }, 409);
      }
      return json({ success: true, ok: true, state: { sessionId: 'sess_f3' } });
    });
    const leaseClient = client(net.impl);

    await leaseClient.claim();
    const result = await leaseClient.applyProposal('prop_2');

    assert.equal(result.ok, true);
    assert.deepEqual(
      net.calls.map((call) => `${call.method} ${call.url.replace('http://127.0.0.1:3280', '')}`),
      [
        'POST /api/pair/lease',
        'POST /api/agent/sessions/sess_f3/proposals/prop_2/apply',
        'GET /api/pair/lease?sessionId=sess_f3',
        'POST /api/agent/sessions/sess_f3/proposals/prop_2/apply',
      ],
      'entre la aplicación vieja y el reintento se relee el estado'
    );
    const sent = net.calls.filter((call) => call.url.includes('/proposals/'));
    assert.deepEqual(sent.map((call) => call.body.seq), [2, 5]);
    assert.equal(leaseClient.getState().lease?.seq, 5);
    assert.equal(leaseClient.getState().canWrite, true);
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
