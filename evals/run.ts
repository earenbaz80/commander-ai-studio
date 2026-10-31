/**
 * Runner de evaluaciones.
 *
 *   npm run eval          → replay, sin red ni claves (lo que corre en CI)
 *   npm run eval:live     → mismo camino con el modelo real (necesita servidor)
 *   npm run eval:history  → pasadas registradas, con commit y modelo
 *
 * Opciones: `--only <id>`, `--live`, `--history`, `--strict-scope`,
 * `--require-model`, `--allow-fallback`, `EVAL_MODEL`, `EVAL_BASE_URL`,
 * `EVAL_PORT`, `EVAL_TIMEOUT_MS`, `EVAL_REQUIRE_MODEL`, `EVAL_ALLOW_FALLBACK`.
 * Cada pasada live se anota en `evals/results.jsonl` y se compara con la
 * anterior del mismo modelo (ver `evals/history.ts`).
 *
 * Antes de la primera tarea, una pasada live pregunta al modelo con una llamada
 * mínima (ver `evals/preflight.ts`): si responde otro, aborta en vez de gastar
 * las cinco tareas en una pasada que no se registraría.
 *
 * El modo live necesita el servidor de la app: si ya hay uno respondiendo lo
 * reutiliza y, si no, arranca el suyo y lo apaga al terminar (ver
 * `evals/server.ts`).
 *
 * Por defecto tocar ficheros fuera de alcance sólo se avisa. Con
 * `--strict-scope` (o `npm run eval:strict`) también hace fallar la pasada, y
 * el registro de la pasada guarda `strictScope` para que ese rojo sobreviva a
 * una repetición sin el flag.
 *
 * Una pasada live con modelo sustituido no se guarda (ver `decideRecording`):
 * la serie es por modelo y meter ahí resultados de otro contamina la línea
 * base. Se avisa con claridad en vez de registrar en silencio algo que no se
 * midió.
 */
import { EVAL_TASKS } from './tasks.js';
import { DEFAULT_MODEL, runTask, summarize, type EvalOutcome } from './harness.js';
import {
  HISTORY_PATH,
  appendRecord,
  buildRecord,
  decideRecording,
  formatComparison,
  formatHistory,
  gitInfo,
  lastRunFor,
  readRecords,
} from './history.js';
import { ensureEvalServer, type EvalServer } from './server.js';
import { decidePreflight, probeModel } from './preflight.js';

const args = process.argv.slice(2);
const live = args.includes('--live') || process.env.EVAL_LIVE === '1';
const strictScope = args.includes('--strict-scope') || process.env.EVAL_STRICT_SCOPE === '1';
/** Falla si el proveedor sustituyó el modelo: medir otro no es medir. */
const requireModel =
  args.includes('--require-model') || process.env.EVAL_REQUIRE_MODEL === '1';
/** Permite seguir cuando la comprobación previa ve que contestaría otro modelo. */
const allowFallback =
  args.includes('--allow-fallback') || process.env.EVAL_ALLOW_FALLBACK === '1';
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
const model = process.env.EVAL_MODEL || DEFAULT_MODEL;
/** Presupuesto por tarea; sin esto, cada modo usa el suyo (20s replay, 300s live). */
const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS) || undefined;
/** Permite medir contra un historial aparte (otro checkout, pruebas). */
const historyFile = process.env.EVAL_HISTORY || HISTORY_PATH;

if (args.includes('--history')) {
  console.log(formatHistory(readRecords(historyFile)).join('\n'));
  process.exit(0);
}

const tasks = only ? EVAL_TASKS.filter((task) => task.id === only) : EVAL_TASKS;

if (tasks.length === 0) {
  console.error(`No existe la tarea "${only}". Disponibles: ${EVAL_TASKS.map((t) => t.id).join(', ')}`);
  process.exit(1);
}

/** Marca, no fallo: los checks pueden pasar y aun así haber tocado de más. */
function printSuspicion(outcome: EvalOutcome) {
  if (!outcome.outOfScope?.length) return;
  const files = outcome.outOfScope.map((file) => `${file.path} (${file.status})`).join(', ');
  console.log(`    ⚠ sospechosa: tocó ficheros que la tarea no declara: ${files}`);
}

/** Al fallar, lo primero que se mira es qué tocó el agente. */
function printDiffs(outcome: EvalOutcome) {
  if (!outcome.diffs?.length) {
    console.log('    (el agente no cambió ningún fichero)');
    return;
  }
  console.log('    cambios en el workspace:');
  for (const diff of outcome.diffs) {
    console.log(`      ${diff.status}: ${diff.path}`);
    for (const line of diff.patch.split('\n')) console.log(`        ${line}`);
  }
}

