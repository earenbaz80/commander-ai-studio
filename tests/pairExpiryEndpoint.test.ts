/**
 * Caducidad del enlace de pair contra un server real (F3).
 *
 * No usa el server compartido porque el TTL es una variable de entorno del
 * proceso (`COMMANDER_PAIR_TTL_MS`) y el compartido es uno solo para toda la
 * corrida: bajarlo ahí afectaría a los demás archivos. Es el mismo motivo por
 * el que `mcpHealthEndpoint` levanta su propio server con otra config. Acá no
 * hay `sleep` fijo para «esperar a que esté listo»: el arnés ya espera el
 * puerto, `/api/health` y cada petición.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;
let sessionId: string;

before(async () => {
  srv = await spawnServer({ env: { COMMANDER_PAIR_TTL_MS: '1' } });
  const res = await srv.request('POST', '/api/agent/sessions', { goal: 'Caducidad de pair (F3)' });
  assert.equal(res.status, 200, res.raw);
  sessionId = String(res.body.session.id);
});

after(async () => {
  await srv?.stop();
});

describe('caducidad del enlace de pair', () => {
  test('un enlace vencido responde 410 con el mismo cuerpo que uno desconocido', async () => {
    const issued = await srv.request('POST', '/api/pair/issue', { sessionId });
    assert.equal(issued.status, 200, issued.raw);
    assert.equal(issued.body.ttlMs, 1);
    assert.equal(issued.body.sessionId, sessionId);
    assert.ok(issued.body.expiresAt <= Date.now() + 50, 'el TTL de prueba es de 1 ms');

    // Se deja pasar el milisegundo de vida del token.
    await new Promise((resolve) => setTimeout(resolve, 15));

    const expired = await srv.request('POST', '/api/pair/redeem', { token: issued.body.token }, {
      headers: { Origin: srv.baseUrl },
    });
    assert.equal(expired.status, 410, expired.raw);
    assert.equal(expired.body.error, 'enlace inválido o caducado');

    const unknown = await srv.request('POST', '/api/pair/redeem', { token: 'jamas-existio' }, {
      headers: { Origin: srv.baseUrl },
    });
    assert.equal(unknown.status, 410, unknown.raw);
    // Indistinguibles: quien prueba no aprende si el token existió.
    assert.deepEqual(expired.body, unknown.body);
    assert.equal(expired.raw.includes(issued.body.token), false);
  });
});
