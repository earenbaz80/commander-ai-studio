#!/usr/bin/env node
/**
 * CAL2 — registro y cálculo de la re-medición del p95 de aprobación.
 *
 * Una fila por **decisión** en `.commander/g1/cal2/samples.jsonl` (ignorado por
 * git) y p50/p90/p95 por nearest-rank sobre el estrato primario **incluido**,
 * con las condiciones §4.1 del protocolo (`docs/parity/g1-approval-remeasure.md`).
 *
 *   # latencia leída del estado de la sesión (preferido, si está persistida)
 *   npm run g1:cal2 -- import --run CAL2-R01 --session .commander/g1/cal2/CAL2-R01.json \
 *     --leido --diff-log --justifica "math.mjs: values.length - 1 → values.length"
 *
 *   # latencia tecleada desde la línea «✓ aprobación … · N ms» del PTY
 *   npm run g1:cal2 -- add --run CAL2-R01 --tool shell.run --decision allow --ms 2120 \
 *     --decision-ms 1204 --leido --justifica "node --test math.test.mjs"
 *
 *   npm run g1:cal2 -- summary
 *
 * `import` toma `SessionStepV2.approval.latencyMs` cuando existe y, si el estado
 * también trae `decisionMs` (decisión − primera tecla, §12.11), lo guarda en la
 * misma fila; para las que no traen latencia imprime el `add --ms` ya montado y
 * no estima nada. `--decision-ms` es opcional en `add`.
 *
 * El `summary` publica **dos** juegos de percentiles, por separado: el de
 * `latencyMs`, que es el de la puerta contra la referencia de 15 151 ms, y el de
 * `decisionMs`, descriptivo y sin umbral. `decisionMs` no entra en las
 * condiciones de inclusión ni puede excluir una muestra: el piso I3 sigue siendo
 * de `latencyMs`. Las filas anteriores al 2026-11-13 no traen el campo y no se
 * reescriben; simplemente no cuentan para el segundo juego.
 *
 * `--leido` es la declaración de lectura, `--diff-log` que el diff quedó impreso
 * en el log (I2
 * tras la enmienda §12; en `fs.edit`/`fs.write` hace falta eso o `--detalle`),
 * `--detalle` que se abrió el hunk con `?`/`¿`/`h` —dato descriptivo— y
 * `--justifica` la línea de qué se revisó. El piso es 1 500 ms y las muestras
 * excluidas se listan con su motivo, nunca en silencio.
 *
 * El estrato se calcula **antes** de escribir: una muestra que no cumple §4.1 no
 * entra por defecto, porque cada exclusión cuenta para el tope del 20 % y es
 * fácil invalidar el bloque con un `import` sin `--tool`. Para dejar constancia
 * de una excluida hace falta `--incluir-excluidas`, y aun así se avisa del
 * porcentaje resultante.
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderFactsFrom, type ApprovalRenderFacts } from '../src/agent/sessionTypes.js';

const MIN_MS = 1_500;
const REFERENCE_MS = 15_151;
const MAX_EXCLUDED_RATIO = 0.2;
const TARGET_N = 40;
const STORE = path.join(process.cwd(), '.commander', 'g1', 'cal2', 'samples.jsonl');

type Decision = 'allow' | 'deny' | 'allow-session';
type Reason = 'I1' | 'I2' | 'I3';

/** Tools que traen diff: I2 exige el diff impreso en el log, o `--detalle` (§4.1, enmienda §12). */
const DIFF_TOOLS = new Set(['fs.edit', 'fs.write']);

