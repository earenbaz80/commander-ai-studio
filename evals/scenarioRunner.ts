/**
 * Escenarios del arnés en proceso hijo: T6, T7, T9 y T10.
 *
 * El 2026-11-21 el runner murió dos veces a mitad de T10 con código 1, sin
 * traza de JS, y se llevó la tanda entera. La corrida aislada convierte esa
 * muerte en un `error` registrable y deja seguir con la siguiente corrida.
 */
import path from 'node:path';
import type { EvalOutcome } from './harness.js';
import { runIsolated, type IsolatedRun } from './isolatedRun.js';

/** Escenarios que corren en su propio proceso, en el orden de la baseline. */
export const ISOLATED_SCENARIOS = ['T6', 'T7', 'T9', 'T10'] as const;
export type IsolatedScenario = (typeof ISOLATED_SCENARIOS)[number];

export function isIsolatedScenario(value: unknown): value is IsolatedScenario {
  return typeof value === 'string' && (ISOLATED_SCENARIOS as readonly string[]).includes(value);
}

export interface ScenarioRunOptions {
  scenario: IsolatedScenario;
  model: string;
  baseUrl: string;
  timeoutMs?: number;
  /** Sólo pruebas: worker alternativo que simula una muerte. */
  workerPath?: string;
}

export interface ScenarioIsolatedOptions extends ScenarioRunOptions {
  /** Archivo JSON donde el worker deja `{ result, toolCalls, answer }`. */
  resultPath: string;
}

/** Worker por defecto, relativo a la raíz del proyecto. */
export function scenarioWorkerPath(): string {
  return path.join(process.cwd(), 'evals', 'scenarioWorker.ts');
}

/** Argumentos del worker; expuestos para fijar el ruteo de los cuatro escenarios. */
export function scenarioWorkerArgs(opts: ScenarioRunOptions, resultPath: string, workerPath = scenarioWorkerPath()): string[] {
  return [
    '--import',
    'tsx',
    workerPath,
    '--scenario',
    opts.scenario,
    '--model',
    opts.model,
    '--baseUrl',
    opts.baseUrl,
    '--out',
    resultPath,
  ];
}

/**
 * Corre un escenario en un proceso aparte. Si el worker muere, `result` queda
 * vacío y `error` trae el código de salida y la cola de stderr; el runner lo
 * registra y sigue con la próxima corrida.
 */
export function runScenarioIsolated(opts: ScenarioIsolatedOptions): Promise<IsolatedRun<EvalOutcome>> {
  return runIsolated<EvalOutcome>({
    command: process.execPath,
    args: scenarioWorkerArgs(opts, opts.resultPath, opts.workerPath),
    resultPath: opts.resultPath,
    // El tope del proceso va por encima del presupuesto del escenario para que
    // el timeout «de verdad» lo informe el propio escenario; esto sólo corta
    // un worker colgado.
    timeoutMs: (opts.timeoutMs ?? 300_000) + 120_000,
  });
}

/** Resultado a registrar cuando el worker no dejó archivo. */
export function isolatedFailureOutcome(
  scenario: IsolatedScenario,
  isolated: Pick<IsolatedRun<EvalOutcome>, 'error'>,
  started: number
): EvalOutcome {
  return {
    id: scenario,
    passed: false,
    steps: 0,
    durationMs: Date.now() - started,
    checks: [],
    stopReason: 'error',
    timedOut: false,
    error: isolated.error ?? `la corrida de ${scenario} no dejó resultado`,
  };
}
