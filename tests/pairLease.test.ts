/**
 * Control lease de una sesión emparejada (F3, §6.4 del modelo de amenazas).
 *
 * Contra el server compartido se prueba lo que ve el cliente: el primer
 * dispositivo toma el control, el segundo lee pero recibe 409 `LEASE_HELD` al
 * intentar escribir, la renovación exige dueño y `seq` vigente, el traspaso
 * sólo ocurre cuando el dueño lo acepta y la respuesta trae el `ack`, y
 * revocar al dueño devuelve el control al escritorio. La caducidad por reloj
 * se prueba contra el módulo, con `now` inyectado: esperar 60 s en la suite no
 * es una opción.
 *
 * Cada caso usa su propia sesión para no depender del orden entre tests; el
 * server y el registro de dispositivos sí son los compartidos.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type HttpResult, type ServerHarness } from './helpers/serverHarness.js';
import { PAIR_DEVICE_COOKIE } from '../src/pair/pairDevices.js';
import {
  DESKTOP_CONTROLLER,
  PAIR_LEASE_AUDIT_FILE_ENV,
  PAIR_LEASE_AUDIT_MAX_ENTRIES,
  claimPairLease,
  pairLeaseAudit,
  readPairLease,
  renewPairLease,
  resetPairLeasesForTests,
} from '../src/pair/pairLease.js';

let srv: ServerHarness;

function setCookies(res: HttpResult): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

async function createSession(goal: string): Promise<string> {
  const res = await srv.request('POST', '/api/agent/sessions', { goal });
  assert.equal(res.status, 200, res.raw);
  return String(res.body.session.id);
}

/** Emite un enlace y lo canja: devuelve la cookie y el id del dispositivo. */
async function pairDevice(sessionId: string): Promise<{ cookie: string; deviceId: string }> {
  const issued = await srv.request('POST', '/api/pair/issue', { sessionId });
  assert.equal(issued.status, 200, issued.raw);
  const redeemed = await srv.request(
    'POST',
    '/api/pair/redeem',
    { token: issued.body.token },
    { headers: { Origin: srv.baseUrl } }
  );
  assert.equal(redeemed.status, 200, redeemed.raw);
  const header = setCookies(redeemed).find((entry) => entry.startsWith(`${PAIR_DEVICE_COOKIE}=`));
  assert.ok(header, `sin cookie de dispositivo: ${JSON.stringify(redeemed.headers)}`);
  const value = String(header).split(';')[0].slice(PAIR_DEVICE_COOKIE.length + 1);
  return { cookie: `${PAIR_DEVICE_COOKIE}=${value}`, deviceId: String(redeemed.body.device.id) };
}

function post(path: string, sessionId: string, cookie: string | null, body: object = {}) {
  const headers: Record<string, string> = { Origin: srv.baseUrl };
  if (cookie) headers.Cookie = cookie;
  return srv.request('POST', path, { sessionId, ...body }, { headers });
}

function read(sessionId: string, cookie?: string) {
  const options = cookie ? { headers: { Cookie: cookie } } : undefined;
  return srv.request('GET', `/api/pair/lease?sessionId=${encodeURIComponent(sessionId)}`, undefined, options);
}

async function claim(sessionId: string, cookie: string) {
  const res = await post('/api/pair/lease', sessionId, cookie);
  assert.equal(res.status, 200, res.raw);
  return res.body.lease;
}

before(async () => {
  srv = await startServer();
});

after(async () => {
  await srv?.stop();
});

