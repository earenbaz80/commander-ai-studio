import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { GlobalTooltip } from '../../src/components/GlobalTooltip';
import { EDGE_MARGIN, ANCHOR_GAP } from '../../src/utils/tooltipGeometry';

/**
 * jsdom no maqueta nada: el tooltip se mide a sí mismo con
 * getBoundingClientRect para corregirse si se sale de pantalla, así que el test
 * devuelve geometría real a partir del `left`/`top`/`transform` que pinta el
 * componente. Así se comprueba la posición final, no sólo las clases.
 */
const TOOLTIP_WIDTH = 200;
const TOOLTIP_HEIGHT = 30;

function emptyRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function installRects(anchor: { left: number; top: number; width: number; height: number }) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;

    if (el.classList?.contains('z-[10001]')) {
      const left = Number.parseFloat(el.style.left) || 0;
      const top = Number.parseFloat(el.style.top) || 0;
      const shift = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform || '');
      const dx = shift ? Number(shift[1]) : 0;
      const dy = shift ? Number(shift[2]) : 0;
      const boxLeft = left - TOOLTIP_WIDTH / 2 + dx;
      const boxTop = top + dy;
      return {
        ...emptyRect(),
        x: boxLeft,
        y: boxTop,
        left: boxLeft,
        top: boxTop,
        right: boxLeft + TOOLTIP_WIDTH,
        bottom: boxTop + TOOLTIP_HEIGHT,
        width: TOOLTIP_WIDTH,
        height: TOOLTIP_HEIGHT,
      } as DOMRect;
    }

    return {
      ...emptyRect(),
      x: anchor.left,
      y: anchor.top,
      left: anchor.left,
      top: anchor.top,
      right: anchor.left + anchor.width,
      bottom: anchor.top + anchor.height,
      width: anchor.width,
      height: anchor.height,
    } as DOMRect;
  });
}

function renderAnchored(anchor: { left: number; top: number; width: number; height: number }) {
  installRects(anchor);
  render(
    <>
      <GlobalTooltip />
      <button type="button" data-tooltip="Ancla de prueba" data-tooltip-sub="Subtítulo">
        Ancla
      </button>
    </>,
  );
  fireEvent.pointerOver(screen.getByRole('button', { name: 'Ancla' }));
}

/** Espera a que el tooltip aparezca (hay 120 ms de retardo) y devuelve su caja. */
async function shownTooltip(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByText('Ancla de prueba')).toBeInTheDocument(), {
    timeout: 2_000,
  });
  const box = screen.getByText('Ancla de prueba').closest('div[style]') as HTMLElement | null;
  expect(box).toBeTruthy();
  return box!;
}

describe('GlobalTooltip compacto', () => {
  beforeEach(() => {
    localStorage.setItem('ai_studio_tooltips', 'true');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('se separa 4px del ancla y se pega al borde derecho sin salirse', async () => {
    // Ancla pegada al borde: el tooltip de 200px se saldría por la derecha.
    renderAnchored({ left: 950, top: 100, width: 40, height: 20 });

    const tip = await shownTooltip();

    // Separación mínima con el ancla: bottom (120) + ANCHOR_GAP.
    expect(tip.style.top).toBe(`${120 + ANCHOR_GAP}px`);

    // El borde derecho queda exactamente en el margen mínimo de la ventana.
    await waitFor(() => expect(tip.style.transform).toContain('translate(-50px, 0px)'));
    const left = Number.parseFloat(tip.style.left);
    const rightEdge = left + TOOLTIP_WIDTH / 2 - 50;
    expect(rightEdge).toBe(window.innerWidth - EDGE_MARGIN);
  });

  test('se pega al borde izquierdo con el mismo margen mínimo', async () => {
    // Centro del ancla en x=20: el tooltip se saldría 80px por la izquierda.
    renderAnchored({ left: 0, top: 100, width: 40, height: 20 });

    const tip = await shownTooltip();

    await waitFor(() => expect(tip.style.transform).toContain('translate(84px, 0px)'));
    const left = Number.parseFloat(tip.style.left);
    expect(left - TOOLTIP_WIDTH / 2 + 84).toBe(EDGE_MARGIN);
  });
});
