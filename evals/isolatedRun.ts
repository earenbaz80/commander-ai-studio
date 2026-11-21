/**
 * Corrida aislada en un proceso hijo.
 *
 * Dos tandas de T10 (2026-11-21) murieron a mitad de corrida con código 1, sin
 * traza de JS, sin resumen y sin línea en el JSONL: el runner se llevó por
 * delante la tanda entera. Con la corrida en su propio proceso, una muerte así
 * pierde como máximo esa corrida y deja un `error` con el código de salida.
 *
 * Tareas (T1–T5, T8) y escenarios (T6, T7, T9, T10) comparten un solo camino:
 * `runIsolatedId` arma los argumentos, lanza el worker único (`runWorker.ts`) y
 * convierte un proceso sin resultado en un `EvalOutcome` de error.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EvalOutcome } from './harness.js';

export interface IsolatedRun<T> {
  /** Resultado que dejó el worker, si terminó y escribió el archivo. */
  result?: T;
  toolCalls: number;
  answer: string;
  /** Motivo cuando no hubo resultado: muerte, error de arranque o timeout. */
  error?: string;
  exitCode: number | null;
  signal: string | null;
}

export interface IsolatedRunOptions {
  command: string;
  args: string[];
  /** Archivo JSON donde el worker deja `{ result, toolCalls, answer }`. */
  resultPath: string;
  /** Tope del proceso; al vencerlo se mata al hijo. */
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

/** Sólo las últimas líneas de stderr: es diagnóstico, no un log completo. */
const MAX_STDERR = 4_000;

/** Presupuesto live del arnés (`LIVE_TASK_TIMEOUT_MS`); el worker lo recibe por env. */
const DEFAULT_RUN_BUDGET_MS = 300_000;
/**
 * Margen sobre el presupuesto para que el timeout «de verdad» lo informe la
 * corrida; este tope sólo corta un worker colgado.
 */
const WORKER_GRACE_MS = 120_000;
/** Si el worker ignora SIGTERM, se fuerza la salida pasado este margen. */
const KILL_GRACE_MS = 5_000;

export function runIsolated<T>(opts: IsolatedRunOptions): Promise<IsolatedRun<T>> {
  try {
    fs.rmSync(opts.resultPath, { force: true });
  } catch {
    /* el archivo se reescribe o el worker falla y se informa */
  }
  return new Promise((resolve) => {
    let settled = false;
    let stderr = '';
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const child = spawn(opts.command, opts.args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, ...opts.env },
      windowsHide: true,
    });
    const clearTimers = () => {
      if (killTimer) clearTimeout(killTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };
    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (exitCode === 0) {
        try {
          const payload = JSON.parse(fs.readFileSync(opts.resultPath, 'utf8'));
          resolve({
            result: payload?.result as T,
            toolCalls: Number(payload?.toolCalls ?? 0),
            answer: String(payload?.answer ?? ''),
            exitCode,
            signal,
          });
          return;
        } catch {
          /* sin archivo válido se informa abajo */
        }
      }
      const cola = stderr.trim().split(/\r?\n/).slice(-3).join(' | ');
      const motivo = timedOut
        ? `la corrida no terminó en ${Math.round(opts.timeoutMs / 1000)}s`
        : exitCode !== null
          ? `el proceso de la corrida terminó con código ${exitCode} sin dejar resultado`
          : `el proceso de la corrida terminó con señal ${signal ?? 'desconocida'} sin dejar resultado`;
      resolve({
        toolCalls: 0,
        answer: '',
        error: cola ? `${motivo}: ${cola}` : motivo,
        exitCode,
        signal,
      });
    };
    killTimer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* ya había terminado */
      }
      // Un hijo que ignora SIGTERM no puede colgar la tanda entera.
      forceKillTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ya había terminado */
        }
      }, KILL_GRACE_MS);
      forceKillTimer.unref();
    }, opts.timeoutMs);
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > MAX_STDERR) stderr = stderr.slice(-MAX_STDERR);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({
        toolCalls: 0,
        answer: '',
        error: `no se pudo lanzar la corrida: ${error.message}`,
        exitCode: null,
        signal: null,
      });
    });
    child.once('exit', (code, signal) => finish(code, signal));
  });
}

