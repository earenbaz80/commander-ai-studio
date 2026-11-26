/**
 * Cupo de streams vivos (T12, §6.6).
 *
 * El registro no cuenta aperturas —eso lo hace el rate limit— sino conexiones
 * que siguen abiertas. Lo que se prueba acá es que un caller no pueda acaparar
 * el proceso, que el global corte aunque cada caller tenga cupo, y que liberar
 * sea idempotente: el `close` de un socket puede llegar más de una vez y un
 * doble `release` no debe regalar cupo.
 */
import { describe, expect, it } from 'vitest';
import {
  PAIR_STREAM_ACTIVE_DEFAULT_GLOBAL_MAX,
  PAIR_STREAM_ACTIVE_DEFAULT_MAX,
  PairStreamCapacity,
  pairStreamActiveGlobalMax,
  pairStreamActiveMax,
} from '../../src/pair/pairStreamCapacity';

describe('PairStreamCapacity', () => {
  it('corta al caller en su cupo y no consume nada al rechazar', () => {
    const capacity = new PairStreamCapacity({ maxPerCaller: 2, maxGlobal: 10 });
    const a = capacity.acquire('device:a');
    const b = capacity.acquire('device:a');
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const third = capacity.acquire('device:a');
    expect(third).toEqual({ ok: false, scope: 'caller', max: 2 });
    expect(capacity.snapshot('device:a')).toEqual({ caller: 2, global: 2 });

    // Otro caller no paga el rechazo del primero.
    const other = capacity.acquire('device:b');
    expect(other.ok).toBe(true);
    expect(capacity.snapshot('device:b')).toEqual({ caller: 1, global: 3 });
  });

  it('el global corta aunque cada caller tenga cupo', () => {
    const capacity = new PairStreamCapacity({ maxPerCaller: 4, maxGlobal: 2 });
    expect(capacity.acquire('desktop').ok).toBe(true);
    expect(capacity.acquire('device:a').ok).toBe(true);

    const blocked = capacity.acquire('device:b');
    expect(blocked).toEqual({ ok: false, scope: 'global', max: 2 });
    expect(capacity.snapshot('device:b')).toEqual({ caller: 0, global: 2 });
  });

  it('liberar devuelve el cupo una sola vez', () => {
    const capacity = new PairStreamCapacity({ maxPerCaller: 1, maxGlobal: 2 });
    const slot = capacity.acquire('desktop');
    expect(slot.ok).toBe(true);
    if (!slot.ok) return;

    slot.release();
    slot.release();
    expect(capacity.snapshot('desktop')).toEqual({ caller: 0, global: 0 });

    // Con el cupo devuelto, el siguiente entra.
    const next = capacity.acquire('desktop');
    expect(next.ok).toBe(true);
    if (next.ok) next.release();
  });

  it('lee los topes del entorno y cae en defaults sanos con basura', () => {
    expect(pairStreamActiveMax({})).toBe(PAIR_STREAM_ACTIVE_DEFAULT_MAX);
    expect(pairStreamActiveGlobalMax({})).toBe(PAIR_STREAM_ACTIVE_DEFAULT_GLOBAL_MAX);
    expect(pairStreamActiveMax({ COMMANDER_PAIR_STREAM_ACTIVE_MAX: '9' })).toBe(9);
    expect(
      pairStreamActiveGlobalMax({ COMMANDER_PAIR_STREAM_ACTIVE_GLOBAL_MAX: '40' })
    ).toBe(40);
    expect(pairStreamActiveMax({ COMMANDER_PAIR_STREAM_ACTIVE_MAX: '0' })).toBe(
      PAIR_STREAM_ACTIVE_DEFAULT_MAX
    );
    expect(pairStreamActiveGlobalMax({ COMMANDER_PAIR_STREAM_ACTIVE_GLOBAL_MAX: 'basura' })).toBe(
      PAIR_STREAM_ACTIVE_DEFAULT_GLOBAL_MAX
    );
  });
});
