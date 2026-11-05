/**
 * Indicador de contexto del chat: cuánto ocupa la conversación, cuánto queda y
 * con qué esfuerzo responde el modelo.
 *
 * La cifra es una estimación (≈4 caracteres por token): el objetivo es avisar
 * antes de llegar al límite, no dar el número exacto del proveedor. Al pulsarlo
 * se despliega el desglose; los perfiles Rápido / Equilibrado / Potente cambian
 * el máximo de tokens y el nivel de razonamiento.
 */
import React, { useId, useState } from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import type { AIModel, ChatMessage, ParameterConfig } from '../../types/studio';
import type { Language } from '../../i18n/translations';
import { computeContextStats, formatTokens } from '../../lib/contextStats';
import { EFFORT_ORDER, EFFORT_PROFILES, detectEffort, type EffortLevel } from './effortProfiles';

interface ContextMeterProps {
  messages: ChatMessage[];
  parameters?: ParameterConfig | null;
  /** Modelo activo, de donde sale la ventana de contexto. */
  model?: AIModel | null;
  lang?: Language;
  /** Sin callback los perfiles se muestran pero no se pueden cambiar. */
  onChangeEffort?: (level: EffortLevel) => void;
}

const effortLabels: Record<EffortLevel, { es: string; en: string; de: string }> = {
  fast: { es: 'Rápido', en: 'Fast', de: 'Schnell' },
  balanced: { es: 'Equilibrado', en: 'Balanced', de: 'Ausgeglichen' },
  powerful: { es: 'Potente', en: 'Powerful', de: 'Leistungsstark' },
};

const effortHints: Record<EffortLevel, { es: string; en: string; de: string }> = {
  fast: {
    es: 'Respuestas cortas y rápidas: poco razonamiento y hasta 1K tokens de salida',
    en: 'Short, fast answers: little reasoning and up to 1K output tokens',
    de: 'Kurze, schnelle Antworten: wenig Nachdenken und bis zu 1K Ausgabe-Token',
  },
  balanced: {
    es: 'Equilibrio entre velocidad y detalle: hasta 4K tokens de salida',
    en: 'Balance of speed and detail: up to 4K output tokens',
    de: 'Ausgleich zwischen Tempo und Detail: bis zu 4K Ausgabe-Token',
  },
  powerful: {
    es: 'Razonamiento profundo: hasta 16K tokens de salida y más tiempo',
    en: 'Deep reasoning: up to 16K output tokens and more time',
    de: 'Tiefes Nachdenken: bis zu 16K Ausgabe-Token und mehr Zeit',
  },
};