function report(outcome: EvalOutcome) {
  const mark = outcome.passed ? '✔' : '✖';
  const time = `${(outcome.durationMs / 1000).toFixed(1)}s`;
  console.log(`${mark} ${outcome.id}  (${outcome.steps} pasos, ${time})`);

  if (outcome.error) {
    console.log(`    ! ${outcome.error}`);
    printSuspicion(outcome);
    printDiffs(outcome);
    return;
  }
  if (outcome.modelFallback) {
    console.log(
      `    ⚠ modelo sustituido: ${outcome.modelFallback.from} no respondió y contestó ` +
        `${outcome.modelFallback.to}: esta tarea no mide el modelo pedido`
    );
  }
  for (const check of outcome.checks) {
    if (check.error) console.log(`    ✖ ${check.name}: ${check.error}`);
  }
  printSuspicion(outcome);
  if (!outcome.passed) printDiffs(outcome);
}

console.log(
  (live
    ? '▶ modo live: usa el modelo real (lento, no determinista, cuesta tokens)'
    : '▶ modo replay: modelo guionizado, herramientas reales (determinista, sin red)') +
    (strictScope ? ' · alcance estricto' : '')
);

// Un servidor que no responde es la causa más común de que una pasada live ni
// empiece: se reutiliza el que haya o se arranca uno propio y se apaga luego.
let server: EvalServer | null = null;
if (live) {
  try {
    server = await ensureEvalServer({ log: console.log });
  } catch (e: any) {
    console.error(`✖ ${e?.message || e}`);
    process.exit(1);
  }
}

// Comprobación previa: una llamada mínima antes de gastar cinco tareas. Si el
// modelo pedido no responde, se para aquí y se dice por qué.
if (live && server) {
  const probe = await probeModel({ baseUrl: server.baseUrl, model });
  const decision = decidePreflight(probe, { model, allowFallback });
  for (const line of decision.lines) console.log(line);
  if (!decision.proceed) {
    if (server.started) {
      server.stop();
      console.log('servidor propio detenido');
    }
    process.exit(1);
  }
}

const results: EvalOutcome[] = [];
for (const task of tasks) {
  const outcome = await runTask(task, {
    live,
    model,
    baseUrl: server?.baseUrl,
    timeoutMs,
  });
  results.push(outcome);
  report(outcome);
}

const summary = summarize(results, { strictScope, requireModel });
console.log(
  `\n${summary.passed}/${summary.total} tareas superadas` +
    (summary.suspicious ? ` · ${summary.suspicious} sospechosa(s)` : '')
);
if (strictScope && summary.suspicious) {
  console.log(`✖ modo estricto: ${summary.suspicious} tarea(s) tocaron ficheros que no declaran`);
}
const fallback = results.find((outcome) => outcome.modelFallback)?.modelFallback;
if (fallback) {
  console.log(
    `⚠ la pasada no mide ${model}: ${fallback.from} no respondió y contestó ${fallback.to}`
  );
  if (requireModel) {
    console.log('✖ modo require-model: una pasada con modelo sustituido no cuenta como medida');
  }
}

// Sólo el modo live es interesante como serie temporal: el replay es
// determinista y ya está en CI. `--only` mide un recorte, no es comparable con
// una pasada completa, así que tampoco se registra.
const recording = decideRecording({
  live,
  only: Boolean(only),
  noRecord: process.env.EVAL_NO_RECORD === '1',
  fallback,
});
if (recording.record) {
  const previous = lastRunFor(readRecords(historyFile), model);
  const { commit, dirty } = gitInfo();
  const record = buildRecord(results, { model, mode: 'live', commit, dirty, strictScope });

  console.log('');
  if (previous) {
    console.log(formatComparison(previous, record).join('\n'));
  } else {
    console.log(`primera pasada registrada de ${model}`);
  }
  appendRecord(record, historyFile);
  console.log(`guardada en ${historyFile} (${commit}${dirty ? '* · árbol sucio' : ''})`);
} else if (fallback) {
  // El aviso va sólo para la sustitución: es el caso en que el usuario espera
  // un registro y no lo hay. Replay y `--only` se saltan el historial siempre.
  console.log('');
  console.log(`sin registrar en ${historyFile}: ${recording.reason}`);
  console.log('la línea base sigue siendo la última pasada que sí midió el modelo pedido');
}

if (server?.started) {
  server.stop();
  console.log('servidor propio detenido');
}

process.exitCode = summary.failed ? 1 : 0;
