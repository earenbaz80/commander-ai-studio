import { deText } from '../i18n/de';
import type { Language } from '../i18n/translations';
/**
 * Modal de aprobación de acciones peligrosas del agente.
 *
 * Para `fs.write` / `fs.edit` lee el archivo actual, calcula la propuesta y
 * muestra un diff con aceptación por hunk. Cuando el usuario aplica un subconjunto
 * de cambios, se resuelve la aprobación con un `override` que escribe el
 * contenido fusionado (en lugar del tool original).
 */
import { useEffect, useMemo, useState } from 'react';
import type { ApprovalRequest } from '../agent/types';
import { readProjectFile } from '../utils/agentToolsApi';
import { applyExactEdit } from '../utils/patch';
import { DiffViewer } from './DiffViewer';

interface AgentApprovalModalProps {
  approval: ApprovalRequest;
  onResolve: (ok: boolean, override?: { toolId: string; input: unknown }) => void;
  lang?: Language;
}

export function AgentApprovalModal({ approval, onResolve, lang = 'es' }: AgentApprovalModalProps) {
  const t = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);
  const toolId = approval.toolId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const input = ((approval.meta as any)?.input ?? {}) as Record<string, any>;
  const path = String(input.path ?? '');
  const isPatchTool = toolId === 'fs.write' || toolId === 'fs.edit';

  const [oldText, setOldText] = useState<string | null>(null);
  const [loading, setLoading] = useState(isPatchTool);

  useEffect(() => {
    if (!isPatchTool) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setOldText(null);
    readProjectFile(path)
      .then((res) => {
        if (cancelled) return;
        // Si el archivo no existe todavía (creación), partimos de contenido vacío.
        setOldText(res.error ? '' : res.content ?? '');
      })
      .catch(() => {
        if (!cancelled) setOldText('');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [approval.id, isPatchTool, path]);

  const proposed = useMemo<string | null>(() => {
    if (oldText === null) return null;
    if (toolId === 'fs.write') return String(input.content ?? '');
    if (toolId === 'fs.edit') {
      const applied = applyExactEdit(
        oldText,
        String(input.oldString ?? ''),
        String(input.newString ?? ''),
        !!input.replaceAll
      );
      return applied ? applied.content : null;
    }
    return null;
  }, [oldText, toolId, input]);

  const showDiff = isPatchTool && !loading && oldText !== null && proposed !== null;
  const showFallback = !showDiff && !(isPatchTool && loading);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-[#000080] border-2 border-[#ffff55] p-4 max-w-2xl w-full max-h-[85vh] overflow-y-auto">
        <div className="text-[#ffff55] font-bold text-sm mb-1">
          {t('Revisar cambios de la IA', 'Review AI changes')}
        </div>
        <div className="text-white text-xs mb-1">{toolId}</div>
        <div className="text-[#00ffff] text-[11px] mb-3 break-all">{approval.description}</div>

        {isPatchTool && loading && (
          <div className="text-[11px] text-[#00ffff] mb-3">{t('Leyendo archivo…', 'Reading file…')}</div>
        )}

        {showDiff && (
          <DiffViewer
            path={path}
            oldText={oldText as string}
            newText={proposed as string}
            onApply={(merged) =>
              onResolve(true, { toolId: 'fs.write', input: { path, content: merged, overwrite: true } })
            }
            onReject={() => onResolve(false)}
            lang={lang}
          />
        )}

        {showFallback && (
          <>
            {toolId === 'fs.edit' ? (
              <div className="grid grid-cols-2 gap-2 mb-3 text-[10px]">
                <div>
                  <div className="text-red-300 font-bold mb-1">— oldString</div>
                  <pre className="bg-black/60 text-white p-2 overflow-x-auto whitespace-pre-wrap">{String(input.oldString || '').slice(0, 2000)}</pre>
                </div>
                <div>
                  <div className="text-green-300 font-bold mb-1">+ newString</div>
                  <pre className="bg-black/60 text-white p-2 overflow-x-auto whitespace-pre-wrap">{String(input.newString || '').slice(0, 2000)}</pre>
                </div>
                <div className="col-span-2 text-white/70">path: {path}</div>
              </div>
            ) : toolId === 'fs.write' ? (
              <div className="mb-3 text-[10px]">
                <div className="text-white/70 mb-1">
                  path: {path} ({String(input.content || '').length} chars)
                </div>
                <pre className="bg-black/60 text-white p-2 overflow-x-auto whitespace-pre-wrap">{String(input.content || '').slice(0, 3000)}</pre>
              </div>
            ) : (
              <pre className="bg-black/50 text-[10px] text-white p-2 mb-3 overflow-x-auto">{JSON.stringify(approval.meta, null, 2)}</pre>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => onResolve(false)} className="nc-button text-xs px-3 py-1">
                {t('Denegar', 'Deny')}
              </button>
              <button
                onClick={() => onResolve(true)}
                className="nc-button text-xs px-3 py-1 bg-[#ffff55] text-black font-bold"
              >
                {t('Aprobar', 'Approve')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
