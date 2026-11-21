/**
 * Worker de una corrida de tarea (T1–T5, T8).
 *
 * `evals/baseline.ts` lo lanza con `node --import tsx` para que la muerte del
 * proceso no se lleve la tanda entera. Escribe `{ task, result, toolCalls,
 * answer }` en `--out`; el padre lo lee o, si no existe, registra la corrida
 * con el código de salida.
 */
import fs from 'node:fs';
import { runTask } from './harness.js';
import { isIsolatedTask } from './taskRunner.js';
import { TASKS } from './baselineTasks.js';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const taskId = flag('--task');
const out = flag('--out');
const baseUrl = flag('--baseUrl');
const model = flag('--model');
if (!isIsolatedTask(taskId) || !out || !baseUrl || !model) {
  console.error('uso: taskWorker.ts --task <T1|T2|T3|T4|T5|T8> --model <id> --baseUrl <url> --out <archivo>');
  process.exit(2);
}

const task = TASKS.find((candidate) => candidate.id === taskId);
if (!task) {
  console.error(`tarea desconocida: ${taskId}`);
  process.exit(2);
}

const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS) || undefined;

let toolCalls = 0;
let answer = '';
const result = await runTask(task, {
  live: true,
  model,
  baseUrl,
  ...(timeoutMs ? { timeoutMs } : {}),
  onStep: (step) => {
    // `runTask` ejecuta el bucle en este proceso: el evento `tool_call` existe.
    if (step.type === 'tool_call') toolCalls += 1;
    if (step.title === 'Finalizado') answer = step.content ?? '';
  },
});

fs.writeFileSync(out, JSON.stringify({ task: taskId, result, toolCalls, answer }), 'utf8');
