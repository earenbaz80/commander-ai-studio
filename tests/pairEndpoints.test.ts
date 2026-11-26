/**
 * Emparejamiento (F3) contra el server de verdad: `POST /api/pair/issue` y
 * `POST /api/pair/redeem`.
 *
 * Cubre lo que este paso implementa: enlace de un solo uso, emisión sólo desde
 * loopback y `Origin` exacto en el canje (403 ajeno, 403 sin Origin, 403
 * cross-site). La caducidad real se prueba en `pairExpiryEndpoint.test.ts` con
 * un servidor de TTL corto, y la lógica del almacén en
 * `tests/unit/pairTokens.test.ts`.
 *
 * La cookie de dispositivo, la lista de dispositivos y el lease son criterios
 * posteriores de F3: acá el canje devuelve la sesión emparejada, no una
 * credencial.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

/** Primera IPv4 de red de la máquina, o `null` si sólo tiene loopback. */
function nonLoopbackIPv4(): string | null {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const info of entries ?? []) {
      if (info.family === 'IPv4' && !info.internal && !info.address.startsWith('127.')) {
        return info.address;
      }
    }
  }
  return null;
}

/** `null` si el puerto acepta la conexión; el código de error si no. */
function probe(host: string, port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (failure: string | null) => {
      socket.destroy();
      resolve(failure);
    };
    socket.setTimeout(2_000, () => done('timeout'));
    socket.once('connect', () => done(null));
    socket.once('error', (e: NodeJS.ErrnoException) => done(e.code || e.message));
  });
}

let srv: ServerHarness;
let sessionId: string;

function post(path: string, body: unknown, headers?: Record<string, string>) {
  return srv.request('POST', path, body, headers ? { headers } : undefined);
}

/**
 * Emite un enlace como lo haría el CLI: loopback, sin `Origin`.
 *
 * Siempre con sesión explícita: el server compartido acumula sesiones de otros
 * archivos y «la más reciente» no es estable entre casos (sí lo es `--session`).
 */
async function issue(body: Record<string, unknown> = { sessionId }): Promise<string> {
  const res = await post('/api/pair/issue', body);
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.success, true, res.raw);
  return String(res.body.token);
}

before(async () => {
  srv = await startServer();
  const res = await post('/api/agent/sessions', { goal: 'Sesión para emparejar (F3)' });
  assert.equal(res.status, 200, res.raw);
  sessionId = String(res.body.session.id);
});

after(async () => {
  await srv?.stop();
});

describe('escucha sólo loopback', () => {
  test('el servidor de pair no acepta conexiones desde la interfaz de red', async (t) => {
    const url = new URL(srv.baseUrl);
    assert.equal(url.hostname, '127.0.0.1');

    const lan = nonLoopbackIPv4();
    if (!lan) {
      t.skip('la máquina no tiene una IPv4 de red con la que probar el bind');
      return;
    }
    const port = Number(url.port);
    assert.ok(port > 0, `puerto inválido en ${srv.baseUrl}`);

    // Mismo puerto, otra interfaz: si escuchara en 0.0.0.0 o en la LAN,
    // conectaría. Que falle (ECONNREFUSED/EHOSTUNREACH/timeout) es la prueba de
    // que la superficie de pair no está publicada. Sin `--remote` no hay forma
    // de pedir otro bind desde `commander pair`.
    const onLan = await probe(lan, port);
    assert.ok(onLan, `el puerto ${port} aceptó una conexión desde ${lan}`);

    // Y por loopback sí responde, para descartar que el puerto esté cerrado.
    const onLoopback = await probe(url.hostname, port);
    assert.equal(onLoopback, null, `127.0.0.1:${port} no aceptó la conexión`);
  });
});

