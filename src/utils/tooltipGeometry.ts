/**
 * Geometría compartida del tooltip.
 *
 * Cualquier componente que pinte su propia caja flotante puede reutilizar estos
 * márgenes y las funciones de colocación para que todas se comporten igual:
 * centradas en el ancla, separadas de ella y sin salirse de la ventana.
 */

/** Margen mínimo entre el tooltip y cualquier borde de la ventana. */
export const EDGE_MARGIN = 4;
/** Separación vertical entre el ancla y el tooltip que cuelga debajo. */
export const ANCHOR_GAP = 4;
/** Alto estimado que se reserva para decidir si el tooltip cabe debajo. */
export const TOOLTIP_ESTIMATED_HEIGHT = 60;
/** Distancia a la que se coloca el tooltip por encima del ancla al voltearse. */
export const TOOLTIP_FLIP_OFFSET = 48;

export interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface TooltipBoxRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface TooltipOffset {
  x: number;
  y: number;
}

/**
 * Posición inicial del tooltip: centrado en el ancla, con `ANCHOR_GAP` de
 * separación. Si no cabe debajo, se voltea por encima. La coordenada X se
 * limita a los márgenes; el ajuste fino se hace después midiendo la caja.
 */
export function computeTooltipAnchorPosition(
  anchor: AnchorRect,
  viewport: ViewportSize,
): TooltipOffset {
  const x = Math.min(
    Math.max(EDGE_MARGIN, anchor.left + anchor.width / 2),
    viewport.width - EDGE_MARGIN,
  );

  let y = anchor.top + anchor.height + ANCHOR_GAP;
  if (y + TOOLTIP_ESTIMATED_HEIGHT > viewport.height) {
    y = Math.max(EDGE_MARGIN, anchor.top - TOOLTIP_FLIP_OFFSET);
  }

  return { x, y };
}

/**
 * Corrección para pegar la caja ya medida a los bordes de la ventana.
 * Devuelve ceros cuando no hace falta moverla.
 */
export function computeTooltipEdgeShift(
  box: TooltipBoxRect,
  viewport: ViewportSize,
  margin: number = EDGE_MARGIN,
): TooltipOffset {
  let dx = 0;
  let dy = 0;

  if (box.left < margin) dx = margin - box.left;
  else if (box.right > viewport.width - margin) dx = viewport.width - margin - box.right;

  if (box.top < margin) dy = margin - box.top;
  else if (box.bottom > viewport.height - margin) dy = viewport.height - margin - box.bottom;

  return { x: dx, y: dy };
}
