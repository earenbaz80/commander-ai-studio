/**
 * Auditoría offline de `LoopGuard` sobre las corridas archivadas de G1.
 *
 * Replay de la secuencia de tool calls de cada estado con la guarda REAL (no
 * una reimplementación): dice en qué llamada cortaría, cuántas llamadas y
 * lecturas se ahorran y si habría cortado alguna corrida que la hoja del día
 * dio por `passed`. Sirve para repetir la medición tras cada cambio de la
 * guarda, sin volver a gastar cuota de proveedor.
 *
 * El veredicto `passed` NO sale del `status` de la sesión: sale de las hojas
 * `docs/parity/dogfooding-g1-d{1..5}.md`. El corpus son las 28 corridas válidas
 * del recibo `docs/parity/receipts/G1-DOGFOOD-2026-11-12.md`.
 *
 * Uso:
 *   npm run audit:loop-guard
 *   npm run audit:loop-guard -- --dir .commander/g1 --strict
 *
 * `--strict` sale 1 si alguna corrida `passed` habría sido cortada (señal de
 * regresión); por defecto sale 0 y sólo lo reporta. Sin estados que auditar
 * sale 2: no es un resultado, es un corpus que falta.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LoopGuard, IDENTICAL_READ_TOOLS } from '../src/agent/identicalCalls';
import { proposalStatsFor } from '../src/agent/proposals';
import type { ProposalStatsV2, SessionProposalV2 } from '../src/agent/sessionTypes';

/**
 * Las 28 corridas válidas: 24 planificadas + 4 repeticiones. `files` son los
 * nombres candidatos dentro del directorio; se usa el primero que exista.
 */
type RunSpec = {
  id: string;
  files: string[];
  /** Veredicto de la hoja del día, no el `status` técnico de la sesión. */
  passed: boolean;
  note?: string;
};

const RUNS: RunSpec[] = [
  { id: 'G1-D1-01', files: ['G1-D1-01.json'], passed: true },
  { id: 'G1-D1-02', files: ['G1-D1-02.json'], passed: true },
  { id: 'G1-D1-03', files: ['G1-D1-03.json'], passed: true },
  { id: 'G1-D1-04', files: ['G1-D1-04.json'], passed: false },
  { id: 'G1-D1-05', files: ['G1-D1-05.json'], passed: false },
  { id: 'G1-D2-01', files: ['G1-D2-01.json'], passed: true },
  { id: 'G1-D2-02', files: ['G1-D2-02.json'], passed: true },
  { id: 'G1-D2-03', files: ['G1-D2-03.json'], passed: false },
  { id: 'G1-D2-04', files: ['G1-D2-04.json'], passed: true },
  { id: 'G1-D2-05', files: ['G1-D2-05.json'], passed: true },
  { id: 'G1-D3-01', files: ['G1-D3-01.json'], passed: false },
  { id: 'G1-D3-02', files: ['G1-D3-02.json'], passed: false },
  { id: 'G1-D3-02R', files: ['G1-D3-02-rerun.json'], passed: true },
  { id: 'G1-D3-03', files: ['G1-D3-03.json'], passed: false },
  { id: 'G1-D3-03R', files: ['G1-D3-03-rerun.json'], passed: true },
  { id: 'G1-D3-04', files: ['G1-D3-04.json'], passed: true },
  { id: 'G1-D3-05', files: ['G1-D3-05.json'], passed: true },
  { id: 'G1-D4-01', files: [], passed: true, note: 'T7 local: sin estado de agente' },
  {
    id: 'G1-D4-04',
    files: ['G1-D4-04.json'],
    passed: false,
    note: 'estado válido ausente; `-attempt1` es el intento bloqueado',
  },
  { id: 'G1-D4-02', files: ['G1-D4-02.json'], passed: true },
  { id: 'G1-D4-03', files: ['G1-D4-03.json'], passed: false },
  { id: 'G1-D4-03R', files: ['G1-D4-03R.json'], passed: false },
  { id: 'G1-D4-05', files: ['G1-D4-05.json'], passed: false },
  { id: 'G1-D4-05R', files: ['G1-D4-05R.json'], passed: false },
  { id: 'G1-D5-01', files: [], passed: true, note: 'T7 local: sin estado de agente' },
  { id: 'G1-D5-02', files: [], passed: true, note: 'T7 local: sin estado de agente' },
  { id: 'G1-D5-03', files: ['G1-D5-03.json'], passed: true },
  { id: 'G1-D5-04', files: ['G1-D5-04.json'], passed: true },
];

type Step = { type?: string; toolId?: string; input?: unknown; output?: unknown };
type StateFile = {
  state?: {
    status?: string;
    steps?: Step[];
    proposals?: SessionProposalV2[];
    proposalStats?: unknown;
  };
};

