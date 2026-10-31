/**
 * Historial de evaluaciones en modo live.
 *
 * El modo replay es determinista y ya está cubierto por CI, así que no necesita
 * historial. Lo que sí cambia con el tiempo es la calidad del modelo real: para
 * saber si un cambio de prompt, de modelo o de herramientas mejora o empeora,
 * cada pasada se guarda junto al commit donde se hizo.
 *
 * `evals/results.jsonl` se versiona a propósito: comparar contra la pasada
 * anterior sólo sirve si la historia viaja con el repo. Cada línea es un JSON
 * independiente, así que un conflicto de merge se resuelve conservando ambas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { EvalChangedFile, EvalOutcome } from './harness.js';

export type { EvalChangedFile };

/** Tope del fichero versionado: una pasada son ~8 líneas de JSON. */
const MAX_RECORDS = 200;

export const HISTORY_PATH = path.join(process.cwd(), 'evals', 'results.jsonl');

export interface EvalTaskResult {
  id: string;
  passed: boolean;
  /** Nombres de las comprobaciones que fallaron (vacío si pasó). */
  failedChecks: string[];
  /** La tarea no llegó a correr. */
  error?: string;
  /**
   * Qué tocó el agente, sólo en las tareas fallidas: un diagnóstico que no
   * sobrevive al borrado del workspace no se puede comparar entre commits.
   * `[]` significa "no cambió nada" (distinto de un registro antiguo, que no lo sabía).
   */
  changedFiles?: EvalChangedFile[];
  /**
   * Ficheros tocados que la tarea no declara. Se guarda también en tareas que
   * pasan: el veredicto no cambia, pero un arreglo por la vía equivocada tiene
   * que quedar visible al comparar pasadas.
   */
  outOfScope?: EvalChangedFile[];
}

export interface EvalRunRecord {
  /** ISO de la pasada. */
  ts: string;
  /** SHA corto, o `sin-git` si no se pudo consultar. */
  commit: string;
  /** Había cambios sin commitear: el commit no identifica el código medido. */
  dirty: boolean;
  model: string;
  mode: 'live' | 'replay';
  /**
   * La pasada corrió con `--strict-scope`: tocar fuera de alcance la ponía en
   * rojo. Se guarda para no perder ese rojo al repetir la misma medición sin el
   * flag. Ausente = pasada no estricta (o registro anterior a este campo).
   */
  strictScope?: boolean;
  /**
   * El modelo pedido no respondió y otro generó las respuestas (cuota agotada).
   * Sin esto la línea del historial atribuye los resultados a un modelo que no
   * se midió.
   */
  modelFallback?: { from: string; to: string };
  /**
   * Modelos que contestaron de verdad, según el servidor. Normalmente es
   * `[model]`; cuando no lo es, la cadena de respaldo (o un alias que se
   * resuelve a otro id) cambió quién contestaba, aunque no hubiera aviso.
   */
  answeredModels?: string[];
  passed: number;
  total: number;
  durationMs: number;
  tasks: EvalTaskResult[];
}

export interface RunDelta {
  totalDelta: number;
  /** Antes fallaban y ahora pasan. */
  fixed: string[];
  /** Antes pasaban y ahora fallan. */
  broken: string[];
  /** Fallan en ambas pasadas. */
  stillFailing: string[];
  /** Tareas que no existían en la pasada anterior. */
  added: string[];
}

/** Commit y suciedad del árbol, sin romper nada si no hay git. */
export function gitInfo(cwd = process.cwd()): { commit: string; dirty: boolean } {
  const run = (args: string[]) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  try {
    const commit = run(['rev-parse', '--short', 'HEAD']);
    const dirty = run(['status', '--porcelain']).length > 0;
    return { commit: commit || 'sin-git', dirty };
  } catch {
    return { commit: 'sin-git', dirty: false };
  }
}

