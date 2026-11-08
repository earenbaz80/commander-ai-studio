import { useEffect, useState, type FC } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import type { Language } from '../i18n/translations';
import { useLmStudioLoading } from '../hooks/useLmStudioLoading';

interface LmStudioLoadingNoticeProps {
  selectedModel: string;
  /** Hay una generación o corrida del agente en curso. */
  busy: boolean;
  lang?: Language;
  /** Abre la configuración del proveedor para corregir el fallo. */
  onOpenProviderSettings?: () => void;
}

const LABELS = {
  es: {
    loading: 'Cargando modelo…',
    hint: 'LM Studio puede tardar varios minutos',
    waiting: 'Esperando',
    context: 'Contexto',
    failed: 'No se pudo cargar el modelo',
    configure: 'Configurar proveedor',
    dismiss: 'Descartar aviso',
  },
  en: {
    loading: 'Loading model…',
    hint: 'LM Studio may take several minutes',
    waiting: 'Waiting',
    context: 'Context',
    failed: 'Could not load the model',
    configure: 'Configure provider',
    dismiss: 'Dismiss notice',
  },
  de: {
    loading: 'Modell wird geladen…',
    hint: 'LM Studio kann mehrere Minuten dauern',
    waiting: 'Wartezeit',
    context: 'Kontext',
    failed: 'Modell konnte nicht geladen werden',
    configure: 'Anbieter einrichten',
    dismiss: 'Hinweis schließen',
  },
};

/** Segundos en un formato compacto; a partir de un minuto pasa a `1m 05s`. */
const formatElapsed = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
};

/** Contexto en tokens; `auto` cuando LM Studio no recibió una ventana explícita. */
const formatContext = (tokens: number | null): string => {
  if (tokens == null) return 'auto';
  return tokens >= 1000 ? `${Math.floor(tokens / 1000)}K` : `${tokens}`;
};

/**
 * Aviso de la carga previa que hace `/api/lmstudio/generate` antes del chat.
 *
 * Sin esto la petición queda abierta durante minutos sin ninguna señal y parece
 * colgada. Se monta una sola vez en App para que se vea también en modo agente.
 * Si la carga falla, el mismo aviso muestra el error real y un acceso directo a
 * la configuración del proveedor en vez de desaparecer en silencio.
 */
export const LmStudioLoadingNotice: FC<LmStudioLoadingNoticeProps> = ({
  selectedModel,
  busy,
  lang = 'es',
  onOpenProviderSettings,
}) => {
  const { loading, startedAt, contextLength, error, dismissError } = useLmStudioLoading(
    selectedModel,
    busy
  );
  // Fuerza un render por segundo para que el cronómetro avance. El texto
  // cambiante queda fuera del árbol accesible: `aria-live` solo debe anunciar
  // el inicio de la carga, no cada tick.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => setClockTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [loading, startedAt]);

  if (!loading && !error) return null;

  const labels = LABELS[lang] || LABELS.es;
  const model = selectedModel.replace(/^lmstudio\//, '');

  if (loading) {
    const elapsedSeconds =
      startedAt == null ? 0 : Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="lmstudio-loading"
        className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t-2 border-[var(--nc-text-accent)] bg-[var(--nc-bg-panel)] px-3 py-1.5 font-mono text-[11px] text-[var(--nc-text-accent)]"
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        <span className="font-bold">{labels.loading}</span>
        <code
          className="max-w-[45vw] truncate text-[var(--nc-text)]"
          title={model}
        >
          {model}
        </code>
        <span
          data-testid="lmstudio-loading-elapsed"
          aria-hidden="true"
          className="rounded border border-cyan-400/30 bg-black/25 px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--nc-text)]"
        >
          {labels.waiting} {formatElapsed(elapsedSeconds)}
        </span>
        <span
          data-testid="lmstudio-loading-context"
          title={contextLength == null ? undefined : `${contextLength} tokens`}
          className="rounded border border-cyan-400/30 bg-black/25 px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--nc-text)]"
        >
          {labels.context} {formatContext(contextLength)}
        </span>
        <span className="text-[10px] text-[var(--nc-text-dim)]">{labels.hint}</span>
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-testid="lmstudio-loading-error"
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t-2 border-[var(--nc-danger)] bg-red-950 px-3 py-1.5 font-mono text-[11px] text-[var(--nc-text)]"
    >
      <AlertTriangle
        className="h-3.5 w-3.5 shrink-0 text-[var(--nc-danger)]"
        aria-hidden="true"
      />
      <span className="font-bold text-[var(--nc-danger)]">{labels.failed}</span>
      <code className="max-w-[35vw] truncate text-[var(--nc-text)]" title={model}>
        {model}
      </code>
      <span
        data-testid="lmstudio-loading-error-message"
        className="min-w-0 flex-1 truncate"
        title={error ?? undefined}
      >
        {error}
      </span>
      {onOpenProviderSettings && (
        <button
          type="button"
          onClick={() => {
            dismissError();
            onOpenProviderSettings();
          }}
          className="shrink-0 border border-[var(--nc-danger)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--nc-danger)] transition-colors hover:bg-[var(--nc-danger)] hover:text-black focus-visible:outline-2 focus-visible:outline-[var(--nc-danger)]"
        >
          {labels.configure}
        </button>
      )}
      <button
        type="button"
        onClick={dismissError}
        aria-label={labels.dismiss}
        title={labels.dismiss}
        className="shrink-0 p-0.5 text-[var(--nc-text-dim)] transition-colors hover:text-[var(--nc-text)] focus-visible:outline-2 focus-visible:outline-[var(--nc-text)]"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};
