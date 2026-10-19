import { deText } from '../i18n/de';
import type { Language } from '../i18n/translations';
/**
 * Visor de diferencias con aceptación por hunk (estilo Cursor).
 *
 * Muestra el diff unificado de una propuesta de la IA y permite aplicar sólo
 * los cambios marcados. El resultado fusionado se entrega en `onApply`.
 */
import { useMemo, useState } from 'react';
import { diffLines, mergeHunks } from '../utils/patch';

interface DiffViewerProps {
  path: string;
  oldText: string;
  newText: string;
  onApply: (mergedText: string) => void;
  onReject: () => void;
  acceptedLabel?: string;
  rejectLabel?: string;
  lang?: Language;
}

const LINE_STYLES: Record<'context' | 'add' | 'del', string> = {
  context: 'text-[#9fe8e8]',
  add: 'bg-[#003300]/60 text-[#7dff9b]',
  del: 'bg-[#3a0000]/60 text-[#ff9d9d]',
};

const PREFIX: Record<'context' | 'add' | 'del', string> = {
  context: ' ',
  add: '+',
  del: '-',
};

export function DiffViewer({
  path,
  oldText,
  newText,
  onApply,
  onReject,
  acceptedLabel,
  rejectLabel,
  lang = 'es',
}: DiffViewerProps) {
  const t = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);
  const diff = useMemo(() => diffLines(oldText, newText), [oldText, newText]);

  const [rejected, setRejected] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggleRejected = (id: string) => {
    setRejected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (diff.hunks.length === 0) {
    return (
      <div className="text-[11px]">
        <div className="text-[#ffff55] font-bold mb-2 truncate" title={path}>
          {t('Sin cambios', 'No changes')}: <span className="text-white/80">{path}</span>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onReject}
            className="nc-button text-xs px-3 py-1"
          >
            {rejectLabel ?? t('Cerrar', 'Close')}
          </button>
        </div>
      </div>
    );
  }

  const accepted = diff.hunks.filter((h) => !rejected.has(h.id));
  const acceptedIds = new Set(accepted.map((h) => h.id));

  return (
    <div className="text-[11px]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[#ffff55] font-bold truncate" title={path}>
          {path}
        </div>
        <div className="shrink-0 font-mono">
          <span className="text-[#7dff9b]">+{diff.additions}</span>{' '}
          <span className="text-[#ff9d9d]">-{diff.deletions}</span>
        </div>
      </div>

      <div
        className="max-h-[45vh] overflow-y-auto border border-[#004466] bg-[#000022]"
        data-testid="diff-hunks"
      >
        {diff.hunks.map((h) => {
          const isRejected = rejected.has(h.id);
          const isCollapsed = collapsed.has(h.id);
          return (
            <div key={h.id} className="border-b border-[#004466] last:border-b-0">
              <div className="flex items-center gap-2 px-2 py-1 bg-[#000055]">
                <input
                  type="checkbox"
                  checked={!isRejected}
                  onChange={() => toggleRejected(h.id)}
                  aria-label={`${t('Hunk', 'Hunk')} ${h.id}`}
                  className="accent-[#00ffff] cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => toggleCollapsed(h.id)}
                  className="font-mono text-[10px] text-[#00ffff] hover:text-[#ffff55]"
                  title={isCollapsed ? t('Expandir', 'Expand') : t('Plegar', 'Collapse')}
                >
                  @@ -{h.oldStart},{h.oldCount} +{h.newStart},{h.newCount} @@
                </button>
                {isRejected && (
                  <span className="ml-auto text-[9px] text-red-300 uppercase">
                    {t('Rechazado', 'Rejected')}
                  </span>
                )}
              </div>
              {!isCollapsed && (
                <div className={`font-mono text-[10px] leading-[1.5] ${isRejected ? 'opacity-50' : ''}`}>
                  {h.lines.map((l, i) => (
                    <div key={i} className={`flex ${LINE_STYLES[l.type]}`}>
                      <span className="w-10 shrink-0 select-none pr-1 text-right text-white/30">
                        {l.oldNo ?? ''}
                      </span>
                      <span className="w-10 shrink-0 select-none pr-1 text-right text-white/30">
                        {l.newNo ?? ''}
                      </span>
                      <span className="w-3 shrink-0 select-none text-center">{PREFIX[l.type]}</span>
                      <span className="flex-1 whitespace-pre">{l.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 mt-3">
        <div className="text-[10px] text-[#00ffff]">
          {t('Hunks', 'Hunks')}: {accepted.length}/{diff.hunks.length}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReject}
            className="nc-button text-xs px-3 py-1"
          >
            {rejectLabel ?? t('Rechazar todo', 'Reject all')}
          </button>
          <button
            type="button"
            onClick={() => onApply(mergeHunks(oldText, diff.hunks, acceptedIds))}
            className="nc-button text-xs px-3 py-1 bg-[#ffff55] text-black font-bold"
          >
            {acceptedLabel ?? t('Aplicar seleccionados', 'Apply selected')}
          </button>
        </div>
      </div>
    </div>
  );
}
