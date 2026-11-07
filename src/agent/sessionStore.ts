/**
 * Persistencia de sesiones ejecutables (F1-02).
 *
 * Un archivo JSON por sesión en `.commander/agent-sessions/<id>.json`:
 *
 * - Escritura atómica (`tmp` + `rename`): un corte a mitad nunca deja el JSON
 *   a medias; el archivo anterior sigue siendo legible.
 * - Límites duros: 50 sesiones, 200 pasos y 2 MB por archivo. Al pasarse se
 *   recorta lo viejo (nunca se corrompe el JSON).
 * - Lectura tolerante con `decodeSessionState`: un archivo corrupto o de otra
 *   versión no tumba al servidor, simplemente no se carga.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  SESSION_SCHEMA_VERSION,
  decodeSessionState,
  encodeSessionState,
  type SessionStateV2,
} from './sessionTypes';

export const SESSION_DIR_ENV = 'COMMANDER_AGENT_SESSIONS_DIR';
export const MAX_SESSIONS = 50;
export const MAX_STEPS = 200;
export const MAX_STATE_BYTES = 2 * 1024 * 1024;
/** Tope de elementos del plan al recortar por tamaño. */
const MAX_PLAN_ITEMS = 20;

/**
 * Ids válidos: lo que genera `uid('sess')` y nada más.
 *
 * Sin `/`, `\`, `:` ni `.` no hay forma de salirse del directorio, y la
 * comparación es laxa a propósito para no rechazar ids ya persistidos.
 */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

/**
 * Directorio por defecto. `COMMANDER_AGENT_SESSIONS_DIR` permite aislar tests y
 * despliegues sin tocar el `.commander` del proyecto.
 */
export function defaultSessionsDir(cwd = process.cwd()): string {
  const override = process.env[SESSION_DIR_ENV]?.trim();
  return override ? path.resolve(override) : path.join(cwd, '.commander', 'agent-sessions');
}

export interface SessionStore {
  readonly dir: string;
  /** Guarda el estado recortado a los límites y devuelve lo que quedó en disco. */
  save(state: SessionStateV2): SessionStateV2;
  load(id: string): SessionStateV2 | null;
  list(): SessionStateV2[];
  remove(id: string): boolean;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Recorta un estado hasta que quepa en los límites.
 *
 * El orden importa: primero se tiran pasos viejos, después turnos viejos y sólo
 * como último recurso se recorta el contenido de lo que queda. Siempre se
 * serializa un objeto completo, así que el JSON resultante es válido.
 */
export function compactSessionState(state: SessionStateV2): SessionStateV2 {
  let next: SessionStateV2 =
    state.steps.length > MAX_STEPS
      ? { ...state, steps: state.steps.slice(-MAX_STEPS) }
      : state;
  if (byteLength(encodeSessionState(next)) <= MAX_STATE_BYTES) return next;

  // Pasos: se descarta el principio (lo más viejo) en bloques del 25 %.
  let keep = next.steps.length;
  while (keep > 0) {
    keep = Math.floor(keep * 0.75);
    next = { ...next, steps: next.steps.slice(next.steps.length - keep) };
    if (byteLength(encodeSessionState(next)) <= MAX_STATE_BYTES) return next;
  }

  // Turnos: mismo criterio.
  let turns = next.turns.length;
  while (turns > 0) {
    turns = Math.floor(turns * 0.75);
    next = { ...next, turns: next.turns.slice(next.turns.length - turns) };
    if (byteLength(encodeSessionState(next)) <= MAX_STATE_BYTES) return next;
  }

  // Último recurso: acotar el contenido de cada pieza. Con esto el tamaño queda
  // dominado por los topes de pasos/turnos, muy por debajo de 2 MB.
  return {
    ...next,
    steps: next.steps.map((step) => ({
      ...step,
      content: step.content.slice(-1_000),
      input: undefined,
      output: undefined,
    })),
    turns: next.turns.map((turn) => ({ ...turn, text: turn.text.slice(-1_000) })),
    plan: next.plan.slice(0, MAX_PLAN_ITEMS),
  };
}

/** `Atomics.wait` da una espera síncrona corta sin busy-loop. */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* si el runtime no lo soporta, se reintenta sin esperar */
  }
}

/**
 * `rename` es atómico, pero en Windows puede fallar con EPERM/EBUSY si el
 * antivirus o un lector tienen el destino abierto un instante: se reintenta.
 */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      const retriable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (!retriable || attempt >= 4) throw error;
      sleepSync(15 * (attempt + 1));
    }
  }
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    renameWithRetry(tmp, file);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* el tmp ya no está */
    }
    throw error;
  }
}

/** Deja como mucho `MAX_SESSIONS`, borrando las de mtime más viejo. */
function pruneSessions(root: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return;
  }
  // El caso normal es no podar: se evita un `stat` por archivo en cada
  // escritura (el estado se persiste en cada paso de la sesión).
  const present = names.filter((name) => name.endsWith('.json'));
  if (present.length <= MAX_SESSIONS) return;
  const files: Array<{ name: string; file: string; mtime: number }> = [];
  for (const name of present) {
    const file = path.join(root, name);
    try {
      files.push({ name, file, mtime: fs.statSync(file).mtimeMs });
    } catch {
      /* desapareció entre readdir y stat */
    }
  }
  files.sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name));
  for (const entry of files.slice(0, files.length - MAX_SESSIONS)) {
    try {
      fs.unlinkSync(entry.file);
    } catch {
      /* otro proceso lo borró */
    }
  }
}

export function createSessionStore(dir = defaultSessionsDir()): SessionStore {
  const root = path.resolve(dir);
  const fileFor = (id: string) => path.join(root, `${id}.json`);

  const load = (id: string): SessionStateV2 | null => {
    if (!isValidSessionId(id)) return null;
    let text: string;
    try {
      text = fs.readFileSync(fileFor(id), 'utf8');
    } catch {
      return null;
    }
    return decodeSessionState(text);
  };

  const list = (): SessionStateV2[] => {
    let names: string[];
    try {
      names = fs.readdirSync(root);
    } catch {
      return [];
    }
    const out: SessionStateV2[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const state = load(name.slice(0, -'.json'.length));
      if (state) out.push(state);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
  };

  return {
    dir: root,

    save(state: SessionStateV2): SessionStateV2 {
      if (!isValidSessionId(state.id)) {
        throw new Error(`id de sesión inválido: ${String(state.id)}`);
      }
      const next = compactSessionState({ ...state, schemaVersion: SESSION_SCHEMA_VERSION });
      fs.mkdirSync(root, { recursive: true });
      writeAtomic(fileFor(next.id), encodeSessionState(next));
      pruneSessions(root);
      return next;
    },

    load,
    list,

    remove(id: string): boolean {
      if (!isValidSessionId(id)) return false;
      try {
        fs.unlinkSync(fileFor(id));
        return true;
      } catch {
        return false;
      }
    },
  };
}
