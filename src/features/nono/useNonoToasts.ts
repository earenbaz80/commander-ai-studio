import { useCallback, useEffect, useState } from 'react';
import type { NonoToast } from './NonoToast';

export interface UseNonoToastsReturn {
  toasts: NonoToast[];
  showToast: (toast: Omit<NonoToast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

const createToastId = () => `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;

interface ToastsState {
  toasts: NonoToast[];
}

// Store mínimo con suscripción: los toasts se comparten entre el panel
// flotante y el toaster, sin contexto de React de por medio.
const createToastsStore = () => {
  let state: ToastsState = { toasts: [] };
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState: (partial: Partial<ToastsState>) => {
      state = { ...state, ...partial };
      listeners.forEach((l) => l());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const store = createToastsStore();

export function useNonoToasts(): UseNonoToastsReturn {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const unsubscribe = store.subscribe(() => forceUpdate((s) => ({ ...s })));
    return unsubscribe;
  }, []);

  const dismissToast = useCallback((id: string) => {
    store.setState({ toasts: store.getState().toasts.filter((t) => t.id !== id) });
  }, []);

  const showToast = useCallback(
    (toast: Omit<NonoToast, 'id'>) => {
      const newToast: NonoToast = { ...toast, id: createToastId() };
      store.setState({ toasts: [...store.getState().toasts, newToast] });

      setTimeout(() => {
        dismissToast(newToast.id);
      }, toast.duration ?? 5000);
    },
    [dismissToast],
  );

  return {
    toasts: store.getState().toasts,
    showToast,
    dismissToast,
  };
}