/** Resultado a registrar cuando la corrida no dejó resultado o el padre falló. */
export function errorOutcome(id: string, error: string, started: number): EvalOutcome {
  return {
    id,
    passed: false,
    steps: 0,
    durationMs: Date.now() - started,
    checks: [],
    stopReason: 'error',
    timedOut: false,
    error,
  };
}

/** Tareas que corren en su propio proceso, en el orden de la baseline. */
export const ISOLATED_TASKS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T8'] as const;
export type IsolatedTask = (typeof ISOLATED_TASKS)[number];

/** Escenarios que corren en su propio proceso, en el orden de la baseline. */
export const ISOLATED_SCENARIOS = ['T6', 'T7', 'T9', 'T10'] as const;
export type IsolatedScenario = (typeof ISOLATED_SCENARIOS)[number];

export type IsolatedId = IsolatedTask | IsolatedScenario;

export function isIsolatedTask(value: unknown): value is IsolatedTask {
  return typeof value === 'string' && (ISOLATED_TASKS as readonly string[]).includes(value);
}

export function isIsolatedScenario(value: unknown): value is IsolatedScenario {
  return typeof value === 'string' && (ISOLATED_SCENARIOS as readonly string[]).includes(value);
}

export function isIsolatedId(value: unknown): value is IsolatedId {
  return isIsolatedTask(value) || isIsolatedScenario(value);
}

/** Qué corre el worker para este id; lo usan el worker y la baseline. */
export function isolatedKind(id: IsolatedId): 'task' | 'scenario' {
  return isIsolatedTask(id) ? 'task' : 'scenario';
}

/** Worker único, junto a este módulo (no depende del cwd). */
function defaultWorkerPath(): string {
  return fileURLToPath(new URL('./runWorker.ts', import.meta.url));
}

export interface WorkerArgsOptions {
  id: IsolatedId;
  model: string;
  baseUrl: string;
}

/** Argumentos del worker; expuestos para fijar el ruteo de las diez corridas. */
export function workerArgs(
  opts: WorkerArgsOptions,
  resultPath: string,
  workerPath = defaultWorkerPath()
): string[] {
  return [
    '--import',
    'tsx',
    workerPath,
    '--id',
    opts.id,
    '--model',
    opts.model,
    '--baseUrl',
    opts.baseUrl,
    '--out',
    resultPath,
  ];
}

export interface IsolatedRunRequest extends WorkerArgsOptions {
  timeoutMs?: number;
  /** Sólo pruebas: worker alternativo que simula una muerte. */
  workerPath?: string;
  /** Archivo JSON donde el worker deja `{ result, toolCalls, answer }`. */
  resultPath: string;
}

/**
 * Corre una tarea o un escenario en un proceso aparte. Si el worker muere,
 * `result` queda vacío y `error` trae el código de salida y la cola de stderr.
 */
export function runIsolatedId(opts: IsolatedRunRequest): Promise<IsolatedRun<EvalOutcome>> {
  return runIsolated<EvalOutcome>({
    command: process.execPath,
    args: workerArgs(opts, opts.resultPath, opts.workerPath),
    resultPath: opts.resultPath,
    timeoutMs: (opts.timeoutMs ?? DEFAULT_RUN_BUDGET_MS) + WORKER_GRACE_MS,
  });
}

/** Resultado a registrar cuando el worker no dejó archivo. */
export function isolatedFailureOutcome(
  id: IsolatedId,
  isolated: Pick<IsolatedRun<EvalOutcome>, 'error'>,
  started: number
): EvalOutcome {
  return errorOutcome(id, isolated.error ?? `la corrida de ${id} no dejó resultado`, started);
}