interface Sample {
  sampleId: string;
  ts: string;
  runId: string;
  tool: string;
  decision: Decision;
  latencyMs: number;
  /**
   * Decisión − primera tecla (§12.11). Opcional: las muestras anteriores al
   * 2026-11-13 no lo traen y no se reescriben; cuenta aparte y nunca decide la
   * puerta.
   */
  decisionMs?: number;
  leido: boolean;
  /** El diff quedó impreso en el log del PTY (§12.3), declarado a mano en `add`. */
  diffLog: boolean;
  /**
   * Evidencia de render que graba la propia aprobación (`ApprovalRenderFacts`):
   * con ella I2 se decide sin leer el log del PTY. Un estado anterior a este
   * cambio no la trae y se cae a `--diff-log`/`--detalle`.
   */
  render?: ApprovalRenderFacts;
  detalle: boolean;
  justificacion: string;
  nota: string;
  /** Origen del número: tecleado o leído del estado de la sesión. */
  source: 'manual' | 'session';
  /** `approval.id` cuando viene de una sesión, para no importarla dos veces. */
  approvalId?: string;
}

const argv = process.argv.slice(2);
const command = argv[0];
const has = (name: string): boolean => argv.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const GENERIC = new Set(['ok', 'vale', 'visto', 'si', 'sí', 'bien', 'yes', 'correcto', 'nada']);
/** Una justificación I1 tiene que nombrar algo: "1" o "2" no describen lectura. */
const HAS_LETTER = /[a-záéíóúüñ]/i;
/** CAL2_PILOT=1 permite validar el flujo sin escribir ninguna muestra. */
const PILOT = process.env.CAL2_PILOT === '1';

/** §4.1: el tope del 20 % se mide sobre las decisiones `allow` del bloque. */
function exclusionRatio(samples: Sample[]): { excluded: number; allows: number; ratio: number } {
  const allows = samples.filter((s) => s.decision === 'allow').length;
  const excluded = samples.filter((s) => bucketOf(s) === 'excluida').length;
  return { excluded, allows, ratio: allows === 0 ? 0 : excluded / allows };
}
const DECISIONS: Decision[] = ['allow', 'deny', 'allow-session'];

function readStore(): Sample[] {
  if (!fs.existsSync(STORE)) return [];
  return fs
    .readFileSync(STORE, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Sample);
}

/**
 * I2 según §12.3: el diff quedó impreso y, si el render avisó de truncado, se
 * abrió el hunk del tramo omitido.
 *
 * La evidencia la graba la aprobación (`render`), así que no depende de leer el
 * PTY a ojo. `--diff-log`/`--detalle` quedan sólo para sesiones anteriores al
 * campo o para filas tecleadas a mano.
 */
function i2Satisfied(sample: Sample): boolean {
  if (sample.render !== undefined) {
    return sample.render.diffShown && (!sample.render.diffTruncated || sample.render.detailOpened);
  }
  return sample.diffLog || sample.detalle;
}

/** Condiciones de inclusión de §4.1, sólo sobre decisiones `allow` (I4 aparte). */
function exclusionReasons(sample: Sample): Reason[] {
  const reasons: Reason[] = [];
  const justification = sample.justificacion.trim().toLowerCase();
  if (!sample.leido || justification === '' || GENERIC.has(justification) || !HAS_LETTER.test(justification)) {
    reasons.push('I1');
  }
  if (DIFF_TOOLS.has(sample.tool) && !i2Satisfied(sample)) reasons.push('I2');
  // El piso es de `latencyMs`: `decisionMs` describe lectura y no excluye nada.
  if (sample.latencyMs < MIN_MS) reasons.push('I3');
  return reasons;
}
type Bucket = 'primario' | 'deny' | 'sesion' | 'excluida';

function bucketOf(sample: Sample): Bucket {
  if (sample.decision === 'deny') return 'deny';
  if (sample.decision !== 'allow') return 'sesion';
  return exclusionReasons(sample).length === 0 ? 'primario' : 'excluida';
}

/** nearest-rank: índice Math.ceil(p·n), acotado a [1, n]. */
function nearestRank(sorted: number[], p: number): number {
  return sorted[Math.max(1, Math.ceil(p * sorted.length)) - 1];
}

function stats(values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p = (x: number) => nearestRank(sorted, x);
  return `n=${sorted.length} · p50 ${p(0.5)} ms · p90 ${p(0.9)} ms · p95 ${p(0.95)} ms · min ${sorted[0]} ms · máx ${sorted[sorted.length - 1]} ms · media ${Math.round(sum / sorted.length)} ms`;
}