describe('control lease contra el server', () => {
  test('el primer dispositivo escribe; el segundo sólo lee y recibe 409 LEASE_HELD', async () => {
    const sessionId = await createSession('Lease: un solo escritor (F3)');
    const first = await pairDevice(sessionId);
    const second = await pairDevice(sessionId);

    const claimed = await claim(sessionId, first.cookie);
    assert.equal(claimed.deviceId, first.deviceId);
    assert.equal(typeof claimed.seq, 'number');
    assert.equal(typeof claimed.expiresAt, 'number', 'el lease de un dispositivo caduca');
    assert.ok(claimed.expiresAt > claimed.renewedAt);

    // El segundo puede leer el estado y sabe que no le toca escribir.
    const seen = await read(sessionId, second.cookie);
    assert.equal(seen.status, 200, seen.raw);
    assert.equal(seen.body.mine, false);
    assert.equal(seen.body.lease.deviceId, first.deviceId);

    const denied = await post('/api/pair/lease', sessionId, second.cookie);
    assert.equal(denied.status, 409, denied.raw);
    assert.equal(denied.body.code, 'LEASE_HELD');

    // Renovar sin ser el dueño tampoco escribe.
    const renew = await post('/api/pair/lease/renew', sessionId, second.cookie, { seq: claimed.seq });
    assert.equal(renew.status, 409, renew.raw);
    assert.equal(renew.body.code, 'LEASE_HELD');

    // El escritorio (loopback sin cookie) lee y no aparece como dueño.
    const desktop = await read(sessionId);
    assert.equal(desktop.status, 200, desktop.raw);
    assert.equal(desktop.body.desktop, true);
    assert.equal(desktop.body.mine, false);
  });

  test('renovar exige ser el dueño y un seq vigente', async () => {
    const sessionId = await createSession('Lease: renovacion y fencing (F3)');
    const device = await pairDevice(sessionId);
    const claimed = await claim(sessionId, device.cookie);

    const renewed = await post('/api/pair/lease/renew', sessionId, device.cookie, { seq: claimed.seq });
    assert.equal(renewed.status, 200, renewed.raw);
    assert.equal(renewed.body.lease.seq, claimed.seq + 1, 'cada renovación avanza el testigo');
    assert.ok(renewed.body.lease.expiresAt >= claimed.expiresAt, 'renovar no acorta la caducidad');

    // Un mensaje en vuelo con el seq viejo no revive el control cedido.
    const stale = await post('/api/pair/lease/renew', sessionId, device.cookie, { seq: claimed.seq });
    assert.equal(stale.status, 409, stale.raw);
    assert.equal(stale.body.code, 'LEASE_STALE');

    // Sin seq es un pedido inválido, no un lease.
    const missing = await post('/api/pair/lease/renew', sessionId, device.cookie);
    assert.equal(missing.status, 400, missing.raw);
  });

  test('traspaso explícito: pedir no cambia nada y aceptar devuelve el ack', async () => {
    const sessionId = await createSession('Lease: traspaso explicito (F3)');
    const owner = await pairDevice(sessionId);
    const guest = await pairDevice(sessionId);
    const claimed = await claim(sessionId, owner.cookie);

    // Pedir sólo deja la solicitud: el dueño no cambia y el invitado sigue sin escribir.
    const requested = await post('/api/pair/lease/request', sessionId, guest.cookie);
    assert.equal(requested.status, 200, requested.raw);
    assert.equal(requested.body.pending, true);
    assert.equal(requested.body.lease.deviceId, owner.deviceId);
    const stillDenied = await post('/api/pair/lease/renew', sessionId, guest.cookie, {
      seq: requested.body.lease.seq,
    });
    assert.equal(stillDenied.status, 409, stillDenied.raw);
    assert.equal(stillDenied.body.code, 'LEASE_HELD');

    // Sólo el dueño acepta, y con el seq vigente.
    const badSeq = await post('/api/pair/lease/transfer', sessionId, owner.cookie, {
      seq: claimed.seq - 1,
    });
    assert.equal(badSeq.status, 409, badSeq.raw);
    assert.equal(badSeq.body.code, 'LEASE_STALE');

    const notOwner = await post('/api/pair/lease/transfer', sessionId, guest.cookie, {
      seq: requested.body.lease.seq,
    });
    assert.equal(notOwner.status, 409, notOwner.raw);
    assert.equal(notOwner.body.code, 'LEASE_HELD');

    const transferred = await post('/api/pair/lease/transfer', sessionId, owner.cookie, {
      seq: requested.body.lease.seq,
    });
    assert.equal(transferred.status, 200, transferred.raw);
    assert.equal(transferred.body.lease.deviceId, guest.deviceId);
    assert.equal(transferred.body.lease.pending, null);
    assert.deepEqual(
      { deviceId: transferred.body.ack.deviceId, seq: transferred.body.ack.seq },
      { deviceId: guest.deviceId, seq: transferred.body.lease.seq }
    );

    // El nuevo dueño escribe; el anterior ya no, aunque conserve su cookie.
    const renewed = await post('/api/pair/lease/renew', sessionId, guest.cookie, {
      seq: transferred.body.lease.seq,
    });
    assert.equal(renewed.status, 200, renewed.raw);
    const oldOwner = await post('/api/pair/lease/renew', sessionId, owner.cookie, {
      seq: renewed.body.lease.seq,
    });
    assert.equal(oldOwner.status, 409, oldOwner.raw);
    assert.equal(oldOwner.body.code, 'LEASE_HELD');
  });

  test('el traspaso rechaza con 409 un destino inexistente o revocado', async () => {
    const sessionId = await createSession('Lease: destino invalido (F3)');
    const owner = await pairDevice(sessionId);
    const claimed = await claim(sessionId, owner.cookie);

    // Un id inventado no puede recibir el control.
    const unknown = await post('/api/pair/lease/transfer', sessionId, owner.cookie, {
      seq: claimed.seq,
      toDeviceId: 'dev_inexistente_f3',
    });
    assert.equal(unknown.status, 409, unknown.raw);
    assert.equal(unknown.body.code, 'LEASE_TARGET_UNAVAILABLE');
    const afterUnknown = await read(sessionId, owner.cookie);
    assert.equal(afterUnknown.body.lease.deviceId, owner.deviceId);
    assert.equal(afterUnknown.body.lease.seq, claimed.seq, 'un destino inválido no mueve el testigo');

    // Un dispositivo revocado tampoco: el registro manda, no el id que nombre el dueño.
    const doomed = await pairDevice(sessionId);
    const revoked = await srv.request('DELETE', `/api/pair/devices/${doomed.deviceId}`, undefined, {
      headers: { Origin: srv.baseUrl },
    });
    assert.equal(revoked.status, 200, revoked.raw);
    const toRevoked = await post('/api/pair/lease/transfer', sessionId, owner.cookie, {
      seq: claimed.seq,
      toDeviceId: doomed.deviceId,
    });
    assert.equal(toRevoked.status, 409, toRevoked.raw);
    assert.equal(toRevoked.body.code, 'LEASE_TARGET_UNAVAILABLE');
    assert.equal((await read(sessionId, owner.cookie)).body.lease.deviceId, owner.deviceId);

    // Y si el que pidió el traspaso es revocado mientras espera, la baja descarta
    // su solicitud: aceptarla no puede entregar el control a un fantasma.
    const guest = await pairDevice(sessionId);
    const requested = await post('/api/pair/lease/request', sessionId, guest.cookie);
    assert.equal(requested.status, 200, requested.raw);
    const guestRevoked = await srv.request(
      'DELETE',
      `/api/pair/devices/${guest.deviceId}`,
      undefined,
      { headers: { Origin: srv.baseUrl } }
    );
    assert.equal(guestRevoked.status, 200, guestRevoked.raw);
    const accept = await post('/api/pair/lease/transfer', sessionId, owner.cookie, {
      seq: requested.body.lease.seq,
    });
    assert.equal(accept.status, 409, accept.raw);
    assert.equal(accept.body.code, 'LEASE_NO_REQUEST');
    assert.equal((await read(sessionId, owner.cookie)).body.lease.deviceId, owner.deviceId);
  });

  test('sin traspaso pendiente y sin destinatario, aceptar responde 409 LEASE_NO_REQUEST', async () => {
    const sessionId = await createSession('Lease: sin solicitud (F3)');
    const device = await pairDevice(sessionId);
    const claimed = await claim(sessionId, device.cookie);

    const res = await post('/api/pair/lease/transfer', sessionId, device.cookie, { seq: claimed.seq });
    assert.equal(res.status, 409, res.raw);
    assert.equal(res.body.code, 'LEASE_NO_REQUEST');
    assert.equal((await read(sessionId, device.cookie)).body.lease.deviceId, device.deviceId);
  });

  test('liberar devuelve el control al escritorio y lo habilita para otro', async () => {
    const sessionId = await createSession('Lease: liberacion (F3)');
    const first = await pairDevice(sessionId);
    const second = await pairDevice(sessionId);
    const claimed = await claim(sessionId, first.cookie);

    const released = await post('/api/pair/lease/release', sessionId, first.cookie, { seq: claimed.seq });
    assert.equal(released.status, 200, released.raw);
    assert.equal(released.body.lease.deviceId, DESKTOP_CONTROLLER);

    const desktop = await read(sessionId);
    assert.equal(desktop.body.lease.deviceId, DESKTOP_CONTROLLER);
    assert.equal(desktop.body.lease.expiresAt, null, 'el escritorio no caduca');

    const renewal = await post('/api/pair/lease/renew', sessionId, first.cookie, {
      seq: released.body.lease.seq,
    });
    assert.equal(renewal.status, 409, renewal.raw);

    const taken = await claim(sessionId, second.cookie);
    assert.equal(taken.deviceId, second.deviceId);
  });

  test('revocar al dueño devuelve el control al escritorio', async () => {
    const sessionId = await createSession('Lease: revocacion (F3)');
    const owner = await pairDevice(sessionId);
    const other = await pairDevice(sessionId);
    await claim(sessionId, owner.cookie);

    const revoked = await srv.request('DELETE', `/api/pair/devices/${owner.deviceId}`, undefined, {
      headers: { Origin: srv.baseUrl },
    });
    assert.equal(revoked.status, 200, revoked.raw);

    const after = await read(sessionId, other.cookie);
    assert.equal(after.status, 200, after.raw);
    assert.equal(after.body.lease.deviceId, DESKTOP_CONTROLLER);

    // La cookie revocada ya no autentica, y el otro puede tomar el control.
    const revokedCookie = await read(sessionId, owner.cookie);
    assert.equal(revokedCookie.status, 401, revokedCookie.raw);
    assert.equal((await claim(sessionId, other.cookie)).deviceId, other.deviceId);
  });

  test('las mutaciones del lease exigen Origin y cookie válida', async () => {
    const sessionId = await createSession('Lease: guardas (F3)');
    const device = await pairDevice(sessionId);

    const noOrigin = await srv.request(
      'POST',
      '/api/pair/lease',
      { sessionId },
      { headers: { Cookie: device.cookie } }
    );
    assert.equal(noOrigin.status, 403, noOrigin.raw);
    assert.match(String(noOrigin.body.error), /falta Origin/);

    const noCookie = await srv.request(
      'POST',
      '/api/pair/lease',
      { sessionId },
      { headers: { Origin: srv.baseUrl } }
    );
    assert.equal(noCookie.status, 401, noCookie.raw);

    const badCookie = await read(sessionId, `${PAIR_DEVICE_COOKIE}=basura`);
    assert.equal(badCookie.status, 401, badCookie.raw);
    assert.equal(badCookie.body.error, 'dispositivo no autorizado');

    // El historial es del escritorio: loopback lo ve, con los eventos del caso.
    const audit = await srv.request('GET', `/api/pair/lease/audit?sessionId=${encodeURIComponent(sessionId)}`);
    assert.equal(audit.status, 200, audit.raw);
    assert.equal(Array.isArray(audit.body.entries), true);

    const badSession = await read('sess_inexistente_f3');
    assert.equal(badSession.status, 404, badSession.raw);
  });

  test('la escritura de sesión exige el control y el seq vigente', async () => {
    const sessionId = await createSession('Lease: escritura de sesion (F3)');
    const owner = await pairDevice(sessionId);
    const guest = await pairDevice(sessionId);

    // La escritura real es POST /message: sin control no se añade ningún turno.
    const write = (cookie: string | null, body: object = {}) =>
      srv.request(
        'POST',
        `/api/agent/sessions/${sessionId}/message`,
        { text: 'turno del dispositivo', ...body },
        cookie ? { headers: { Cookie: cookie } } : undefined
      );

    // Sin reclamar, el lease está en el escritorio: un dispositivo no escribe.
    const unclaimed = await write(guest.cookie);
    assert.equal(unclaimed.status, 409, unclaimed.raw);
    assert.equal(unclaimed.body.code, 'LEASE_HELD');

    const claimed = await claim(sessionId, owner.cookie);

    // El otro dispositivo lee el estado pero no escribe.
    const held = await write(guest.cookie, { seq: claimed.seq });
    assert.equal(held.status, 409, held.raw);
    assert.equal(held.body.code, 'LEASE_HELD');

    // El escritorio tampoco: con el control en un dispositivo hay un solo escritor.
    const desktop = await write(null, { seq: claimed.seq });
    assert.equal(desktop.status, 409, desktop.raw);
    assert.equal(desktop.body.code, 'LEASE_HELD');

    // El dueño necesita el seq vigente; sin él o con uno viejo no revive el control.
    const stale = await write(owner.cookie, { seq: claimed.seq - 1 });
    assert.equal(stale.status, 409, stale.raw);
    assert.equal(stale.body.code, 'LEASE_STALE');

    const missing = await write(owner.cookie);
    assert.equal(missing.status, 409, missing.raw);
    assert.equal(missing.body.code, 'LEASE_STALE');

    // Renovar mueve el testigo: el seq anterior deja de servir.
    const renewed = await post('/api/pair/lease/renew', sessionId, owner.cookie, { seq: claimed.seq });
    assert.equal(renewed.status, 200, renewed.raw);
    const afterRenew = await write(owner.cookie, { seq: claimed.seq });
    assert.equal(afterRenew.status, 409, afterRenew.raw);
    assert.equal(afterRenew.body.code, 'LEASE_STALE');

    // Con el seq vigente la escritura entra y el turno queda en la sesión.
    const accepted = await write(owner.cookie, { seq: renewed.body.lease.seq });
    assert.equal(accepted.status, 202, accepted.raw);
    const acceptedTurns = (accepted.body.state?.turns ?? []).filter(
      (turn: any) => turn.text === 'turno del dispositivo'
    );
    assert.equal(acceptedTurns.length, 1);

    // Ninguna tentativa rechazada dejó turno: sólo la autorizada escribió.
    const state = await srv.request('GET', `/api/agent/sessions/${sessionId}`);
    assert.equal(state.status, 200, state.raw);
    const stored = (state.body.state?.turns ?? []).filter(
      (turn: any) => turn.text === 'turno del dispositivo'
    );
    assert.equal(stored.length, 1, 'sólo la petición autorizada añade el turno');
  });
});

