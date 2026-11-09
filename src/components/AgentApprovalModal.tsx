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
import { readProjectFile, runAgentTool } from '../utils/agentToolsApi';
import type { RuleFinding } from '../agent/tools/fs';
import { applyExactEdit, diffLines, toUnifiedDiff } from '../utils/patch';
import { DiffViewer } from './DiffViewer';
import { addRule, persistRuleToProject, ruleTarget, syncRulesWithServer } from '../agent/permissionRules';
import { getActiveProjectRoot } from '../agent/activeProject';

interface AgentApprovalModalProps {
  approval: ApprovalRequest;
  onResolve: (
    ok: boolean,
    override?: { toolId: string; input: unknown },
    diff?: string
  ) => void;
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

  // F1-07: una vez por carga, sube a `.commander/permissions.json` las reglas
  // que sólo vivían en localStorage. El CLI lee ese archivo, no el navegador.
  useEffect(() => {
    const root = getActiveProjectRoot();
    if (!root) return;
    void syncRulesWithServer(root).catch(() => {
      /* best-effort: sin servidor, localStorage sigue funcionando */
    });
  }, []);

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

  /** Patch del contenido que realmente se aplicó (incluye hunks rechazados). */
  const patchFor = (nextText: string): string | undefined => {
    if (oldText === null || nextText === oldText) return undefined;
    return toUnifiedDiff(path, diffLines(oldText, nextText), {
      exists: oldText !== '',
    }).slice(0, 20_000);
  };

  /**
   * Reglas del repo que introduce el borrador (color, i18n).
   *
   * Las calcula el servidor con `ts.propose`, no el navegador: el parser de
   * TypeScript vive allí y meterlo en el bundle por dos avisos no tiene
   * sentido. `diagnose: false` porque aquí sólo interesan las reglas, no el
   * typecheck, que ya costó su segundo en el flujo del agente.
   */
  const [rules, setRules] = useState<RuleFinding[]>([]);
  // Regla "no volver a preguntar" para este comando o ruta exactos.
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (!showDiff) {
      setRules([]);
      return;
    }
    let cancelled = false;
    const payload =
      toolId === 'fs.write'
        ? { path, content: String(input.content ?? ''), diagnose: false }
        : {
            path,
            oldString: String(input.oldString ?? ''),
            newString: String(input.newString ?? ''),
            replaceAll: !!input.replaceAll,
            diagnose: false,
          };
    runAgentTool<{ rules?: RuleFinding[] }>(toolId === 'fs.write' ? 'fs.propose.write' : 'fs.propose.edit', payload)
      .then((res) => {
        if (!cancelled) setRules(res.ok ? res.data?.rules ?? [] : []);
      })
      .catch(() => {
        if (!cancelled) setRules([]);
      });
    return () => {
      cancelled = true;
    };
    // `input` se reconstruye en cada render: la identidad de la aprobación y la
    // ruta son las que dicen si el borrador es otro.
  }, [approval.id, showDiff, toolId, path]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-[var(--nc-bg-panel)] border-2 border-[var(--nc-text-accent)] p-4 max-w-2xl w-full max-h-[85vh] overflow-y-auto">
        <div className="text-[var(--nc-text-accent)] font-bold text-sm mb-1">
          {t('Revisar cambios de la IA', 'Review AI changes')}
        </div>
        <div className="text-white text-xs mb-1">{toolId}</div>
        <div className="text-[var(--nc-text)] text-[11px] mb-3 break-all">{approval.description}</div>

        {isPatchTool && loading && (
          <div className="text-[11px] text-[var(--nc-text)] mb-3">{t('Leyendo archivo…', 'Reading file…')}</div>
        )}

        {showDiff && rules.length > 0 && (
          <div className="mb-3 border border-white/40 bg-black/40 p-2">
            <div className="text-white text-[11px] font-bold mb-1">
              {t('Reglas del repo que introduce este cambio', 'Repo rules this change introduces')}
            </div>
            <ul className="text-[10px] text-white space-y-1">
              {rules.map((r, i) => (
                <li key={`${r.rule}-${r.line}-${i}`}>
                  <span className="underline decoration-dotted">{r.rule}</span>
                  {` · ${t('línea', 'line')} ${r.line} · ${r.message} `}
                  <span className="text-white/60">«{r.excerpt}»</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {showDiff && (
          <DiffViewer
            path={path}
            oldText={oldText as string}
            newText={proposed as string}
            onApply={(merged) =>
              onResolve(
                true,
                { toolId: 'fs.write', input: { path, content: merged, overwrite: true } },
                patchFor(merged)
              )
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
            {ruleTarget(toolId, input) && (
              <label className="flex items-center gap-2 text-[10px] text-white/80 mb-2">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                {t('No volver a preguntar por', 'Do not ask again for')} «{ruleTarget(toolId, input)}»
              </label>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => onResolve(false)} className="nc-button text-xs px-3 py-1">
                {t('Denegar', 'Deny')}
              </button>
              <button
                onClick={() => {
                  const target = ruleTarget(toolId, input);
                  if (remember && target) {
                    const rule = { tool: toolId, pattern: target, decision: 'allow' as const };
                    addRule(rule);
                    const root = getActiveProjectRoot();
                    if (root) {
                      void persistRuleToProject(root, rule).catch(() => {
                        /* la regla local ya quedó; el archivo se reintenta al abrir */
                      });
                    }
                  }
                  onResolve(true);
                }}
                className="nc-button text-xs px-3 py-1 bg-[var(--nc-active-bg)] text-black font-bold"
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