interface NewSample {
  runId: string;
  tool: string;
  decision: Decision;
  latencyMs: number;
  decisionMs?: number;
  source: Sample['source'];
  approvalId?: string;
  nota?: string;
  render?: ApprovalRenderFacts;
}

const validTool = (tool: string): boolean => /^[a-z][a-z0-9._]*$/.test(tool);

/**
 * Escribe la muestra **después** de mirar en qué estrato cae.
 *
 * Devuelve `null` cuando la muestra incumple §4.1 y no se pidió `--incluir-excluidas`:
 * escribirla a ciegas puede dejar el bloque fuera del tope del 20 % sin avisar.
 */
function pushSample(input: NewSample): Sample | null {
  if (PILOT) {
    console.log('[g1:cal2] modo piloto: no se escribe ninguna muestra');
    return null;
  }

  const samples = readStore();
  const sample: Sample = {
    sampleId: `CAL2-${String(samples.length + 1).padStart(2, '0')}`,
    ts: new Date().toISOString(),
    runId: input.runId,
    tool: input.tool,
    decision: input.decision,
    latencyMs: input.latencyMs,
    ...(input.decisionMs === undefined ? {} : { decisionMs: input.decisionMs }),
    leido: has('leido'),
    diffLog: has('diff-log'),
    detalle: has('detalle'),
    justificacion: value('justifica') ?? '',
    nota: input.nota ?? value('nota') ?? '',
    source: input.source,
    ...(input.approvalId === undefined ? {} : { approvalId: input.approvalId }),
    ...(input.render === undefined ? {} : { render: input.render }),
  };

  const reasons = exclusionReasons(sample);
  const bucket = bucketOf(sample);

  if (bucket === 'excluida' && !has('incluir-excluidas')) {
    const after = exclusionRatio([...samples, sample]);
    console.log(`✖ ${sample.runId} · ${sample.tool} · ${sample.decision} · ${sample.latencyMs} ms → excluida (${reasons.join(', ')}): no se escribe`);
    console.log(`  §4.1 ${reasons.join(' + ')}; con ella el bloque quedaría con ${after.excluded} de ${after.allows} decisiones \`allow\` excluidas (${Math.round(after.ratio * 100)} %, límite ${MAX_EXCLUDED_RATIO * 100} %).`);
    console.log('  para dejar constancia fuera del estrato: repite con --incluir-excluidas y anótala en §11.1 del protocolo.');
    return null;
  }

  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.appendFileSync(STORE, `${JSON.stringify(sample)}\n`);
  const origin = sample.source === 'session' ? ' (del JSON)' : '';
  const renderText = sample.render === undefined
    ? ''
    : ` · diff ${sample.render.diffShown ? 'impreso' : 'no impreso'}${sample.render.diffTruncated ? ' (truncado)' : ''}${sample.render.detailOpened ? ' + hunk abierto' : ''}`;
  console.log(`${sample.sampleId} · ${sample.runId} · ${sample.tool} · ${sample.decision} · ${sample.latencyMs} ms${origin}${renderText} → ${bucket}${bucket === 'excluida' ? ` (${reasons.join(', ')})` : ''}`);
  if (bucket === 'excluida') {
    const after = exclusionRatio([...samples, sample]);
    console.log(`  motivo: §4.1 ${reasons.join(' + ')}; se lista aparte y la corrida se repite con etiqueta nueva.`);
    console.log(`  tope §4.1: ${after.excluded} de ${after.allows} decisiones \`allow\` excluidas (${Math.round(after.ratio * 100)} %, límite ${MAX_EXCLUDED_RATIO * 100} %)${after.ratio > MAX_EXCLUDED_RATIO ? ' → el bloque sería INVÁLIDO' : ''}.`);
  }
  if (bucket === 'deny') console.log('  estrato deny: se publica aparte y nunca entra en el p95 primario.');
  if (bucket === 'sesion') console.log('  allow-session no genera muestra primaria (I4).');
  return sample;
}

