/**
 * Limitador del pair (§6.6 del modelo de amenazas remoto; T2 y T12): ventana
 * fija, presupuesto por caller y global, y `Retry-After` calculado desde lo que
 * falta de la ventana.
 *
 * Es lógica pura con reloj inyectable: la caducidad del enlace se prueba contra
 * un server real en `pairExpiryEndpoint.test.ts`, pero acá el minuto de ventana
 * no se espera.
 */
import { describe, expect, it } from 'vitest';
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
  expect(result.ok, 'se esperaba un rechazo del limitador').toBe(false);
  return result as Extract<PairRateResult, { ok: false }>;
}

describe('presupuesto por caller', () => {
  it('permite hasta el tope y el siguiente intento cae con el Retry-After de la ventana', () => {
    const clock = limiterAt(1_000_000);
    const budgets = { caller: 3, global: 100 };

    for (let i = 0; i < 3; i++) {
      expect(clock.limiter.take('approval', 'device:dev_a', budgets)).toEqual({ ok: true });
    }

    clock.advance(15_000);
    const blocked = rejected(clock.limiter.take('approval', 'device:dev_a', budgets));
    expect(blocked.scope).toBe('caller');
    expect(blocked.max).toBe(3);
    // Quedan 45 s de la ventana abierta en el primer intento.
    expect(blocked.retryAfterSec).toBe(45);
    expect(blocked.windowMs).toBe(WINDOW);
  });

  it('cada caller tiene su bucket; el global es compartido', () => {
    const clock = limiterAt(0);
    const budgets = { caller: 1, global: 100 };

    expect(clock.limiter.take('stream', 'device:dev_a', budgets).ok).toBe(true);
    expect(rejected(clock.limiter.take('stream', 'device:dev_a', budgets)).scope).toBe('caller');
    // Otro dispositivo arranca con su propio contador.
    expect(clock.limiter.take('stream', 'device:dev_b', budgets).ok).toBe(true);
  });

  it('el Retry-After nunca baja de 1 s, aunque falte menos de un segundo', () => {
    const clock = limiterAt(5_000);
    const budgets = { caller: 1, global: 100 };
    clock.limiter.take('approval', 'device:dev_a', budgets);
    clock.advance(WINDOW - 200);

    const blocked = rejected(clock.limiter.take('approval', 'device:dev_a', budgets));
    expect(blocked.retryAfterSec).toBe(1);
  });
});

describe('presupuesto global', () => {
  it('corta aunque cada caller esté dentro de su propio tope', () => {
    const clock = limiterAt(0);
    const budgets = { caller: 2, global: 3 };

    expect(clock.limiter.take('approval', 'device:dev_a', budgets).ok).toBe(true);
    expect(clock.limiter.take('approval', 'device:dev_a', budgets).ok).toBe(true);
    // Tercer intento del proceso: entra por el global, es el último permitido.
    expect(clock.limiter.take('approval', 'device:dev_b', budgets).ok).toBe(true);

    const blocked = rejected(clock.limiter.take('approval', 'device:dev_b', budgets));
    expect(blocked.scope).toBe('global');
    expect(blocked.max).toBe(3);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('el rechazo del global también gasta el bucket del caller', () => {
    const clock = limiterAt(0);
    const budgets = { caller: 10, global: 1 };

    expect(clock.limiter.take('stream', 'device:dev_a', budgets).ok).toBe(true);
    expect(rejected(clock.limiter.take('stream', 'device:dev_b', budgets)).scope).toBe('global');
    expect(clock.limiter.used('stream', 'device:dev_b')).toEqual({ caller: 1, global: 2 });
  });
});

describe('ventana', () => {
  it('al cumplirse la ventana se reinician los dos contadores', () => {
    const clock = limiterAt(10_000);
    const budgets = { caller: 1, global: 1 };

    expect(clock.limiter.take('redeem', 'ip:127.0.0.1', budgets).ok).toBe(true);
    expect(rejected(clock.limiter.take('redeem', 'ip:127.0.0.1', budgets)).scope).toBe('caller');
    expect(clock.limiter.used('redeem', 'ip:127.0.0.1')).toEqual({ caller: 2, global: 2 });

    clock.advance(WINDOW);
    expect(clock.limiter.take('redeem', 'ip:127.0.0.1', budgets).ok).toBe(true);
    expect(clock.limiter.used('redeem', 'ip:127.0.0.1')).toEqual({ caller: 1, global: 1 });
  });

  it('los alcances no comparten contador', () => {
    const clock = limiterAt(0);
    const budgets = { caller: 1, global: 100 };

    expect(clock.limiter.take('approval', 'device:dev_a', budgets).ok).toBe(true);
    expect(clock.limiter.take('stream', 'device:dev_a', budgets).ok).toBe(true);
    expect(clock.limiter.take('redeem', 'device:dev_a', budgets).ok).toBe(true);
  });
});

describe('parámetros por entorno', () => {
  it('los topes salen de COMMANDER_PAIR_RATE_* y caen al default si falta o es basura', () => {
    const env = {
      COMMANDER_PAIR_RATE_REDEEM_MAX: '7',
      COMMANDER_PAIR_RATE_REDEEM_GLOBAL_MAX: '30',
      COMMANDER_PAIR_RATE_APPROVAL_MAX: '0',
      [PAIR_RATE_WINDOW_ENV]: '5000',
    };

    expect(pairRateMax('redeem', env)).toBe(7);
    expect(pairRateGlobalMax('redeem', env)).toBe(30);
    expect(pairRateBudgets('redeem', env)).toEqual({ caller: 7, global: 30 });
    expect(pairRateWindowMs(env)).toBe(5_000);

    // Sin valor, un 0 o texto no numérico: el default, nunca desactivado.
    expect(pairRateMax('approval', env)).toBe(PAIR_RATE_DEFAULT_MAX.approval);
    expect(pairRateMax('approval', {})).toBe(PAIR_RATE_DEFAULT_MAX.approval);
    expect(pairRateMax('approval', { COMMANDER_PAIR_RATE_APPROVAL_MAX: 'basura' })).toBe(
      PAIR_RATE_DEFAULT_MAX.approval
    );
    expect(pairRateGlobalMax('stream', {})).toBe(PAIR_RATE_DEFAULT_GLOBAL_MAX.stream);
  });
});
