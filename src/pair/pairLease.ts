/**
 * Control lease de una sesión emparejada: un solo escritor a la vez (§6.4 del
 * modelo de amenazas remoto).
 *
 * - El escritorio (`DESKTOP_CONTROLLER`) es el dueño por defecto: mientras
 *   nadie reclame, la sesión no tiene caducidad. Un dispositivo emparejado
 *   toma el control con `claimPairLease`, que es explícito y visible.
 * - Mientras otro lo tiene, cualquier intento de escritura ajeno responde
 *   `held` y el endpoint lo traduce a **409 `LEASE_HELD`**. Leer no se bloquea:
 *   el que no escribe ve el estado y puede **pedir** el traspaso.
 * - El traspaso es explícito: `requestPairTransfer` sólo deja una solicitud
 *   pendiente; el dueño actual la acepta con `transferPairLease` (o nombra a
 *   otro dispositivo) y sólo entonces cambia el `deviceId`. La respuesta lleva
 *   un `ack` con el `deviceId` y el `seq` nuevos: el cliente no habilita la
 *   escritura hasta verlo.
 * - `seq` es el testigo de fencing: sube en cada adquisición, renovación,
 *   traspaso, liberación, caducidad y revocación. Una renovación o un traspaso
 *   con un `seq` viejo falla (`stale` → 409 `LEASE_STALE`) aunque el `deviceId`
 *   coincida, así un mensaje en vuelo no revive un control ya cedido.
 * - Renovación: TTL de 60 s, renovado por el escritor (el cliente cada 30 s).
 *   Sin renovación el lease caduca y el control vuelve al escritorio, con su
 *   evento en la auditoría. Revocar un dispositivo hace lo mismo en todas las
 *   sesiones donde fuera el dueño (`dropPairLeasesForDevice`).
 * - La auditoría se persiste en `.commander/pair/lease-audit.jsonl` (JSONL,
 *   tope de 200 entradas, escritura atómica) y se relee al arrancar. Lleva
 *   `deviceId`, `seq`, acción y hora, sin secretos, y se lee desde el escritorio.
 *
 * `now` y `ttlMs` son inyectables para probar la caducidad sin esperar 60 s;
 * en producción se usan `Date.now()` y `COMMANDER_PAIR_LEASE_TTL_MS` (sólo
 * tests lo bajan).
 */
import fs from 'node:fs';
import path from 'node:path';
import { activePairDevice } from './pairDevices.js';

export const DESKTOP_CONTROLLER = 'desktop';
export const PAIR_LEASE_TTL_MS = 60_000;
/** El cliente renueva a la mitad del TTL: un fallo de red no pierde el control. */
export const PAIR_LEASE_RENEW_MS = 30_000;
export const PAIR_LEASE_TTL_ENV = 'COMMANDER_PAIR_LEASE_TTL_MS';
/** Tope del historial, en memoria y en disco: lo viejo se descarta. */
export const PAIR_LEASE_AUDIT_MAX_ENTRIES = 200;
/** Archivo del historial; la variable permite aislar tests y despliegues. */
export const PAIR_LEASE_AUDIT_FILE_ENV = 'COMMANDER_PAIR_LEASE_AUDIT_FILE';

/**
 * Ruta del historial. Por defecto vive junto al resto del estado local del
 * proyecto (`.commander/`, ignorado por git), no sólo en la memoria del
 * proceso: un reinicio del server no borra quién tuvo el control.
 */
export function pairLeaseAuditPath(cwd = process.cwd()): string {
  const override = process.env[PAIR_LEASE_AUDIT_FILE_ENV]?.trim();
  return override ? path.resolve(override) : path.join(cwd, '.commander', 'pair', 'lease-audit.jsonl');
}

export function pairLeaseTtlMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env[PAIR_LEASE_TTL_ENV]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : PAIR_LEASE_TTL_MS;
}

export type PairLeaseAction =
  | 'claimed'
  | 'renewed'
  | 'requested'
  | 'transferred'
  | 'released'
  | 'expired'
  | 'revoked';

export interface PairLeaseAuditEntry {
  at: number;
  sessionId: string;
  action: PairLeaseAction;
  deviceId: string;
  seq: number;
  /** Sólo en `transferred`: quién recibe el control. */
  toDeviceId?: string;
}

