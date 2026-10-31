/**
 * Servidor de la app para el modo live de las evaluaciones.
 *
 * El modo live mide contra `/api/gemini/generate` (o el proveedor que toque) de
 * una app ya arrancada. Exigir que el usuario la levante aparte es la causa más
 * habitual de que una pasada live no llegue a empezar, así que el runner:
 *
 *   • si ya hay un servidor respondiendo en la URL objetivo, lo REUTILIZA y no
 *     lo toca al terminar (puede ser el `npm run dev` del usuario);
 *   • si no responde y la URL es loopback, arranca el suyo, espera a
 *     `/api/health` y lo apaga al acabar;
 *   • si no responde y la URL es remota, no inventa nada: error claro, porque
 *     arrancar un servidor local no haría que esa URL respondiera.
 *
 * Sólo se mata el proceso que arrancó este módulo, y sólo ese árbol: nunca se
 * busca por nombre ni se toca un puerto ajeno.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

/** Puerto por defecto del servidor de la app (`commander.json` → server.port). */
export const DEFAULT_PORT = 3280;

/** URL que usa el modo live si no se indica otra cosa. */
export const DEFAULT_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

const HEALTH_PATH = '/api/health';

/**
 * tsx compila `server.ts` al vuelo y, al arrancar, el optimizer de Vite puede
 * bloquear el event loop decenas de segundos: el health check no contesta
 * mientras tanto aunque el puerto ya escuche. Esperar de más aquí cuesta menos
 * que declarar muerto un servidor que está arrancando.
 */
const READY_TIMEOUT_MS = 120_000;

/**
 * Un solo `fetch` no distingue "no hay servidor" de "está ocupado": con el
 * event loop bloqueado, 1,5 s abortaban contra un servidor vivo. Varios
 * intentos, y generosos.
 */
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_ATTEMPTS = 3;
const PROBE_INTERVAL_MS = 700;

/** Sólo las últimas líneas del arranque: es un diagnóstico, no un log. */
const MAX_LOG_LINES = 40;

export interface EvalServer {
  baseUrl: string;
  /** `true` si este proceso arrancó el servidor (y por tanto lo apaga). */
  started: boolean;
  /** Detiene el servidor propio. Idempotente; no hace nada si se reutilizó uno. */
  stop(): void;
}

/** URL objetivo del modo live. */
export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.EVAL_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const port = Number(env.EVAL_PORT || env.PORT || DEFAULT_PORT);
  return `http://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT}`;
}

