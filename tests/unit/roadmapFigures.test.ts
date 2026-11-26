import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

/**
 * ROADMAP.md repite a mano el global del roadmap visual y el recuento por
 * frente. Estas pruebas leen el bloque `<script id="plan">` de la página (la
 * fuente del global) y las casillas del propio ROADMAP.md, y fallan si las
 * cifras citadas dejan de coincidir. La fecha también se contrasta con
 * `updated`, para que un resumen no quede fechado en una foto anterior.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('../..', import.meta.url));

/** Carpetas que no son documentación del repo (dependencias, artefactos y builds). */
const SKIP_DIRS = new Set([
  '.commander',
  '.git',
  'build',
  'cli-dist',
  'dist',
  'local_models',
  'node_modules',
  'release',
  'runtime',
]);

/** Recibos históricos y el worktree de CAL4H: fotos fechadas, no citas vivas. */
const SKIP_PREFIXES = ['docs/parity/receipts/', 'tests/tmp-g1/'];

/** Este archivo contiene fixtures viejos a propósito. */
const SKIP_FILES = new Set(['tests/unit/roadmapFigures.test.ts']);

function scannedDocs(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) scannedDocs(join(dir, entry.name), found);
      continue;
    }
    if (!/\.(md|html)$/i.test(entry.name)) continue;
    const rel = relative(root, join(dir, entry.name)).split(sep).join('/');
    if (SKIP_FILES.has(rel) || SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
    found.push(rel);
  }
  return found;
}

type Figures = { percent: number; closed: number; total: number; updated: string };

function planFigures(): Figures {
  const html = read('docs/roadmap-autonomo.html');
  const block = html.match(/<script type="application\/json" id="plan">([\s\S]*?)<\/script>/);
  if (!block) throw new Error('docs/roadmap-autonomo.html: falta el bloque <script id="plan">');

  const plan = JSON.parse(block[1]) as {
    updated: string;
    phases: { steps: { weight: number; progress: number }[] }[];
  };
  let weight = 0;
  let weighted = 0;
  let closed = 0;
  let total = 0;

  for (const phase of plan.phases) {
    const phaseWeight = phase.steps.reduce((sum, step) => sum + step.weight, 0);
    const phaseProgress =
      phase.steps.reduce((sum, step) => sum + step.weight * step.progress, 0) / phaseWeight;
    weight += phaseWeight;
    weighted += phaseWeight * phaseProgress;
    closed += phase.steps.filter((step) => step.progress >= 100).length;
    total += phase.steps.length;
  }

  return { percent: Math.round(weighted / weight), closed, total, updated: plan.updated };
}

/** Cifras que un documento cita sobre el roadmap visual. */
function citedFigures(text: string): Figures | null {
  const line = text.split(/\r?\n/).find((l) => l.includes('hacia el multiagente autónomo'));
  if (!line) return null;
  const percent = line.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const steps = line.match(/(\d+)\s+de\s+(\d+)\s+pasos cerrados/);
  const date = line.match(/(\d{4}-\d{2}-\d{2})/);
  if (!percent || !steps) return null;
  return {
    percent: Number(percent[1].replace(',', '.')),
    closed: Number(steps[1]),
    total: Number(steps[2]),
    updated: date ? date[1] : '',
  };
}

type Citation = { file: string; line: number; percent?: number; closed?: number; total?: number };

/** Citas sueltas del global o de los pasos cerrados, sin exigir el formato de la línea de resumen. */
function citationsIn(file: string, text: string): Citation[] {
  const citations: Citation[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const canonical = /hacia el multiagente autónomo/i.test(line);
    const mentionsSteps = /pasos cerrados/i.test(line);
    // «el roadmap visual va al 67 %» cita el global sin decir «pasos cerrados».
    // La métrica de criterios de fase (53 %) no es el global y queda fuera.
    const globalPercentOnly =
      /roadmap/i.test(line) && /visual|autónomo|global/i.test(line) && !/criterios/i.test(line);
    if (!canonical && !mentionsSteps && !globalPercentOnly) return;
    const percent = line.match(/(\d+(?:[.,]\d+)?)\s*%/);
    const steps =
      line.match(/(\d+)\s+de\s+(\d+)\s+pasos cerrados/) ??
      line.match(/(\d+)\/(\d+)\s+pasos cerrados/);
    if (!percent && !steps) return;
    citations.push({
      file,
      line: index + 1,
      percent: percent ? Number(percent[1].replace(',', '.')) : undefined,
      closed: steps ? Number(steps[1]) : undefined,
      total: steps ? Number(steps[2]) : undefined,
    });
  });
  return citations;
}

