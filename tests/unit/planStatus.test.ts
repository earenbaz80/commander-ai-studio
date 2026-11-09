import { describe, expect, it } from 'vitest';
import { normalizePlan, planGlyph, planStatusOf } from '../../src/agent/plan';

describe('estados del plan (F1-13)', () => {
  it('migra done:true/false sin perder pasos ni texto', () => {
    const plan = normalizePlan([
      { id: 'p1', text: 'leer el repo', done: true },
      { id: 'p2', text: 'escribir el fix', done: false },
    ]);

    expect(plan).toEqual([
      { id: 'p1', text: 'leer el repo', status: 'done', done: true },
      { id: 'p2', text: 'escribir el fix', status: 'pending', done: false },
    ]);
    expect(planStatusOf(undefined, true)).toBe('done');
    expect(planStatusOf(undefined, false)).toBe('pending');
    expect(planStatusOf('blocked', true)).toBe('blocked');
  });

  it('blocked nunca se marca como completado', () => {
    const [item] = normalizePlan([{ id: 'p1', text: 'espera review', status: 'blocked' }]);
    expect(item.status).toBe('blocked');
    expect(item.done).toBe(false);
    expect(planGlyph('blocked')).toBe('!');
    expect(planGlyph('done')).toBe('✔');
    expect(planGlyph('in_progress')).toBe('▸');
    expect(planGlyph('pending')).toBe('☐');
  });

  it('update_plan parcial {id,status} actualiza sin repetir texto y conserva metadatos', () => {
    const current = normalizePlan([
      {
        id: 'p1',
        text: 'leer el repo',
        status: 'in_progress',
        files: ['src/a.ts'],
        criteria: 'lee el archivo',
      },
    ]);

    const next = normalizePlan([{ id: 'p1', status: 'blocked' }], current);
    expect(next).toEqual([
      {
        id: 'p1',
        text: 'leer el repo',
        status: 'blocked',
        done: false,
        files: ['src/a.ts'],
        criteria: 'lee el archivo',
      },
    ]);
  });

  it('acepta archivos y criterios, sin duplicados ni vacíos', () => {
    const [item] = normalizePlan([
      {
        id: 'p1',
        text: 'arreglar',
        status: 'in_progress',
        files: [' src/a.ts ', 'src/a.ts', '', 3],
        criteria: '  tsc en verde  ',
      },
    ]);
    expect(item.files).toEqual(['src/a.ts']);
    expect(item.criteria).toBe('tsc en verde');
  });

  it('un paso nuevo sin status nace pending y descarta basura o ids repetidos', () => {
    expect(normalizePlan([{ id: 'p1', text: 'nuevo' }])[0].status).toBe('pending');
    expect(normalizePlan([{ text: '   ' }, { done: true }, null]).length).toBe(0);
    expect(normalizePlan([{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }]).length).toBe(1);
  });

  it('recorta texto y número de pasos, y no borra el plan con una entrada inválida', () => {
    const many = normalizePlan(
      Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, text: `paso ${i}` }))
    );
    expect(many).toHaveLength(20);

    const long = normalizePlan([{ id: 'p1', text: 'x'.repeat(300) }]);
    expect(long[0].text).toHaveLength(160);

    const current = normalizePlan([{ id: 'p1', text: 'leer' }]);
    expect(normalizePlan('no soy un array', current)).toEqual(current);
  });
});
