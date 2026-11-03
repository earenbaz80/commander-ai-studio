/**
 * Barra de edición inline con IA (Cmd+K) — previsualización con diff.
 *
 * Flujo: instrucción → propuesta del modelo → diff con Aceptar/Rechazar.
 * Es puramente presentacional; el estado y la transacción viven en CodeEditor.
 */
import React, { useMemo } from 'react';
import { Sparkles, Loader2, Check, X, Wand2 } from 'lucide-react';
import { lineDiff, summarizeDiff } from '../../utils/lineDiff';

export type InlineEditPhase = 'prompt' | 'loading' | 'preview' | 'error';

export interface InlineEditBarProps {
  phase: InlineEditPhase;
  instruction: string;
  original: string;
  proposed: string;
  error: string;
  model: string;
  onInstructionChange: (value: string) => void;
  onSubmit: () => void;
  onAccept: () => void;
  onReject: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

const LINE_CLASS: Record<string, string> = {
  add: 'bg-[#003300] text-[var(--nc-success)]',
  del: 'bg-[#330000] text-[#ff8888]',
  equal: 'text-[#9fe8ff]/50',
};
const LINE_PREFIX: Record<string, string> = { add: '+', del: '-', equal: ' ' };

export const InlineEditBar: React.FC<InlineEditBarProps> = ({
  phase,
  instruction,
  original,
  proposed,
  error,
  model,
  onInstructionChange,
  onSubmit,
  onAccept,
  onReject,
  inputRef,
}) => {
  const ops = useMemo(
    () => (phase === 'preview' ? lineDiff(original, proposed) : []),
    [phase, original, proposed]
  );
  const summary = useMemo(() => summarizeDiff(ops), [ops]);
  const showDiff = phase === 'preview';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onReject();
      return;
    }
    if ((phase === 'prompt' || phase === 'loading') && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (phase === 'preview' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onAccept();
    }
  };

  return (
    <div
      className="absolute left-2 right-2 top-2 z-20 border border-[var(--nc-border-light)]/60 bg-[var(--nc-bg-deep)] font-mono text-[11px] shadow-[0_0_0_1px_#000080,0_6px_18px_rgba(0,0,0,0.5)]"
      data-testid="editor-inline-ai"
      onKeyDown={handleKeyDown}
    >
      {/* Cabecera */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)]">
        <Sparkles className="w-3 h-3 text-[var(--nc-text-accent)] shrink-0" />
        <span className="text-[var(--nc-text-accent)]">EDICIÓN IA</span>
        <span className="text-[var(--nc-text)]/50 truncate">{model}</span>
        <button
          onClick={onReject}
          className="ml-auto p-0.5 text-[var(--nc-danger)] hover:bg-[var(--nc-bg-hover)] rounded shrink-0"
          title="Cerrar (Esc)"
          aria-label="Cerrar edición IA"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {(phase === 'prompt' || phase === 'loading') && (
        <div className="flex items-center gap-2 p-2">
          <Wand2 className="w-3.5 h-3.5 text-[var(--nc-text)] shrink-0" />
          <input
            ref={inputRef}
            value={instruction}
            disabled={phase === 'loading'}
            onChange={(e) => onInstructionChange(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="Instrucción: p. ej. «añade manejo de errores», «convierte a async»"
            className="flex-1 min-w-0 bg-[var(--nc-bg-deep)] text-white border border-[var(--nc-border-light)]/50 px-2 py-1 outline-none placeholder:text-[var(--nc-text)]/30 disabled:opacity-60"
            data-testid="editor-inline-input"
          />
          <button
            onClick={onSubmit}
            disabled={phase === 'loading' || !instruction.trim()}
            className="nc-button !px-2 !py-1 text-[10px] bg-[var(--nc-highlight-bg)] text-black font-bold hover:bg-white flex items-center gap-1 shrink-0 disabled:opacity-40"
          >
            {phase === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            <span>{phase === 'loading' ? 'Generando…' : 'Proponer'}</span>
          </button>
        </div>
      )}

      {showDiff && (
        <div>
          <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--nc-border-dark)] text-[10px]">
            <span className="text-[var(--nc-success)]">+{summary.added}</span>
            <span className="text-[#ff8888]">−{summary.removed}</span>
            <span className="text-[var(--nc-text)]/50">Cmd/Ctrl+Enter acepta · Esc rechaza</span>
          </div>
          <div className="max-h-44 overflow-auto py-1" data-testid="editor-inline-diff">
            {ops.map((op, i) => (
              <div key={i} className={`px-2 whitespace-pre ${LINE_CLASS[op.type]}`}>
                {LINE_PREFIX[op.type]}
                {op.text || ' '}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 px-2 py-1 border-t border-[var(--nc-border-dark)]">
            <button
              onClick={onAccept}
              className="nc-button !px-2 !py-1 text-[10px] bg-[#88ff88] text-black font-bold hover:bg-white flex items-center gap-1"
              title="Aplicar el cambio (Cmd/Ctrl+Enter)"
            >
              <Check className="w-3 h-3" />
              <span>Aceptar</span>
            </button>
            <button
              onClick={onReject}
              className="nc-button !px-2 !py-1 text-[10px] bg-[#ff5555] text-black font-bold hover:bg-white flex items-center gap-1"
              title="Descartar el cambio (Esc)"
            >
              <X className="w-3 h-3" />
              <span>Rechazar</span>
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex items-start gap-2 p-2 text-[#ff8888]" data-testid="editor-inline-error">
          <X className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1 min-w-0 break-words">{error || 'No se pudo generar la edición'}</span>
        </div>
      )}
    </div>
  );
};

export default InlineEditBar;
