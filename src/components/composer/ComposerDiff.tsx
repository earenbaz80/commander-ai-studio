/**
 * Visor de diff del Composer.
 *
 * Una sola cabecera por archivo con el recuento `+X −Y`, el estado (pendiente o
 * sin cambios) y las dos acciones. Las zonas sin cambios largas se colapsan:
 * antes eran una pared de líneas grises donde el cambio se perdía.
 */
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { deText } from '../../i18n/de';
import type { Language } from '../../i18n/translations';
import type { DiffLine } from '../../utils/diffUtils';

export interface ComposerDiffProps {
  path: string;
  lines: DiffLine[];
  stats: { addedCount: number; removedCount: number };
  pending: boolean;
  onAccept: () => void;
  onReject: () => void;
  lang?: Language;
}

/** A partir de aquí, el contexto se colapsa. */
const CONTEXT_RUN = 6;
const CONTEXT_HEAD = 2;
const CONTEXT_TAIL = 2;

export function ComposerDiff({ path, lines, stats, pending, onAccept, onReject, lang = 'es' }: ComposerDiffProps) {
  const t = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const row = (line: DiffLine, key: number) => {
    const gutter = 'select-none w-10 shrink-0 text-right pr-1 tabular-nums';
    if (line.type === 'added') {
      return (
        <div key={key} className="flex gap-2 px-2 bg-emerald-400/10 border-l-2 border-emerald-400/60 text-emerald-200">
          <span className={`${gutter} text-emerald-300/60`}>{line.newLineNumber ?? ''}</span>
          <span className="whitespace-pre-wrap break-all">{line.content}</span>
        </div>
      );
    }
    if (line.type === 'removed') {
      return (
        <div key={key} className="flex gap-2 px-2 bg-red-400/10 border-l-2 border-red-400/60 text-red-200">
          <span className={`${gutter} text-red-300/60`}>{line.oldLineNumber ?? ''}</span>
          <span className="whitespace-pre-wrap break-all">{line.content}</span>
        </div>
      );
    }
    return (
      <div key={key} className="flex gap-2 px-2 text-[var(--nc-text)]/60">
        <span className={`${gutter} text-[var(--nc-text)]/30`}>{line.oldLineNumber ?? ''}</span>
        <span className="whitespace-pre-wrap break-all">{line.content}</span>
      </div>
    );
  };

  const rows: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.type === 'unchanged') {
      let end = i;
      while (end + 1 < lines.length && lines[end + 1].type === 'unchanged') end++;
      const run = end - i + 1;
      if (run > CONTEXT_RUN && !expanded[i]) {
        for (let k = i; k < i + CONTEXT_HEAD; k++) rows.push(row(lines[k], k));
        rows.push(
          <button
            key={`collapse-${i}`}
            type="button"
            onClick={() => setExpanded((prev) => ({ ...prev, [i]: true }))}
            className="w-full text-left px-2 py-0.5 text-[10px] text-[var(--nc-text)]/50 bg-[var(--nc-bg-main)]/30 hover:text-[var(--nc-text-accent)]"
            data-testid={`composer-expand-${i}`}
          >
            ⋯ {run - CONTEXT_HEAD - CONTEXT_TAIL} {t('líneas sin cambios · expandir', 'unchanged lines · expand')}
          </button>
        );
        for (let k = end - CONTEXT_TAIL + 1; k <= end; k++) rows.push(row(lines[k], k));
        i = end;
        continue;
      }
    }
    rows.push(row(line, i));
  }

  return (
    <div className="font-mono text-[11px] leading-relaxed">
      <div className="sticky top-0 z-10 flex items-center gap-2 px-2 py-1 bg-[var(--nc-bg-main)]/70 border-b border-[var(--nc-border-dark)]">
        <span className="truncate text-[10px]">{path}</span>
        <span className="text-[10px] tabular-nums shrink-0">
          <span className="text-emerald-300">+{stats.addedCount}</span>{' '}
          <span className="text-red-300">−{stats.removedCount}</span>
        </span>
        <span
          className={`text-[9px] px-1 border shrink-0 ${
            pending
              ? 'border-[var(--nc-text-accent)] text-[var(--nc-text-accent)]'
              : 'border-[var(--nc-border-dark)] text-[var(--nc-text)]/50'
          }`}
        >
          {pending ? t('PENDIENTE', 'PENDING') : t('SIN CAMBIOS', 'NO CHANGES')}
        </span>
        {pending && (
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onAccept}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-emerald-400 text-black hover:bg-white border border-black"
              data-testid="composer-accept"
            >
              <Check className="w-3 h-3" />
              {t('ACEPTAR', 'ACCEPT')}
            </button>
            <button
              type="button"
              onClick={onReject}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-red-500 text-black hover:bg-white border border-black"
              data-testid="composer-reject"
            >
              <X className="w-3 h-3" />
              {t('DESCARTAR', 'DISCARD')}
            </button>
          </div>
        )}
      </div>

      {!pending && lines.length > 0 && (
        <div className="px-2 py-1 text-[10px] text-[var(--nc-text)]/50">
          {t('Sin cambios pendientes en este archivo.', 'No pending changes in this file.')}
        </div>
      )}

      {rows}
    </div>
  );
}

export default ComposerDiff;
