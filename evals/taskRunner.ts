/**
 * Tareas T1–T5 y T8 en proceso hijo.
 *
 * Igual que los escenarios: si el proceso de la corrida muere, el padre
 * registra el código de salida y sigue con la próxima, en vez de perder la
 * tanda entera.
 */
import path from 'node:path';
import type { EvalOutcome } from './harness.js';
import { runIsolated, type IsolatedRun } from './isolatedRun.js';

/** Tareas que corren en su propio proceso, en el orden de la baseline. */
export const ISOLATED_TASKS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T8'] as const;
export type IsolatedTask = (typeof ISOLATED_TASKS)[number];

export function isIsolatedTask(value: unknown): value is IsolatedTask {
  return typeof value === 'string' && (ISOLATED_TASKS as readonly string[]).includes(value);
}

export interface TaskRunOptions {
  task: IsolatedTask;
  model: string;
  baseUrl: string;
  timeoutMs?: number;
  /** Sólo pruebas: worker alternativo que simula una muerte. */
  workerPath?: string;
}

export interface TaskIsolatedOptions extends TaskRunOptions {
  /** Archivo JSON donde el worker deja `{ result, toolCalls, answer }`. */
  resultPath: string;
}

/** Worker por defecto, relativo a la raíz del proyecto. */
export function taskWorkerPath(): string {
  return path.join(process.cwd(), 'evals', 'taskWorker.ts');
}

/** Argumentos del worker; expuestos para fijar el ruteo de las seis tareas. */
export function taskWorkerArgs(opts: TaskRunOptions, resultPath: string, workerPath = taskWorkerPath()): string[] {
  return [
    '--import',
    'tsx',
    workerPath,
    '--task',
    opts.task,
    '--model',
    opts.model,
    '--baseUrl',
    opts.baseUrl,
    '--out',
    resultPath,
  ];
}

/**
 * Corre una tarea en un proceso aparte. Si el worker muere, `result` queda
 * vacío y `error` trae el código de salida y la cola de stderr.
 */
export function runTaskIsolated(opts: TaskIsolatedOptions): Promise<IsolatedRun<EvalOutcome>> {
  return runIsolated<EvalOutcome>({
    command: process.execPath,
    args: taskWorkerArgs(opts, opts.resultPath, opts.workerPath),
    resultPath: opts.resultPath,
    timeoutMs: (opts.timeoutMs ?? 300_000) + 120_000,
  });
}

/** Resultado a registrar cuando el worker no dejó archivo. */
export function isolatedTaskFailureOutcome(
  task: IsolatedTask,
  isolated: Pick<IsolatedRun<EvalOutcome>, 'error'>,
  started: number
): EvalOutcome {
  return {
    id: task,
    passed: false,
    steps: 0,
    durationMs: Date.now() - started,
    checks: [],
    stopReason: 'error',
    timedOut: false,
    error: isolated.error ?? `la corrida de ${task} no dejó resultado`,
  };
}
