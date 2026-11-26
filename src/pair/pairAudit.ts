/**
 * Auditoría del emparejamiento: emisión, canje y baja de dispositivo (§6.2 y
 * §6.6 del modelo de amenazas remoto).
 *
 * - Sólo metadatos: acción, resultado, `deviceId`, `sessionId`, motivo y hora.
 *   Nunca el token del enlace, su hash ni la cookie: un volcado de este archivo
 *   no permite emparejar ni autenticar nada.
 * - Persistida en JSONL con tope de 200 entradas, relectura perezosa al arrancar
 *   y reescritura completa al superar el tope (un `append` crecería sin límite).
 * - Ruta por defecto `.commander/pair/audit.jsonl`; `COMMANDER_PAIR_AUDIT_FILE`
 *   la aísla en tests y despliegues, igual que la del lease.
 * - Un fallo de disco no tumba el endpoint: se pierde la entrada, no el par.
 */
import fs from 'node:fs';
import path from 'node:path';

export const PAIR_AUDIT_MAX_ENTRIES = 200;
export const PAIR_AUDIT_FILE_ENV = 'COMMANDER_PAIR_AUDIT_FILE';

export type PairAuditAction = 'issued' | 'redeemed' | 'revoked';
export type PairAuditResult = 'ok' | 'error';

export interface PairAuditEntry {
  at: number;
  action: PairAuditAction;
  result: PairAuditResult;
  /** Dispositivo creado o dado de baja; ausente en la emisión del enlace. */
  deviceId?: string;
  sessionId?: string;
  /** Motivo corto y estable del fallo: `used`, `invalid`, `limit`, `rate`, `not-found`. */
  reason?: string;
}

/** Ruta del historial; la variable permite aislar tests y despliegues. */
export function pairAuditPath(cwd = process.cwd()): string {
  const override = process.env[PAIR_AUDIT_FILE_ENV]?.trim();
  return override ? path.resolve(override) : path.join(cwd, '.commander', 'pair', 'audit.jsonl');
}

const entries: PairAuditEntry[] = [];
/** El disco se lee una vez; `resetPairAuditForTests` decide si se relee. */
let loaded = false;

function isEntry(value: any): value is PairAuditEntry {
  return (
    Boolean(value) &&
    typeof value.action === 'string' &&
    (value.result === 'ok' || value.result === 'error') &&
    typeof value.at === 'number'
  );
}

/** Una línea cortada o ilegible se descarta: un archivo dañado no rompe el par. */
function load(): void {
  if (loaded) return;
  loaded = true;
  let raw = '';
  try {
    raw = fs.readFileSync(pairAuditPath(), 'utf8');
  } catch {
    return;
  }
  const rows: PairAuditEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (isEntry(parsed)) rows.push(parsed);
    } catch {
      /* línea cortada por un corte de energía: se descarta */
    }
  }
  entries.push(...rows.slice(-PAIR_AUDIT_MAX_ENTRIES));
}

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* sin espera si el runtime no lo soporta */
  }
}

/** `rename` atómico con reintento: en Windows el antivirus puede dar EPERM. */
function writeAtomically(file: string, text: string): void {
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
 * Reescribe el archivo con lo que hay en memoria: así el tope también vale en
 * disco. Las llamadas son síncronas y el servidor es un solo proceso, así que
 * no hay dos escrituras pisándose.
 */
function persist(): void {
  const file = pairAuditPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = entries.map((entry) => JSON.stringify(entry)).join('\n');
    writeAtomically(file, text ? `${text}\n` : '');
  } catch {
    /* sin disco, la auditoría sigue en memoria */
  }
}

/** Registra una entrada. Devuelve lo guardado, sin secretos. */
export function recordPairAudit(
  entry: Omit<PairAuditEntry, 'at'> & { at?: number }
): PairAuditEntry {
  load();
  const full: PairAuditEntry = {
    at: entry.at ?? Date.now(),
    action: entry.action,
    result: entry.result,
    ...(entry.deviceId ? { deviceId: entry.deviceId } : {}),
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    ...(entry.reason ? { reason: entry.reason } : {}),
  };
  entries.push(full);
  while (entries.length > PAIR_AUDIT_MAX_ENTRIES) entries.shift();
  persist();
  return full;
}

/** Últimas entradas (todas si no se pide límite). Sin secretos. */
export function pairAudit(limit?: number): PairAuditEntry[] {
  load();
  const requested = Number(limit);
  const max = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), PAIR_AUDIT_MAX_ENTRIES)
    : entries.length;
  return entries.slice(-max).map((entry) => ({ ...entry }));
}

/**
 * Sólo para tests: vacía la memoria y, si la ruta viene aislada por
 * `COMMANDER_PAIR_AUDIT_FILE`, borra el archivo. Con la ruta por defecto no se
 * toca nada en disco: es el historial real del proyecto.
 */
export function resetPairAuditForTests(options: { keepFile?: boolean } = {}): void {
  entries.length = 0;
  const isolatedFile = process.env[PAIR_AUDIT_FILE_ENV]?.trim();
  if (options.keepFile || !isolatedFile) {
    loaded = false;
    return;
  }
  loaded = true;
  try {
    fs.rmSync(pairAuditPath(), { force: true });
  } catch {
    /* sin archivo no hay nada que borrar */
  }
}
