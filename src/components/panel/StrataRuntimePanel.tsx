import React from 'react';
import { Loader2, Server } from 'lucide-react';
import {
  assessStrataHardware,
  type StrataHardwareLevel,
  type StrataModelInfo,
} from '../../lib/strataRequirements';
import { StrataLifecycleControls } from './StrataLifecycleControls';

type Translator = (es: string, en: string, de: string) => string;

interface StrataRuntimeData {
  ok?: boolean;
  error?: string;
  model?: string;
  contextWindow?: number;
  models?: StrataModelInfo[];
  runtime?: {
    instances?: Array<{ gpus?: string[] }>;
  };
  monitor?: {
    context?: { usedTokens?: number; maxTokens?: number; pct?: number };
    queue?: { running?: number; waiting?: number };
    hardware?: { vramUsedGb?: number; vramTotalGb?: number; ramTotalGb?: number };
  };
  warning?: string;
}

interface StrataRuntimePanelProps {
  runtime?: StrataRuntimeData;
  defaultModel?: string;
  baseUrl?: string;
  apiKey?: string;
  busy: boolean;
  onCheck: () => void;
  t: Translator;
}

const LEVEL: Record<Exclude<StrataHardwareLevel, 'unknown'>, { label: [string, string, string]; className: string }> = {
  ok: { label: ['OK', 'OK', 'OK'], className: 'text-emerald-300' },
  warn: { label: ['ajustado', 'tight', 'knapp'], className: 'text-amber-300' },
  fail: { label: ['insuficiente', 'insufficient', 'unzureichend'], className: 'text-red-300' },
};

const contextLabel = (tokens: number) => `${Math.round(tokens / 1024)}K ctx`;

const Summary: React.FC<{ overall: StrataHardwareLevel; t: Translator }> = ({ overall, t }) => {
  if (overall === 'warn') {
    return (
      <div className="text-[8px] leading-snug opacity-80">
        {t(
          'Cumple el mínimo; el contexto recomendado es conservador.',
          'Meets the minimum; the recommended context is conservative.',
          'Minimum erfüllt; der empfohlene Kontext ist konservativ.'
        )}
      </div>
    );
  }
  if (overall === 'fail') {
    return (
      <div className="text-[8px] leading-snug text-red-300">
        {t(
          'Hardware insuficiente para el modelo grande de Strata.',
          'Hardware is insufficient for Strata’s large model.',
          'Die Hardware reicht für das große Strata-Modell nicht aus.'
        )}
      </div>
    );
  }
  return null;
};

export const StrataRuntimePanel: React.FC<StrataRuntimePanelProps> = ({
  runtime,
  defaultModel,
  baseUrl,
  apiKey,
  busy,
  onCheck,
  t,
}) => {
  const assessment =
    runtime && runtime.ok !== false
      ? assessStrataHardware({
          vramTotalGb: runtime.monitor?.hardware?.vramTotalGb,
          ramTotalGb: runtime.monitor?.hardware?.ramTotalGb,
          models: runtime.models,
          loadedModel: runtime.model,
        })
      : null;
  const gpus = runtime?.runtime?.instances?.flatMap((instance) => instance.gpus ?? []) ?? [];
  const hardware = runtime?.monitor?.hardware;
  const context = runtime?.monitor?.context;
  const queue = runtime?.monitor?.queue;
  const recommendation = assessment?.recommendation;

  return (
    <div className="border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] p-1.5">
      <div className="flex items-center gap-2">
        <Server className="h-3.5 w-3.5 shrink-0 text-[var(--nc-text-accent)]" aria-hidden="true" />
        <span className="text-[10px] font-bold text-[var(--nc-text)]">
          {t('Runtime de Strata', 'Strata runtime', 'Strata-Runtime')}
        </span>
        <button
          type="button"
          onClick={onCheck}
          disabled={busy}
          className="ml-auto flex items-center gap-1 border border-[var(--nc-text-accent)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--nc-text-accent)] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Server className="h-3 w-3" />}
          {t('Comprobar requisitos', 'Check requirements', 'Anforderungen prüfen')}
        </button>
      </div>

      <StrataLifecycleControls
        models={runtime?.models || []}
        loadedModel={runtime?.model}
        loadedContext={runtime?.contextWindow}
        defaultModel={defaultModel}
        baseUrl={baseUrl}
        apiKey={apiKey}
        running={runtime?.ok === true}
        onRefresh={onCheck}
        t={t}
      />

      {runtime && (
        <div className="mt-1 space-y-0.5 font-mono text-[9px] leading-snug text-[var(--nc-text)]">
          {runtime.ok === false ? (
            <div className="text-red-300">{runtime.error || t('Sin respuesta', 'No response', 'Keine Antwort')}</div>
          ) : (
            <>
              <div>
                {t('Modelo', 'Model', 'Modell')}: {runtime.model || t('ninguno cargado', 'none loaded', 'keines geladen')}
                {runtime.contextWindow ? ` · ${contextLabel(runtime.contextWindow)}` : ''}
              </div>
              {context && (
                <div>
                  {t('Contexto usado', 'Context used', 'Kontext belegt')}: {context.usedTokens ?? 0}/
                  {context.maxTokens ?? '?'}
                  {typeof context.pct === 'number' ? ` (${context.pct}%)` : ''}
                </div>
              )}
              {gpus.length > 0 && <div>GPU: {gpus.join(', ')}</div>}
              {hardware?.vramUsedGb != null && (
                <div>
                  VRAM: {hardware.vramUsedGb} GB
                  {hardware.vramTotalGb != null ? ` / ${hardware.vramTotalGb} GB` : ''}
                </div>
              )}
              {queue && (
                <div>
                  {t('Cola', 'Queue', 'Warteschlange')}: {queue.running ?? 0} {t('activa', 'running', 'aktiv')} ·{' '}
                  {queue.waiting ?? 0} {t('esperando', 'waiting', 'wartend')}
                </div>
              )}

              {assessment && (
                <div className="mt-1 space-y-0.5 border-t border-[var(--nc-border-light)] pt-1">
                  <div className="font-bold text-[var(--nc-text-accent)]">
                    {t('Requisitos de hardware', 'Hardware requirements', 'Hardware-Anforderungen')}
                  </div>
                  {assessment.checks.map((item) => {
                    const status = item.level === 'unknown' ? null : LEVEL[item.level];
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-2">
                        <span>
                          {item.id.toUpperCase()}: {item.actualGb != null ? `${item.actualGb} GB` : t('sin datos', 'no data', 'keine Daten')} ·{' '}
                          {t('mín.', 'min.', 'min.')} {item.minimumGb} GB
                        </span>
                        {status && (
                          <span className={`${status.className} shrink-0 font-bold`}>{t(...status.label)}</span>
                        )}
                      </div>
                    );
                  })}
                  <Summary overall={assessment.overall} t={t} />
                  {recommendation?.model && (
                    <div className="font-bold">
                      {t('Recomendado antes de arrancar', 'Recommended before starting', 'Empfohlen vor dem Start')}:{' '}
                      {recommendation.model}
                      {recommendation.contextTokens ? ` · ${contextLabel(recommendation.contextTokens)}` : ''}
                    </div>
                  )}
                  <div className="text-[8px] leading-snug opacity-70">
                    {t('Comprobar no inicia Strata.', 'Checking does not start Strata.', 'Prüfen startet Strata nicht.')}
                  </div>
                </div>
              )}
              {runtime.warning && <div className="text-amber-300">{runtime.warning}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
};
