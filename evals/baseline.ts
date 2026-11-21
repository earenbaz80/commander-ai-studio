/**
 * Línea base F0: T1–T10 sobre el modelo real, con corridas contadas.
 *
 * T1–T5 y T8 viven en `./baselineTasks.ts`; T6, T7, T9 y T10, en `./scenarios.ts`.
 * Cada corrida —tarea o escenario— se lanza en su propio proceso: si el
 * proceso muere, se registra esa corrida y la tanda sigue. Cada corrida usa un
 * workspace temporal y comprobaciones que observan el resultado real, no el
 * texto del modelo.
 *
 * Uso:
 *   npm run baseline                         # todas las tareas medibles
 *   npm run baseline -- --resume             # sólo las corridas que faltan
 *   npm run baseline -- --only T1 --runs 1   # una tarea, una corrida (pilot)
 *   EVAL_TIMEOUT_MS=600000 npm run baseline -- --only T4 --runs 1
 *   BASELINE_MODEL=lmstudio/<id> npm run baseline
 *
 * Registra cada corrida en `evals/baseline-results.jsonl` (una línea por
 * corrida, sin secretos) e imprime el resumen por tarea.
 *
 * Ningún escenario inventa un resultado: si falta un paso, la comprobación
 * falla con el estado observado.
 *
 * Volumen acordado (runbook §4.1): 3 corridas en T1, T7, T8 y T9; 2 en el
 * resto, 24 en total.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type EvalOutcome, type EvalSpawnBatch, type EvalStopReason } from './harness.js';
import {
  ISOLATED_SCENARIOS,
  errorOutcome,
  isolatedFailureOutcome,
  runIsolatedId,
  type IsolatedId,
} from './isolatedRun.js';
import { TASKS } from './baselineTasks.js';
import { ensureEvalServer } from './server.js';
import { abandonedRunWarning, armRun, disarmRun, readAbandonedRun } from './runMarker.js';
import { gitInfo } from './history.js';
import { resolveBaselineModel } from './baselineModel.js';

const RESULTS_PATH = path.join(process.cwd(), 'evals', 'baseline-results.jsonl');

/** Volumen por tarea; las críticas llevan 3. */
const RUNS: Record<string, number> = { T1: 3, T7: 3, T8: 3, T9: 3 };

interface BaselineRecord {
  runId: string;
  /** Corrida de diagnóstico con `--only`; no cuenta para la baseline completa. */
  subset?: boolean;
  ts: string;
  commit: string;
  dirty: boolean;
  model: string;
  taskId: string;
  run: number;
  passed: boolean;
  steps: number;
  toolCalls: number;
  durationMs: number;
  checks: Array<{ name: string; error?: string }>;
  stopReason: EvalStopReason;
  timedOut: boolean;
  /** Corrida descartada por cuota, mock o un fallo externo. */
  invalid?: string;
  outOfScope?: Array<{ path: string; status: string }>;
  modelFallback?: { from: string; to: string };
  answeredModels?: string[];
  error?: string;
  /** Diagnóstico del padre (T10): qué tools llamó, sus pasos y turnos cortados. */
  parentTools?: string[];
  stepTitles?: string[];
  truncatedTurns?: number;
  /** Todas las tandas de `spawn_agents` de T10, en orden. */
  spawns?: EvalSpawnBatch[];
  /** Volcado del estado de la sesión, guardado antes de borrarla. */
  sessionStatePath?: string;
}

const args = process.argv.slice(2);
const valueOf = (name: string): string | null => {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : null;
};
const only = valueOf('--only');
const resume = process.argv.includes('--resume');
const forcedRuns = Number(valueOf('--runs')) || 0;
const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS) || undefined;
const model = resolveBaselineModel();
const baseUrl = process.env.BASELINE_BASE_URL || process.env.EVAL_BASE_URL || undefined;

const ALL_IDS = [...TASKS.map((task) => task.id), ...ISOLATED_SCENARIOS];
const selected = only ? ALL_IDS.filter((id) => id === only) : ALL_IDS;
if (selected.length === 0) {
  console.error(`No hay tarea medible "${only}". Medibles: ${ALL_IDS.join(', ')}`);
  process.exit(1);
}

const server = await ensureEvalServer({ baseUrl, log: (line) => console.log(line) });
const { commit, dirty } = gitInfo();
const records: BaselineRecord[] = [];

// `--resume` permite continuar una corrida interrumpida sin repetir las
// corridas completas del mismo modelo. Los timeouts no cuentan como completas:
// se vuelven a medir para no cerrar una baseline inválida.
const existingRecords: BaselineRecord[] =
  resume && fs.existsSync(RESULTS_PATH)
    ? fs
        .readFileSync(RESULTS_PATH, 'utf8')
        .split(/\r?\n/)
        .flatMap((line) => {
          if (!line.trim()) return [];
          try {
            return [JSON.parse(line) as BaselineRecord];
          } catch {
            return [];
          }
        })
    : [];

console.log(
  `▶ línea base · modelo ${model} · commit ${commit}${dirty ? '* · árbol sucio' : ''} · ` +
    `timeout ${timeoutMs ? `${Math.round(timeoutMs / 1000)}s` : 'por defecto'} · servidor ${server.baseUrl}`
);

