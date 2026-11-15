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
  options: { blink?: boolean; eyeOffset?: { x: number; y: number }; idleGaze?: boolean } = {}
) => {
  const { container } = render(
    <NonoHead
      variant="eyes"
      expression={expression}
      blink={options.blink ?? false}
      eyeOffset={options.eyeOffset ?? { x: 0, y: 0 }}
      idleGaze={options.idleGaze ?? false}
      size={96}
    />
  );
  const svg = container.querySelector('svg[data-variant="eyes"]') as SVGSVGElement | null;
  const eyes = Array.from(
    svg?.querySelectorAll('[data-testid="nono-eyes"] rect') ?? []
  ) as SVGRectElement[];
  const gaze = svg?.querySelector('[data-testid="nono-eyes-gaze"]') as SVGGElement | null;
  return { svg, eyes, gaze };
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

  test('la mirada sigue al puntero y vuelve al centro en reposo', () => {
    const base = renderEyes('neutral');
    const moved = renderEyes('neutral', { eyeOffset: { x: 1, y: 1 } });
    const idle = renderEyes('neutral', { eyeOffset: { x: 1, y: 1 }, idleGaze: true });

    // El vector extremo desplaza el grupo; en reposo el grupo vuelve a cero.
    expect(moved.gaze?.style.transform).toContain('translate(7px, 5px)');
    expect(idle.gaze?.style.transform).toContain('translate(0px, 0px)');

    // La geometría queda en su sitio y el barrido arranca desde el centro.
    expect(idle.eyes.map((eye) => eye.getAttribute('x'))).toEqual(
      base.eyes.map((eye) => eye.getAttribute('x'))
    );
    expect(idle.eyes.map((eye) => eye.getAttribute('y'))).toEqual(
      base.eyes.map((eye) => eye.getAttribute('y'))
    );
    expect(
      idle.svg?.querySelector('[data-testid="nono-eyes"]')?.getAttribute('class') ?? ''
    ).toContain('nono-orb-gaze');
  });
});