/** Sólo loopback: el único sitio donde arrancar un proceso local tiene sentido. */
export function isLoopback(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export type ServerPlan =
  | { action: 'reuse'; baseUrl: string }
  | { action: 'start'; baseUrl: string }
  | { action: 'error'; baseUrl: string; error: string };

/**
 * Decide qué hacer con el servidor. Es una función pura sobre las dos sondas
 * para poder probar la política sin abrir puertos.
 *
 * `portOpen` existe porque el health check HTTP no basta: un servidor de
 * desarrollo ocupado (Vite optimizando dependencias) acepta conexiones pero no
 * contesta, y tomarlo por ausente llevaría a intentar arrancar otro en el mismo
 * puerto. Si el puerto escucha, hay servidor: se reutiliza.
 */
export function planServer(opts: {
  baseUrl: string;
  alive: boolean;
  portOpen: boolean;
}): ServerPlan {
  const { baseUrl, alive, portOpen } = opts;
  if (alive || portOpen) return { action: 'reuse', baseUrl };
  if (!isLoopback(baseUrl)) {
    return {
      action: 'error',
      baseUrl,
      error:
        `${baseUrl} no responde a ${HEALTH_PATH} y no es loopback: arranca ese servidor tú mismo ` +
        'o apunta EVAL_BASE_URL a uno que responda',
    };
  }
  return { action: 'start', baseUrl };
}

/**
 * `true` si el servidor contesta el health check con 2xx. Un intento: para
 * decidir si hay servidor está `probeServer`.
 */
export async function probeHealth(
  baseUrl: string,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${HEALTH_PATH}`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sonda de decisión: varios intentos con pausa, para no confundir un servidor
 * ocupado con un servidor ausente.
 */
export async function probeServer(
  baseUrl: string,
  opts: { attempts?: number; timeoutMs?: number; intervalMs?: number } = {}
): Promise<boolean> {
  const attempts = opts.attempts ?? PROBE_ATTEMPTS;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? PROBE_INTERVAL_MS;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (await probeHealth(baseUrl, timeoutMs)) return true;
  }
  return false;
}

/** Guarda las últimas N líneas del arranque para poder enseñarlas si falla. */
function tailBuffer() {
  const lines: string[] = [];
  return {
    push(chunk: string) {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue;
        lines.push(line);
        if (lines.length > MAX_LOG_LINES) lines.shift();
      }
    },
    toString() {
      return lines.join('\n');
    },
  };
}

function portOf(baseUrl: string): number {
  const url = new URL(baseUrl);
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

/**
 * `true` si algo escucha en el puerto, a nivel TCP: contesta aunque el
 * servidor tenga el event loop bloqueado y no pueda atender el health check.
 */
export function probePort(baseUrl: string, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });
    try {
      const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
      socket.connect({ host, port: portOf(baseUrl) });
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
}

/** Mata el árbol del proceso que arrancamos. Nunca se busca por nombre. */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    // Detached ⇒ líder de grupo: el signo negativo alcanza a sus hijos.
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* ya estaba muerto */
    }
  }
}

async function startServer(baseUrl: string, log: (line: string) => void): Promise<EvalServer> {
  const cwd = process.cwd();
  const port = portOf(baseUrl);
  // Se lanza el CLI de tsx con el propio `node`, no `npx`: así el PID es el
  // servidor y no una cadena de lanzadores que luego hay que perseguir.
  const tsxCli = path.join(cwd, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!fs.existsSync(tsxCli)) {
    throw new Error(`no encuentro tsx en ${tsxCli}; ejecuta npm install antes de eval:live`);
  }

  const lines = tailBuffer();
  const child: ChildProcess = spawn(process.execPath, [tsxCli, 'server.ts'], {
    cwd,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) },
  });
  child.stdout?.on('data', (chunk) => lines.push(String(chunk)));
  child.stderr?.on('data', (chunk) => lines.push(String(chunk)));

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (child.pid) killTree(child.pid);
  };
  // Si el runner muere por una excepción o Ctrl+C, el servidor no queda vivo.
  process.once('exit', stop);

  log(`  servidor: no respondía ${baseUrl}; arrancando uno propio en el puerto ${port}`);

  const startedAt = Date.now();
  const deadline = startedAt + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      stop();
      throw new Error(
        `el servidor propio terminó durante el arranque (código ${child.exitCode ?? child.signalCode})` +
          (lines.toString() ? `\n${lines.toString()}` : '')
      );
    }
    // El puerto lo ocupa otro proceso: esperar 2 minutos no lo arregla.
    if (/EADDRINUSE/.test(lines.toString())) {
      stop();
      throw new Error(
        `el puerto ${port} ya está ocupado por otro proceso (EADDRINUSE): ` +
          `libéralo o apunta EVAL_BASE_URL a ese servidor`
      );
    }
    // Sondeo secuencial: el bucle ya espera entre intentos.
    if (await probeHealth(baseUrl, PROBE_TIMEOUT_MS)) {
      log(`  servidor: listo en ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      return { baseUrl, started: true, stop };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  stop();
  throw new Error(
    `el servidor propio no respondió ${HEALTH_PATH} en ${READY_TIMEOUT_MS / 1000}s` +
      (lines.toString() ? `\n${lines.toString()}` : '')
  );
}

/**
 * Garantiza un servidor para el modo live. Reutiliza el que ya esté arriba y,
 * si no hay ninguno y la URL es loopback, arranca uno y lo devuelve para poder
 * pararlo al terminar.
 */
export async function ensureEvalServer(
  opts: { baseUrl?: string; log?: (line: string) => void } = {}
): Promise<EvalServer> {
  const log = opts.log ?? (() => {});
  const baseUrl = opts.baseUrl ?? resolveBaseUrl();
  const alive = await probeServer(baseUrl);
  const portOpen = alive || (await probePort(baseUrl));
  const plan = planServer({ baseUrl, alive, portOpen });

  if (plan.action === 'error') throw new Error(plan.error);
  if (plan.action === 'reuse') {
    log(
      alive
        ? `  servidor: reutilizando el que ya responde en ${baseUrl}`
        : `  servidor: el puerto de ${baseUrl} escucha pero ${HEALTH_PATH} aún no contesta; ` +
            'se reutiliza ese servidor en vez de arrancar otro'
    );
    return { baseUrl, started: false, stop: () => {} };
  }
  return startServer(baseUrl, log);
}
