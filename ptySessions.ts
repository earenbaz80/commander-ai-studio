/**
 * Sesiones PTY persistentes para el agente.
 *
 * `shell.run` ejecuta un comando y devuelve su salida; esto es lo otro: abrir un
 * proceso interactivo REAL (REPL de node, `npm init`, un TUI) y hablar con él a
 * lo largo de varias llamadas —escribir, leer sólo lo nuevo, redimensionar y
 * cerrar—. El proceso ve un terminal de verdad (`isatty` cierto), así que los
 * programas que cambian de comportamiento sin TTY funcionan aquí.
 *
 * Dos reglas que no se negocian:
 *
 * 1. **Nada de un shell interpretando la orden.** Se lanza un ejecutable con su
 *    array de argumentos (`spawnPty(bin, args)`), sin `cmd /c`, así que no hay
 *    `;`, `&&` ni redirects que se cuelen en la línea de la tool.
 * 2. **Sólo se toca lo que este registro abrió.** `read`/`write`/`close` piden
 *    un id del registro y, cuando la sesión pertenece a una sesión del agente,
 *    sólo esa sesión puede usarla. No hay forma de escribir en un proceso
 *    ajeno ni de matar un PID arbitrario.
 *
 * La salida se guarda en un buffer con cursor absoluto: el agente lee desde el
 * byte que le devolvió la llamada anterior y nunca se le repite lo ya visto.
 */