function add(): void {
  const runId = value('run') ?? '';
  const tool = (value('tool') ?? '').trim();
  const decision = (value('decision') ?? '') as Decision;
  const latencyMs = Number(value('ms'));
  const decisionMsRaw = value('decision-ms');
  const decisionMs = decisionMsRaw === undefined ? undefined : Number(decisionMsRaw);
  const decisionMsInvalid = decisionMs !== undefined && (!Number.isInteger(decisionMs) || decisionMs < 0);

  if (runId === '' || !validTool(tool) || !DECISIONS.includes(decision) || !Number.isInteger(latencyMs) || latencyMs < 0 || decisionMsInvalid) {
    console.error('[g1:cal2] uso: add --run CAL2-R01 --tool fs.edit|fs.write|shell.run|… --decision allow|deny|allow-session --ms <entero> [--decision-ms <entero>] [--leido] [--diff-log] [--detalle] [--justifica "..."] [--nota "..."] [--incluir-excluidas]');
    process.exit(1);
  }

  if (pushSample({ runId, tool, decision, latencyMs, ...(decisionMs === undefined ? {} : { decisionMs }), source: 'manual' }) === null) {
    process.exit(1);
  }
}

interface SessionApproval {
  approvalId: string;
  tool: string;
  decision: Decision;
  render?: ApprovalRenderFacts;
  latencyMs?: number;
  decisionMs?: number;
}

interface SessionImport {
  approvals: SessionApproval[];
  /** Alguna aprobación de la sesión trae `render`: el proceso que la ejecutó ya grababa el campo. */
  writesRender: boolean;
}

/** Aprobaciones con `SessionStepV2.approval` del estado persistido. */
function approvalsFromSession(file: string): SessionImport {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;
  const state = (raw.state ?? raw.data ?? raw) as Record<string, any>;
  const steps = Array.isArray(state.steps) ? (state.steps as Record<string, any>[]) : [];
  const approvals: SessionApproval[] = [];
  for (const step of steps) {
    const approval = step.approval as Record<string, any> | undefined;
    if (!approval || typeof approval.id !== 'string') continue;
    if (!DECISIONS.includes(approval.decision as Decision)) continue;
    const render = renderFactsFrom(approval.render);
    approvals.push({
      approvalId: approval.id,
      tool: String(step.toolId ?? step.title ?? 'other'),
      decision: approval.decision as Decision,
      ...(typeof approval.latencyMs === 'number' && Number.isFinite(approval.latencyMs) ? { latencyMs: approval.latencyMs } : {}),
      ...(typeof approval.decisionMs === 'number' && Number.isFinite(approval.decisionMs) ? { decisionMs: approval.decisionMs } : {}),
      ...(render === undefined ? {} : { render }),
    });
  }
  return { approvals, writesRender: approvals.some((a) => a.render !== undefined) };
}

/**
 * Por qué una aprobación no trae `approval.render`.
 *
 * Sólo la propia sesión lo dice: si otra de sus aprobaciones trae el campo, el
 * proceso ya lo grababa y a ésta le falta por no pasar por el prompt. Si no lo
 * trae ninguna, el estado no permite saber si fue el flujo o un binario anterior
 * al campo, y el aviso no afirma ninguna de las dos cosas.
 */
function renderGapReason(writesRender: boolean): string {
  return writesRender
    ? 'se resolvió fuera del prompt del TTY (otra aprobación de la misma sesión sí trae el campo)'
    : 'ninguna aprobación de la sesión trae el campo: no hay constancia de que pasara por el prompt del TTY';
}

