/**
 * Lista de archivos del workspace del Composer.
 *
 * Antes la lista era un `div` con `onClick` que además usaba `prompt()` para
 * crear y `confirm()` para borrar. Aquí cada fila es un botón de verdad (se
 * puede enfocar con el teclado), crear es un input en la propia lista y borrar
 * pide confirmación en la fila, sin diálogos del sistema.
 */
import { useState } from 'react';
import { Check, FileCode, Plus, Trash2, X } from 'lucide-react';
import { deText } from '../../i18n/de';
import type { Language } from '../../i18n/translations';
import { computeLineDiff } from '../../utils/diffUtils';
import type { ComposerFile } from '../../lib/composerRun';

export interface ComposerFileListProps {
  files: ComposerFile[];
  selected: string;
  onSelect: (name: string) => void;
  /** Devuelve un mensaje de error, o `null` si se creó. */
  onCreate: (name: string) => string | null;
  onDelete: (name: string) => void;
  lang?: Language;
}

/** `src/components/panel/EditorView.tsx` → `src/…/EditorView.tsx`. */
function elidePath(name: string, maxSegments = 2): string {
  const parts = name.split('/');
  if (parts.length <= maxSegments + 1) return name;
  return `${parts[0]}/…/${parts[parts.length - 1]}`;
}

export function ComposerFileList({ files, selected, onSelect, onCreate, onDelete, lang = 'es' }: ComposerFileListProps) {
  const t = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  const submit = () => {
    const name = draft.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    const problem = onCreate(name);
    if (problem) {
      setError(problem);
      return;
    }
    setDraft('');
    setError('');
    setCreating(false);
  };

  return (
    <aside className="w-56 shrink-0 min-h-0 flex flex-col bg-[var(--nc-bg-panel)] border-r border-[var(--nc-border-dark)]">
      <div className="flex items-center gap-1 px-2 h-8 shrink-0 border-b border-[var(--nc-border-dark)]">
        <FileCode className="w-3.5 h-3.5 text-[var(--nc-text-accent)] shrink-0" />
        <span className="text-[10px] font-bold tracking-wide truncate">{t('ARCHIVOS', 'FILES')}</span>
        <span className="text-[10px] text-[var(--nc-text)]/50">{files.length}</span>
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setError('');
          }}
          className="ml-auto p-0.5 text-[var(--nc-text-accent)] hover:text-white"
          title={t('Nuevo archivo', 'New file')}
          data-testid="composer-add-file"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {creating && (
        <div className="px-1.5 py-1 border-b border-[var(--nc-border-dark)] shrink-0">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') {
                setCreating(false);
                setDraft('');
                setError('');
              }
            }}
            autoFocus
            spellCheck={false}
            placeholder="src/nuevo.ts"
            className="w-full bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] px-1.5 py-0.5 text-[10px] text-[var(--nc-text)] outline-none"
            data-testid="composer-new-file-input"
          />
          {error && <div className="text-red-300 text-[10px] mt-0.5">{error}</div>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1" role="list">
        {files.map((file) => {
          const pending = file.proposedContent !== undefined && file.proposedContent !== file.originalContent;
          const stats = pending
            ? computeLineDiff(file.originalContent, file.proposedContent as string).stats
            : null;
          const isSelected = file.name === selected;
          return (
            <div key={file.name} role="listitem" className="px-1">
              <button
                type="button"
                onClick={() => onSelect(file.name)}
                aria-current={isSelected ? 'true' : undefined}
                className={`w-full text-left px-2 py-1 border-l-2 flex items-center gap-1.5 text-[10px] transition-colors ${
                  isSelected
                    ? 'border-[var(--nc-text)] bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)]'
                    : 'border-transparent text-[var(--nc-text)]/80 hover:bg-[var(--nc-bg-main)]/60'
                }`}
                data-testid={`composer-file-${file.name}`}
              >
                <span className="truncate flex-1">{elidePath(file.name)}</span>
                {pending && stats && (
                  <span className="shrink-0 tabular-nums text-[10px]">
                    <span className="text-emerald-300">+{stats.addedCount}</span>{' '}
                    <span className="text-red-300">−{stats.removedCount}</span>
                  </span>
                )}
                {file.isNew && (
                  <span className="shrink-0 text-[9px] px-1 bg-[var(--nc-text-accent)] text-black font-bold">
                    {t('NUEVO', 'NEW')}
                  </span>
                )}
              </button>

              {confirming === file.name ? (
                <div className="flex items-center gap-1 pl-2 pb-1">
                  <span className="text-[10px] text-red-300 flex-1 truncate">
                    {t('¿Borrar archivo?', 'Delete file?')}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(file.name);
                      setConfirming(null);
                    }}
                    className="p-0.5 text-red-300 hover:text-red-200"
                    title={t('Confirmar', 'Confirm')}
                    data-testid={`composer-confirm-delete-${file.name}`}
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="p-0.5 text-[var(--nc-text)]/70 hover:text-white"
                    title={t('Cancelar', 'Cancel')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="flex justify-end pb-0.5">
                  <button
                    type="button"
                    onClick={() => setConfirming(file.name)}
                    className="p-0.5 text-[var(--nc-text)]/40 hover:text-red-300"
                    title={t('Eliminar archivo', 'Remove file')}
                    data-testid={`composer-delete-${file.name}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default ComposerFileList;
