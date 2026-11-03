/**
 * Modal de ayuda para las menciones `@` — estilo Norton Commander.
 *
 * Extraído de `ChatPlayground` para dejar el componente principal centrado en
 * la máquina de estado del chat y no en el JSX de soporte.
 */
import React from 'react';
import { HelpCircle, X } from 'lucide-react';
import type { Language } from '../../i18n/translations';

interface MentionHelpModalProps {
  lang: Language;
  onClose: () => void;
}

export const MentionHelpModal: React.FC<MentionHelpModalProps> = ({ lang, onClose }) => {
  const closeLabel = lang === 'es' ? 'Cerrar' : lang === 'de' ? 'Schließen' : 'Close';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] shadow-[0_0_30px_rgba(0,255,255,0.4)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-[var(--nc-border-light)]/40 px-4 py-2">
          <div className="flex items-center gap-2 text-[var(--nc-text-accent)] text-sm font-bold">
            <HelpCircle className="w-4 h-4" />
            {lang === 'es' ? 'Ayuda de menciones' : lang === 'de' ? 'Erwähnungshilfe' : 'Mention help'}
          </div>
          <button
            onClick={onClose}
            className="text-[var(--nc-text)] hover:text-white"
            aria-label={closeLabel}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 text-xs">
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <code className="shrink-0 bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)]/40 px-2 py-1 font-mono text-[10px] text-[var(--nc-text)]">@nono</code>
              <span className="text-[10px] text-[var(--nc-text)]/80">{lang === 'es' ? 'Abre el asistente Nono con un prompt pre-rellenado' : lang === 'de' ? 'Öffnet den Assistenten Nono mit vorausgefülltem Prompt' : 'Opens Nono assistant with prefilled prompt'}</span>
            </div>
            <div className="flex items-start gap-2">
              <code className="shrink-0 bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)]/40 px-2 py-1 font-mono text-[10px] text-[var(--nc-text)]">@archivo</code>
              <span className="text-[10px] text-[var(--nc-text)]/80">{lang === 'es' ? 'Sugiere archivos del proyecto' : lang === 'de' ? 'Schlägt Projektdateien vor' : 'Suggests project files'}</span>
            </div>
            <div className="flex items-start gap-2">
              <code className="shrink-0 bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)]/40 px-2 py-1 font-mono text-[10px] text-[var(--nc-text)]">@ayuda</code>
              <span className="text-[10px] text-[var(--nc-text)]/80">{lang === 'es' ? 'Muestra información rápida' : lang === 'de' ? 'Zeigt Kurzinfos' : 'Shows quick info'}</span>
            </div>
          </div>
          <p className="text-[10px] text-[var(--nc-text)]/50 pt-2 border-t border-[var(--nc-border-light)]/20">
            {lang === 'es'
              ? 'Escribe @ seguido de una palabra en el chat para ver sugerencias.'
              : lang === 'de' ? 'Gib @ gefolgt von einem Wort im Chat ein, um Vorschläge zu sehen.' : 'Type @ followed by a word in the chat to see suggestions.'}
          </p>
        </div>

        <div className="flex justify-end border-t border-[var(--nc-border-light)]/40 px-4 py-2">
          <button
            onClick={onClose}
            className="border border-[var(--nc-text-accent)] bg-[var(--nc-active-bg)] px-3 py-1 font-bold text-black text-xs"
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MentionHelpModal;