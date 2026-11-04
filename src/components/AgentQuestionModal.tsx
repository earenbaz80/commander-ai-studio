import { useEffect, useRef, useState } from 'react';
import type { ApprovalRequest } from '../agent/types';
import type { Language } from '../i18n/translations';

/**
 * Modal de `ask_user`.
 *
 * Comparte el canal de aprobación, pero aquí no se acepta ni se rechaza una
 * acción: se responde una pregunta. Las opciones resuelven al instante y el
 * texto libre envía con Enter, para que preguntar cueste un clic.
 */
interface AgentQuestionModalProps {
  approval: ApprovalRequest;
  onResolve: (ok: boolean, answer?: string) => void;
  lang?: Language;
}

export function AgentQuestionModal({ approval, onResolve, lang = 'es' }: AgentQuestionModalProps) {
  const t = (es: string, en: string) => (lang === 'es' ? es : en);
  const meta = (approval.meta ?? {}) as {
    question?: string;
    options?: string[];
    allowFreeText?: boolean;
  };
  const question = String(meta.question || approval.description || '');
  const options = Array.isArray(meta.options) ? meta.options : [];
  const allowFreeText = meta.allowFreeText !== false;
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (allowFreeText && options.length === 0) inputRef.current?.focus();
  }, [allowFreeText, options.length]);

  const submit = () => {
    const answer = text.trim();
    if (!answer) return;
    onResolve(true, answer);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-[var(--nc-bg-panel)] border-2 border-[var(--nc-text-accent)] p-4 max-w-xl w-full">
        <div className="text-[var(--nc-text-accent)] font-bold text-sm mb-2">
          {approval.title || t('Pregunta del agente', 'Agent question')}
        </div>
        <div className="text-white text-xs mb-3 whitespace-pre-wrap break-words">{question}</div>

        {options.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onResolve(true, option)}
                className="nc-button w-full text-left text-xs px-3 py-1.5"
              >
                {option}
              </button>
            ))}
          </div>
        )}

        {allowFreeText && (
          <div className="flex gap-2 mb-2">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder={t('Escribe la respuesta…', 'Type the answer…')}
              className="flex-1 bg-black/60 border border-[var(--nc-text)] text-white text-xs px-2 py-1"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim()}
              className="nc-button text-xs px-3 py-1 disabled:opacity-50"
            >
              {t('Responder', 'Answer')}
            </button>
          </div>
        )}

        <div className="flex justify-end">
          <button type="button" onClick={() => onResolve(false)} className="nc-button text-xs px-3 py-1">
            {t('Cancelar', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
