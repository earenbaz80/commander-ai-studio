import { useState, useCallback, useRef, useEffect } from 'react';

export interface ResizableWidthOptions {
  key: string;
  defaultWidth: number;
  min: number;
  max: number;
  /** Paneles anclados a la derecha: crecen al arrastrar hacia la izquierda. */
  invert?: boolean;
}

export function useResizableWidth({ key, defaultWidth, min, max, invert = false }: ResizableWidthOptions) {
  const [width, setWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem(key);
      if (v) {
        const n = Number(v);
        if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
      }
    } catch { /* ignore */ }
    return defaultWidth;
  });

  const widthRef = useRef(width);
  useEffect(() => { widthRef.current = width; }, [width]);

  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(width);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = widthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const next = Math.min(max, Math.max(min, startWidth.current + (invert ? -delta : delta)));
      setWidth(next);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem(key, String(widthRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [key, min, max, invert]);

  const onDoubleClick = useCallback(() => {
    setWidth(defaultWidth);
    try { localStorage.setItem(key, String(defaultWidth)); } catch { /* ignore */ }
  }, [key, defaultWidth]);

  return { width, onMouseDown, onDoubleClick };
}
