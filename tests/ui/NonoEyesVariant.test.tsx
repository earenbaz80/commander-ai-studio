import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { NonoHead } from '../../src/components/nono/NonoHead';
import type { NonoExpression } from '../../src/components/nono/content';

/**
 * Variante «solo ojos»: dos rectángulos sin cabeza ni boca. Las expresiones se
 * resuelven con ancho, alto, posición e inclinación; aquí se comprueba que
 * cambian de verdad y que el parpadeo y la mirada siguen funcionando.
 */

const renderEyes = (
  expression: NonoExpression,
  options: { blink?: boolean; eyeOffset?: { x: number; y: number } } = {}
) => {
  const { container } = render(
    <NonoHead
      variant="eyes"
      expression={expression}
      blink={options.blink ?? false}
      eyeOffset={options.eyeOffset ?? { x: 0, y: 0 }}
      size={96}
    />
  );
  const svg = container.querySelector('svg[data-variant="eyes"]') as SVGSVGElement | null;
  const eyes = Array.from(
    svg?.querySelectorAll('[data-testid="nono-eyes"] rect') ?? []
  ) as SVGRectElement[];
  return { svg, eyes };
};

describe('NonoHead · variante de solo ojos', () => {
  test('dibuja dos rectángulos y ninguna pieza de cabeza', () => {
    const { svg, eyes } = renderEyes('neutral');

    expect(svg).toBeTruthy();
    expect(eyes).toHaveLength(2);
    expect(svg?.querySelector('[data-testid="nono-face-mouth"]')).toBeNull();
    expect(svg?.querySelector('[data-testid="nono-face-eyes"]')).toBeNull();
    expect(svg?.querySelector('circle')).toBeNull();
  });

  test('el parpadeo aplana los dos ojos', () => {
    const { eyes } = renderEyes('neutral', { blink: true });

    expect(eyes.map((eye) => eye.getAttribute('height'))).toEqual(['3', '3']);
  });

  test('cada expresión cambia la geometría de los ojos', () => {
    const neutral = renderEyes('neutral').eyes;
    const surprised = renderEyes('surprised').eyes;
    const sleepy = renderEyes('sleepy').eyes;

    expect(Number(surprised[0].getAttribute('height'))).toBeGreaterThan(
      Number(neutral[0].getAttribute('height'))
    );
    expect(Number(sleepy[0].getAttribute('height'))).toBeLessThan(
      Number(neutral[0].getAttribute('height'))
    );
    expect(neutral[0].getAttribute('transform')).toBeNull();
    expect(renderEyes('angry').eyes[0].getAttribute('transform')).toContain('rotate');
  });

  test('el error son aspas rectangulares', () => {
    const { eyes } = renderEyes('error');

    expect(eyes).toHaveLength(4);
    expect(eyes.every((eye) => eye.getAttribute('transform')?.includes('rotate'))).toBe(true);
  });

  test('el error se pinta en rojo', () => {
    const error = renderEyes('error').eyes;

    expect(error.every((eye) => eye.getAttribute('fill') === '#ff5555')).toBe(true);
    expect(renderEyes('neutral').eyes[0].getAttribute('fill')).not.toBe('#ff5555');
  });

  test('love conserva el latido y cool añade el puente', () => {
    expect(
      renderEyes('love').eyes.every((eye) => eye.getAttribute('class')?.includes('nono-heart'))
    ).toBe(true);
    expect(renderEyes('cool').eyes).toHaveLength(3);
  });

  test('la mirada desplaza los rectángulos con el puntero', () => {
    const base = renderEyes('neutral').eyes[0];
    const moved = renderEyes('neutral', { eyeOffset: { x: 1, y: 1 } }).eyes[0];

    // Más recorrido que las otras variantes: el ojo solo tiene que seguir el
    // puntero sin una cabeza que lo ancle.
    expect(Number(moved.getAttribute('x')) - Number(base.getAttribute('x'))).toBe(7);
    expect(Number(moved.getAttribute('y')) - Number(base.getAttribute('y'))).toBe(5);
  });
});
