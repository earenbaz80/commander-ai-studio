/**
 * Limitador del pair (§6.6 del modelo de amenazas remoto; T2 y T12): ventana
 * fija, presupuesto por caller y global, y `Retry-After` calculado desde lo que
 * falta de la ventana.
 *
 * Es lógica pura con reloj inyectable: la caducidad del enlace se prueba contra
 * un server real en `pairExpiryEndpoint.test.ts`, pero acá el minuto de ventana
 * no se espera.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAIR_RATE_DEFAULT_GLOBAL_MAX,
  PAIR_RATE_DEFAULT_MAX,
  PAIR_RATE_WINDOW_ENV,
  PairRateLimiter,
  type PairRateResult,
  pairRateBudgets,
  pairRateGlobalMax,
  pairRateMax,
  pairRateWindowMs,
} from '../../src/pair/pairRateLimit';

const WINDOW = 60_000;

function limiterAt(start: number, windowMs = WINDOW) {
  let now = start;
  const limiter = new PairRateLimiter({ now: () => now, windowMs });
  return {
    limiter,
    advance(ms: number) {
      now += ms;
    },
    now: () => now,
  };
}

function rejected(result: PairRateResult): Extract<PairRateResult, { ok: false }> {
  assert.equal(result.ok, false, 'se esperaba un rechazo del limitador');
  return result as Extract<PairRateResult, { ok: false }>;
}

describe('presupuesto por caller', () => {
  test('permite hasta el tope y el siguiente intento cae con el Retry-After de la ventana', () => {
    const clock = limiterAt(1_000_000);
    const budgets = { caller: 3, global: 100 };

    for (let i = 0; i < 3; i++) {
      assert.deepEqual(clock.limiter.take('approval', 'device:dev_a', budgets), { ok: true });
    }

    clock.advance(15_000);
    const blocked = rejected(clock.limiter.take('approval', 'device:dev_a', budgets));
    assert.equal(blocked.scope, 'caller');
    assert.equal(blocked.max, 3);
    // Quedan 45 s de la ventana abierta en el primer intento.
    assert.equal(blocked.retryAfterSec, 45);
    assert.equal(blocked.windowMs, WINDOW);
  });

  test('cada caller tiene su bucket; el global es compartido', () => {
    const clock = limiterAt(0);
    const budgets = { caller: 1, global: 100 };

    assert.equal(clock.limiter.take('stream', 'device:dev_a', budgets).ok, true);
    assert.equal(rejected(clock.limiter.take('stream', 'device:dev_a', budgets)).scope, 'caller');
    // Otro dispositivo arranca con su propio contador.
    assert.equal(clock.limiter.take('stream', 'device:dev_b', budgets).ok, true);
  });

  test('el Retry-After nunca baja de 1 s, aunque falte menos de un segundo', () => {
    const clock = limiterAt(5_000);
    const budgets = { caller: 1, global: 100 };
    clock.limiter.take('approval', 'device:dev_a', budgets);
    clock.advance(WINDOW - 200);

    const blocked = rejected(clock.limiter.take('approval', 'device:dev_a', budgets));
    assert.equal(blocked.retryAfterSec, 1);
  });
});

describe('presupuesto global', () => {
  test('corta aunque cada caller esté dentro de su propio tope', () => {
    const clock = limiterAt(0);
    const budgets = { caller: 2, global: 3 };

    assert.equal(clock.limiter.take('approval', 'device:dev_a', budgets).ok, true);
    assert.equal(clock.limiter.take('approval', 'device:dev_a', budgets).ok, true);
    // Tercer intento del proceso: entra por el global, es el último permitido.
    assert.equal(clock.limiter.take('approval', 'device:dev_b', budgets).ok, true);

    const blocked = rejected(clock.limiter.take('approval', 'device:dev_b', budgets));
    assert.equal(blocked.scope, 'global');
    assert.equal(blocked.max, 3);
    assert.ok(blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 60);
  });

  test('el rechazo del global también gasta el bucket del caller', () => {
    const clock = limiterAt(0);
    const budgets = { caller: 10, global: 1 };

    assert.equal(clock.limiter.take('stream', 'device:dev_a', budgets).ok, true);
    assert.equal(rejected(clock.limiter.take('stream', 'device:dev_b', budgets)).scope, 'global');
    assert.deepEqual(clock.limiter.used('stream', 'device:dev_b'), { caller: 1, global: 2 });
  });
});

describe('ventana', () => {
  test('al cumplirse la ventana se reinician los dos contadores', () => {
    const clock = limiterAt(10_000);
    const budgets = { caller: 1, global: 1 };

    assert.equal(clock.limiter.take('redeem', 'ip:127.0.0.1', budgets).ok, true);
    assert.equal(rejected(clock.limiter.take('redeem', 'ip:127.0.0.1', budgets)).scope, 'caller');
    assert.deepEqual(clock.limiter.used('redeem', 'ip:127.0.0.1'), { caller: 2, global: 2 });

    clock.advance(WINDOW);
    assert.equal(clock.limiter.take('redeem', 'ip:127.0.0.1', budgets).ok, true);
    assert.deepEqual(clock.limiter.used('redeem', 'ip:127.0.0.1'), { caller: 1, global: 1 });
  });

  test('los alcances no comparten contador', () => {
    const clock = limiterAt(0);
    const budgets = { caller: 1, global: 100 };

    assert.equal(clock.limiter.take('approval', 'device:dev_a', budgets).ok, true);
    assert.equal(clock.limiter.take('stream', 'device:dev_a', budgets).ok, true);
    assert.equal(clock.limiter.take('redeem', 'device:dev_a', budgets).ok, true);
  });
});

describe('parámetros por entorno', () => {
  test('los topes salen de COMMANDER_PAIR_RATE_* y caen al default si falta o es basura', () => {
    const env = {
      COMMANDER_PAIR_RATE_REDEEM_MAX: '7',
      COMMANDER_PAIR_RATE_REDEEM_GLOBAL_MAX: '30',
      COMMANDER_PAIR_RATE_APPROVAL_MAX: '0',
      [PAIR_RATE_WINDOW_ENV]: '5000',
    };

    assert.equal(pairRateMax('redeem', env), 7);
    assert.equal(pairRateGlobalMax('redeem', env), 30);
    assert.deepEqual(pairRateBudgets('redeem', env), { caller: 7, global: 30 });
    assert.equal(pairRateWindowMs(env), 5_000);

    // Sin valor, un 0 o texto no numérico: el default, nunca desactivado.
    assert.equal(pairRateMax('approval', env), PAIR_RATE_DEFAULT_MAX.approval);
    assert.equal(pairRateMax('approval', {}), PAIR_RATE_DEFAULT_MAX.approval);
    assert.equal(pairRateMax('approval', { COMMANDER_PAIR_RATE_APPROVAL_MAX: 'basura' }), PAIR_RATE_DEFAULT_MAX.approval);
    assert.equal(pairRateGlobalMax('stream', {}), PAIR_RATE_DEFAULT_GLOBAL_MAX.stream);
  });
});
