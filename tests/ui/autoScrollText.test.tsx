import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useAutoScrollText } from '../../src/hooks/useAutoScrollText';

const Harness = () => {
  useAutoScrollText();
  return (
    <button type="button">
      <span data-testid="label" className="truncate">
        Un texto mucho más largo que la caja
      </span>
    </button>
  );
};

const originalRaf = window.requestAnimationFrame;
const originalCaf = window.cancelAnimationFrame;

afterEach(() => {
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: originalRaf,
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: originalCaf,
  });
});

function prepareLabel(width = 360, visible = 120) {
  const label = screen.getByTestId('label');
  Object.defineProperty(label, 'scrollWidth', { configurable: true, value: width });
  Object.defineProperty(label, 'clientWidth', { configurable: true, value: visible });
  let scrollLeft = 0;
  Object.defineProperty(label, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });
  return {
    label,
    getScrollLeft: () => scrollLeft,
  };
}

describe('useAutoScrollText', () => {
  test('desplaza el texto truncado al pasar el ratón y lo devuelve al salir', () => {
    let nextFrame: FrameRequestCallback | null = null;
    const raf = vi.fn((callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 7;
    });
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: raf });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: vi.fn() });

    render(<Harness />);
    const { label, getScrollLeft } = prepareLabel();

    fireEvent.mouseOver(label);
    expect(raf).toHaveBeenCalledTimes(1);

    act(() => {
      nextFrame?.(performance.now() + 5_000);
    });
    expect(getScrollLeft()).toBe(240);

    fireEvent.mouseOut(label, { relatedTarget: document.body });
    expect(getScrollLeft()).toBe(0);
  });

  test('no anima un texto que cabe completo', () => {
    const raf = vi.fn(() => 1);
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: raf });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: vi.fn() });

    render(<Harness />);
    const { label } = prepareLabel(120, 120);

    fireEvent.mouseOver(label);
    expect(raf).not.toHaveBeenCalled();
  });

  test('no anima un recorte imperceptible de dos píxeles', () => {
    const raf = vi.fn(() => 1);
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: raf });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: vi.fn() });

    render(<Harness />);
    const { label } = prepareLabel(122, 120);

    fireEvent.mouseOver(label);
    expect(raf).not.toHaveBeenCalled();
  });

  test('encuentra el texto truncado al enfocar el botón que lo contiene', () => {
    const raf = vi.fn(() => 1);
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: raf });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: vi.fn() });

    render(<Harness />);
    prepareLabel();

    fireEvent.focusIn(screen.getByRole('button'));
    expect(raf).toHaveBeenCalledTimes(1);
  });

  test('no busca textos truncados al enfocar un contenedor genérico', () => {
    const raf = vi.fn(() => 1);
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: raf });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: vi.fn() });

    render(<Harness />);
    prepareLabel();

    const container = screen.getByRole('button').parentElement as HTMLElement;
    fireEvent.focusIn(container);
    expect(raf).not.toHaveBeenCalled();
  });
});
