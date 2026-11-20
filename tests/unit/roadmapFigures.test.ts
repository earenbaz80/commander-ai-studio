import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

/**
 * ROADMAP.md y ROADMAP_PARITY.md repiten a mano el global del roadmap visual.
 * Estas pruebas leen el bloque `<script id="plan">` de la página (la fuente) y
 * fallan si la cifra citada deja de coincidir, que es justo lo que pasó cuando
 * la página pasó a 62 % y los resúmenes seguían en 57,1 %. La fecha también se
 * contrasta con `updated`, para que un resumen no quede fechado en una foto
 * anterior a la que cita.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

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

describe('cifras del roadmap visual', () => {
  const source = planFigures();

  for (const file of ['ROADMAP.md', 'ROADMAP_PARITY.md']) {
    it(`${file} cita el global y los pasos cerrados de la página`, () => {
      const cited = citedFigures(read(file));
      expect(cited, `${file}: no encontré la línea con el roadmap visual`).not.toBeNull();
      expect(Math.round(cited!.percent), `${file}: porcentaje global desfasado`).toBe(source.percent);
      expect(cited!.closed, `${file}: pasos cerrados desfasados`).toBe(source.closed);
      expect(cited!.total, `${file}: total de pasos desfasado`).toBe(source.total);
      expect(cited!.updated, `${file}: fecha desfasada`).toBe(source.updated);
    });
  }

  it('el detector rechaza una cifra vieja', () => {
    const stale =
      '> … — 57,1 % hacia el multiagente autónomo (1999-01-01), 11 de 27 pasos cerrados.';
    const cited = citedFigures(stale)!;
    expect(Math.round(cited.percent)).not.toBe(source.percent);
    expect(cited.closed).not.toBe(source.closed);
    expect(cited.updated).not.toBe(source.updated);
  });
});