export interface PairLease {
  sessionId: string;
  /** `DESKTOP_CONTROLLER` cuando nadie emparejado lo tiene. */
  deviceId: string;
  seq: number;
  acquiredAt: number;
  renewedAt: number;
  /** `null` mientras el escritorio tenga el control: no caduca. */
  expiresAt: number | null;
  /** Pedido de traspaso esperando que el dueño actual lo acepte. */
  pending: { deviceId: string; requestedAt: number } | null;
}

type LeaseRecord = PairLease;

const leases = new Map<string, LeaseRecord>();
const audit: PairLeaseAuditEntry[] = [];
/** El disco se lee una vez; `resetPairLeasesForTests` decide si se relee. */
let auditLoaded = false;

function isAuditEntry(value: any): value is PairLeaseAuditEntry {
  return (
    Boolean(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.deviceId === 'string' &&
    typeof value.action === 'string' &&
    typeof value.at === 'number' &&
    typeof value.seq === 'number'
  );
}

/**
 * Carga perezosa del historial. Una línea cortada o ilegible se ignora: un
 * archivo dañado no puede tumbar el control de la sesión.
 */
function loadAudit(): void {
  if (auditLoaded) return;
  auditLoaded = true;
  let raw = '';
  try {
    raw = fs.readFileSync(pairLeaseAuditPath(), 'utf8');
  } catch {
    return;
  }
  const rows: PairLeaseAuditEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (isAuditEntry(parsed)) rows.push(parsed);
    } catch {
      /* línea cortada por un corte de energía: se descarta */
    }
  }
  audit.push(...rows.slice(-PAIR_LEASE_AUDIT_MAX_ENTRIES));
}

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* sin espera si el runtime no lo soporta */
  }
}

/** `rename` atómico con reintento: en Windows el antivirus puede dar EPERM. */
function writeAuditAtomically(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      const retriable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (!retriable || attempt >= 4) {
        try { fs.unlinkSync(tmp); } catch { /* el tmp ya no está */ }
        throw error;
      }
      sleepSync(15 * (attempt + 1));
    }
  }
}

/**
 * Reescribe el archivo con lo que hay en memoria: así el tope también se aplica
 * en disco (un `append` crecería sin límite). Un fallo de disco no bloquea el
 * lease: se pierde el historial, no el control.
 */
function persistAudit(): void {
  const file = pairLeaseAuditPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = audit.map((entry) => JSON.stringify(entry)).join('\n');
    writeAuditAtomically(file, text ? `${text}\n` : '');
  } catch {
    /* sin disco, la auditoría sigue en memoria */
  }
}

function publicLease(record: LeaseRecord): PairLease {
  return {
    sessionId: record.sessionId,
    deviceId: record.deviceId,
    seq: record.seq,
    acquiredAt: record.acquiredAt,
    renewedAt: record.renewedAt,
    expiresAt: record.expiresAt,
    pending: record.pending ? { ...record.pending } : null,
  };
}

function log(record: LeaseRecord, action: PairLeaseAction, at: number, toDeviceId?: string): void {
  loadAudit();
  audit.push({
    at,
    sessionId: record.sessionId,
    action,
    deviceId: record.deviceId,
    seq: record.seq,
    ...(toDeviceId ? { toDeviceId } : {}),
  });
  while (audit.length > PAIR_LEASE_AUDIT_MAX_ENTRIES) audit.shift();
  persistAudit();
}

function desktopLease(sessionId: string, seq: number, now: number): LeaseRecord {
  return {
    sessionId,
    deviceId: DESKTOP_CONTROLLER,
    seq,
    acquiredAt: now,
    renewedAt: now,
    expiresAt: null,
    pending: null,
  };
}

/**
 * Estado vigente: caduca de forma perezosa cuando alguien lo mira. La caducidad
 * mueve `seq` (el fencing token no se repite) y deja su evento en la auditoría.
 */
function current(sessionId: string, now: number): LeaseRecord {
  const record = leases.get(sessionId);
  if (!record) return desktopLease(sessionId, 0, now);
  if (record.deviceId !== DESKTOP_CONTROLLER && record.expiresAt !== null && now >= record.expiresAt) {
    record.deviceId = DESKTOP_CONTROLLER;
    record.expiresAt = null;
    record.renewedAt = now;
    record.pending = null;
    record.seq += 1;
    log(record, 'expired', now);
    return record;
  }
  return record;
}