// Una corrida sin cerrar de la ejecución anterior se nombra acá: el JSONL no
// tiene su línea y sin esto el hueco parecía una corrida que nunca existió.
const abandonedWarning = abandonedRunWarning(readAbandonedRun());
if (abandonedWarning) console.warn(abandonedWarning);

for (const id of selected) {
  const total = forcedRuns > 0 ? forcedRuns : RUNS[id] ?? 2;
  const completed = new Set(
    existingRecords
      .filter(
        (record) =>
          record.model === model &&
          record.taskId === id &&
          !record.subset &&
          !record.invalid &&
          record.timedOut !== true
      )
      .map((record) => record.run)
  );
  for (let run = 1; run <= total; run++) {
    if (completed.has(run)) {
      console.log(`↷ ${id}-${run} ya registrada; se omite`);
      continue;
    }
    const started = Date.now();
    armRun({
      runId: `${id}-${run}`,
      taskId: id,
      run,
      pid: process.pid,
      startedAt: new Date(started).toISOString(),
    });
    let toolCalls = 0;
    let answer = '';
    let result: EvalOutcome;
    // Cada corrida va en su propio proceso: una muerte del runner (2026-11-21,
    // código 1 sin traza) pierde como máximo esta corrida y queda registrada.
    const resultPath = path.join(
      os.tmpdir(),
      `commander-${id.toLowerCase()}-${process.pid}-${run}-${Date.now()}.json`
    );
    try {
      const isolated = await runIsolatedId({
        id: id as IsolatedId,
        model,
        baseUrl: server.baseUrl,
        ...(timeoutMs ? { timeoutMs } : {}),
        resultPath,
      });
      toolCalls = isolated.toolCalls;
      answer = isolated.answer;
      result = isolated.result ?? isolatedFailureOutcome(id as IsolatedId, isolated, started);
    } catch (e: any) {
      // `runTask`/los escenarios no deberían lanzar, pero una caída del
      // servidor no puede quedar como corrida inexistente: se registra.
      result = errorOutcome(id, e?.message || String(e), started);
    } finally {
      fs.rmSync(resultPath, { force: true });
    }

    const record: BaselineRecord = {
      runId: `${id}-${run}`,
      ...(only ? { subset: true } : {}),
      ts: new Date().toISOString(),
      commit,
      dirty,
      model,
      taskId: id,
      run,
      passed: result.passed,
      steps: result.steps,
      toolCalls,
      durationMs: result.durationMs,
      checks: result.checks,
      stopReason: result.stopReason ?? (result.error ? 'error' : 'completed'),
      timedOut: result.timedOut === true,
      ...(result.outOfScope?.length ? { outOfScope: result.outOfScope } : {}),
      ...(result.modelFallback ? { modelFallback: result.modelFallback } : {}),
      ...(result.answeredModels?.length ? { answeredModels: result.answeredModels } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.diagnostics
        ? {
            parentTools: result.diagnostics.parentTools,
            stepTitles: result.diagnostics.stepTitles,
            truncatedTurns: result.diagnostics.truncatedTurns,
            ...(result.diagnostics.spawns?.length
              ? { spawns: result.diagnostics.spawns }
              : {}),
            ...(result.diagnostics.statePath
              ? { sessionStatePath: result.diagnostics.statePath }
              : {}),
          }
        : {}),
    };
    records.push(record);
    fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
    fs.appendFileSync(RESULTS_PATH, `${JSON.stringify(record)}\n`);
    disarmRun();

    const mark = record.passed ? '✔' : '✖';
    const failed = record.checks.filter((c) => c.error).map((c) => c.name);
    console.log(
      `${mark} ${record.runId}  ${(record.durationMs / 1000).toFixed(1)}s · ${record.steps} pasos · ` +
        `${record.toolCalls} tool calls` +
        (record.timedOut ? ' · timeout' : '') +
        (failed.length ? ` · falló: ${failed.join('; ')}` : '') +
        (record.error ? ` · error: ${record.error}` : '') +
        (answer ? '' : ' · sin respuesta final')
    );
  }
}

server.stop();

/** Mediana de una lista de números. */
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

console.log('\ntarea  corridas  éxito  duración p50  pasos p50  tools p50');
for (const id of selected) {
  const rows = records.filter((record) => record.taskId === id);
  const ok = rows.filter((record) => record.passed).length;
  console.log(
    `${id.padEnd(5)} ${String(rows.length).padStart(8)} ${String(`${ok}/${rows.length}`).padStart(7)} ` +
      `${`${(median(rows.map((r) => r.durationMs)) / 1000).toFixed(1)}s`.padStart(13)} ` +
      `${String(median(rows.map((r) => r.steps))).padStart(9)} ` +
      `${String(median(rows.map((r) => r.toolCalls))).padStart(9)}`
  );
}
console.log(`\nguardado en ${RESULTS_PATH}`);
const total = records.length;
const ok = records.filter((record) => record.passed).length;
const timeouts = records.filter((record) => record.timedOut).length;
console.log(
  `medidas ${total} corridas · ${ok} passed · ${total - ok} failed · ${timeouts} timeout`
);
process.exitCode = ok === total ? 0 : 1;