describe('POST /api/pair/issue', () => {
  test('emite desde loopback sin Origin (el CLI) y caduca en 5 minutos', async () => {
    const before = Date.now();
    const res = await post('/api/pair/issue', {});
    const after = Date.now();

    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body.success, true, res.raw);
    assert.match(String(res.body.token), /^[A-Za-z0-9_-]{43}$/);
    // El server compartido tiene sesiones de otros archivos, algunos en
    // paralelo: cuál es «la más reciente» no es estable acá. Que elija una
    // válida y que sea la misma al canjear es lo que este caso cubre; qué
    // sesión elige (la última del store persistido) lo fija
    // `pairLatestSession.test.ts` con su propio server vacío.
    assert.match(String(res.body.sessionId), /^[A-Za-z0-9][A-Za-z0-9_-]*$/);
    assert.equal(res.body.ttlMs, 300_000);
    // El server es otro proceso: si el reloj de la máquina se ajusta entre
    // `before` y la lectura del server (NTP, despertar del equipo), el mismo
    // TTL de 5 min cae corrido. La ventana tolera ese desfasaje; el valor
    // exacto lo fija `pairTokens.test.ts` inyectando `now`.
    const skewMs = 60_000;
    assert.ok(
      res.body.expiresAt >= before + 300_000 - skewMs &&
        res.body.expiresAt <= after + 300_000 + skewMs,
      `expiresAt fuera de la ventana de 5 min (±${skewMs / 1000}s): ${res.body.expiresAt}`
    );
  });

  test('una página ajena no puede emitir: Origin ajeno → 403 sin token', async () => {
    const res = await post('/api/pair/issue', {}, { Origin: 'https://evil.example' });
    assert.equal(res.status, 403, res.raw);
    assert.equal(res.body.success, false);
    assert.equal(res.body.token, undefined);
    assert.match(String(res.body.error), /Origin no permitido/);
  });

  test('el propio servidor sí puede emitir con Origin explícito', async () => {
    const res = await post('/api/pair/issue', {}, { Origin: srv.baseUrl });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body.success, true);
  });

  test('Sec-Fetch-Site cross-site se rechaza antes de mirar el Origin', async () => {
    const res = await post('/api/pair/issue', {}, { Origin: srv.baseUrl, 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(res.status, 403, res.raw);
    assert.match(String(res.body.error), /cross-site/);
  });

  test('una sesión explícita que no existe es 404 y un id inválido es 400', async () => {
    const missing = await post('/api/pair/issue', { sessionId: 'sess_inexistente_f3' });
    assert.equal(missing.status, 404, missing.raw);

    const invalid = await post('/api/pair/issue', { sessionId: '../etc/passwd' });
    assert.equal(invalid.status, 400, invalid.raw);
  });

  test('con --session empareja esa sesión y no la más reciente', async () => {
    const created = await post('/api/agent/sessions', { goal: 'Sesión explícita (F3)' });
    assert.equal(created.status, 200, created.raw);
    const target = String(created.body.session.id);

    const res = await post('/api/pair/issue', { sessionId: target });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body.sessionId, target);
    // Y el canje devuelve esa, no la del `before`.
    const redeem = await post('/api/pair/redeem', { token: res.body.token }, { Origin: srv.baseUrl });
    assert.equal(redeem.status, 200, redeem.raw);
    assert.equal(redeem.body.session.id, target);
  });
});

describe('POST /api/pair/redeem', () => {
  test('canjea una sola vez y devuelve la sesión sin repetir el token', async () => {
    const token = await issue();
    const first = await post('/api/pair/redeem', { token }, { Origin: srv.baseUrl });
    assert.equal(first.status, 200, first.raw);
    assert.equal(first.body.success, true);
    assert.equal(first.body.session.id, sessionId);
    assert.equal(typeof first.body.session.status, 'string');
    assert.equal(first.raw.includes(token), false, 'la respuesta no repite el token');

    const second = await post('/api/pair/redeem', { token }, { Origin: srv.baseUrl });
    assert.equal(second.status, 401, second.raw);
    assert.match(String(second.body.error), /ya usado/);
  });

  test('sin Origin se rechaza: la página que no lo manda no canjea', async () => {
    const token = await issue();
    const res = await post('/api/pair/redeem', { token });
    assert.equal(res.status, 403, res.raw);
    assert.match(String(res.body.error), /falta Origin/);
  });

  test('Origin ajeno → 403 y no quema el enlace del dueño', async () => {
    const token = await issue();
    const evil = await post('/api/pair/redeem', { token }, { Origin: 'https://evil.example' });
    assert.equal(evil.status, 403, evil.raw);
    assert.match(String(evil.body.error), /Origin no permitido/);

    // El intento cross-site no consumió el token: el dueño lo canjea después.
    const owner = await post('/api/pair/redeem', { token }, { Origin: srv.baseUrl });
    assert.equal(owner.status, 200, owner.raw);
    assert.equal(owner.body.session.id, sessionId);
  });

  test('Sec-Fetch-Site cross-site → 403 aunque el Origin sea el propio', async () => {
    const token = await issue();
    const res = await post(
      '/api/pair/redeem',
      { token },
      { Origin: srv.baseUrl, 'Sec-Fetch-Site': 'cross-site' }
    );
    assert.equal(res.status, 403, res.raw);
    assert.match(String(res.body.error), /cross-site/);
    // Sigue vivo para el cliente legítimo.
    const ok = await post('/api/pair/redeem', { token }, { Origin: srv.baseUrl });
    assert.equal(ok.status, 200, ok.raw);
  });

  test('un token desconocido es 410 y no filtra si existió', async () => {
    const res = await post('/api/pair/redeem', { token: 'no-existe' }, { Origin: srv.baseUrl });
    assert.equal(res.status, 410, res.raw);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'enlace inválido o caducado');
    assert.equal(res.raw.includes('no-existe'), false);
  });

  test('un token vacío también es 410, no un 500', async () => {
    const res = await post('/api/pair/redeem', {}, { Origin: srv.baseUrl });
    assert.equal(res.status, 410, res.raw);
    assert.equal(res.body.error, 'enlace inválido o caducado');
  });
});