function importSession(): void {
  const runId = value('run') ?? '';
  const file = value('session') ?? '';
  const toolFilter = (value('tool') ?? '').trim();

  if (runId === '' || toolFilter !== '' && !validTool(toolFilter) || file === '' || !fs.existsSync(file)) {
    console.error('[g1:cal2] uso: import --run CAL2-R01 --session .commander/g1/cal2/CAL2-R01.json [--tool fs.edit] [--leido] [--diff-log] [--detalle] [--justifica "..."] [--incluir-excluidas]');
    process.exit(1);
  }

  const session = approvalsFromSession(file);
  const approvals = session.approvals.filter((a) => toolFilter === '' || a.tool === toolFilter);
  if (approvals.length === 0) {
    console.log(`[g1:cal2] ${file}: sin aprobaciones${toolFilter === '' ? '' : ` de ${toolFilter}`} en el estado de la sesión`);
    return;
  }

  const samples = readStore();
  let imported = 0;
  let missing = 0;
  let refused = 0;

  for (const approval of approvals) {
    const already = samples.find((s) => s.runId === runId && s.approvalId === approval.approvalId);
    if (already) {
      console.log(`= ${approval.tool} · ${approval.decision} · ya estaba como ${already.sampleId}`);
      continue;
    }
    if (approval.render === undefined) {
      const consequence = DIFF_TOOLS.has(approval.tool) ? '; I2 queda sin evidencia' : '';
      console.log(`⚠ ${approval.tool} · ${approval.decision} · sin \`approval.render\`: ${renderGapReason(session.writesRender)}${consequence}`);
    }
    if (approval.latencyMs === undefined) {
      missing++;
      const tieneDecision = approval.decisionMs === undefined ? '' : ` (sí trae decisionMs ${approval.decisionMs} ms)`;
      console.log(`↷ ${approval.tool} · ${approval.decision} · el estado no trae \`approval.latencyMs\`${tieneDecision}`);
      const decisionArg = approval.decisionMs === undefined ? '' : ` --decision-ms ${approval.decisionMs}`;
      console.log(`   → la línea «✓ aprobación … · N ms» del PTY es la fuente: npm run g1:cal2 -- add --run ${runId} --tool ${approval.tool} --decision ${approval.decision} --ms <N>${decisionArg} --leido --diff-log --justifica "…"`);
      continue;
    }
    const written = pushSample({
      runId,
      tool: approval.tool,
      decision: approval.decision,
      latencyMs: approval.latencyMs,
      ...(approval.decisionMs === undefined ? {} : { decisionMs: approval.decisionMs }),
      source: 'session',
      approvalId: approval.approvalId,
      ...(approval.render === undefined ? {} : { render: approval.render }),
    });
    if (written === null) refused++;
    else imported++;
  }

  console.log(
    `\n[g1:cal2] importadas ${imported} · rechazadas ${refused} · sin \`latencyMs\` ${missing} · ya estaban ${approvals.length - imported - missing - refused}`
  );
  if (missing > 0) console.log('[g1:cal2] las que no traen latencia se teclean con `add --ms` desde el log del PTY (§4 del protocolo); no se estiman.');
  if (refused > 0) {
    console.log(`[g1:cal2] ${refused} no cumplen §4.1 y se quedan fuera del store: listadas en §11.1 del protocolo con su motivo.`);
    process.exit(1);
  }
}

