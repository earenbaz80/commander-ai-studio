/**
 * Tokens de emparejamiento: un solo uso, 5 minutos, 256 bits (§6.1 del modelo
 * de amenazas remoto).
 *
 * - El token es opaco: 32 bytes de CSPRNG en `base64url`, sin sesión, usuario
 *   ni ruta dentro. No se deriva de nada adivinable.
 * - El servidor guarda **sólo el SHA-256**; el token en claro no se persiste ni
 *   se registra. Canjearlo borra la entrada antes de responder.
 * - Caducado y desconocido responden igual (`invalid` → 410): distinguirlos
 *   diría si un token existió. Un segundo canje del mismo token sí es `used`
 *   (401) porque ya hubo una sesión emparejada con él.
 * - El estado vive en memoria del proceso: reiniciar el servidor invalida los
 *   enlaces pendientes, que es el comportamiento seguro por defecto.
 *
 * `now` y `ttlMs` son inyectables para poder probar la caducidad sin esperar
 * cinco minutos; en producción se usan `Date.now()` y `COMMANDER_PAIR_TTL_MS`
 * (sólo tests lo bajan).
 */
import { createHash, randomBytes } from 'node:crypto';

export const PAIR_TOKEN_TTL_MS = 5 * 60_000;
/** 32 bytes = 256 bits de entropía. */
export const PAIR_TOKEN_BYTES = 32;
/** Un token legítimo son 43 caracteres; más que esto es basura y no se hashea. */
export const MAX_PAIR_TOKEN_LENGTH = 512;
export const PAIR_TOKEN_TTL_ENV = 'COMMANDER_PAIR_TTL_MS';
/** Tope de enlaces vivos simultáneos: emitir desde la máquina host, no un API público. */
const MAX_LIVE_TOKENS = 32;

export function pairTokenTtlMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env[PAIR_TOKEN_TTL_ENV]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : PAIR_TOKEN_TTL_MS;
}

export function hashPairToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

interface LivePairToken {
  sessionId: string;
  expiresAt: number;
}

const live = new Map<string, LivePairToken>();
/** Hash de tokens ya canjeados → cuándo se canjearon (para el 401 de reutilización). */
const used = new Map<string, number>();

export interface IssuePairTokenOptions {
  now?: number;
  ttlMs?: number;
}

export interface IssuedPairToken {
  token: string;
  expiresAt: number;
}

/** Descarte perezoso: sin esto el mapa crece con cada enlace emitido. */
function sweep(now: number, ttlMs: number): void {
  for (const [hash, entry] of live) {
    if (now >= entry.expiresAt) live.delete(hash);
  }
  const usedTtl = Math.max(ttlMs, PAIR_TOKEN_TTL_MS);
  for (const [hash, at] of used) {
    if (now - at > usedTtl) used.delete(hash);
  }
  // Tope duro: se tiran los más viejos (Map conserva el orden de inserción).
  while (live.size > MAX_LIVE_TOKENS) {
    const oldest = live.keys().next();
    if (oldest.done) break;
    live.delete(oldest.value);
  }
}

/** Emite un enlace para `sessionId`. Devuelve el token en claro una sola vez. */
export function issuePairToken(sessionId: string, options: IssuePairTokenOptions = {}): IssuedPairToken {
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('sessionId requerido para emparejar');
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? pairTokenTtlMs();
  sweep(now, ttlMs);
  const token = randomBytes(PAIR_TOKEN_BYTES).toString('base64url');
  const expiresAt = now + ttlMs;
  live.set(hashPairToken(token), { sessionId, expiresAt });
  return { token, expiresAt };
}

export type PairRedeemResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: 'used' | 'invalid' };

/**
 * Canjea un token. Éxito una sola vez: la entrada se borra antes de devolver.
 * `used` es el segundo intento con el mismo token; `invalid` cubre caducado,
 * desconocido y basura, que a propósito no se distinguen.
 */
export function redeemPairToken(token: unknown, options: IssuePairTokenOptions = {}): PairRedeemResult {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? pairTokenTtlMs();
  if (typeof token !== 'string' || !token || token.length > MAX_PAIR_TOKEN_LENGTH) {
    return { ok: false, reason: 'invalid' };
  }
  const hash = hashPairToken(token);
  const entry = live.get(hash);
  if (!entry) return used.has(hash) ? { ok: false, reason: 'used' } : { ok: false, reason: 'invalid' };
  live.delete(hash);
  if (now >= entry.expiresAt) return { ok: false, reason: 'invalid' };
  used.set(hash, now);
  sweep(now, ttlMs);
  return { ok: true, sessionId: entry.sessionId };
}

/** Sólo para tests: deja el almacén vacío entre casos. */
export function resetPairTokensForTests(): void {
  live.clear();
  used.clear();
}

/**
 * Vista sin secretos del almacén, para tests y para una futura auditoría:
 * hashes y vencimientos, nunca el token en claro.
 */
export function pairTokenStats(): {
  live: Array<{ hash: string; sessionId: string; expiresAt: number }>;
  used: number;
} {
  return {
    live: Array.from(live, ([hash, entry]) => ({
      hash,
      sessionId: entry.sessionId,
      expiresAt: entry.expiresAt,
    })),
    used: used.size,
  };
}