import { spawn as spawnPty, type IPty } from 'node-pty';
import childProcess, { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

/**
 * En Windows, node-pty forkea `conpty_console_list_agent` para enumerar los
 * procesos de la consola: al matar y otra vez al procesar la salida del shell.
 * Ese hijo hereda `process.execArgv` (bajo tsx se lleva `--import tsx`) y no
 * comparte la consola del padre, así que muere con «AttachConsole failed» y su
 * promesa sólo se resuelve por el timeout de 5 s: ruido en el log y cinco
 * segundos colgados por cada cierre. El árbol ya lo mata `taskkill /T`, así que
 * se sustituye sólo ese agente —cualquier otro `fork` pasa intacto— por uno que
 * responde al instante con una lista vacía.
 */
const forkOriginal = childProcess.fork;
if (process.platform === 'win32') {
  (childProcess as any).fork = function (modulePath: unknown, ...rest: unknown[]) {
    if (typeof modulePath === 'string' && modulePath.includes('conpty_console_list_agent')) {
      const agente = new EventEmitter() as EventEmitter & { kill: () => void };
      agente.kill = () => {};
      setImmediate(() => agente.emit('message', { consoleProcessList: [] }));
      return agente;
    }
    return (forkOriginal as any).call(childProcess, modulePath, ...rest);
  };
}

/** Máximo de sesiones vivas a la vez: cada una es un proceso real. */
export const MAX_PTYS = 4;

/** Tope del buffer por sesión (se descarta lo más viejo primero). */
export const MAX_BUFFER_CHARS = 256 * 1024;

/** Una sesión sin uso se cierra sola: nada de shells huérfanas. */
export const IDLE_TTL_MS = 15 * 60 * 1000;

/** Tope de un `write` en una llamada. */
export const MAX_WRITE_CHARS = 4000;

export type PtyStatus = 'running' | 'exited';

interface Session {
  id: string;
  executable: string;
  args: string[];
  cwd: string;
  sessionId: string | null;
  pty: IPty;
  pid: number;
  cols: number;
  rows: number;
  startedAt: number;
  status: PtyStatus;
  exitCode: number | null;
  endedAt: number | null;
  /** Última parte de la salida (como mucho MAX_BUFFER_CHARS). */
  buffer: string;
  /** Caracteres emitidos en total: el cursor que ve el agente. */
  total: number;
  lastUsed: number;
  /**
   * Tamaño pedido antes de que el PTY esté listo. node-pty encola ese resize y
   * lo aplica al arrancar; si el proceso muere antes, el resize encolado se
   * ejecuta sobre un PTY ya cerrado y lanza «Cannot resize a pty that has
   * already exited» fuera de todo try. Se guarda aquí y se aplica al primer
   * dato, que es cuando el PTY ya existe de verdad.
   */
  pendingResize: { cols: number; rows: number } | null;
}

export interface PublicPty {
  id: string;
  executable: string;
  args: string[];
  cwd: string;
  pid: number;
  cols: number;
  rows: number;
  startedAt: number;
  status: PtyStatus;
  exitCode: number | null;
  running: boolean;
  runningMs: number;
  /** Caracteres de salida emitidos hasta ahora (cursor final). */
  cursor: number;
  ownerSessionId: string | null;
}

const sessions = new Map<string, Session>();
let seq = 0;

/**
 * Ejecutables que jamás se abren desde una tool: son los mismos bloqueos que
 * `shell.run` aplica, pero aquí no hay allowlist por comando (el valor de un PTY
 * es justo lo interactivo), así que la puerta es la denylist más la aprobación.
 */
const DENY_BIN = /^(sudo|su|doas|pkexec|shutdown|reboot|halt|poweroff|format|mkfs|diskpart|bcdedit|reg|regedit|netsh|sc|taskkill|pkill|killall|iptables|systemctl|service|useradd|usermod|userdel|passwd|mount|umount|dd|fdisk)$/i;

/**
 * Mata el árbol del PTY y suelta los handles.
 *
 * `taskkill /T` se lleva los hijos que ConPTY deja sueltos (npm → node) y
 * `pty.kill()` cierra los sockets; sin ese segundo paso el proceso se queda
 * con handles abiertos y no termina.
 */
export function killPtyTree(pty: IPty): void {
  if (process.platform === 'win32') {
    try {
      execFile('taskkill', ['/F', '/T', '/PID', String(pty.pid)], { windowsHide: true }, () => {});
    } catch {
      /* sin taskkill se intenta el kill normal */
    }
  }
  try {
    pty.kill();
  } catch {
    /* ya murió */
  }
  // node-pty 1.1.0 deja viva la conexión del conout hasta que llega el último
  // dato; si el shell ya no escribe nada, ese pipe mantiene el proceso abierto
  // (en los tests impide terminar; en la app no se nota). Se libera a mano.
  const agente = (pty as any)._agent;
  try {
    agente?._conoutSocketWorker?.dispose?.();
  } catch {
    /* interno de node-pty: si cambia de forma, el kill ya hizo lo importante */
  }
  try {
    agente?._outSocket?.destroy?.();
  } catch {
    /* idem */
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** ¿Este ejecutable es de los que no se abren nunca? Mira también la ruta. */
export function isDeniedExecutable(executable: string): boolean {
  const base = path.basename(String(executable || '')).replace(/\.(exe|cmd|bat|com|ps1)$/i, '');
  return DENY_BIN.test(base);
}

/**
 * Resuelve el ejecutable como haría el sistema: ruta explícita tal cual, o
 * búsqueda en PATH (con PATHEXT en Windows). Devuelve null si no existe, para
 * que el error sea «no existe» y no un spawn fallido dentro de node-pty.
 */
export function resolveExecutable(executable: string): string | null {
  const raw = String(executable || '').trim();
  if (!raw) return null;
  if (raw.includes('/') || raw.includes('\\')) {
    try {
      return fs.statSync(raw).isFile() ? raw : null;
    } catch {
      return null;
    }
  }
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, raw.endsWith(ext) ? raw : raw + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* siguiente */
      }
    }
  }
  return null;
}

function toPublic(s: Session): PublicPty {
  return {
    id: s.id,
    executable: s.executable,
    args: s.args,
    cwd: s.cwd,
    pid: s.pid,
    cols: s.cols,
    rows: s.rows,
    startedAt: s.startedAt,
    status: s.status,
    exitCode: s.exitCode,
    running: s.status === 'running',
    runningMs: (s.endedAt ?? Date.now()) - s.startedAt,
    cursor: s.total,
    ownerSessionId: s.sessionId,
  };
}

/** ¿Puede esta llamada usar la sesión? La del agente sólo la ve su dueño. */
function ownedBy(s: Session, sessionId: string | null): boolean {
  return s.sessionId === null || sessionId === null || s.sessionId === sessionId;
}

