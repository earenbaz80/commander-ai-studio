/**
 * Rate limit del canje y del presupuesto global, contra un server propio (F3,
 * T2 y T12 del modelo de amenazas remoto).
 *
 * No usa el server compartido porque los topes son variables de entorno del
 * proceso (`COMMANDER_PAIR_RATE_*`) y el compartido es uno solo para toda la
 * corrida: bajarlos ahí afectaría a los demás archivos. Es el mismo motivo por el
 * que `pairExpiryEndpoint` levanta su propio server con otro TTL.
 *
 * El caso por dispositivo de approvals y stream vive en
 * `pairRateLimitEndpoint.test.ts`, sobre el server compartido.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;
let sessionId: string;

before(async () => {
  srv = await spawnServer({
    env: {
      // El canje cuenta sólo fallos: 3 es el tope por IP.
      COMMANDER_PAIR_RATE_REDEEM_MAX: '3',
      COMMANDER_PAIR_RATE_REDEEM_GLOBAL_MAX: '100',
      // El global se prueba con approvals, donde el tope por dispositivo es alto
      // para que corte el global y no el del caller.
      COMMANDER_PAIR_RATE_APPROVAL_MAX: '100',
      COMMANDER_PAIR_RATE_APPROVAL_GLOBAL_MAX: '2',
    },
  });
  const created = await srv.request('POST', '/api/agent/sessions', { goal: 'Rate limit de canje (F3)' });
  assert.equal(created.status, 200, created.raw);
  sessionId = String(created.body.session.id);
});

after(async () => {
  await srv?.stop();
});

function redeem(token: unknown) {
  return srv.request('POST', '/api/pair/redeem', { token }, { headers: { Origin: srv.baseUrl } });
}

async function pairedDevice(): Promise<string> {
  const issued = await srv.request('POST', '/api/pair/issue', { sessionId });
  assert.equal(issued.status, 200, issued.raw);
  const redeemed = await redeem(issued.body.token);
  assert.equal(redeemed.status, 200, redeemed.raw);
  const raw = redeemed.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [String(raw ?? '')];
  const cookie = cookies
    .map((entry) => entry.split(';')[0])
    .find((entry) => entry.startsWith('commander_pair='));
  assert.ok(cookie, 'el canje tiene que devolver la cookie del dispositivo');
  return cookie as string;
}

describe('canje (T2)', () => {
  test('tras agotar los intentos fallidos responde 429 con Retry-After', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await redeem('token-que-no-existe');
      assert.equal(res.status, 410, `el fallo ${i + 1} debía ser 410: ${res.raw}`);
      assert.equal(res.body.error, 'enlace inválido o caducado');
    }

    const limited = await redeem('token-que-no-existe');
    assert.equal(limited.status, 429, limited.raw);
    assert.equal(limited.body.code, 'PAIR_RATE_LIMITED');
    assert.equal(limited.body.scope, 'caller');
    assert.equal(limited.body.max, 3);
    const retryAfter = Number(limited.headers['retry-after']);
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, `Retry-After inválido: ${limited.headers['retry-after']}`);
    assert.equal(limited.body.retryAfterSec, retryAfter);
    assert.match(String(limited.headers['cache-control']), /no-store/);
  });

  test('el dueño sigue canjeando: un enlace válido no cuenta ni queda fuera', async () => {
    // La ventana de fallos está agotada para esta IP; el canje legítimo entra.
    const cookie = await pairedDevice();
    assert.match(cookie, /^commander_pair=/);
  });
});

describe('presupuesto global (T12)', () => {
  test('corta aunque cada dispositivo esté dentro de su tope', async () => {
    const first = await pairedDevice();
    const second = await pairedDevice();

    const one = await srv.request(
      'POST',
      `/api/agent/sessions/${sessionId}/approvals/apr_inexistente`,
      { decision: 'allow' },
      { headers: { Cookie: first } }
    );
    assert.notEqual(one.status, 429, one.raw);
    assert.equal(one.status, 409, one.raw);

    const two = await srv.request(
      'POST',
      `/api/agent/sessions/${sessionId}/approvals/apr_inexistente`,
      { decision: 'allow' },
      { headers: { Cookie: second } }
    );
    assert.notEqual(two.status, 429, two.raw);

    // Tercer intento del proceso: el global (2) ya se gastó.
    const limited = await srv.request(
      'POST',
      `/api/agent/sessions/${sessionId}/approvals/apr_inexistente`,
      { decision: 'allow' },
      { headers: { Cookie: first } }
    );
    assert.equal(limited.status, 429, limited.raw);
    assert.equal(limited.body.code, 'PAIR_RATE_LIMITED');
    assert.equal(limited.body.scope, 'global');
    assert.equal(limited.body.max, 2);
    const retryAfter = Number(limited.headers['retry-after']);
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, `Retry-After inválido: ${limited.headers['retry-after']}`);
  });
});
