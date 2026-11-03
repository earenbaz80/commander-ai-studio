import React, { useEffect, useRef, useState } from 'react';

/**
 * Tooltip global para cualquier elemento con `data-tooltip` o `title`.
 *
 * La posición se calcula centrada en el elemento con `translateX(-50%)`, y
 * después se mide el tooltip ya pintado para corregir el desplazamiento si se
 * sale por cualquier borde. Antes se limitaba la coordenada con un ancho fijo
 * de 240 px, pero el tooltip puede medir hasta 320: en los botones pegados a la
 * izquierda el recorte dejaba media caja fuera de pantalla.
 */
export const GlobalTooltip: React.FC = () => {
  const [tooltip, setTooltip] = useState<{
    text: string;
    subtext?: string;
    x: number;
    y: number;
    visible: boolean;
  }>({
    text: '',
    subtext: '',
    x: 0,
    y: 0,
    visible: false,
  });
  /** Corrección acumulada tras medir el tooltip en pantalla. */
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tooltip.visible) {
      setShift({ x: 0, y: 0 });
      return;
    }
    const el = tooltipRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const margin = 8;
    let dx = 0;
    let dy = 0;

    if (rect.left < margin) dx = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right;

    if (rect.top < margin) dy = margin - rect.top;
    else if (rect.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - rect.bottom;

    if (dx !== 0 || dy !== 0) {
      // Se suma a lo ya corregido: así converge en una pasada y no oscila.
      setShift((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    }
    // No depende de `shift` a propósito: con la corrección aplicada no hace
    // falta volver a medir, y añadirlo provocaría un bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tooltip.visible, tooltip.text, tooltip.x, tooltip.y]);

  useEffect(() => {
    let timeoutId: any = null;
    let activeTitleTarget: HTMLElement | null = null;

    const restoreTitle = (el: HTMLElement | null) => {
      if (!el || !el.dataset?.originalTitle) return;
      el.setAttribute('title', el.dataset.originalTitle);
      delete el.dataset.originalTitle;
    };

    const handlePointerOver = (e: PointerEvent) => {
      const target = (e.target as HTMLElement)?.closest('[data-tooltip], [title], button, input, select, textarea, .nc-button, [role="button"]') as HTMLElement | null;
      if (!target) {
        setTooltip((prev) => ({ ...prev, visible: false }));
        // Do not restore a previous title while still moving inside its bounds.
        return;
      }

      // Keep hovering nested elements from restoring/re-removing the same title rapidly.
      if (activeTitleTarget && activeTitleTarget !== target && !activeTitleTarget.contains(target)) {
        restoreTitle(activeTitleTarget);
        activeTitleTarget = null;
      }

      // Check if user disabled tooltips in localStorage
      try {
        if (localStorage.getItem('ai_studio_tooltips') === 'false') {
          return;
        }
      } catch {}

      const customTooltip = target.getAttribute('data-tooltip');
      const titleAttr = target.getAttribute('title');
      const subtextAttr = target.getAttribute('data-tooltip-sub');

      let text = customTooltip || titleAttr;

      // If native title is used, clear it temporarily to prevent duplicate native OS tooltip.
      if (titleAttr && !target.dataset.originalTitle) {
        target.dataset.originalTitle = titleAttr;
        target.removeAttribute('title');
        activeTitleTarget = target;
      } else if (target.dataset.originalTitle && !text) {
        text = target.dataset.originalTitle;
        activeTitleTarget = target;
      }

      if (!text) {
        // Generate automatic smart description if interactive element has none
        if (target.tagName === 'BUTTON' && target.innerText.trim()) {
          const raw = target.innerText.trim();
          text = raw.length > 80 ? raw.slice(0, 77) + '...' : raw;
        } else if (target.tagName === 'INPUT' && (target as HTMLInputElement).placeholder) {
          text = (target as HTMLInputElement).placeholder;
        } else {
          setTooltip((prev) => ({ ...prev, visible: false }));
          return;
        }
      }

      // Calculate position
      const rect = target.getBoundingClientRect();
      const x = Math.min(Math.max(16, rect.left + rect.width / 2), window.innerWidth - 16);
      let y = rect.bottom + 8;
      if (y + 60 > window.innerHeight) {
        y = Math.max(10, rect.top - 48);
      }

      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        // Cada tooltip nuevo empieza sin corrección y se mide al pintarse.
        setShift({ x: 0, y: 0 });
        setTooltip({
          text: text || '',
          subtext: subtextAttr || undefined,
          x,
          y,
          visible: true,
        });
      }, 120); // Quick 120ms delay for ultra-responsive feel
    };

    const handlePointerOut = (e: PointerEvent) => {
      clearTimeout(timeoutId);
      const target = (e.target as HTMLElement) || activeTitleTarget;
      const related = (e as any).relatedTarget as Node | null;

      // Do not restore the native title while moving between descendants.
      if (activeTitleTarget && related && activeTitleTarget.contains(related)) {
        setTooltip((prev) => ({ ...prev, visible: false }));
        return;
      }

      if (target?.dataset?.originalTitle) {
        restoreTitle(target);
      }

      if (activeTitleTarget && (!related || !activeTitleTarget.contains(related))) {
        restoreTitle(activeTitleTarget);
        activeTitleTarget = null;
      }

      setTooltip((prev) => ({ ...prev, visible: false }));
    };

    window.addEventListener('pointerover', handlePointerOver, true);
    window.addEventListener('pointerout', handlePointerOut, true);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('pointerover', handlePointerOver, true);
      window.removeEventListener('pointerout', handlePointerOut, true);
    };
  }, []);

  if (!tooltip.visible || !tooltip.text) return null;

  return (
    <div
      ref={tooltipRef}
      style={{
        left: `${tooltip.x}px`,
        top: `${tooltip.y}px`,
        transform: `translateX(-50%) translate(${shift.x}px, ${shift.y}px)`,
      }}
      className="fixed z-[10001] pointer-events-none transition-opacity duration-100 ease-out font-mono select-none"
    >
      <div className="bg-[#000080] border-2 border-[#00ffff] px-2.5 py-1 text-white text-xs shadow-[4px_4px_0px_#000000] flex flex-col items-center max-w-xs text-center animate-in fade-in zoom-in-95">
        <div className="flex items-center gap-1.5 text-[#ffff55] font-bold text-[11px] leading-tight">
          <span className="text-[#00ffff]">►</span>
          <span>{tooltip.text}</span>
        </div>
        {tooltip.subtext && (
          <div className="text-[#a8c7fa] text-[9px] mt-0.5 leading-snug">
            {tooltip.subtext}
          </div>
        )}
      </div>
    </div>
  );
};
