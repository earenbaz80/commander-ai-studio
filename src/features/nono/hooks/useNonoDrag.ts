import { useState, useRef, useCallback, useEffect } from 'react';
import { loadNonoPosition, saveNonoPosition, clearNonoPosition } from '../../../utils/nonoStorage';

interface UseNonoDragOptions {
  headRef: React.RefObject<HTMLDivElement | null>;
}

interface UseNonoDragReturn {
  dragPos: { x: number; y: number } | null;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleDoubleClick: () => void;
}

/**
 * Hook para lógica de arrastre de Nono.
 * - Posición persistente en localStorage
 * - Clamp a viewport
 * - rAF para smooth drag
 * - Doble clic = reset posición
 */
export function useNonoDrag({
  headRef,
}: UseNonoDragOptions): UseNonoDragReturn {
  const [dragPos, setDragPosState] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const dragRef = useRef<{ 
    startX: number; 
    startY: number; 
    startPosX: number; 
    startPosY: number 
  } | null>(null);
  
  const dragRafRef = useRef<number | null>(null);
  const pendingDragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const hasMovedRef = useRef(false);
  const suppressClickRef = useRef(false);

  // Restaurar posición guardada
  useEffect(() => {
    const saved = loadNonoPosition();
    if (saved) {
      setDragPosState({
        x: Math.max(0, Math.min(saved.x, window.innerWidth - 70)),
        y: Math.max(0, Math.min(saved.y, window.innerHeight - 70)),
      });
    }
  }, []);

  // Persistir posición cuando el usuario suelta
  useEffect(() => {
    if (dragPos && !isDragging) {
      saveNonoPosition(dragPos);
    }
  }, [dragPos, isDragging]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.nono-panel')) return;
    setIsDragging(true);
    hasMovedRef.current = false;
    suppressClickRef.current = false;
    const rect = headRef.current?.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: rect ? rect.left : 0,
      startPosY: rect ? rect.top : 0,
    };
  }, [headRef]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('.nono-panel')) return;
    setIsDragging(true);
    hasMovedRef.current = false;
    suppressClickRef.current = false;
    const t = e.touches[0];
    const rect = headRef.current?.getBoundingClientRect();
    dragRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      startPosX: rect ? rect.left : 0,
      startPosY: rect ? rect.top : 0,
    };
  }, [headRef]);

  const handleMouseMove = useCallback((e: any) => {
    if (!isDragging || !dragRef.current) return;
    const clientX = typeof e?.clientX === 'number' ? e.clientX : (e?.touches?.[0]?.clientX ?? 0);
    const clientY = typeof e?.clientY === 'number' ? e.clientY : (e?.touches?.[0]?.clientY ?? 0);

    if (!hasMovedRef.current) {
      const dx = clientX - dragRef.current.startX;
      const dy = clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 5) hasMovedRef.current = true;
    }

    const newX = Math.max(0, Math.min(
      dragRef.current.startPosX + (clientX - dragRef.current.startX), 
      window.innerWidth - 70
    ));
    const newY = Math.max(0, Math.min(
      dragRef.current.startPosY + (clientY - dragRef.current.startY), 
      window.innerHeight - 70
    ));

    pendingDragPositionRef.current = { x: newX, y: newY };

    if (dragRafRef.current === null) {
      dragRafRef.current = requestAnimationFrame(() => {
        const next = pendingDragPositionRef.current;
        if (next) setDragPosState(next);
        dragRafRef.current = null;
        pendingDragPositionRef.current = null;
      });
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    suppressClickRef.current = hasMovedRef.current;

    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    const pending = pendingDragPositionRef.current;
    if (pending) setDragPosState(pending);
    pendingDragPositionRef.current = null;

    setIsDragging(false);
    dragRef.current = null;
    hasMovedRef.current = false;
  }, []);

  // Event listeners globales durante drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('touchmove', handleMouseMove, { passive: false });
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchend', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('touchmove', handleMouseMove as any);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchend', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleDoubleClick = useCallback(() => {
    setDragPosState(null);
    clearNonoPosition();
  }, []);

  return {
    dragPos,
    handleMouseDown,
    handleTouchStart,
    handleDoubleClick,
  };
}