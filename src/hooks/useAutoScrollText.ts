import { useEffect } from 'react';

const START_DELAY_MS = 300;
const MIN_OVERFLOW_PX = 4;
const MIN_TRAVEL_MS = 600;
// El tope evita animaciones eternas; a 60 px/s cubre recortes de hasta 360 px
// sin acelerar, que es más de lo que ocultan las etiquetas del historial.
const MAX_TRAVEL_MS = 6000;
const SPEED_PX_PER_SEC = 60;
const INTERACTIVE_FOCUS =
  'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="link"], label, summary';

function hasDirectText(element: HTMLElement): boolean {
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
  );
}

/**
 * ¿Este elemento contiene texto recortado horizontalmente?
 *
 * Se acepta lo que ya marca Tailwind (`truncate` / `text-ellipsis`) y también
 * cajas con `nowrap` + overflow oculto que tengan texto directo. Los elementos
 * con scroll horizontal propio (`auto`/`scroll`) se dejan intactos.
 */
export function isAutoScrollTextElement(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  if (element.dataset.noAutoscroll !== undefined) return false;
  if (element.closest('[data-no-autoscroll]')) return false;

  const tag = element.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION' || tag === 'PRE') {
    return false;
  }
  if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') return false;
  if (!element.textContent?.trim()) return false;
  // Un recorte de 1-3 px es imperceptible: animarlo sólo produce un temblor
  // de medio segundo. Se exige un desbordamiento que realmente oculte texto.
  if (element.scrollWidth <= element.clientWidth + MIN_OVERFLOW_PX) return false;

  let style: CSSStyleDeclaration;
  try {
    style = window.getComputedStyle(element);
  } catch {
    return false;
  }
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.overflowX === 'auto' || style.overflowX === 'scroll') return false;

  const marked =
    element.classList.contains('truncate') ||
    element.classList.contains('text-ellipsis') ||
    element.hasAttribute('data-autoscroll');
  if (marked) return true;

  const nowrap = style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre';
  const clipped =
    style.textOverflow === 'ellipsis' ||
    style.overflowX === 'hidden' ||
    style.overflowX === 'clip';
  return nowrap && clipped && hasDirectText(element);
}

function findAutoScrollText(target: EventTarget | null, includeDescendants: boolean): HTMLElement | null {
  let element = target instanceof Element ? target : null;
  while (element && element !== document.documentElement) {
    if (element === document.body) break;
    if (element instanceof HTMLElement) {
      if (isAutoScrollTextElement(element)) return element;

      // Al enfocar un botón, el foco cae en el botón y no en el span truncado
      // que contiene. Se busca el primer descendiente marcado que sí desborde.
      if (includeDescendants) {
        const candidates = element.querySelectorAll<HTMLElement>(
          '.truncate, .text-ellipsis, [data-autoscroll]'
        );
        for (const candidate of Array.from(candidates)) {
          if (isAutoScrollTextElement(candidate)) return candidate;
        }
      }
    }
    element = element.parentElement;
  }
  return null;
}

/**
 * Revela con scroll lateral los textos que no caben completos.
 *
 * Se instala una sola vez para toda la app mediante delegación de eventos:
 * recorre el elemento apuntado (y sus ancestros) y sólo actúa si el texto está
 * realmente recortado. Al pasar el ratón o enfocar, se desplaza hasta el final;
 * al salir vuelve al inicio. Respeta `prefers-reduced-motion`.
 */
export function useAutoScrollText(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const requestFrame = (callback: FrameRequestCallback): number =>
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(callback)
        : window.setTimeout(() => callback(performance.now()), 16);
    const cancelFrame = (id: number): void => {
      if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(id);
      else window.clearTimeout(id);
    };

    let active: HTMLElement | null = null;
    let frame = 0;
    let previousScrollBehavior = '';

    const stop = () => {
      if (frame) {
        cancelFrame(frame);
        frame = 0;
      }
      if (active) {
        active.scrollLeft = 0;
        active.style.scrollBehavior = previousScrollBehavior;
        active = null;
      }
    };

    const start = (element: HTMLElement | null) => {
      if (!element || element === active) return;
      stop();

      const distance = element.scrollWidth - element.clientWidth;
      if (distance <= MIN_OVERFLOW_PX) return;

      active = element;
      previousScrollBehavior = element.style.scrollBehavior;
      element.style.scrollBehavior = 'auto';
      element.scrollLeft = 0;

      const duration = Math.min(
        MAX_TRAVEL_MS,
        Math.max(MIN_TRAVEL_MS, (distance / SPEED_PX_PER_SEC) * 1000)
      );
      const startAt = performance.now() + START_DELAY_MS;

      const step = (now: number) => {
        const current = active;
        if (!current || current !== element || !current.isConnected) {
          if (active === element) stop();
          return;
        }
        const max = current.scrollWidth - current.clientWidth;
        if (max <= 1) {
          stop();
          return;
        }
        if (now < startAt) {
          frame = requestFrame(step);
          return;
        }
        const progress = Math.min(1, (now - startAt) / duration);
        current.scrollLeft = Math.round(max * progress);
        if (progress < 1) frame = requestFrame(step);
        else frame = 0;
      };

      frame = requestFrame(step);
    };

    const onMouseOver = (event: MouseEvent) => {
      const element = findAutoScrollText(event.target, false);
      if (!element) return;
      const from = event.relatedTarget;
      if (active === element && from instanceof Node && element.contains(from)) return;
      start(element);
    };

    const onMouseOut = (event: MouseEvent) => {
      if (!active) return;
      const next = event.relatedTarget;
      if (next instanceof Node && active.contains(next)) return;
      stop();
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }
      // Sólo se buscan descendientes en controles con una etiqueta propia. Si
      // se enfoca el contenedor de un modal, no debe desplazarse su primer
      // texto truncado por accidente.
      const interactive = target instanceof HTMLElement && target.matches(INTERACTIVE_FOCUS);
      start(findAutoScrollText(target, interactive));
    };

    const onFocusOut = (event: FocusEvent) => {
      if (!active) return;
      const next = event.relatedTarget;
      if (next instanceof Node && active.contains(next)) return;
      stop();
    };

    const onWindowBlur = () => stop();
    const onVisibilityChange = () => {
      if (document.hidden) stop();
    };

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('mouseout', onMouseOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}
