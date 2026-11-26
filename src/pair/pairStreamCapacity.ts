/**
 * Cupo de streams SSE **vivos** por caller y por proceso (T12, §6.6).
 *
 * El rate limit cuenta aperturas por minuto; una sola apertura puede quedarse
 * colgada horas. Este registro mide lo que de verdad ocupa recursos: cada
 * conexión abierta retiene un listener del buffer y un socket. Sin este tope, N
 * reconexiones "legítimas" —o un cliente que abre y no lee— agotan el proceso
 * sin cruzarse con ningún 429.
 *
 * Los cupos no persisten ni se comparten: duran lo que dura la conexión y el
 * proceso es el único dueño de sus sockets.
 */

export const PAIR_STREAM_ACTIVE_MAX_ENV = 'COMMANDER_PAIR_STREAM_ACTIVE_MAX';
export const PAIR_STREAM_ACTIVE_GLOBAL_ENV = 'COMMANDER_PAIR_STREAM_ACTIVE_GLOBAL_MAX';

/**
 * Por caller: cuatro pestañas o reintentos del mismo dispositivo sin que una
 * pestaña zombi deje afuera a la buena. Global: seis veces eso, para que un
 * cliente no pueda ocupar el proceso entero.
 */
export const PAIR_STREAM_ACTIVE_DEFAULT_MAX = 4;
export const PAIR_STREAM_ACTIVE_DEFAULT_GLOBAL_MAX = 24;

function positiveInt(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function pairStreamActiveMax(
  env: Record<string, string | undefined> = process.env
): number {
  return positiveInt(env[PAIR_STREAM_ACTIVE_MAX_ENV], PAIR_STREAM_ACTIVE_DEFAULT_MAX);
}

export function pairStreamActiveGlobalMax(
  env: Record<string, string | undefined> = process.env
): number {
  return positiveInt(env[PAIR_STREAM_ACTIVE_GLOBAL_ENV], PAIR_STREAM_ACTIVE_DEFAULT_GLOBAL_MAX);
}

export type PairStreamAcquire =
  | { ok: true; active: { caller: number; global: number }; release: () => void }
  | { ok: false; scope: 'caller' | 'global'; max: number };

export class PairStreamCapacity {
  private readonly active = new Map<string, number>();
  private total = 0;

  constructor(private readonly options: { maxPerCaller?: number; maxGlobal?: number } = {}) {}

  private get maxPerCaller(): number {
    return positiveInt(this.options.maxPerCaller, PAIR_STREAM_ACTIVE_DEFAULT_MAX);
  }

  private get maxGlobal(): number {
    return positiveInt(this.options.maxGlobal, PAIR_STREAM_ACTIVE_DEFAULT_GLOBAL_MAX);
  }

  /** Pide un cupo; si no hay, no consume nada. `release` es idempotente. */
  acquire(callerKey: string): PairStreamAcquire {
    const used = this.active.get(callerKey) ?? 0;
    if (used >= this.maxPerCaller) return { ok: false, scope: 'caller', max: this.maxPerCaller };
    if (this.total >= this.maxGlobal) return { ok: false, scope: 'global', max: this.maxGlobal };
    this.active.set(callerKey, used + 1);
    this.total += 1;
    let released = false;
    return {
      ok: true,
      active: { caller: used + 1, global: this.total },
      release: () => {
        if (released) return;
        released = true;
        this.drop(callerKey);
      },
    };
  }

  private drop(callerKey: string): void {
    const used = this.active.get(callerKey) ?? 0;
    if (used <= 1) this.active.delete(callerKey);
    else this.active.set(callerKey, used - 1);
    if (this.total > 0) this.total -= 1;
  }

  /** Conexiones vivas ahora mismo; para tests y diagnóstico. */
  snapshot(callerKey: string): { caller: number; global: number } {
    return { caller: this.active.get(callerKey) ?? 0, global: this.total };
  }
}