function save(record: LeaseRecord): void {
  leases.set(record.sessionId, record);
}

export interface PairLeaseOptions {
  now?: number;
  ttlMs?: number;
}

export type PairLeaseResult =
  | { ok: true; lease: PairLease }
  | { ok: false; reason: 'held' | 'stale' | 'owner' | 'no-request' | 'invalid-target' };

/** Estado del control. No caduca nada más que el lease: es una lectura. */
export function readPairLease(sessionId: string, options: { now?: number } = {}): PairLease {
  const now = options.now ?? Date.now();
  return publicLease(current(sessionId, now));
}

/**
 * Toma el control si está libre (o ya lo tenía, en cuyo caso renueva). Si otro
 * dispositivo lo tiene, `held`: hay que pedir el traspaso, no insistir.
 */
export function claimPairLease(
  sessionId: string,
  deviceId: string,
  options: PairLeaseOptions = {}
): PairLeaseResult {
  if (!sessionId || !deviceId || deviceId === DESKTOP_CONTROLLER) {
    throw new Error('claimPairLease necesita una sesión y un deviceId emparejado');
  }
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? pairLeaseTtlMs();
  const record = current(sessionId, now);
  if (record.deviceId === deviceId) {
    record.renewedAt = now;
    record.expiresAt = now + ttlMs;
    record.seq += 1;
    log(record, 'renewed', now);
    save(record);
    return { ok: true, lease: publicLease(record) };
  }
  if (record.deviceId !== DESKTOP_CONTROLLER) return { ok: false, reason: 'held' };
  record.deviceId = deviceId;
  record.seq += 1;
  record.acquiredAt = now;
  record.renewedAt = now;
  record.expiresAt = now + ttlMs;
  record.pending = null;
  log(record, 'claimed', now);
  save(record);
  return { ok: true, lease: publicLease(record) };
}

/** Sólo el dueño renueva, y con el `seq` vigente. */
export function renewPairLease(
  sessionId: string,
  deviceId: string,
  seq: number,
  options: PairLeaseOptions = {}
): PairLeaseResult {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? pairLeaseTtlMs();
  const record = current(sessionId, now);
  if (record.deviceId !== deviceId || record.deviceId === DESKTOP_CONTROLLER) {
    return { ok: false, reason: 'held' };
  }
  if (!Number.isInteger(seq) || seq !== record.seq) return { ok: false, reason: 'stale' };
  record.renewedAt = now;
  record.expiresAt = now + ttlMs;
  record.seq += 1;
  log(record, 'renewed', now);
  save(record);
  return { ok: true, lease: publicLease(record) };
}

/**
 * Deja una solicitud de traspaso. No cambia el dueño: el escritor actual decide.
 * Repetir la solicitud del mismo dispositivo es idempotente.
 */
export function requestPairTransfer(
  sessionId: string,
  deviceId: string,
  options: { now?: number } = {}
): PairLeaseResult {
  const now = options.now ?? Date.now();
  const record = current(sessionId, now);
  if (record.deviceId === deviceId) return { ok: false, reason: 'owner' };
  if (record.pending?.deviceId === deviceId) return { ok: true, lease: publicLease(record) };
  record.pending = { deviceId, requestedAt: now };
  log(record, 'requested', now);
  save(record);
  return { ok: true, lease: publicLease(record) };
}

export type PairLeaseTransferResult =
  | { ok: true; lease: PairLease; ack: { deviceId: string; seq: number; at: number } }
  | { ok: false; reason: 'held' | 'stale' | 'no-request' | 'invalid-target' };

/**
 * Acepta el traspaso pendiente (o nombra a otro dispositivo) y devuelve el
 * `ack`. Sólo el dueño actual puede hacerlo, con el `seq` vigente.
 */