/**
 * Un mensaje de error puede traer rutas absolutas del workspace temporal. Se
 * guardan relativas a la raíz: el historial se versiona y debe ser portable (y
 * no delatar la ruta de la máquina de quien lanzó la pasada).
 */
function portable(text: string): string {
  return text.split(process.cwd()).join('.');
}

export function buildRecord(
  outcomes: EvalOutcome[],
  meta: {
    model: string;
    mode: 'live' | 'replay';
    commit: string;
    dirty: boolean;
    strictScope?: boolean;
  }
): EvalRunRecord {
  // Cualquier tarea que haya visto la sustitución basta: afecta a toda la pasada.
  const fallback = outcomes.find((outcome) => outcome.modelFallback)?.modelFallback;
  // Unión de lo que contestó en cada tarea, sin repetidos y ordenada: dos
  // modelos distintos en la misma pasada es justo lo que hay que ver.
  const answeredModels = [...new Set(outcomes.flatMap((outcome) => outcome.answeredModels ?? []))].sort();
  return {
    ts: new Date().toISOString(),
    commit: meta.commit,
    dirty: meta.dirty,
    model: meta.model,
    mode: meta.mode,
    // Sólo se escribe cuando está activo: ausente ya significa "no estricta" y
    // así el JSON no engorda con `false` en todas las líneas.
    ...(meta.strictScope ? { strictScope: true } : {}),
    ...(fallback ? { modelFallback: fallback } : {}),
    ...(answeredModels.length ? { answeredModels } : {}),
    passed: outcomes.filter((outcome) => outcome.passed).length,
    total: outcomes.length,
    durationMs: outcomes.reduce((sum, outcome) => sum + outcome.durationMs, 0),
    tasks: outcomes.map((outcome) => ({
      id: outcome.id,
      passed: outcome.passed,
      failedChecks: outcome.checks.filter((check) => check.error).map((check) => check.name),
      ...(outcome.error ? { error: portable(outcome.error) } : {}),
      ...(outcome.passed
        ? {}
        : {
            changedFiles: (outcome.diffs ?? []).map((diff) => ({
              path: diff.path,
              status: diff.status,
            })),
          }),
      ...(outcome.outOfScope?.length ? { outOfScope: outcome.outOfScope } : {}),
    })),
  };
}

/**
 * ¿Toca guardar esta pasada en el historial?
 *
 * Una pasada con modelo sustituido NO se guarda: el historial es una serie por
 * modelo y la comparación se hace contra la última pasada del modelo pedido.
 * Anotar ahí resultados que generó otro modelo convierte la línea base en una
 * mezcla, y después ya no se sabe contra qué se está midiendo. Mientras dure la
 * falta de cuota se puede repetir la pasada live sin ensuciar nada; la primera
 * que sí mida el modelo pedido se compara con la última que también lo midió.
 *
 * El registro de pasadas sustituidas sigue existiendo en `buildRecord` para los
 * ficheros escritos antes de esta regla, que se leen tal cual.
 */
export function decideRecording(opts: {
  live: boolean;
  /** La pasada mide un recorte (`--only`), no es comparable con una completa. */
  only?: boolean;
  noRecord?: boolean;
  fallback?: { from: string; to: string } | null;
}): { record: boolean; reason?: string } {
  if (!opts.live) return { record: false, reason: 'el modo replay ya está cubierto por CI' };
  if (opts.only) return { record: false, reason: 'una pasada con --only mide un recorte' };
  if (opts.noRecord) return { record: false, reason: 'EVAL_NO_RECORD=1' };
  if (opts.fallback) {
    return {
      record: false,
      reason:
        `no midió el modelo pedido: ${opts.fallback.from} no respondió y contestó ` +
        `${opts.fallback.to}`,
    };
  }
  return { record: true };
}

export function readRecords(file = HISTORY_PATH): EvalRunRecord[] {
  if (!fs.existsSync(file)) return [];
  const records: EvalRunRecord[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      // Una línea a medio escribir no debe invalidar el resto del historial.
      if (parsed && typeof parsed.ts === 'string' && Array.isArray(parsed.tasks)) records.push(parsed);
    } catch {
      /* línea corrupta: se descarta */
    }
  }
  return records;
}