describe('control lease (módulo)', () => {
  test('la caducidad devuelve el control al escritorio y queda auditada', () => {
    // Aislado: el reset ya no borra el archivo por defecto, así que sin override
    // este caso leería y ensuciaría el historial real del proyecto.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-lease-expiry-'));
    const previous = process.env[PAIR_LEASE_AUDIT_FILE_ENV];
    process.env[PAIR_LEASE_AUDIT_FILE_ENV] = path.join(dir, 'lease-audit.jsonl');
    resetPairLeasesForTests();
    try {
      const claimed = claimPairLease('sess_demo', 'dev_a', { now: 1_000, ttlMs: 1_000 });
      assert.equal(claimed.ok, true);

      // Antes del TTL sigue vivo.
      assert.equal(readPairLease('sess_demo', { now: 1_900 }).deviceId, 'dev_a');

      // Al vencer, el escritorio recupera el control y el seq avanza.
      const expired = readPairLease('sess_demo', { now: 2_000 });
      assert.equal(expired.deviceId, DESKTOP_CONTROLLER);
      assert.equal(expired.expiresAt, null);
      assert.equal(expired.seq, claimed.ok ? claimed.lease.seq + 1 : -1);

      const actions = pairLeaseAudit('sess_demo').map((entry) => entry.action);
      assert.deepEqual(actions, ['claimed', 'expired']);

      // Renovar después de caducar no resucita el lease: primero hay que tomarlo.
      const renew = renewPairLease('sess_demo', 'dev_a', expired.seq, { now: 2_100, ttlMs: 1_000 });
      assert.deepEqual(renew, { ok: false, reason: 'held' });

      // Reclamarlo de nuevo funciona y la auditoría conserva el historial.
      const again = claimPairLease('sess_demo', 'dev_b', { now: 3_000, ttlMs: 1_000 });
      assert.equal(again.ok, true);
      assert.equal(pairLeaseAudit('sess_demo').length, 3);
    } finally {
      if (previous === undefined) delete process.env[PAIR_LEASE_AUDIT_FILE_ENV];
      else process.env[PAIR_LEASE_AUDIT_FILE_ENV] = previous;
      resetPairLeasesForTests();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('la auditoría se persiste en disco, se relee y respeta el tope', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-lease-audit-'));
    const file = path.join(dir, 'lease-audit.jsonl');
    const previous = process.env[PAIR_LEASE_AUDIT_FILE_ENV];
    process.env[PAIR_LEASE_AUDIT_FILE_ENV] = file;
    try {
      resetPairLeasesForTests();
      const claimed = claimPairLease('sess_persist', 'dev_a', { now: 1_000, ttlMs: 1_000 });
      assert.equal(claimed.ok, true);

      // El evento quedó en disco como una línea JSON, sin secretos.
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      assert.equal(lines.length, 1);
      const entry = JSON.parse(lines[0]);
      assert.deepEqual(
        { action: entry.action, deviceId: entry.deviceId, sessionId: entry.sessionId },
        { action: 'claimed', deviceId: 'dev_a', sessionId: 'sess_persist' }
      );
      assert.equal(JSON.stringify(entry).includes('token'), false, 'la auditoría no guarda secretos');

      // Reinicio: memoria vacía y disco intacto → la lectura recupera el historial.
      resetPairLeasesForTests({ keepAuditFile: true });
      assert.deepEqual(pairLeaseAudit('sess_persist').map((row) => row.action), ['claimed']);

      // El tope también rige en disco: se reescribe, no se acumula sin límite.
      const again = claimPairLease('sess_persist', 'dev_a', { now: 2_000, ttlMs: 10_000_000 });
      assert.equal(again.ok, true);
      let seq = again.ok ? again.lease.seq : -1;
      for (let i = 0; i < PAIR_LEASE_AUDIT_MAX_ENTRIES + 20; i++) {
        const renewed = renewPairLease('sess_persist', 'dev_a', seq, { now: 2_001 + i, ttlMs: 10_000_000 });
        assert.equal(renewed.ok, true);
        seq = renewed.ok ? renewed.lease.seq : -1;
      }
      const capped = fs.readFileSync(file, 'utf8').trim().split('\n');
      assert.equal(capped.length, PAIR_LEASE_AUDIT_MAX_ENTRIES);
      assert.equal(JSON.parse(capped.at(-1)!).action, 'renewed');
    } finally {
      if (previous === undefined) delete process.env[PAIR_LEASE_AUDIT_FILE_ENV];
      else process.env[PAIR_LEASE_AUDIT_FILE_ENV] = previous;
      resetPairLeasesForTests();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reset no borra la auditoría real cuando la ruta es la de por defecto', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-lease-default-'));
    const defaultFile = path.join(dir, '.commander', 'pair', 'lease-audit.jsonl');
    const previousEnv = process.env[PAIR_LEASE_AUDIT_FILE_ENV];
    const previousCwd = process.cwd();
    delete process.env[PAIR_LEASE_AUDIT_FILE_ENV];
    fs.mkdirSync(path.dirname(defaultFile), { recursive: true });
    fs.writeFileSync(
      defaultFile,
      `${JSON.stringify({ at: 1_000, sessionId: 'sess_real', action: 'claimed', deviceId: 'dev_real', seq: 1 })}\n`,
      'utf8'
    );
    try {
      // La ruta por defecto cuelga del cwd: aquí es un temporal, no el .commander real.
      process.chdir(dir);
      resetPairLeasesForTests();
      assert.equal(fs.existsSync(defaultFile), true, 'el historial real sobrevive al reset');
      assert.deepEqual(
        pairLeaseAudit('sess_real').map((row) => row.action),
        ['claimed'],
        'y se relee del disco en vez de darse por vacío'
      );
    } finally {
      process.chdir(previousCwd);
      if (previousEnv === undefined) delete process.env[PAIR_LEASE_AUDIT_FILE_ENV];
      else process.env[PAIR_LEASE_AUDIT_FILE_ENV] = previousEnv;
      resetPairLeasesForTests();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