export function transferPairLease(
  sessionId: string,
  deviceId: string,
  options: PairLeaseOptions & {
    seq: number;
    toDeviceId?: string;
    /** Inyectable para tests del módulo; por defecto, el registro real. */
    isActiveDevice?: (id: string) => boolean;
  }
): PairLeaseTransferResult {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? pairLeaseTtlMs();
  const record = current(sessionId, now);
  if (record.deviceId !== deviceId) return { ok: false, reason: 'held' };
  if (!Number.isInteger(options.seq) || options.seq !== record.seq) {
    return { ok: false, reason: 'stale' };
  }
  const target = options.toDeviceId ?? record.pending?.deviceId;
  if (!target || target === record.deviceId || target === DESKTOP_CONTROLLER) {
    return { ok: false, reason: 'no-request' };
  }
  // El destino tiene que existir y seguir activo: el dueño puede nombrar un id
  // inventado, uno revocado o uno que pidió el traspaso y fue dado de baja
  // mientras esperaba. Sin esto el control quedaría en un fantasma.
  const isActive = options.isActiveDevice ?? ((id: string) => activePairDevice(id, { now }) !== null);
  if (!isActive(target)) return { ok: false, reason: 'invalid-target' };
  // El evento se registra con el emisor en `deviceId` y el destinatario aparte.
  record.seq += 1;
  log(record, 'transferred', now, target);
  record.deviceId = target;
  record.acquiredAt = now;
  record.renewedAt = now;
  record.expiresAt = now + ttlMs;
  record.pending = null;
  save(record);
  return {
    ok: true,
    lease: publicLease(record),
    ack: { deviceId: record.deviceId, seq: record.seq, at: now },
  };
}

/** El dueño devuelve el control al escritorio. Idempotente si ya lo tiene. */
export function releasePairLease(
  sessionId: string,
  deviceId: string,
  options: { now?: number; seq?: number } = {}
): PairLeaseResult {
  const now = options.now ?? Date.now();
  const record = current(sessionId, now);
  if (record.deviceId !== deviceId) return { ok: false, reason: 'held' };
  if (options.seq !== undefined && options.seq !== record.seq) return { ok: false, reason: 'stale' };
  if (record.deviceId === DESKTOP_CONTROLLER) return { ok: true, lease: publicLease(record) };
  record.deviceId = DESKTOP_CONTROLLER;
  record.seq += 1;
  record.renewedAt = now;
  record.expiresAt = null;
  record.pending = null;
  log(record, 'released', now);
  save(record);
  return { ok: true, lease: publicLease(record) };
}

/**
 * Revocar un dispositivo devuelve el control al escritorio en todas las
 * sesiones donde fuera el dueño y descarta sus solicitudes pendientes.
 * Devuelve cuántas sesiones cambiaron de dueño.
 */
export function dropPairLeasesForDevice(
  deviceId: string,
  options: { now?: number } = {}
): number {
  if (!deviceId) return 0;
  const now = options.now ?? Date.now();
  let changed = 0;
  for (const record of leases.values()) {
    let touched = false;
    if (record.deviceId === deviceId) {
      record.deviceId = DESKTOP_CONTROLLER;
      record.expiresAt = null;
      record.seq += 1;
      changed += 1;
      touched = true;
    }
    if (record.pending?.deviceId === deviceId) {
      record.pending = null;
      touched = true;
    }
    if (touched) {
      record.renewedAt = now;
      log(record, 'revoked', now, deviceId);
    }
  }
  return changed;
}

/** Historial de control, opcionalmente de una sola sesión. Sin secretos. */
export function pairLeaseAudit(sessionId?: string): PairLeaseAuditEntry[] {
  loadAudit();
  const rows = sessionId ? audit.filter((entry) => entry.sessionId === sessionId) : audit.slice();
  return rows.map((entry) => ({ ...entry }));
}

/**
 * Sólo para tests: deja el control y la auditoría vacíos entre casos.
 *
 * Por defecto también borra el archivo, para no heredar eventos de la corrida
 * anterior; con `keepAuditFile` sólo vacía la memoria y obliga a releer el
 * disco en la siguiente lectura (así se prueba el reinicio).
 */
export function resetPairLeasesForTests(options: { keepAuditFile?: boolean } = {}): void {
  leases.clear();
  audit.length = 0;
  if (options.keepAuditFile) {
    auditLoaded = false;
    return;
  }
  auditLoaded = true;
  try {
    fs.rmSync(pairLeaseAuditPath(), { force: true });
  } catch {
    /* sin archivo no hay nada que borrar */
  }
}
