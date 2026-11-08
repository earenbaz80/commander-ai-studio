import React, { useEffect, useState } from 'react';
import { useNonoToasts } from './useNonoToasts';

export interface NonoToast {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'action';
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Aviso cerrado por el usuario: se recuerda para no repetirlo. */
  onClose?: () => void;
  duration?: number;
}

const TOAST_STYLES: Record<NonoToast['type'], string> = {
  info: 'bg-[var(--nc-bg-deep)] border-[var(--nc-border-light)] text-[var(--nc-text)]',
  success: 'bg-[var(--nc-bg-deep)] border-[var(--nc-success)] text-[var(--nc-success)]',
  error: 'bg-[#240000] border-[var(--nc-danger)] text-[var(--nc-danger)]',
  warning: 'bg-[#2a1a00] border-[var(--nc-text-accent)] text-[var(--nc-text-accent)]',
  action: 'bg-[var(--nc-bg-deep)] border-[var(--nc-border-light)] text-[var(--nc-text)]',
};

const ICONS: Record<NonoToast['type'], React.ReactNode> = {
  info: <span className="text-[var(--nc-text)]">●</span>,
  success: <span className="text-[var(--nc-success)]">✓</span>,
  error: <span className="text-[var(--nc-danger)]">✕</span>,
  warning: <span className="text-[var(--nc-text-accent)]">⚠</span>,
  action: <span className="text-[var(--nc-text)]">→</span>,
};

/**
 * Componente de toast no intrusivo para Nono.
 * Aparece en esquina superior derecha, no bloquea interacción.
 * Auto-dismiss configurable.
 */
export const NonoToast: React.FC<{ toast: NonoToast; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss
}) => {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(toast.id), 300);
    }, toast.duration ?? 5000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!visible) return null;

  const style = TOAST_STYLES[toast.type];
  const action = toast.action;

  return (
    <div
      className={`pointer-events-auto fixed top-24 right-4 z-[9999] flex items-start gap-2 max-w-sm px-3 py-2.5 rounded-lg border-2 shadow-[0_0_20px_rgba(0,0,0,0.5)] transition-all duration-300 ${
        style
      } ${exiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}`}
      role="alert"
      aria-live="polite"
    >
      <span className="mt-0.5 text-xl">{ICONS[toast.type]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold leading-snug">{toast.message}</p>
        {action ? (
          <button
            onClick={() => {
              action.onClick();
              toast.onClose?.();
              onDismiss(toast.id);
            }}
            className="mt-1 text-[10px] font-bold underline hover:opacity-70 transition-opacity"
          >
            {action.label}
          </button>
        ) : null}
      </div>
      <button
        onClick={() => {
          setExiting(true);
          toast.onClose?.();
          setTimeout(() => onDismiss(toast.id), 300);
        }}
        className="ml-2 text-current opacity-50 hover:opacity-100 transition-opacity leading-none"
        aria-label="Cerrar"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Componente contenedor para renderizar todos los toasts.
 * Colocar una vez en App.tsx o layout principal.
 */
export const NonoToaster: React.FC = () => {
  const { toasts, dismissToast } = useNonoToasts();

  return (
    <div className="fixed top-24 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <NonoToast key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
