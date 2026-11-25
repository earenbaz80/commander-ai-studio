/**
 * Tokens de emparejamiento (F3): 256 bits, un solo uso, 5 minutos.
 *
 * Estos casos son de la pieza pura, sin HTTP: la caducidad se prueba con el
 * reloj inyectado, así que no hay esperas ni márgenes de sleep.
 */
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  hashPairToken,
  issuePairToken,
  PAIR_TOKEN_BYTES,
  PAIR_TOKEN_TTL_MS,
  pairTokenStats,
  pairTokenTtlMs,
  redeemPairToken,
  resetPairTokensForTests,
} from '../src/pair/pairTokens.js';

beforeEach(() => resetPairTokensForTests());

describe('almacén de tokens de pair', () => {
  test('el token es opaco, base64url y de 256 bits', () => {
    const { token } = issuePairToken('sess_a');
    assert.equal(token.length, 43, '32 bytes en base64url son 43 caracteres');
    assert.match(token, /^[A-Za-z0-9_-]+$/, 'sin caracteres fuera de base64url');
    assert.equal(Buffer.from(token, 'base64url').length, PAIR_TOKEN_BYTES);
    assert.equal(PAIR_TOKEN_BYTES * 8, 256);
    // Dos emisiones no repiten token.
    assert.notEqual(issuePairToken('sess_a').token, token);
  });

  test('sólo se guarda el SHA-256, nunca el token en claro', () => {
    const { token } = issuePairToken('sess_b');
    const [entry] = pairTokenStats().live;
    assert.equal(entry.hash, createHash('sha256').update(token).digest('hex'));
    assert.equal(entry.hash, hashPairToken(token));
    assert.equal(entry.sessionId, 'sess_b');
    // La vista del almacén no contiene el token ni parte de él.
    assert.equal(JSON.stringify(pairTokenStats()).includes(token), false);
  });

  test('el primer canje devuelve la sesión y el segundo es reutilización', () => {
    const { token } = issuePairToken('sess_c', { now: 1_000 });
    assert.deepEqual(redeemPairToken(token, { now: 1_001 }), { ok: true, sessionId: 'sess_c' });
    assert.deepEqual(redeemPairToken(token, { now: 1_002 }), { ok: false, reason: 'used' });
    // El segundo intento no reintroduce nada en el almacén vivo.
    assert.equal(pairTokenStats().live.length, 0);
  });

  test('caduca a los 5 minutos exactos y un token viejo se comporta como desconocido', () => {
    const { token, expiresAt } = issuePairToken('sess_d', { now: 10_000 });
    assert.equal(expiresAt - 10_000, PAIR_TOKEN_TTL_MS);

    const justBefore = redeemPairToken(token, { now: expiresAt - 1 });
    assert.deepEqual(justBefore, { ok: true, sessionId: 'sess_d' });

    const other = issuePairToken('sess_e', { now: 20_000 }).token;
    // Justo en el vencimiento ya no vale: `now >= expiresAt`.
    assert.deepEqual(redeemPairToken(other, { now: 20_000 + PAIR_TOKEN_TTL_MS }), {
      ok: false,
      reason: 'invalid',
    });
    // Y no se distingue de un token que nunca existió.
    assert.deepEqual(redeemPairToken('token-que-nunca-existio', { now: 30_000 }), {
      ok: false,
      reason: 'invalid',
    });
  });

  test('el canje de un token vacío o gigante no toca el almacén', () => {
    issuePairToken('sess_f');
    for (const bad of ['', '   ', 'x'.repeat(513), null, 42]) {
      assert.deepEqual(redeemPairToken(bad as unknown), { ok: false, reason: 'invalid' });
    }
    assert.equal(pairTokenStats().live.length, 1, 'el enlace válido sigue vivo');
  });

  test('el TTL se puede bajar por entorno sólo para pruebas', () => {
    assert.equal(pairTokenTtlMs({ COMMANDER_PAIR_TTL_MS: '1000' }), 1000);
    assert.equal(pairTokenTtlMs({ COMMANDER_PAIR_TTL_MS: '0' }), PAIR_TOKEN_TTL_MS);
    assert.equal(pairTokenTtlMs({ COMMANDER_PAIR_TTL_MS: 'basura' }), PAIR_TOKEN_TTL_MS);
    assert.equal(pairTokenTtlMs({}), PAIR_TOKEN_TTL_MS);
  });

  test('emitir exige sesión', () => {
    assert.throws(() => issuePairToken(''), /sessionId requerido/);
  });
});