type Call = { tool: string; input: Record<string, unknown>; ok: boolean; hasResult: boolean };

type Row = {
  spec: RunSpec;
  status?: string;
  calls: Call[];
  reads: number;
  warned: number;
  refused: number;
  skipped: number;
  skippedReads: number;
  cut?: { at: number; tool: string; attempts: number; message: string };
  afterCalls: number;
  afterReads: number;
  proposalStats: ProposalStatsV2;
  pendingProposals: number;
  hasProposalData: boolean;
};

type Options = { dir: string; strict: boolean };

function parseArgs(argv: string[]): Options {
  const options: Options = { dir: '.commander/g1', strict: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') {
      const value = argv[++i];
      if (!value) throw new Error('--dir necesita una ruta');
      options.dir = value;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Uso: npm run audit:loop-guard -- [--dir <estados>] [--strict]');
      process.exit(0);
    } else {
      throw new Error(`argumento desconocido: ${arg}`);
    }
  }
  return options;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Empareja cada tool_call con su tool_result posterior, sin cruzarse con otra call. */
function callsOf(steps: Step[]): Call[] {
  const calls: Call[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type !== 'tool_call') continue;
    let result: Step | undefined;
    for (let k = i + 1; k < steps.length; k++) {
      if (steps[k].type === 'tool_result') {
        result = steps[k];
        break;
      }
      if (steps[k].type === 'tool_call') break;
    }
    const output = isRecord(result?.output) ? result.output : null;
    calls.push({
      tool: String(step.toolId ?? ''),
      input: isRecord(step.input) ? step.input : {},
      // El bug de `runTool` (HTTP 200 = éxito) ya está corregido, pero los
      // estados archivados conservan pasos `completed` con `output.ok:false`;
      // la simulación usa `output.ok` y no el `status` del step.
      ok: Boolean(output && output.ok !== false),
      hasResult: Boolean(result),
    });
  }
  return calls;
}

