/**
 * Worker único de una corrida aislada (T1–T10).
 *
 * `evals/isolatedRun.ts` lo lanza con `node --import tsx` para que la muerte del
 * proceso no se lleve la tanda entera. Despacha por id: T1–T5 y T8 con
 * `runTask`; T6, T7, T9 y T10 con su `runT*`. Escribe
 * `{ id, result, toolCalls, answer }` en `--out`; el padre lo lee o, si no
 * existe, registra la corrida con el código de salida.
 */
import fs from 'node:fs';
import { runTask, type EvalOutcome } from './harness.js';
import {
  isIsolatedId,
  isolatedKind,
  type IsolatedScenario,
  type IsolatedTask,
} from './isolatedRun.js';
import { TASKS } from './baselineTasks.js';
import { runT6, runT7, runT9, runT10, type ScenarioOptions } from './scenarios.js';
import { collectSteps, workerFlag } from './workerProtocol.js';

const id = workerFlag('--id');
const out = workerFlag('--out');
const baseUrl = workerFlag('--baseUrl');
const model = workerFlag('--model');
if (!isIsolatedId(id) || !out || !baseUrl || !model) {
  console.error('uso: runWorker.ts --id <T1|…|T10> --model <id> --baseUrl <url> --out <archivo>');
  process.exit(2);
}

// Alias ya estrechados: dentro de las funciones se pierde el estrechamiento de
// las constantes del módulo.
const runId = id;
const resultPath = out;
const serverUrl = baseUrl;
const modelId = model;
const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS) || undefined;

async function runTaskById(taskId: IsolatedTask): Promise<{
  result: EvalOutcome;
  toolCalls: number;
  answer: string;
}> {
  const task = TASKS.find((candidate) => candidate.id === taskId);
  if (!task) {
    console.error(`tarea desconocida: ${taskId}`);
    process.exit(2);
  }
  const steps = collectSteps('tool_call');
  const result = await runTask(task, {
    live: true,
    model: modelId,
    baseUrl: serverUrl,
    ...(timeoutMs ? { timeoutMs } : {}),
    onStep: steps.onStep,
  });
  return { result, ...steps.counts() };
}

function runScenario(
  scenarioId: IsolatedScenario,
  opts: ScenarioOptions
): Promise<EvalOutcome> {
  switch (scenarioId) {
    case 'T6':
      return runT6(opts);
    case 'T7':
      // T7 publica sobre el servidor local y no usa modelo ni presupuesto de sesión.
      return runT7({ baseUrl: opts.baseUrl });
    case 'T9':
      return runT9(opts);
    case 'T10':
      return runT10(opts);
    default:
      throw new Error(`escenario no soportado: ${scenarioId}`);
  }
}

async function runScenarioById(scenarioId: IsolatedScenario): Promise<{
  result: EvalOutcome;
  toolCalls: number;
  answer: string;
}> {
  const customKeys =
    process.env.BASELINE_CUSTOM_BASE_URL && process.env.BASELINE_CUSTOM_API_KEY
      ? {
          CUSTOM_BASE_URL: process.env.BASELINE_CUSTOM_BASE_URL,
          CUSTOM_API_KEY: process.env.BASELINE_CUSTOM_API_KEY,
          ...(process.env.BASELINE_CUSTOM_MODEL
            ? { CUSTOM_MODEL: process.env.BASELINE_CUSTOM_MODEL }
            : {}),
        }
      : undefined;
  const steps = collectSteps('tool_result');
  const opts: ScenarioOptions = {
    baseUrl: serverUrl,
    model: modelId,
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(customKeys ? { keys: customKeys } : {}),
    onStep: steps.onStep,
  };
  const result = await runScenario(scenarioId, opts);
  return { result, ...steps.counts() };
}

const outcome =
  isolatedKind(runId) === 'task'
    ? await runTaskById(runId as IsolatedTask)
    : await runScenarioById(runId as IsolatedScenario);

fs.writeFileSync(resultPath, JSON.stringify({ id: runId, ...outcome }), 'utf8');