function summary(): void {
  const samples = readStore();
  if (samples.length === 0) {
    console.error('[g1:cal2] no hay muestras todavía');
    process.exit(1);
  }

  const included = samples.filter((s) => bucketOf(s) === 'primario');
  const excluded = samples.filter((s) => bucketOf(s) === 'excluida');
  const denied = samples.filter((s) => bucketOf(s) === 'deny');
  const session = samples.filter((s) => bucketOf(s) === 'sesion');

  console.log(`\n# Muestras (${samples.length})`);
  console.log('| id | runId | tool | decisión | latencyMs | decisionMs | estrato |');
  console.log('| --- | --- | --- | --- | ---: | ---: | --- |');
  for (const s of samples) {
    const reasons = exclusionReasons(s);
    const bucket = bucketOf(s);
    console.log(`| ${s.sampleId} | ${s.runId} | ${s.tool} | ${s.decision} | ${s.latencyMs} | ${s.decisionMs ?? '—'} | ${bucket}${bucket === 'excluida' ? ` (${reasons.join(', ')})` : ''} |`);
  }

  console.log(`\n# Estrato primario — incluido (${included.length}/${TARGET_N})`);
  if (included.length === 0) {
    console.log('sin muestras incluidas');
  } else {
    console.log(stats(included.map((s) => s.latencyMs)));
    for (const tool of [...new Set(included.map((s) => s.tool))]) {
      const byTool = included.filter((s) => s.tool === tool);
      console.log(`  ${tool}: ${stats(byTool.map((s) => s.latencyMs))}`);
    }
    const p95 = nearestRank([...included.map((s) => s.latencyMs)].sort((a, b) => a - b), 0.95);
    const over = included.filter((s) => s.latencyMs > REFERENCE_MS).length;
    console.log(`  puerta: p95 ${p95} ms frente a ${REFERENCE_MS} ms → ${p95 <= REFERENCE_MS ? 'CUMPLE' : 'NO CUMPLE'}`);
    console.log(`  lectura con n=${included.length}: ${over} decisión(es) por encima de ${REFERENCE_MS} ms`);
    if (included.length < TARGET_N) console.log(`  aviso: faltan ${TARGET_N - included.length} muestras incluidas para el objetivo`);

    // Segundo juego de percentiles: mismo estrato, otra métrica. No hay umbral ni
    // puerta aquí; publicarlo aparte es lo que evita confundirlo con el de arriba.
    const conDecision = included.filter((s) => typeof s.decisionMs === 'number');
    console.log(`\n# decisionMs — desde la primera tecla de lectura (${conDecision.length} de ${included.length} incluidas)`);
    if (conDecision.length === 0) {
      console.log('sin muestras con decisionMs: el campo se graba desde el 2026-11-13 y las anteriores no lo traen');
    } else {
      console.log(stats(conDecision.map((s) => s.decisionMs as number)));
      for (const tool of [...new Set(conDecision.map((s) => s.tool))]) {
        const byTool = conDecision.filter((s) => s.tool === tool);
        console.log(`  ${tool}: ${stats(byTool.map((s) => s.decisionMs as number))}`);
      }
      console.log(`  no decide la puerta: la referencia de ${REFERENCE_MS} ms es de \`latencyMs\` y no se toca`);
      if (conDecision.length < included.length) {
        console.log(`  aviso: ${included.length - conDecision.length} incluidas no traen decisionMs (estados anteriores al 2026-11-13)`);
      }
    }
  }

  console.log(`\n# Estrato deny — informativo, nunca se mezcla`);
  console.log(denied.length === 0 ? 'sin denegaciones registradas' : stats(denied.map((s) => s.latencyMs)));
  const denyConDecision = denied.filter((s) => typeof s.decisionMs === 'number');
  if (denyConDecision.length > 0) {
    console.log(`  decisionMs (informativo): ${stats(denyConDecision.map((s) => s.decisionMs as number))}`);
  }
  if (session.length > 0) console.log(`\nallow-session fuera del cómputo: ${session.length}`);

  console.log(`\n# Excluidas (${excluded.length})`);
  const tally: Record<string, number> = {};
  for (const s of excluded) {
    for (const reason of exclusionReasons(s)) tally[reason] = (tally[reason] ?? 0) + 1;
    console.log(`- ${s.sampleId} · ${s.latencyMs} ms · ${exclusionReasons(s).join(', ')}${s.nota === '' ? '' : ` · ${s.nota}`}`);
  }
  if (excluded.length > 0) console.log(`  recuento por condición: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  const { ratio } = exclusionRatio(samples);
  if (ratio > MAX_EXCLUDED_RATIO) {
    console.log(`  ⚠ ${Math.round(ratio * 100)} % de las decisiones \`allow\` excluidas (límite ${MAX_EXCLUDED_RATIO * 100} %): el bloque es INVÁLIDO y se repite con otro operador (§4.1)`);
  }
}

switch (command) {
  case 'add':
    add();
    break;
  case 'import':
    importSession();
    break;
  case 'summary':
    summary();
    break;
  default:
    console.error('[g1:cal2] comandos: add | import | summary');
    process.exit(1);
}