describe('cifras del roadmap visual', () => {
  const source = planFigures();

  it('ROADMAP.md cita el global y los pasos cerrados de la página', () => {
    const cited = citedFigures(read('ROADMAP.md'));
    expect(cited, 'ROADMAP.md: no encontré la línea con el roadmap visual').not.toBeNull();
    expect(Math.round(cited!.percent), 'ROADMAP.md: porcentaje global desfasado').toBe(source.percent);
    expect(cited!.closed, 'ROADMAP.md: pasos cerrados desfasados').toBe(source.closed);
    expect(cited!.total, 'ROADMAP.md: total de pasos desfasado').toBe(source.total);
    expect(cited!.updated, 'ROADMAP.md: fecha desfasada').toBe(source.updated);
  });

  it('el detector rechaza una cifra vieja', () => {
    const stale =
      '> … — 57,1 % hacia el multiagente autónomo (1999-01-01), 11 de 27 pasos cerrados.';
    const cited = citedFigures(stale)!;
    expect(Math.round(cited.percent)).not.toBe(source.percent);
    expect(cited.closed).not.toBe(source.closed);
    expect(cited.updated).not.toBe(source.updated);
  });

  it('detecta una cita del global que sólo trae el porcentaje', () => {
    const [citation] = citationsIn('nota.md', 'El roadmap visual va al 64 %.');
    expect(citation?.percent).toBe(64);
    expect(citation?.closed).toBeUndefined();
  });

  it('no cuenta la métrica de criterios del 53 %', () => {
    const line =
      'El 53 % cuenta criterios de fase, no esfuerzo, tiempo ni valor de producto: 50 de los 95 criterios en alcance tienen evidencia, y cada criterio es una casilla de este documento.';
    expect(citationsIn('ROADMAP.md', line)).toEqual([]);
  });

  it('ningún .md ni .html del repo cita el global o los pasos cerrados desfasados', () => {
    const files = scannedDocs(root);
    expect(files).toContain('ROADMAP.md');

    const found = files.flatMap((file) => citationsIn(file, read(file)));
    const stale = found.filter(
      (citation) =>
        (citation.percent !== undefined && Math.round(citation.percent) !== source.percent) ||
        (citation.closed !== undefined &&
          (citation.closed !== source.closed || citation.total !== source.total)),
    );

    expect(found.length, 'el barrido no encontró ninguna cita: el detector no está mirando').toBeGreaterThanOrEqual(
      1,
    );
    expect(
      stale,
      `citas desfasadas respecto de docs/roadmap-autonomo.html (${source.percent} %, ${source.closed}/${source.total}):\n${stale
        .map(
          (citation) =>
            `${citation.file}:${citation.line} → ${citation.percent ?? '?'} % · ${citation.closed ?? '?'}/${citation.total ?? '?'}`,
        )
        .join('\n')}`,
    ).toEqual([]);
  });
});

type PhaseBoxes = { title: string; done: number; open: number; total: number };

/**
 * Casillas de una sección de `ROADMAP.md`: un `##` abre el frente y cada `###`
 * una fase; los `####` (4A/4B) siguen dentro de su fase. Sólo se cuentan
 * `- [x]` y `- [ ]`; los `- [—]` son exclusiones declaradas y no suman.
 */
function frontPhases(file: string, section: RegExp): PhaseBoxes[] {
  const lines = read(file).split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+/.test(line) && section.test(line));
  expect(start, `${file}: falta la sección ${section}`).toBeGreaterThanOrEqual(0);

  const phases: PhaseBoxes[] = [];
  let current: PhaseBoxes | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    const heading = line.match(/^###\s+(.+)$/);
    if (heading) {
      current = { title: heading[1], done: 0, open: 0, total: 0 };
      phases.push(current);
      continue;
    }
    if (!current) continue;
    if (/^\s*- \[x\]/i.test(line)) current.done += 1;
    else if (/^\s*- \[ \]/.test(line)) current.open += 1;
  }
  return phases.map((phase) => ({ ...phase, total: phase.done + phase.open }));
}

