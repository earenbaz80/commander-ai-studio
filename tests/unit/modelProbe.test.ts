import { describe, it, expect } from 'vitest';
import { probeFirstResponder, type PreflightProbe } from '../../src/lib/modelProbe';

/** Construye una sonda falsa que responde según la lista dada. */
function stubProbe(byModel: Record<string, PreflightProbe>) {
  const asked: string[] = [];
  const probe = async (model: string): Promise<PreflightProbe> => {
    asked.push(model);
    return byModel[model] ?? { status: 'failed', error: 'HTTP 503: sin respuesta' };
  };
  return { probe, asked };
}

describe('recorrido de la cadena de respaldo', () => {
  it('para en el primero que responde y no gasta más llamadas', async () => {
    const { probe, asked } = stubProbe({ a: { status: 'ok', model: 'a' } });

    const result = await probeFirstResponder(['a', 'b', 'c'], probe);

    expect(asked).toEqual(['a']);
    expect(result.answeredIndex).toBe(0);
    expect(result.answeredModel).toBe('a');
    expect(result.attempts).toHaveLength(1);
  });

  it('avanza en orden y dice en qué posición respondería', async () => {
    const { probe, asked } = stubProbe({
      a: { status: 'failed', error: 'HTTP 503: cuota' },
      b: { status: 'failed', error: 'HTTP 404: retirado' },
      c: { status: 'ok', model: 'c' },
    });

    const result = await probeFirstResponder(['a', 'b', 'c'], probe);

    // El orden de la lista es la prioridad: se pregunta de arriba abajo.
    expect(asked).toEqual(['a', 'b', 'c']);
    expect(result.answeredIndex).toBe(2);
    expect(result.answeredModel).toBe('c');
    expect(result.attempts.map((a) => a.status)).toEqual(['failed', 'failed', 'ok']);
    expect(result.attempts[0].detail).toContain('cuota');
  });

  it('si ninguno responde lo dice sin inventar un ganador', async () => {
    const { probe, asked } = stubProbe({});
    const result = await probeFirstResponder(['a', 'b'], probe);

    expect(asked).toEqual(['a', 'b']);
    expect(result.answeredIndex).toBe(-1);
    expect(result.answeredModel).toBeUndefined();
    expect(result.attempts).toHaveLength(2);
  });

  it('una cadena vacía no hace ninguna llamada', async () => {
    const { probe, asked } = stubProbe({});
    const result = await probeFirstResponder([], probe);

    expect(asked).toEqual([]);
    expect(result.answeredIndex).toBe(-1);
    expect(result.attempts).toEqual([]);
  });

  it('una sustitución no cuenta como respuesta: se pidió otro modelo', async () => {
    const { probe } = stubProbe({
      a: { status: 'substituted', fallback: { from: 'a', to: 'z' }, model: 'z' },
      b: { status: 'ok', model: 'b' },
    });

    const result = await probeFirstResponder(['a', 'b'], probe);

    // El primero no sirvió, aunque contestara otro modelo por detrás.
    expect(result.answeredIndex).toBe(1);
    expect(result.answeredModel).toBe('b');
    expect(result.attempts[0].detail).toContain('contestó z');
  });
});
