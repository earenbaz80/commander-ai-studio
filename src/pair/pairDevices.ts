/**
 * Dispositivos emparejados: la cookie opaca, su registro y su revocación
 * (§6.2 del modelo de amenazas remoto).
 *
 * - El identificador es opaco: 32 bytes de CSPRNG en `base64url`. No deriva de
 *   la sesión, del usuario ni de la máquina. Se guarda **sólo su SHA-256**, así
 *   que un volcado del registro no permite reusar la cookie.
 * - El registro expone un `id` (`dev_…`) separado del token: la lista y la
 *   revocación nombran al dispositivo sin revelar la credencial.
 * - Revocar marca `revokedAt`; el siguiente request con esa cookie recibe 401
 *   aunque no haya caducado. Revocar dos veces es idempotente mientras dure la
 *   retención del revocado (24 h por defecto); luego el registro se poda.
 * - Caducidad de 30 días renovada por uso. Caducado, revocado y desconocido se
 *   responden igual desde el endpoint (`401`), pero el módulo distingue el
 *   motivo para tests y auditoría.
 * - Tope de 5 dispositivos activos: emparejar otro exige revocar uno.
 *
 * `now` y `ttlMs` son inyectables para probar la caducidad sin esperar 30 días;
 * en producción se usan `Date.now()` y los valores por entorno, que sólo bajan
 * los tests (`COMMANDER_PAIR_DEVICE_TTL_MS`, `COMMANDER_PAIR_MAX_DEVICES`).
 */
import { createHash, randomBytes } from 'node:crypto';

export const PAIR_DEVICE_COOKIE = 'commander_pair';
/** 32 bytes = 256 bits de entropía. */
export const PAIR_DEVICE_BYTES = 32;
export const PAIR_DEVICE_TTL_MS = 30 * 24 * 60 * 60_000;
export const PAIR_DEVICE_TTL_ENV = 'COMMANDER_PAIR_DEVICE_TTL_MS';
export const PAIR_DEVICE_MAX_ENV = 'COMMANDER_PAIR_MAX_DEVICES';
export const PAIR_DEVICE_REVOKED_TTL_ENV = 'COMMANDER_PAIR_REVOKED_TTL_MS';
/**
 * Cuánto se conserva un revocado: es la ventana en que repetir la baja sigue
 * siendo idempotente (mismo `revokedAt`). Pasada, el registro se poda: si se
 * guardara los 30 días de la cookie, emparejar y revocar en bucle haría crecer
 * la memoria sin límite por algo que ya no autentica a nadie.
 */
export const PAIR_DEVICE_REVOKED_RETENTION_MS = 24 * 60 * 60_000;
export const MAX_PAIR_DEVICES = 5;
export const MAX_PAIR_DEVICE_TOKEN_LENGTH = 512;
/** Un User-Agent de 4 KB no aporta nada y engorda el registro. */
const MAX_USER_AGENT = 200;

export function pairDeviceTtlMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env[PAIR_DEVICE_TTL_ENV]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : PAIR_DEVICE_TTL_MS;
}

export function maxPairDevices(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env[PAIR_DEVICE_MAX_ENV]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : MAX_PAIR_DEVICES;
}

