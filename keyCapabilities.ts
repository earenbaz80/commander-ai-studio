/**
 * Rasgos aprendidos de cada API key que deben sobrevivir a los reinicios.
 *
 * Hoy sólo se guarda uno: que la key no admite las herramientas integradas de
 * Gemini (`googleSearch` / `codeExecution`). Sin persistencia, cada reinicio del
 * servidor volvía a pagar una pasada completa de llamadas fallidas antes de
 * aprenderlo otra vez.
 *
 * Nunca se escribe la key: sólo su SHA-256 truncado. La huella no permite
 * recuperarla y basta para reconocer la misma key en el siguiente arranque.
 *
 * El fichero vive junto a la configuración global de la app
 * (`~/.config/commander/`), no en el repo, y se escribe con permisos de dueño.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getConfig } from './src/config';

/**
 * Cuánto se recuerda un rasgo cuando la configuración no dice otra cosa.
 *
 * Media hora: evita repetir la primera pasada fallida en cada mensaje y deja que
 * un 429 pasajero —o una mejora de plan— devuelva la búsqueda de Google sin
 * reiniciar el servidor.
 */
export const DEFAULT_CAPABILITY_TTL_MS = 30 * 60 * 1000;

/**
 * Duración efectiva de la marca, tomada de `providers.google.toolsMemoryTtlMinutes`.
 *
 * Se consulta en cada marca nueva (la configuración se cachea, así que un cambio
 * en `commander.json` entra como el resto: al recargar). Si falta o es inválida
 * se cae al valor por defecto de 30 minutos.
 */
export function capabilityTtlMs(): number {
  try {
    const minutes = getConfig().providers?.google?.toolsMemoryTtlMinutes;
    if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0) {
      return minutes * 60 * 1000;
    }
  } catch {
    // Sin configuración válida se mantiene el comportamiento de siempre.
  }
  return DEFAULT_CAPABILITY_TTL_MS;
}

const FILE_NAME = 'key-capabilities.json';
const MAX_ENTRIES = 50;

/** Huella → instante (ms) hasta el que el rasgo es válido. */
type CapabilityMap = Record<string, number>;

/** Directorio de estado; `COMMANDER_STATE_DIR` permite aislarlo en pruebas. */
function stateDir(): string {
  const override = process.env.COMMANDER_STATE_DIR;
  if (override) return override;
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  return path.join(home, '.config', 'commander');
}

function memoryFile(): string {
  return path.join(stateDir(), FILE_NAME);
}

/** Huella estable de la key; nunca se guarda ni se registra el valor original. */
export function keyFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

/** Lee el almacén; cualquier problema de disco se trata como «no hay nada». */
function load(): CapabilityMap {
  try {
    const raw = fs.readFileSync(memoryFile(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const items: CapabilityMap = {};
    for (const [fingerprint, until] of Object.entries(parsed)) {
      if (typeof until === 'number' && Number.isFinite(until)) items[fingerprint] = until;
    }
    return items;
  } catch {
    return {};
  }
}

/** Guarda el mapa sin rasgos caducados y sin superar el tope de entradas. */
function save(items: CapabilityMap): void {
  try {
    const now = Date.now();
    const alive = Object.entries(items)
      .filter(([, until]) => until > now)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ENTRIES);
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = memoryFile();
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(alive), null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err: any) {
    // Persistir es una optimización: si falla, se sigue recordando en memoria
    // durante la vida del proceso, pero nunca se rompe la respuesta del chat.
    console.warn('[key-capabilities] no se pudo guardar:', err?.message || err);
  }
}

/** ¿Esta key ya demostró hace poco que no puede usar grounding ni code execution? */
export function keyLacksBuiltinTools(apiKey?: string): boolean {
  if (!apiKey) return false;
  const fingerprint = keyFingerprint(apiKey);
  const until = load()[fingerprint];
  return typeof until === 'number' && until > Date.now();
}

/**
 * Estado de la marca para una key: si está marcada y hasta cuándo.
 * Lo usa la UI para explicar por qué el chat deja de pedir grounding.
 */
export function builtinToolsMemory(apiKey?: string): { marked: boolean; expiresAt: number | null } {
  if (!apiKey) return { marked: false, expiresAt: null };
  const until = load()[keyFingerprint(apiKey)];
  if (typeof until !== 'number' || until <= Date.now()) return { marked: false, expiresAt: null };
  return { marked: true, expiresAt: until };
}

/** Recuerda que la key funcionó sin herramientas integradas porque no las admite. */
export function rememberKeyLacksBuiltinTools(apiKey?: string): void {
  if (!apiKey) return;
  const items = load();
  items[keyFingerprint(apiKey)] = Date.now() + capabilityTtlMs();
  save(items);
}

/** Olvida lo aprendido de una key (o de todas si se omite). */
export function forgetToolsMemory(apiKey?: string): void {
  if (apiKey) {
    const items = load();
    delete items[keyFingerprint(apiKey)];
    save(items);
    return;
  }
  save({});
}
