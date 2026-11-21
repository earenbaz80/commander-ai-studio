/**
 * Worker de una corrida de escenario (T6, T7, T9 o T10).
 *
 * `evals/baseline.ts` lo lanza con `node --import tsx` para que la muerte del
 * proceso (código 1 sin traza, como las del 2026-11-21) no se lleve la tanda
 * entera. Escribe `{ scenario, result, toolCalls, answer }` en `--out`; el
 * padre lo lee o, si no existe, registra la corrida con el código de salida.
 */
import fs from 'node:fs';
import type { EvalOutcome } from './harness.js';
import { isIsolatedScenario, type IsolatedScenario } from './scenarioRunner.js';
import { runT6, runT7, runT9, runT10, type ScenarioOptions } from './scenarios.js';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const scenario = flag('--scenario');
const out = flag('--out');
const baseUrl = flag('--baseUrl');
const model = flag('--model');
if (!isIsolatedScenario(scenario) || !out || !baseUrl || !model) {
  console.error(
    'uso: scenarioWorker.ts --scenario <T6|T7|T9|T10> --model <id> --baseUrl <url> --out <archivo>'
  );
  process.exit(2);
}

const customKeys =
  process.env.BASELINE_CUSTOM_BASE_URL && process.env.BASELINE_CUSTOM_API_KEY
    ? {
        CUSTOM_BASE_URL: process.env.BASELINE_CUSTOM_BASE_URL,
        CUSTOM_API_KEY: process.env.BASELINE_CUSTOM_API_KEY,
        ...(process.env.BASELINE_CUSTOM_MODEL ? { CUSTOM_MODEL: process.env.BASELINE_CUSTOM_MODEL } : {}),
      }
    : undefined;
const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS) || undefined;

let toolCalls = 0;
let answer = '';
const opts: ScenarioOptions = {
  baseUrl,
  model,
  ...(timeoutMs ? { timeoutMs } : {}),
  ...(customKeys ? { keys: customKeys } : {}),
  onStep: (step) => {
    // Igual que en el runner: las sesiones del servidor persisten el resultado,
    // no el evento `tool_call`.
    if (step.type === 'tool_result') toolCalls += 1;
    if (step.title === 'Finalizado') answer = step.content ?? '';
  },
};

async function run(scenarioId: IsolatedScenario, serverUrl: string): Promise<EvalOutcome> {
  switch (scenarioId) {
    case 'T6':
      return runT6(opts);
    case 'T7':
      // T7 publica sobre el servidor local y no usa modelo ni presupuesto de sesión.
      return runT7({ baseUrl: serverUrl });
    case 'T9':
      return runT9(opts);
    case 'T10':
      return runT10(opts);
    default:
      throw new Error(`escenario no soportado: ${scenarioId}`);
  }
}

const result = await run(scenario, baseUrl);
fs.writeFileSync(out, JSON.stringify({ scenario, result, toolCalls, answer }), 'utf8');
