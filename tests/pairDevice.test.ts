/**
 * Cookie de dispositivo de pair (F3, §6.2 del modelo de amenazas).
 *
 * Contra el server compartido se prueba lo que ve el cliente: el canje emite
 * una cookie opaca `HttpOnly`/`SameSite=Strict`, el enlace sigue siendo de un
 * solo uso, una cookie inválida (o ausente) recibe 401 y revocar la invalida en
 * el request siguiente. Los casos puros del registro (tope de dispositivos,
 * caducidad, revocar dos veces) van directo contra el módulo, con su memoria
 * propia: no hay dos procesos compartiendo estado.
 *
 * La cookie se lee de `set-cookie`; el arnés expone ahora las cabeceras.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type HttpResult, type ServerHarness } from './helpers/serverHarness.js';
import {
  PAIR_DEVICE_COOKIE,
  PAIR_DEVICE_REVOKED_RETENTION_MS,
  PAIR_DEVICE_TTL_MS,
  issuePairDevice,
  pairDeviceRevokedTtlMs,
  listPairDevices,
  pairDeviceCookie,
  resetPairDevicesForTests,
  resolvePairDevice,
  revokePairDevice,
} from '../src/pair/pairDevices.js';

let srv: ServerHarness;
let sessionId: string;

function setCookies(res: HttpResult): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

function deviceCookieHeader(res: HttpResult): string {
  const header = setCookies(res).find((entry) => entry.startsWith(`${PAIR_DEVICE_COOKIE}=`));
  assert.ok(header, `la respuesta no trae la cookie de dispositivo: ${JSON.stringify(res.headers)}`);
  return String(header);
}

function cookiePair(res: HttpResult): { header: string; cookie: string } {
  const header = deviceCookieHeader(res);
  const value = header.split(';')[0].slice(PAIR_DEVICE_COOKIE.length + 1);
  return { header, cookie: `${PAIR_DEVICE_COOKIE}=${value}` };
}

/** Emite el enlace y lo canja como el navegador del dispositivo nuevo. */
async function pairOnce() {
  const issued = await srv.request('POST', '/api/pair/issue', { sessionId });
  assert.equal(issued.status, 200, issued.raw);
  const redeemed = await srv.request(
    'POST',
    '/api/pair/redeem',
    { token: issued.body.token },
    { headers: { Origin: srv.baseUrl } }
  );
  assert.equal(redeemed.status, 200, redeemed.raw);
  const { header, cookie } = cookiePair(redeemed);
  return { token: String(issued.body.token), redeemed, header, cookie, deviceId: String(redeemed.body.device.id) };
}

before(async () => {
  srv = await startServer();
  const res = await srv.request('POST', '/api/agent/sessions', { goal: 'Sesión para la cookie de pair (F3)' });
  assert.equal(res.status, 200, res.raw);
  sessionId = String(res.body.session.id);
});

after(async () => {
  await srv?.stop();
});