export const ContextMeter: React.FC<ContextMeterProps> = ({
  messages,
  parameters,
  model,
  lang = 'es',
  onChangeEffort,
}) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const stats = React.useMemo(
    () => computeContextStats({ messages, parameters, model }),
    [messages, parameters, model]
  );

  const L = (es: string, en: string, de: string) => (lang === 'es' ? es : lang === 'de' ? de : en);
  const percent = stats.percent ?? 0;
  const tone =
    percent >= 95 ? 'var(--nc-danger)' : percent >= 80 ? 'var(--nc-text-accent)' : 'var(--nc-text)';
  const active = detectEffort(parameters);
  const activeProfile = active ? EFFORT_PROFILES[active] : null;

  const summary = L(
    `Contexto: ${stats.percent === null ? 'ventana desconocida' : `${percent}%`} · ${formatTokens(stats.totalTokens)} tokens estimados de ${stats.messages} mensaje(s)`,
    `Context: ${stats.percent === null ? 'unknown window' : `${percent}%`} · ${formatTokens(stats.totalTokens)} estimated tokens across ${stats.messages} message(s)`,
    `Kontext: ${stats.percent === null ? 'Fenster unbekannt' : `${percent}%`} · geschätzt ${formatTokens(stats.totalTokens)} Token aus ${stats.messages} Nachricht(en)`
  );

  const rows: Array<{ label: string; value: string }> = [
    { label: L('Instrucciones y ejemplos', 'Instructions & examples', 'Anweisungen & Beispiele'), value: formatTokens(stats.systemTokens) },
    { label: L('Conversación', 'Conversation', 'Unterhaltung'), value: formatTokens(stats.conversationTokens) },
    { label: L('Total estimado', 'Estimated total', 'Geschätzt gesamt'), value: formatTokens(stats.totalTokens) },
    { label: L('Ventana del modelo', 'Model window', 'Modellfenster'), value: stats.limit ? formatTokens(stats.limit) : '—' },
    { label: L('Reservado a la respuesta', 'Reserved for reply', 'Für Antwort reserviert'), value: formatTokens(stats.reservedTokens) },
    {
      label: L('Libre', 'Free', 'Frei'),
      value: stats.remainingTokens === null ? '—' : formatTokens(stats.remainingTokens),
    },
  ];

  return (
    <>
      <div
        data-testid="context-meter"
        className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--nc-text)]"
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          title={summary}
          className="flex min-h-7 items-center gap-1.5 rounded-sm border border-[var(--nc-border-mid)]/60 bg-[var(--nc-bg-main)] px-1.5 py-1 hover:bg-[var(--nc-bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nc-text-accent)]"
        >
          <Activity className="h-3 w-3 text-[var(--nc-text-accent)]" aria-hidden />
          <span className="font-bold text-[var(--nc-text-accent)]">CTX</span>
          <span
            aria-hidden
            className="h-1.5 w-16 overflow-hidden border border-[var(--nc-border-mid)]/50 bg-[var(--nc-bg-deep)]"
          >
            <span
              className="block h-full"
              style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: tone }}
            />
          </span>
          <span className="tabular-nums" data-testid="context-percent">
            {stats.percent === null ? '—' : `${percent}%`}
          </span>
          <span className="tabular-nums opacity-70">
            {formatTokens(stats.totalTokens)}
            {stats.limit ? `/${formatTokens(stats.limit)}` : ''}
          </span>
          <span className="opacity-70">· {stats.messages} msg</span>
          <ChevronDown
            className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>

        <div
          role="group"
          aria-label={L('Perfil de esfuerzo', 'Effort profile', 'Aufwandsprofil')}
          className="ml-auto flex items-center gap-0.5"
        >
          {EFFORT_ORDER.map((level) => {
            const selected = active === level;
            return (
              <button
                key={level}
                type="button"
                onClick={() => onChangeEffort?.(level)}
                disabled={!onChangeEffort}
                aria-pressed={selected}
                title={effortHints[level][lang]}
                className={`min-h-7 border px-2 py-1 text-[10px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected
                    ? 'border-[var(--nc-text-accent)] bg-[var(--nc-active-bg)] text-[var(--nc-active-text)]'
                    : 'border-[var(--nc-border-mid)]/60 bg-[var(--nc-bg-panel)] text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)]'
                }`}
              >
                {effortLabels[level][lang]}
              </button>
            );
          })}
        </div>
      </div>

      {open && (
        <div
          id={panelId}
          data-testid="context-details"
          className="mb-2 grid grid-cols-1 gap-x-4 gap-y-0.5 border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] p-2 font-mono text-[10px] text-[var(--nc-text)] sm:grid-cols-2 lg:grid-cols-3"
        >
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-2">
              <span className="opacity-70">{row.label}</span>
              <span className="tabular-nums">{row.value}</span>
            </div>
          ))}
          <p className="col-span-full mt-1 opacity-60">
            {L(
              'Estimación aproximada (≈4 caracteres por token).',
              'Rough estimate (≈4 characters per token).',
              'Grobe Schätzung (≈4 Zeichen pro Token).'
            )}
            {activeProfile
              ? ' ' +
                L(
                  `Perfil activo: ${effortLabels[activeProfile.id].es}.`,
                  `Active profile: ${effortLabels[activeProfile.id].en}.`,
                  `Aktives Profil: ${effortLabels[activeProfile.id].de}.`
                )
              : ''}
          </p>
          {stats.overLimit && (
            <p role="alert" className="col-span-full font-bold text-[var(--nc-danger)]">
              {L(
                'La conversación ya no cabe con la respuesta reservada: acorta el historial o sube la ventana del modelo.',
                'The conversation no longer fits with the reserved reply: trim the history or use a bigger model window.',
                'Die Unterhaltung passt mit der reservierten Antwort nicht mehr: Verlauf kürzen oder größeres Modellfenster nutzen.'
              )}
            </p>
          )}
        </div>
      )}
    </>
  );
};

export default ContextMeter;