export function appendRecord(record: EvalRunRecord, file = HISTORY_PATH): void {
  const records = readRecords(file);
  records.push(record);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const kept = records.slice(-MAX_RECORDS);
  fs.writeFileSync(file, `${kept.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

/**
 * Última pasada de ese modelo y modo, o null si es la primera.
 *
 * Se ordena por `ts` y no por posición: un merge de dos ramas puede dejar las
 * líneas intercaladas, y entonces "la última del fichero" no es la más reciente.
 */
export function lastRunFor(
  records: EvalRunRecord[],
  model: string,
  mode: EvalRunRecord['mode'] = 'live'
): EvalRunRecord | null {
  let best: EvalRunRecord | null = null;
  let bestAt = -Infinity;
  for (const record of records) {
    if (record.model !== model || record.mode !== mode) continue;
    const parsed = Date.parse(record.ts);
    // Una fecha ilegible se trata como la más antigua, no como la más nueva.
    const at = Number.isFinite(parsed) ? parsed : 0;
    // `>=` conserva la última línea añadida cuando dos pasadas comparten fecha.
    if (!best || at >= bestAt) {
      best = record;
      bestAt = at;
    }
  }
  return best;
}

export function compareRuns(prev: EvalRunRecord, next: EvalRunRecord): RunDelta {
  const before = new Map(prev.tasks.map((task) => [task.id, task.passed]));
  const after = new Map(next.tasks.map((task) => [task.id, task.passed]));
  const delta: RunDelta = {
    totalDelta: next.passed - prev.passed,
    fixed: [],
    broken: [],
    stillFailing: [],
    added: [],
  };
  for (const [id, passed] of after) {
    if (!before.has(id)) {
      delta.added.push(id);
      continue;
    }
    const wasPassing = before.get(id) === true;
    if (!wasPassing && passed) delta.fixed.push(id);
    else if (wasPassing && !passed) delta.broken.push(id);
    else if (!wasPassing && !passed) delta.stillFailing.push(id);
  }
  return delta;
}

export function describeAge(iso: string, now = Date.now()): string {
  const diff = now - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < 0) return 'hace un momento';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

/**
 * Tareas que sus checks dan por buenas pero que el modo estricto pone en rojo
 * por tocar fuera de alcance: exactamente el rojo que no se deduce de
 * `passed/total` y que se perdería al repetir la pasada sin el flag.
 */
export function strictScopeFailures(record: EvalRunRecord): string[] {
  if (!record.strictScope) return [];
  return record.tasks
    .filter((task) => task.passed && task.outOfScope?.length)
    .map((task) => task.id);
}

/**
 * Quién contestó, si no fue el modelo pedido.
 *
 * Sin diferencias no se imprime nada: repetir el modelo pedido en cada línea
 * del historial es ruido, y lo que se busca es justo la excepción.
 */
function describeAnswered(record: EvalRunRecord): string {
  const answered = (record.answeredModels ?? []).filter(Boolean);
  if (answered.length === 0) return '';
  // Con sustitución declarada ya lo dice `⚠ sustituido`: no se duplica.
  if (record.modelFallback) return '';
  if (answered.length === 1) {
    return answered[0] === record.model ? '' : `· respondió: ${answered[0]}`;
  }
  return `⚠ respondió: ${answered.join(', ')}`;
}

/** Ficheros tocados en una línea: ` [tocó: a (modificado), b (nuevo)]`. */
function describeTouched(changed?: EvalChangedFile[]): string {
  if (!changed) return '';
  if (changed.length === 0) return ' [sin cambios]';
  const shown = changed.slice(0, 3).map((file) => `${file.path} (${file.status})`);
  const rest = changed.length - shown.length;
  return ` [tocó: ${shown.join(', ')}${rest > 0 ? ` (+${rest})` : ''}]`;
}

/** Líneas legibles de la comparación; vacío si no hay nada que decir. */
export function formatComparison(prev: EvalRunRecord, next: EvalRunRecord): string[] {
  const delta = compareRuns(prev, next);
  const mark = prev.dirty ? '*' : '';
  const sign = delta.totalDelta > 0 ? `+${delta.totalDelta}` : String(delta.totalDelta);
  const lines = [
    `comparativa con la pasada anterior de ${next.model} ` +
      `(${prev.passed}/${prev.total}, ${prev.commit}${mark}, ${describeAge(prev.ts)}):`,
    `  ${prev.passed}/${prev.total} → ${next.passed}/${next.total} (${delta.totalDelta === 0 ? 'igual' : sign})`,
  ];

  const byId = new Map(next.tasks.map((task) => [task.id, task]));
  if (delta.broken.length) {
    for (const id of delta.broken) {
      const task = byId.get(id);
      const failed = task?.failedChecks ?? [];
      lines.push(
        `  ↓ ${id}${failed.length ? ` — ${failed.join('; ')}` : ''}${describeTouched(task?.changedFiles)}`
      );
    }
  }
  for (const id of delta.fixed) lines.push(`  ↑ ${id}`);
  if (delta.added.length) lines.push(`  + nuevas: ${delta.added.join(', ')}`);
  if (delta.stillFailing.length) lines.push(`  · siguen fallando: ${delta.stillFailing.join(', ')}`);

  const suspicious = next.tasks.filter((task) => task.outOfScope?.length);
  for (const task of suspicious) {
    lines.push(`  ⚠ fuera de alcance: ${task.id} (${task.outOfScope!.map((file) => file.path).join(', ')})`);
  }

  // Si entre dos pasadas cambió quién contestaba, el resultado no es
  // comparable aunque el número sea el mismo: lo midió otro modelo.
  const previousAnswered = (prev.answeredModels ?? []).join(', ');
  const currentAnswered = (next.answeredModels ?? []).join(', ');
  if (previousAnswered && currentAnswered && previousAnswered !== currentAnswered) {
    lines.push(`  · modelo que respondió: antes ${previousAnswered} · ahora ${currentAnswered}`);
  }

  // La pasada anterior pudo ser roja sólo por el modo estricto. Sin esta línea,
  // repetirla sin el flag mostraría "igual" y parecería que nunca hubo rojo.
  const previousStrict = strictScopeFailures(prev);
  if (previousStrict.length) {
    lines.push(`  · la pasada anterior era estricta y falló por alcance: ${previousStrict.join(', ')}`);
  }
  if (next.strictScope && suspicious.length) {
    lines.push('  · pasada estricta: tocar fuera de alcance cuenta como fallo');
  }

  if (!delta.fixed.length && !delta.broken.length && !delta.added.length && !suspicious.length) {
    lines.push('  · sin cambios por tarea');
  }
  return lines;
}

/** Tabla del historial completo, en orden cronológico. */
export function formatHistory(records: EvalRunRecord[]): string[] {
  if (!records.length) return ['(sin pasadas registradas todavía)'];
  const sorted = [...records].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return sorted.map((record) => {
    const mark = record.dirty ? '*' : ' ';
    const when = record.ts.replace('T', ' ').slice(0, 16);
    const time = `${(record.durationMs / 1000).toFixed(0)}s`;
    const strictFailures = strictScopeFailures(record);
    return (
      `${when}  ${record.commit}${mark}  ${record.model}  ${record.passed}/${record.total}  (${time})` +
      (record.strictScope ? '  · estricto' : '') +
      (strictFailures.length ? `  ✖ alcance: ${strictFailures.join(', ')}` : '') +
      (record.modelFallback ? `  ⚠ sustituido: ${record.modelFallback.to}` : '') +
      (describeAnswered(record) ? `  ${describeAnswered(record)}` : '')
    );
  });
}
