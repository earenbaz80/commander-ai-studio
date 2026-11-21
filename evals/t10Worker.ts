/**
 * Worker de una corrida de T10.
 *
 * `evals/baseline.ts` lo lanza con `node --import tsx` para que una muerte del
 * proceso (código 1 sin traza, como las del 2026-11-21) no se lleve la tanda.
 * Escribe `{ result, toolCalls, answer }` en `--out`; el padre lo lee o, si no
 * existe, registra la corrida con el código de salida.
 */
import fs from 'node:fs';
import { runT10 } from './scenarios.js';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const out = flag('--out');
const baseUrl = flag('--baseUrl');
const model = flag('--model');
if (!out || !baseUrl || !model) {
  console.error('uso: t10Worker.ts --model <id> --baseUrl <url> --out <archivo>');
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
const result = await runT10({
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
});

fs.writeFileSync(out, JSON.stringify({ result, toolCalls, answer }), 'utf8');