describe('cookie de dispositivo en el canje', () => {
  test('emite un identificador opaco HttpOnly y SameSite=Strict, y lo registra', async () => {
    const device = await pairOnce();

    // Flags de §6.2: host-only, no legible por JS, no viaja cross-site.
    assert.match(device.header, /HttpOnly/);
    assert.match(device.header, /SameSite=Strict/);
    assert.match(device.header, /Path=\//);
    assert.equal(device.header.includes('Domain='), false, `no debe ser host-only: ${device.header}`);
    assert.equal(device.header.includes('Secure'), false, 'en http el Secure impediría guardar la cookie');
    assert.match(device.header, new RegExp(`Max-Age=${Math.floor(PAIR_DEVICE_TTL_MS / 1000)}`));

    // El cuerpo nombra el dispositivo sin repetir la credencial.
    assert.match(device.deviceId, /^dev_[0-9a-f]{16}$/);
    assert.equal(device.redeemed.raw.includes(device.cookie), false);
    assert.equal(typeof device.redeemed.body.device.createdAt, 'number');
    assert.equal(typeof device.redeemed.body.device.expiresAt, 'number');

    // Registro: aparece en la lista del host, con su User-Agent recortado.
    const listed = await srv.request('GET', '/api/pair/devices');
    assert.equal(listed.status, 200, listed.raw);
    assert.equal(listed.body.success, true);
    assert.equal(listed.body.maxDevices, 5);
    const entry = listed.body.devices.find((row: any) => row.id === device.deviceId);
    assert.ok(entry, `el dispositivo ${device.deviceId} no está en la lista`);
    assert.equal(entry.revokedAt, null);
    assert.equal(entry.expiresAt > entry.createdAt, true);

    // La cookie identifica al dispositivo sin exponer el token en la respuesta.
    const whoami = await srv.request('GET', '/api/pair/device', undefined, {
      headers: { Cookie: device.cookie },
    });
    assert.equal(whoami.status, 200, whoami.raw);
    assert.equal(whoami.body.device.id, device.deviceId);
    assert.equal(whoami.raw.includes(device.cookie), false);
  });

  test('reutilizar el enlace responde 401 y no emite una segunda cookie', async () => {
    const device = await pairOnce();
    const before = await srv.request('GET', '/api/pair/devices');
    const entryBefore = before.body.devices.find((row: any) => row.id === device.deviceId);
    assert.ok(entryBefore, 'el dispositivo del caso debe estar registrado');

    const replay = await srv.request(
      'POST',
      '/api/pair/redeem',
      { token: device.token },
      { headers: { Origin: srv.baseUrl } }
    );
    assert.equal(replay.status, 401, replay.raw);
    assert.match(String(replay.body.error), /ya usado/);
    assert.equal(setCookies(replay).length, 0, 'un canje fallido no entrega credencial');

    // El registro de dispositivos es del server compartido y otros archivos
    // emparejan en paralelo, así que un conteo global es una carrera. Lo que
    // este caso fija es que el reuso no duplica ni toca el registro existente.
    const after = await srv.request('GET', '/api/pair/devices');
    const ours = after.body.devices.filter((row: any) => row.id === device.deviceId);
    assert.equal(ours.length, 1, 'el reuso no duplica el dispositivo');
    assert.equal(ours[0].lastSeenAt, entryBefore.lastSeenAt, 'el reuso no revalida el registro');
  });

  test('cookie inválida o ausente → 401 con el mismo cuerpo', async () => {
    const invalid = await srv.request('GET', '/api/pair/device', undefined, {
      headers: { Cookie: `${PAIR_DEVICE_COOKIE}=basura` },
    });
    const missing = await srv.request('GET', '/api/pair/device');
    assert.equal(invalid.status, 401, invalid.raw);
    assert.equal(missing.status, 401, missing.raw);
    // Indistinguibles: quien prueba no aprende si el dispositivo existió.
    assert.deepEqual(invalid.body, missing.body);
    assert.equal(invalid.raw.includes('basura'), false);
  });

  test('revocar invalida la cookie en el request siguiente y es idempotente', async () => {
    const revokedDevice = await pairOnce();
    const survivor = await pairOnce();

    const revoked = await srv.request(
      'DELETE',
      `/api/pair/devices/${revokedDevice.deviceId}`,
      undefined,
      { headers: { Origin: srv.baseUrl } }
    );
    assert.equal(revoked.status, 200, revoked.raw);
    assert.equal(revoked.body.success, true);
    assert.equal(typeof revoked.body.device.revokedAt, 'number');

    const after = await srv.request('GET', '/api/pair/device', undefined, {
      headers: { Cookie: revokedDevice.cookie },
    });
    assert.equal(after.status, 401, after.raw);
    assert.equal(after.body.error, 'dispositivo no autorizado');

    // El otro dispositivo no se ve afectado.
    const alive = await srv.request('GET', '/api/pair/device', undefined, {
      headers: { Cookie: survivor.cookie },
    });
    assert.equal(alive.status, 200, alive.raw);
    assert.equal(alive.body.device.id, survivor.deviceId);

    // Repetir la baja mantiene el mismo `revokedAt`; un id inexistente es 404.
    const again = await srv.request(
      'DELETE',
      `/api/pair/devices/${revokedDevice.deviceId}`,
      undefined,
      { headers: { Origin: srv.baseUrl } }
    );
    assert.equal(again.status, 200, again.raw);
    assert.equal(again.body.device.revokedAt, revoked.body.device.revokedAt);

    const unknown = await srv.request('DELETE', '/api/pair/devices/dev_inexistente', undefined, {
      headers: { Origin: srv.baseUrl },
    });
    assert.equal(unknown.status, 404, unknown.raw);

    const listed = await srv.request('GET', '/api/pair/devices');
    const row = listed.body.devices.find((entry: any) => entry.id === revokedDevice.deviceId);
    assert.equal(typeof row.revokedAt, 'number', 'la lista conserva la revocación');
  });

  test('revocar sin Origin se rechaza y la cookie sigue viva', async () => {
    const device = await pairOnce();
    const res = await srv.request('DELETE', `/api/pair/devices/${device.deviceId}`);
    assert.equal(res.status, 403, res.raw);
    assert.match(String(res.body.error), /falta Origin/);

    const alive = await srv.request('GET', '/api/pair/device', undefined, {
      headers: { Cookie: device.cookie },
    });
    assert.equal(alive.status, 200, alive.raw);
  });
});

describe('registro de dispositivos (módulo)', () => {
  test('el tope de activos se respeta y lo revocado libera cupo', () => {
    const previous = process.env.COMMANDER_PAIR_MAX_DEVICES;
    resetPairDevicesForTests();
    process.env.COMMANDER_PAIR_MAX_DEVICES = '2';
    try {
      const first = issuePairDevice();
      const second = issuePairDevice();
      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      assert.deepEqual(issuePairDevice(), { ok: false, reason: 'limit' });

      assert.ok(first.ok);
      revokePairDevice(first.device.id);
      const replacement = issuePairDevice();
      assert.equal(replacement.ok, true, 'revocar libera el cupo del dispositivo');
      assert.deepEqual(issuePairDevice(), { ok: false, reason: 'limit' });

      // El revocado sigue en la lista, con su marca, para poder auditarlo.
      const rows = listPairDevices();
      assert.equal(rows.filter((row) => row.revokedAt === null).length, 2);
      assert.equal(rows.filter((row) => row.revokedAt !== null).length, 1);
    } finally {
      if (previous === undefined) delete process.env.COMMANDER_PAIR_MAX_DEVICES;
      else process.env.COMMANDER_PAIR_MAX_DEVICES = previous;
      resetPairDevicesForTests();
    }
  });

  test('caducar, revocar y adivinar se distinguen en el módulo y no exponen el token', () => {
    resetPairDevicesForTests();
    const issued = issuePairDevice({ now: 1_000, ttlMs: 50, userAgent: 'Mozilla/5.0 (test)' });
    assert.ok(issued.ok);
    assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(issued.device.userAgent, 'Mozilla/5.0 (test)');

    const fresh = resolvePairDevice(issued.token, { now: 1_010, ttlMs: 50 });
    assert.equal(fresh.ok, true);
    assert.equal(fresh.ok && fresh.device.lastSeenAt, 1_010);

    const wrong = resolvePairDevice('token-inventado', { now: 1_010, ttlMs: 50 });
    assert.deepEqual(wrong, { ok: false, reason: 'invalid' });

    const expired = resolvePairDevice(issued.token, { now: 1_100, ttlMs: 50 });
    assert.deepEqual(expired, { ok: false, reason: 'expired' });

    const again = issuePairDevice({ now: 2_000, ttlMs: 60_000 });
    assert.ok(again.ok);
    assert.equal(revokePairDevice(again.device.id, { now: 2_010 })?.revokedAt, 2_010);
    assert.equal(revokePairDevice(again.device.id, { now: 2_020 })?.revokedAt, 2_010);
    assert.deepEqual(resolvePairDevice(again.token, { now: 2_030 }), { ok: false, reason: 'revoked' });
    assert.equal(revokePairDevice('dev_no_existe'), null);

    // La vista pública no lleva hash ni token.
    const dump = JSON.stringify(listPairDevices({ now: 2_030 }));
    assert.equal(dump.includes(again.token), false);
    assert.equal(dump.includes('hash'), false);
    resetPairDevicesForTests();
  });

  test('los revocados se podan al vencer su ventana de idempotencia', () => {
    const previous = process.env.COMMANDER_PAIR_REVOKED_TTL_MS;
    resetPairDevicesForTests();
    process.env.COMMANDER_PAIR_REVOKED_TTL_MS = '1000';
    try {
      const issued = issuePairDevice({ now: 10_000 });
      assert.ok(issued.ok);
      assert.equal(revokePairDevice(issued.device.id, { now: 10_000 })?.revokedAt, 10_000);

      // Dentro de la ventana sigue en el registro y repetir la baja es idempotente.
      const inside = listPairDevices({ now: 10_999 }).find((row) => row.id === issued.device.id);
      assert.ok(inside, 'un revocado reciente se conserva para la baja idempotente');
      assert.equal(revokePairDevice(issued.device.id, { now: 10_500 })?.revokedAt, 10_000);

      // Vencida la ventana, la poda lo saca: ya no autentica ni ocupa memoria.
      assert.equal(
        listPairDevices({ now: 11_000 }).some((row) => row.id === issued.device.id),
        false
      );
      assert.equal(revokePairDevice(issued.device.id, { now: 11_000 }), null);
      assert.deepEqual(resolvePairDevice(issued.token, { now: 11_000, ttlMs: PAIR_DEVICE_TTL_MS }), {
        ok: false,
        reason: 'invalid',
      });
    } finally {
      if (previous === undefined) delete process.env.COMMANDER_PAIR_REVOKED_TTL_MS;
      else process.env.COMMANDER_PAIR_REVOKED_TTL_MS = previous;
      resetPairDevicesForTests();
    }
  });

  test('emparejar y revocar en bucle no acumula revocados', () => {
    const previous = process.env.COMMANDER_PAIR_REVOKED_TTL_MS;
    resetPairDevicesForTests();
    process.env.COMMANDER_PAIR_REVOKED_TTL_MS = '1000';
    try {
      // Seis ciclos de emparejar+revocar con reloj avanzando: sin la poda
      // quedarían seis registros, porque la cookie dura 30 días.
      for (let i = 0; i < 6; i++) {
        const issued = issuePairDevice({ now: 20_000 + i * 500 });
        assert.ok(issued.ok, `ciclo ${i}`);
        revokePairDevice(issued.device.id, { now: 20_000 + i * 500 });
      }
      const rows = listPairDevices({ now: 23_000 });
      assert.equal(rows.length, 1, `sólo el revocado dentro de la ventana sobrevive: ${rows.length}`);
      assert.equal(rows[0].revokedAt, 22_500);

      // La poda no toca a los activos ni a los revocados recientes.
      const active = issuePairDevice({ now: 23_000 });
      assert.ok(active.ok);
      assert.equal(listPairDevices({ now: 23_000 }).length, 2);
    } finally {
      if (previous === undefined) delete process.env.COMMANDER_PAIR_REVOKED_TTL_MS;
      else process.env.COMMANDER_PAIR_REVOKED_TTL_MS = previous;
      resetPairDevicesForTests();
    }
  });

  test('la retención por defecto de un revocado es 24 h, no la vida de la cookie', () => {
    assert.equal(pairDeviceRevokedTtlMs({}), PAIR_DEVICE_REVOKED_RETENTION_MS);
    assert.equal(PAIR_DEVICE_REVOKED_RETENTION_MS, 24 * 60 * 60_000);
    assert.ok(PAIR_DEVICE_REVOKED_RETENTION_MS < PAIR_DEVICE_TTL_MS);
  });

  test('la cookie agrega Secure sólo sobre HTTPS', () => {
    const plain = pairDeviceCookie('tok', { ttlMs: 1_000 });
    assert.equal(plain.includes('Secure'), false);
    assert.match(plain, /^commander_pair=tok; Path=\/; HttpOnly; SameSite=Strict; Max-Age=1$/);
    assert.match(pairDeviceCookie('tok', { secure: true, ttlMs: 1_000 }), /; Secure$/);
  });
});
