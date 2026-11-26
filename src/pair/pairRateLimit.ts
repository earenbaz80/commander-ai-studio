/**
 * Rate limit del pair (§6.6 del modelo de amenazas remoto; T2 y T12).
 *
 * Dos presupuestos por alcance, en ventana fija de un minuto:
 *
 * - **caller**: por dispositivo emparejado (o por IP cuando todavía no hay
 *   cookie). Es lo que impide que un cliente emparejado abrume la sesión.
 * - **global**: uno solo para todo el proceso. Es lo que impide que N
 *   dispositivos, o un bucle desde una sola IP, saturen el servidor aunque
 *   cada uno esté dentro de su propio presupuesto.
 *
 * El canje **sólo cuenta fallos** (`POST /api/pair/redeem` con token inválido,
 * usado o caducado): un enlace válido nunca queda fuera por haber probado
 * tokens, así que el dueño no puede quedar bloqueado por la fuerza bruta de
 * otro. Approvals y stream cuentan cada intento, porque ahí el trabajo se hace
 * antes de saber si el pedido prospera.
 *
 * La respuesta 429 lleva `Retry-After` en segundos: lo que falta de la ventana,
 * nunca menos de 1. Los topes y la ventana salen del entorno
 * (`COMMANDER_PAIR_RATE_*`), igual que el resto de límites del server, y sólo
 * los tests los bajan.
 */

export const PAIR_RATE_WINDOW_MS = 60_000;
export const PAIR_RATE_WINDOW_ENV = 'COMMANDER_PAIR_RATE_WINDOW_MS';

export type PairRateScope = 'redeem' | 'approval' | 'stream';

/** Tope por caller (dispositivo o IP) y minuto. */
export const PAIR_RATE_MAX_ENV: Record<PairRateScope, string> = {
  redeem: 'COMMANDER_PAIR_RATE_REDEEM_MAX',
  approval: 'COMMANDER_PAIR_RATE_APPROVAL_MAX',
  stream: 'COMMANDER_PAIR_RATE_STREAM_MAX',
};

/** Tope global del proceso y minuto, por alcance. */
export const PAIR_RATE_GLOBAL_ENV: Record<PairRateScope, string> = {
  redeem: 'COMMANDER_PAIR_RATE_REDEEM_GLOBAL_MAX',
  approval: 'COMMANDER_PAIR_RATE_APPROVAL_GLOBAL_MAX',
  stream: 'COMMANDER_PAIR_RATE_STREAM_GLOBAL_MAX',
};

/**
 * Topes por minuto. Los de stream salen de medir el cliente, no de un número
 * redondo: reconecta con backoff de 1 s a 8 s, o sea ~10 aperturas por minuto y
 * por pestaña, y una sesión puede estar abierta en tres pestañas del teléfono
 * más la del escritorio. 60 deja margen para eso y para una pestaña recargándose
 * (30 era el tope exacto de tres pestañas reconectando: sin margen); el global
 * (600) permite cinco clientes a tope sin que uno consuma el cupo de los demás.
 */
export const PAIR_RATE_DEFAULT_MAX: Record<PairRateScope, number> = {
  redeem: 10,
  approval: 60,
  stream: 60,
};

export const PAIR_RATE_DEFAULT_GLOBAL_MAX: Record<PairRateScope, number> = {
  redeem: 60,
  approval: 600,
  stream: 600,
};

function positiveInt(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function pairRateMax(
  scope: PairRateScope,
  env: Record<string, string | undefined> = process.env
): number {
  return positiveInt(env[PAIR_RATE_MAX_ENV[scope]], PAIR_RATE_DEFAULT_MAX[scope]);
}

export function pairRateGlobalMax(
  scope: PairRateScope,
  env: Record<string, string | undefined> = process.env
): number {
  return positiveInt(env[PAIR_RATE_GLOBAL_ENV[scope]], PAIR_RATE_DEFAULT_GLOBAL_MAX[scope]);
}

export function pairRateWindowMs(env: Record<string, string | undefined> = process.env): number {
  return positiveInt(env[PAIR_RATE_WINDOW_ENV], PAIR_RATE_WINDOW_MS);
}

export interface PairRateBudgets {
  caller: number;
  global: number;
}

export function pairRateBudgets(
  scope: PairRateScope,
  env: Record<string, string | undefined> = process.env
): PairRateBudgets {
  return { caller: pairRateMax(scope, env), global: pairRateGlobalMax(scope, env) };
}

export type PairRateResult =
  | { ok: true }
  | {
      ok: false;
      /** Qué presupuesto se agotó. `caller` es el del dispositivo o IP. */
      scope: 'caller' | 'global';
      /** Tope que se superó, para el mensaje. */
      max: number;
      /** Segundos hasta que se reinicie la ventana; nunca menos de 1. */
      retryAfterSec: number;
      windowMs: number;
    };

interface Bucket {
  used: number;
  reset: number;
}

/**
 * Limitador de ventana fija. Sin timers ni dependencias: cada `take` purga de
 * forma perezosa los buckets vencidos cuando el mapa crece, así un proceso que
 * ve muchas IPs no acumula memoria sin límite.
 *
 * `now` y `windowMs` son inyectables para probar el reinicio y el
 * `Retry-After` sin esperar un minuto.
 */
export class PairRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly maxBuckets: number;

  constructor(options: { now?: () => number; windowMs?: number; maxBuckets?: number } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.windowMs = positiveInt(options.windowMs, PAIR_RATE_WINDOW_MS);
    this.maxBuckets = positiveInt(options.maxBuckets, 512);
  }

  /**
   * Cuenta un intento en el bucket del caller y en el global, y dice si pasa.
   * Los dos contadores suben siempre: un pedido rechazado por el global sigue
   * consumiendo el del caller, que es lo que pasaría si se reintentara.
   */
  take(
    scope: PairRateScope,
    callerKey: string,
    budgets: PairRateBudgets = pairRateBudgets(scope)
  ): PairRateResult {
    const now = this.now();
    const caller = this.bump(`${scope}:caller:${callerKey}`, now);
    const global = this.bump(`${scope}:global`, now);
    if (caller.used > budgets.caller) {
      return this.reject('caller', caller, budgets.caller, now);
    }
    if (global.used > budgets.global) {
      return this.reject('global', global, budgets.global, now);
    }
    return { ok: true };
  }

  /** Intento registrados en la ventana vigente; para tests y diagnóstico. */
  used(scope: PairRateScope, callerKey: string): { caller: number; global: number } {
    const now = this.now();
    const caller = this.buckets.get(`${scope}:caller:${callerKey}`);
    const global = this.buckets.get(`${scope}:global`);
    return {
      caller: caller && now < caller.reset ? caller.used : 0,
      global: global && now < global.reset ? global.used : 0,
    };
  }

  private bump(key: string, now: number): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.reset) {
      bucket = { used: 0, reset: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.used++;
    if (this.buckets.size > this.maxBuckets) this.purge(now);
    return bucket;
  }

  private purge(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.reset) this.buckets.delete(key);
    }
  }

  private reject(
    scope: 'caller' | 'global',
    bucket: Bucket,
    max: number,
    now: number
  ): PairRateResult {
    return {
      ok: false,
      scope,
      max,
      retryAfterSec: Math.max(1, Math.ceil((bucket.reset - now) / 1000)),
      windowMs: this.windowMs,
    };
  }
}