/** UX no usa casillas: cuenta las diez filas de la tabla de §5 y cuántas dicen Hecho. */
function uxFigures(): { done: number; total: number } {
  const rows = read('ROADMAP.md')
    .split(/\r?\n/)
    .filter((line) => /^\|\s*\d+\.\s*\|/.test(line));
  expect(rows.length, 'ROADMAP.md §5: no encontré la tabla de UX 1.0').toBeGreaterThan(0);
  return { done: rows.filter((row) => /\*\*Hecho\*\*/.test(row)).length, total: rows.length };
}

/** Cifras que ROADMAP.md §1 cita para un frente (la última «n/m» de la fila). */
function citedFront(front: string): { done: number; total: number } {
  const row = read('ROADMAP.md')
    .split(/\r?\n/)
    .find((line) => line.startsWith(`| ${front} `));
  if (!row) throw new Error(`ROADMAP.md §1: falta la fila «${front}»`);
  const figures = [...row.matchAll(/(\d+)\/(\d+)/g)].pop();
  if (!figures) throw new Error(`ROADMAP.md §1: la fila «${front}» no trae «n/m»`);
  return { done: Number(figures[1]), total: Number(figures[2]) };
}

describe('desfase documental del roadmap', () => {
  it('ROADMAP.md cita el recibo G1-T10-* más alto del árbol', () => {
    const dir = join(root, 'docs/parity/receipts');
    const ids = readdirSync(dir)
      .map((name) => /^G1-T10-(\d+)-/.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]));
    expect(ids.length, 'docs/parity/receipts: no hay recibos G1-T10-*').toBeGreaterThan(0);
    const latest = `G1-T10-${Math.max(...ids)}`;

    const lines = read('ROADMAP.md').split(/\r?\n/);
    const citations = lines.filter((line) => line.includes(latest));
    const tableCitation = lines.find(
      (line) => line.startsWith('|') && line.includes('G1-SUBAGENT-CLOSE') && line.includes(latest),
    );

    expect(
      citations.length,
      `ROADMAP.md: debe citar ${latest}, el recibo de T10 más alto de docs/parity/receipts, al menos dos veces (fase F1 y tabla de issues); hoy ${citations.length}`,
    ).toBeGreaterThanOrEqual(2);
    expect(
      tableCitation,
      `ROADMAP.md §6: la fila de G1-SUBAGENT-CLOSE debe citar ${latest}`,
    ).toBeDefined();
  });

  it('el recuento por frente de §1 cuadra con las casillas y la regla declarada', () => {
    // F6 es una apuesta opcional: fuera del cómputo.
    const parity = frontPhases('ROADMAP.md', /^## 3\./).filter((phase) => !/^F6\b/.test(phase.title));
    // §1 declara que F2 está «cubierta por evidencia y sin marcar»: entra aunque sus casillas sigan vacías.
    const parityDone = parity.reduce(
      (sum, phase) => sum + phase.done + (/^F2\b/.test(phase.title) ? phase.open : 0),
      0,
    );
    // PL1 está fuera del cómputo hasta G3 y PL7 es opcional.
    const platform = frontPhases('ROADMAP.md', /^## 4\./).filter(
      (phase) => !/^PL(1|7)\b/.test(phase.title),
    );

    const expected = {
      Paridad: { done: parityDone, total: parity.reduce((sum, phase) => sum + phase.total, 0) },
      Plataforma: {
        done: platform.reduce((sum, phase) => sum + phase.done, 0),
        total: platform.reduce((sum, phase) => sum + phase.total, 0),
      },
      UX: uxFigures(),
    };

    for (const [front, figures] of Object.entries(expected)) {
      expect(
        citedFront(front),
        `ROADMAP.md §1: ${front} no cuadra con las casillas de su sección`,
      ).toEqual(figures);
    }

    const sum = {
      done: expected.Paridad.done + expected.Plataforma.done + expected.UX.done,
      total: expected.Paridad.total + expected.Plataforma.total + expected.UX.total,
    };
    expect(citedFront('**Total**'), 'ROADMAP.md §1: el total no es la suma de los frentes').toEqual(
      sum,
    );

    const totalRow =
      read('ROADMAP.md')
        .split(/\r?\n/)
        .find((line) => line.startsWith('| **Total**')) ?? '';
    const percent = [...totalRow.matchAll(/(\d+)\s*%/g)].pop();
    expect(percent, 'ROADMAP.md §1: la fila del total no cita el porcentaje').toBeDefined();
    expect(
      Number(percent![1]),
      'ROADMAP.md §1: el porcentaje no se deriva del total',
    ).toBe(Math.round((sum.done / sum.total) * 100));
  });
});
