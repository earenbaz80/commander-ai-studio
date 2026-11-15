import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, RotateCcw, Square } from 'lucide-react';

type Translator = (es: string, en: string, de: string) => string;

export interface StrataLifecycleView {
  state?: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  model?: string;
  context?: number;
  defaultModel?: string;
  error?: string;
  available?: boolean;
}

interface StrataLifecycleControlsProps {
  models: Array<{ id: string }>;
  loadedModel?: string;
  loadedContext?: number;
  defaultModel?: string;
  baseUrl?: string;
  apiKey?: string;
  running: boolean;
  onRefresh: () => void;
  t: Translator;
}

const stripPrefix = (value: string | undefined) => String(value || '').replace(/^strata-local\//, '');

export const StrataLifecycleControls: React.FC<StrataLifecycleControlsProps> = ({
  models,
  loadedModel,
  loadedContext,
  defaultModel,
  baseUrl,
  apiKey,
  running,
  onRefresh,
  t,
}) => {
  const [model, setModel] = useState(() => stripPrefix(loadedModel || defaultModel));
  const [context, setContext] = useState(String(loadedContext || 32_768));
  const [lifecycle, setLifecycle] = useState<StrataLifecycleView | null>(null);
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);
  const [error, setError] = useState('');

  const loadLifecycle = useCallback(async () => {
    try {
      const suffix = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : '';
      const response = await fetch(`/api/strata-local/lifecycle${suffix}`, { credentials: 'include' });
      const data = await response.json().catch(() => null);
      if (data?.success) setLifecycle(data);
    } catch {
      /* el estado del proceso es opcional; el runtime sigue siendo la fuente principal */
    }
  }, [baseUrl]);

  useEffect(() => {
    void loadLifecycle();
  }, [loadLifecycle]);

  useEffect(() => {
    if (loadedModel) setModel(stripPrefix(loadedModel));
  }, [loadedModel]);

  useEffect(() => {
    if (loadedContext) setContext(String(loadedContext));
  }, [loadedContext]);

  useEffect(() => {
    const fallback = stripPrefix(lifecycle?.defaultModel);
    if (fallback) setModel((current) => (current.trim() ? current : fallback));
  }, [lifecycle?.defaultModel]);

  const run = async (action: 'start' | 'restart' | 'stop') => {
    setBusy(action === 'stop' ? 'stop' : 'start');
    setError('');
    try {
      const response = await fetch('/api/strata-local/lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action,
          ...(action === 'stop' ? {} : { model, context: Number(context) }),
          ...(baseUrl ? { baseUrl } : {}),
          ...(apiKey?.trim() ? { apiKey } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || t('La operación de Strata falló', 'Strata operation failed', 'Strata-Vorgang fehlgeschlagen'));
      }
      setLifecycle(data);
      onRefresh();
      await loadLifecycle();
    } catch (e: any) {
      setError(e?.message || t('La operación de Strata falló', 'Strata operation failed', 'Strata-Vorgang fehlgeschlagen'));
    } finally {
      setBusy(null);
    }
  };

  const validContext =
    Number.isInteger(Number(context)) && Number(context) >= 2_048 && Number(context) <= 1_048_576;
  const shownLifecycleError = lifecycle?.error;
  const active = running || lifecycle?.state === 'running' || lifecycle?.state === 'starting';
  const canStart = Boolean(model.trim()) && validContext && !busy;

  return (
    <div className="mt-1 space-y-1 border-t border-[var(--nc-border-light)] pt-1">
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-1">
        <label className="flex min-w-0 items-center gap-1 text-[9px]">
          <span className="w-12 shrink-0 font-bold text-[var(--nc-text)]">{t('Modelo', 'Model', 'Modell')}</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            list="strata-lifecycle-models"
            placeholder={t('modelo cargado', 'loaded model', 'geladenes Modell')}
            className="min-w-0 flex-1 border border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] px-1 py-0.5 font-mono text-[10px] text-[var(--nc-text)] outline-none"
          />
        </label>
        <label className="flex items-center gap-1 text-[9px]">
          <span className="font-bold text-[var(--nc-text)]">{t('Ctx', 'Ctx', 'Ctx')}</span>
          <input
            value={context}
            onChange={(event) => setContext(event.target.value)}
            inputMode="numeric"
            className="min-w-0 flex-1 border border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] px-1 py-0.5 font-mono text-[10px] text-[var(--nc-text)] outline-none"
          />
        </label>
      </div>
      <datalist id="strata-lifecycle-models">
        {models.map((entry) => (
          <option key={entry.id} value={entry.id} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => void run(active ? 'restart' : 'start')}
          disabled={!canStart}
          className="flex items-center gap-1 border border-[var(--nc-text-accent)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--nc-text-accent)] disabled:opacity-50"
        >
          {busy === 'start' ? <Loader2 className="h-3 w-3 animate-spin" /> : active ? <RotateCcw className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {busy === 'start'
            ? t('Esperando a /status…', 'Waiting for /status…', 'Warte auf /status…')
            : active
              ? t('Aplicar modelo/contexto', 'Apply model/context', 'Modell/Kontext anwenden')
              : t('Arrancar Strata', 'Start Strata', 'Strata starten')}
        </button>
        {active && (
          <button
            type="button"
            onClick={() => void run('stop')}
            disabled={Boolean(busy)}
            className="flex items-center gap-1 border border-red-400/60 px-1.5 py-0.5 text-[9px] font-bold text-red-300 disabled:opacity-50"
          >
            {busy === 'stop' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
            {busy === 'stop' ? t('Deteniendo…', 'Stopping…', 'Wird gestoppt…') : t('Detener', 'Stop', 'Stoppen')}
          </button>
        )}
      </div>
      {lifecycle?.available === false && !active && (
        <div className="text-[8px] leading-snug text-amber-300">
          {t(
            'No se encontró el CLI de Strata. Define STRATA_BIN o instálalo en el PATH.',
            'The Strata CLI was not found. Set STRATA_BIN or install it in PATH.',
            'Strata-CLI nicht gefunden. Setze STRATA_BIN oder installiere es im PATH.'
          )}
        </div>
      )}
      {(error || shownLifecycleError) && (
        <div className="text-[8px] leading-snug text-red-300">{error || shownLifecycleError}</div>
      )}
    </div>
  );
};