function evictIfFull(): string | null {
  if (sessions.size < MAX_PTYS) return null;
  for (const [id, s] of sessions) {
    if (s.status !== 'running') {
      sessions.delete(id);
      return null;
    }
  }
  const ids = [...sessions.keys()].join(', ');
  return `Ya hay ${MAX_PTYS} sesiones PTY abiertas (${ids}); cierra alguna con { action: "close", id } antes de abrir otra.`;
}

function append(s: Session, data: string): void {
  if (s.pendingResize) {
    // Se aplica en el siguiente tick, no en el propio evento de datos: en ese
    // instante node-pty todavía puede no estar «listo» y encolaría el resize,
    // que luego se dispara sobre un PTY ya cerrado y lanza fuera de todo try.
    const { cols, rows } = s.pendingResize;
    s.pendingResize = null;
    const timer = setTimeout(() => {
      if (s.status !== 'running') return;
      try {
        s.pty.resize(cols, rows);
      } catch {
        /* el proceso murió antes del resize */
      }
    }, 80);
    timer.unref?.();
  }
  s.buffer += data;
  s.total += data.length;
  if (s.buffer.length > MAX_BUFFER_CHARS) {
    const drop = s.buffer.length - MAX_BUFFER_CHARS;
    s.buffer = s.buffer.slice(drop);
  }
  s.lastUsed = Date.now();
}

export interface OpenPtyInput {
  executable: string;
  args?: string[];
  cwd: string;
  sessionId?: string | null;
  cols?: number;
  rows?: number;
}

export type PtyResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export function openPty(input: OpenPtyInput): PtyResult<{ pty: PublicPty }> {
  const full = evictIfFull();
  if (full) return { ok: false, error: full };

  const executable = String(input.executable || '').trim().slice(0, 300);
  if (!executable) return { ok: false, error: 'executable requerido' };
  if (isDeniedExecutable(executable)) {
    return { ok: false, error: `«${path.basename(executable)}» no se puede abrir desde una tool` };
  }
  const resolved = resolveExecutable(executable);
  if (!resolved) return { ok: false, error: `No se encontró el ejecutable: ${executable}` };

  const args = (Array.isArray(input.args) ? input.args : []).map((a) => String(a).slice(0, 500)).slice(0, 20);
  const cwd = String(input.cwd || '').trim();
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    return { ok: false, error: `cwd no es un directorio: ${cwd || '(vacío)'}` };
  }

  let pty: IPty;
  try {
    pty = spawnPty(resolved, args, {
      name: 'xterm-256color',
      cols: clampInt(input.cols, 2, 500, 100),
      rows: clampInt(input.rows, 1, 300, 30),
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as { [key: string]: string },
    });
  } catch (err) {
    return { ok: false, error: `No se pudo abrir el PTY: ${err instanceof Error ? err.message : String(err)}` };
  }

  const id = `pty-${++seq}`;
  const session: Session = {
    id,
    executable: resolved,
    args,
    cwd,
    sessionId: input.sessionId ?? null,
    pty,
    pid: pty.pid,
    cols: clampInt(input.cols, 2, 500, 100),
    rows: clampInt(input.rows, 1, 300, 30),
    startedAt: Date.now(),
    status: 'running',
    exitCode: null,
    endedAt: null,
    buffer: '',
    total: 0,
    lastUsed: Date.now(),
    pendingResize: null,
  };
  sessions.set(id, session);

  pty.onData((data: string) => append(session, data));
  pty.onExit(({ exitCode }: { exitCode: number }) => {
    session.status = 'exited';
    session.exitCode = exitCode ?? 0;
    session.endedAt = Date.now();
    session.lastUsed = Date.now();
  });

  return { ok: true, pty: toPublic(session) };
}

/**
 * Devuelve la salida nueva desde `cursor`. Si el cursor se quedó atrás porque el
 * buffer descartó lo viejo, se avisa con `dropped` en vez de fingir continuidad.
 */