export function pairDeviceRevokedTtlMs(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = Number(env[PAIR_DEVICE_REVOKED_TTL_ENV]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : PAIR_DEVICE_REVOKED_RETENTION_MS;
}

export function hashPairDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Vista pública del dispositivo: nunca incluye el hash ni el token. */
export interface PairDevice {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
  userAgent: string;
}

interface DeviceRecord extends PairDevice {
  hash: string;
}

const devices = new Map<string, DeviceRecord>();
const idToHash = new Map<string, string>();

function publicDevice(record: DeviceRecord): PairDevice {
  return {
    id: record.id,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    userAgent: record.userAgent,
  };
}

/**
 * Descarte perezoso: sin esto el registro crece con cada emparejamiento. Un
 * revocado no se guarda hasta su caducidad de cookie sino hasta que vence su
 * ventana de idempotencia; después ya no aporta nada (la cookie da 401 igual).
 */
function sweep(now: number, revokedTtlMs = pairDeviceRevokedTtlMs()): void {
  for (const [hash, record] of devices) {
    const expired = now >= record.expiresAt;
    const revokedWindowOver =
      record.revokedAt !== null && now - record.revokedAt >= revokedTtlMs;
    if (expired || revokedWindowOver) {
      devices.delete(hash);
      idToHash.delete(record.id);
    }
  }
}

/**
 * ¿Hay ya el máximo de dispositivos activos? El canje lo mira **antes** de
 * consumir el token: si no, el enlace se quemaría para responder 409. Un
 * revocado no cuenta: revocar es justamente lo que libera el cupo.
 */
export function pairDeviceLimitReached(now = Date.now()): boolean {
  let active = 0;
  for (const record of devices.values()) {
    if (record.revokedAt === null && now < record.expiresAt) active++;
  }
  return active >= maxPairDevices();
}

export interface IssuePairDeviceOptions {
  userAgent?: unknown;
  now?: number;
  ttlMs?: number;
}

export type IssuePairDeviceResult =
  | { ok: true; token: string; device: PairDevice }
  | { ok: false; reason: 'limit' };

/** Registra un dispositivo nuevo. Devuelve la cookie en claro una sola vez. */
export function issuePairDevice(options: IssuePairDeviceOptions = {}): IssuePairDeviceResult {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? pairDeviceTtlMs();
  sweep(now);
  if (pairDeviceLimitReached(now)) return { ok: false, reason: 'limit' };
  const token = randomBytes(PAIR_DEVICE_BYTES).toString('base64url');
  const record: DeviceRecord = {
    id: `dev_${randomBytes(8).toString('hex')}`,
    hash: hashPairDeviceToken(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + ttlMs,
    revokedAt: null,
    userAgent:
      typeof options.userAgent === 'string' ? options.userAgent.trim().slice(0, MAX_USER_AGENT) : '',
  };
  devices.set(record.hash, record);
  idToHash.set(record.id, record.hash);
  return { ok: true, token, device: publicDevice(record) };
}

export type PairDeviceCheck =
  | { ok: true; device: PairDevice }
  | { ok: false; reason: 'invalid' | 'revoked' | 'expired' };

/**
 * Valida la cookie. En éxito actualiza `lastSeenAt` y renueva la caducidad; en
 * fallo dice el motivo, que el endpoint no revela al cliente.
 */
export function resolvePairDevice(
  token: unknown,
  options: { now?: number; ttlMs?: number } = {}
): PairDeviceCheck {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? pairDeviceTtlMs();
  if (typeof token !== 'string' || !token || token.length > MAX_PAIR_DEVICE_TOKEN_LENGTH) {
    return { ok: false, reason: 'invalid' };
  }
  const record = devices.get(hashPairDeviceToken(token));
  if (!record) return { ok: false, reason: 'invalid' };
  if (record.revokedAt !== null) return { ok: false, reason: 'revoked' };
  if (now >= record.expiresAt) {
    devices.delete(record.hash);
    idToHash.delete(record.id);
    return { ok: false, reason: 'expired' };
  }
  record.lastSeenAt = now;
  record.expiresAt = now + ttlMs;
  return { ok: true, device: publicDevice(record) };
}

/**
 * Marca el dispositivo como revocado. Idempotente: repetir la revocación
 * devuelve el mismo `revokedAt`. `null` sólo si el id no existe.
 */
export function revokePairDevice(id: unknown, options: { now?: number } = {}): PairDevice | null {
  if (typeof id !== 'string' || !id) return null;
  const hash = idToHash.get(id);
  if (!hash) return null;
  const record = devices.get(hash);
  if (!record) return null;
  if (record.revokedAt === null) record.revokedAt = options.now ?? Date.now();
  return publicDevice(record);
}

/** Dispositivos vivos (revocados incluidos, con su `revokedAt`). */
export function listPairDevices(options: { now?: number } = {}): PairDevice[] {
  const now = options.now ?? Date.now();
  sweep(now);
  return Array.from(devices.values())
    .filter((record) => now < record.expiresAt)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicDevice);
}

/**
 * `Set-Cookie` de la credencial. `HttpOnly` (no la lee JavaScript),
 * `SameSite=Strict` (no viaja en peticiones cross-site) y `Path=/`, host-only
 * (sin `Domain`). `Secure` sólo cuando el origen es HTTPS.
 */
export function pairDeviceCookie(
  token: string,
  options: { secure?: boolean; ttlMs?: number } = {}
): string {
  const maxAge = Math.floor((options.ttlMs ?? pairDeviceTtlMs()) / 1000);
  const parts = [
    `${PAIR_DEVICE_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/** Sólo para tests: deja el registro vacío entre casos. */
export function resetPairDevicesForTests(): void {
  devices.clear();
  idToHash.clear();
}
