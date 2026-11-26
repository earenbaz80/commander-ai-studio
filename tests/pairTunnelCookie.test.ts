/**
 * `Secure` de la cookie con túnel (G2 C3, §6.2 del modelo de amenazas).
 *
 * El túnel termina TLS y reenvía al server local con `X-Forwarded-Proto:
 * https`; Express sigue viendo `http`, así que sin esta cabecera la cookie
 * viajaría sin `Secure` sobre un enlace HTTPS. El caso de un peer que no es
 * loopback (cabecera no confiable) se cubre en `tests/unit/pairCookieSecure`.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type ServerHarness, type HttpResult } from './helpers/serverHarness.js';

let srv: ServerHarness;
let sessionId: string;

function cookieHeader(res: HttpResult): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const header = list.find((entry) => entry.startsWith('commander_pair='));
  assert.ok(header, `el canje no devolvió la cookie: ${JSON.stringify(res.headers)}`);
  return String(header);
}

async function redeemOnce(headers: Record<string, string>): Promise<HttpResult> {
  const issued = await srv.request('POST', '/api/pair/issue', { sessionId });
  assert.equal(issued.status, 200, issued.raw);
  return srv.request('POST', '/api/pair/redeem', { token: issued.body.token }, {
    headers: { Origin: srv.baseUrl, ...headers },
  });
}

before(async () => {
  srv = await startServer();
  const res = await srv.request('POST', '/api/agent/sessions', {
    goal: 'Sesión para Secure detrás del túnel (G2 C3)',
  });
  assert.equal(res.status, 200, res.raw);
  sessionId = String(res.body.session.id);
});

after(async () => {
  await srv?.stop();
});

describe('cookie Secure detrás del túnel', () => {
  test('con X-Forwarded-Proto https desde loopback, la cookie sale Secure', async () => {
    const redeemed = await redeemOnce({ 'X-Forwarded-Proto': 'https' });
    assert.equal(redeemed.status, 200, redeemed.raw);
    assert.match(cookieHeader(redeemed), /; Secure/);
  });

  test('sin túnel, sobre http, la cookie no lleva Secure', async () => {
    const redeemed = await redeemOnce({});
    assert.equal(redeemed.status, 200, redeemed.raw);
    assert.doesNotMatch(cookieHeader(redeemed), /; Secure/);
  });
});