export function readPty(
  id: string,
  cursor: number,
  sessionId: string | null,
): PtyResult<{ output: string; cursor: number; dropped: number; pty: PublicPty }> {
  const s = sessions.get(id);
  if (!s) return { ok: false, error: `No existe la sesión PTY ${id}` };
  if (!ownedBy(s, sessionId)) return { ok: false, error: 'Esa sesión PTY pertenece a otro agente' };

  const base = s.total - s.buffer.length;
  const from = Math.max(Number.isFinite(cursor) ? Math.trunc(cursor) : 0, base);
  const output = s.buffer.slice(from - base);
  s.lastUsed = Date.now();
  return { ok: true, output, cursor: s.total, dropped: Math.max(0, from - base), pty: toPublic(s) };
}

export function writePty(id: string, data: string, sessionId: string | null): PtyResult<{ pty: PublicPty }> {
  const s = sessions.get(id);
  if (!s) return { ok: false, error: `No existe la sesión PTY ${id}` };
  if (!ownedBy(s, sessionId)) return { ok: false, error: 'Esa sesión PTY pertenece a otro agente' };
  if (s.status !== 'running') return { ok: false, error: `La sesión ${id} ya terminó (código ${s.exitCode ?? 0})` };
  const text = String(data ?? '');
  if (!text) return { ok: false, error: 'data requerido para write' };
  if (text.length > MAX_WRITE_CHARS) return { ok: false, error: `data demasiado largo (máx. ${MAX_WRITE_CHARS} caracteres)` };
  s.pty.write(text);
  s.lastUsed = Date.now();
  return { ok: true, pty: toPublic(s) };
}

export function resizePty(
  id: string,
  cols: number,
  rows: number,
  sessionId: string | null,
): PtyResult<{ pty: PublicPty }> {
  const s = sessions.get(id);
  if (!s) return { ok: false, error: `No existe la sesión PTY ${id}` };
  if (!ownedBy(s, sessionId)) return { ok: false, error: 'Esa sesión PTY pertenece a otro agente' };
  if (s.status !== 'running') return { ok: false, error: `La sesión ${id} ya terminó` };
  s.cols = clampInt(cols, 2, 500, s.cols);
  s.rows = clampInt(rows, 1, 300, s.rows);
  if (s.total === 0) {
    // Todavía no llegó ni el prompt: se aplica en el primer dato.
    s.pendingResize = { cols: s.cols, rows: s.rows };
    s.lastUsed = Date.now();
    return { ok: true, pty: toPublic(s) };
  }
  try {
    s.pty.resize(s.cols, s.rows);
  } catch {
    return { ok: false, error: 'El PTY no acepta ese tamaño' };
  }
  s.lastUsed = Date.now();
  return { ok: true, pty: toPublic(s) };
}

export function closePty(id: string, sessionId: string | null): PtyResult<{ pty: PublicPty }> {
  const s = sessions.get(id);
  if (!s) return { ok: false, error: `No existe la sesión PTY ${id}` };
  if (!ownedBy(s, sessionId)) return { ok: false, error: 'Esa sesión PTY pertenece a otro agente' };
  if (s.status === 'running') {
    killPtyTree(s.pty);
    s.status = 'exited';
    s.endedAt = Date.now();
  }
  return { ok: true, pty: toPublic(s) };
}

export function listPtys(): PublicPty[] {
  return [...sessions.values()].map(toPublic);
}

/** Cierra las sesiones de una tanda del agente (fin de sesión o cancelación). */
export function closePtysForSession(sessionId: string | null): number {
  if (!sessionId) return 0;
  let closed = 0;
  for (const s of sessions.values()) {
    if (s.sessionId === sessionId && s.status === 'running') {
      killPtyTree(s.pty);
      s.status = 'exited';
      s.endedAt = Date.now();
      closed++;
    }
  }
  return closed;
}

/** Cierra todo: se llama al apagar el servidor para no dejar shells vivas. */
export function closeAllPtys(): void {
  for (const s of sessions.values()) {
    if (s.status === 'running') killPtyTree(s.pty);
  }
  sessions.clear();
}

// Barrido de inactividad: `unref` para que no sostenga el proceso del servidor.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.status === 'running' && now - s.lastUsed > IDLE_TTL_MS) {
      killPtyTree(s.pty);
      s.status = 'exited';
      s.endedAt = now;
    }
    if (s.status !== 'running' && now - s.lastUsed > IDLE_TTL_MS) sessions.delete(id);
  }
}, 60_000);
sweeper.unref?.();