function replay(spec: RunSpec, state: StateFile['state']): Row {
  const steps = state?.steps ?? [];
  const calls = callsOf(steps);
  const guard = new LoopGuard();
  let warned = 0;
  let refused = 0;
  let skipped = 0;
  let skippedReads = 0;
  let cut: Row['cut'];

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const verdict = guard.repeat(call.tool, call.input);
    if (verdict) {
      if (verdict.action === 'cut') {
        cut = { at: i + 1, tool: call.tool, attempts: verdict.cut.attempts, message: verdict.message };
        break;
      }
      skipped += 1;
      if (IDENTICAL_READ_TOOLS.has(call.tool)) skippedReads += 1;
      if (verdict.action === 'warn') warned += 1;
      else refused += 1;
      // Aviso y fallo no ejecutan la tool: no hay `succeeded` que aplicar.
      continue;
    }
    if (call.ok) guard.succeeded(call.tool, call.input);
  }

  const after = cut ? calls.slice(cut.at) : [];
  const proposals = state?.proposals ?? [];
  const proposalStats = proposalStatsFor(proposals, state?.proposalStats);
  return {
    spec,
    status: state?.status,
    calls,
    reads: calls.filter((call) => IDENTICAL_READ_TOOLS.has(call.tool)).length,
    warned,
    refused,
    skipped,
    skippedReads,
    cut,
    afterCalls: after.length,
    afterReads: after.filter((call) => IDENTICAL_READ_TOOLS.has(call.tool)).length,
    proposalStats,
    pendingProposals: proposals.filter(
      (proposal) => !proposal.applied && proposal.discardedAt === undefined
    ).length,
    hasProposalData:
      proposals.length > 0 || Object.values(proposalStats).some((value) => value > 0),
  };
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const dir = path.resolve(options.dir);
  if (!fs.existsSync(dir)) {
    console.error(`No existe el directorio de estados: ${dir}`);
    console.error('Pásalo con --dir <ruta>; el script no inventa un corpus vacío.');
    process.exit(2);
  }

  const rows: Row[] = [];
  const missing: RunSpec[] = [];
  for (const spec of RUNS) {
    const file = spec.files.map((name) => path.join(dir, name)).find((candidate) => fs.existsSync(candidate));
    if (!file) {
      missing.push(spec);
      continue;
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as StateFile;
    rows.push(replay(spec, parsed.state ?? (parsed as StateFile['state'])));
  }

  if (rows.length === 0) {
    console.error(`Ningún estado de G1 encontrado en ${dir}.`);
    process.exit(2);
  }

  console.log(`Corridas auditadas: ${rows.length}/${RUNS.length} (estados en ${dir})`);
  console.log('');
  console.log(
    [
      pad('corrida', 10),
      pad('hoja', 6),
      pad('status', 10),
      pad('calls', 6),
      pad('reads', 6),
      pad('warn', 5),
      pad('ref', 4),
      pad('salt', 5),
      pad('corte', 18),
      'tras corte',
    ].join(' ')
  );
  for (const row of rows) {
    const cut = row.cut ? `#${row.cut.at} ${row.cut.tool}` : '—';
    console.log(
      [
        pad(row.spec.id, 10),
        pad(row.spec.passed ? 'PASA' : 'falla', 6),
        pad(row.status ?? '—', 10),
        pad(row.calls.length, 6),
        pad(row.reads, 6),
        pad(row.warned, 5),
        pad(row.refused, 4),
        pad(`${row.skipped}`, 5),
        pad(cut, 18),
        row.cut ? `${row.afterCalls} calls / ${row.afterReads} lecturas` : '—',
      ].join(' ')
    );
  }

  const cuts = rows.filter((row) => row.cut);
  const passedCuts = cuts.filter((row) => row.spec.passed);
  const skipped = rows.reduce((sum, row) => sum + row.skipped, 0);
  const skippedReads = rows.reduce((sum, row) => sum + row.skippedReads, 0);
  const afterCalls = rows.reduce((sum, row) => sum + row.afterCalls, 0);
  const afterReads = rows.reduce((sum, row) => sum + row.afterReads, 0);
  const reads = rows.reduce((sum, row) => sum + row.reads, 0);
  const calls = rows.reduce((sum, row) => sum + row.calls.length, 0);
  const savedReads = skippedReads + afterReads;
  const pct = reads === 0 ? 0 : Math.round((savedReads / reads) * 100);

  console.log('');
  console.log('CORTES');
  if (cuts.length === 0) {
    console.log('  ninguno: la guarda no cierra ninguna de las corridas auditadas.');
  }
  for (const row of cuts) {
    const callWord = row.afterCalls === 1 ? 'llamada' : 'llamadas';
    const readWord = row.afterReads === 1 ? 'lectura' : 'lecturas';
    console.log(
      `  ${row.spec.id}: llamada #${row.cut!.at} ${row.cut!.tool} (intento ${row.cut!.attempts}) · ` +
        `${row.afterCalls} ${callWord} y ${row.afterReads} ${readWord} tras el corte · ` +
        `hoja ${row.spec.passed ? 'PASA' : 'falla'}`
    );
    console.log(`    ${row.cut!.message}`);
  }

  console.log('');
  console.log('AHORRO');
  console.log(
    `  lecturas: ${savedReads}/${reads} (${pct} %) = ${skippedReads} por aviso/fallo + ${afterReads} tras el corte`
  );
  console.log(
    `  llamadas: ${skipped + afterCalls}/${calls} (${Math.round(((skipped + afterCalls) / calls) * 100)} %) = ` +
      `${skipped} por aviso/fallo + ${afterCalls} tras el corte`
  );
  console.log(
    `  saltadas por aviso/fallo (antes de un corte o del final): ${skipped} llamadas en ` +
      `${rows.filter((row) => row.skipped > 0).length} corridas`
  );

  console.log('');
  console.log('PROPUESTAS');
  const proposalRows = rows.filter((row) => row.hasProposalData);
  if (proposalRows.length === 0) {
    console.log('  sin datos de propuestas en este corpus (estados anteriores a la métrica).');
  } else {
    const sum = (key: keyof ProposalStatsV2) =>
      proposalRows.reduce((total, row) => total + row.proposalStats[key], 0);
    console.log(`  corridas con propuestas: ${proposalRows.length}/${rows.length}`);
    console.log(
      `  creadas: ${sum('created')} · duplicadas descartadas: ${sum('duplicatesDropped')}`
    );
    console.log(
      `  normalización: tope por archivo: ${sum('perFileCapDropped')} · ` +
        `tope de sesión: ${sum('totalCapDropped')}`
    );
    console.log(
      `  pendientes: ${proposalRows.reduce((total, row) => total + row.pendingProposals, 0)} · ` +
        `revisadas: ${sum('reviewed')} · aplicadas: ${sum('applied')} · descartadas: ${sum('discarded')}`
    );
  }

  console.log('');
  console.log('CORRIDAS `passed` QUE SE CORTARÍAN');
  if (passedCuts.length === 0) {
    console.log('  ninguna.');
  } else {
    for (const row of passedCuts) console.log(`  ${row.spec.id} (corte en la llamada #${row.cut!.at})`);
    console.log('  Revisa si el corte llega antes de la acción que hizo pasar la tarea.');
  }

  if (missing.length > 0) {
    console.log('');
    console.log('SIN ESTADO (no auditadas)');
    for (const spec of missing) console.log(`  ${spec.id}: ${spec.note ?? 'archivo no encontrado'}`);
  }

  if (options.strict && passedCuts.length > 0) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
