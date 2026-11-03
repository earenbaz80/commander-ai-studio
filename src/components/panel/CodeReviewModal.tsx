/**
 * Revisión del archivo abierto, sin modelo de por medio.
 *
 * Tres cosas en un solo sitio, porque son el mismo momento del trabajo:
 *  • análisis (diagnósticos, imports sin usar, reglas del repo),
 *  • «formatear y lintar» (code.fix: eslint --fix + prettier del proyecto),
 *  • renombrado de un símbolo en todo el proyecto (code.refactor), con el diff
 *    por archivo y sin aplicar nada hasta que el usuario lo pide.
 *
 * El renombrado no se aplica si alguna de sus consecuencias deja errores de
 * tipos: el plan trae el typecheck de lo que quedaría, y un refactor que rompe
 * el proyecto no es un refactor.
 */
import { useCallback, useEffect, useState } from 'react';
import { deText } from '../../i18n/de';
import type { Language } from '../../i18n/translations';
import { runAgentTool, writeProjectFile } from '../../utils/agentToolsApi';

interface Finding {
  line: number;
  column: number;
  message: string;
  code?: string;
  severity?: 'error' | 'warning';
}

interface Analysis {
  file: string;
  checked: boolean;
  note?: string;
  diagnostics: Finding[];
  errorCount: number;
  warningCount: number;
  unusedImports: { name: string; module: string; line: number; column: number }[];
  rules: { rule: string; line: number; message: string; excerpt: string }[];
}

interface RenameFile {
  path: string;
  changed: boolean;
  additions: number;
  deletions: number;
  diff: string;
  content?: string;
  diagnostics?: Finding[];
  checked?: boolean;
}

interface RenamePlan {
  symbol: string;
  newName: string;
  locations: number;
  files: RenameFile[];
}

interface FixFile {
  path: string;
  changed: boolean;
  additions: number;
  deletions: number;
  diff: string;
}

export interface CodeReviewModalProps {
  /** Ruta relativa del archivo abierto. */
  path: string;
  projectPath: string;
  onClose: () => void;
  /** Se llama cuando el contenido del archivo cambió en disco. */
  onFileChanged?: (path: string) => void;
  lang?: Language;
}

const MAX_LIST = 12;
const DIFF_PREVIEW_LINES = 24;

export function CodeReviewModal({ path, projectPath, onClose, onFileChanged, lang = 'es' }: CodeReviewModalProps) {
  // Estable entre renders: `analyze` la lleva en sus dependencias y, si
  // cambiara de identidad en cada uno, el efecto volvería a pedir el análisis
  // en bucle.
  const t = useCallback(
    (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en),
    [lang]
  );

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [fixing, setFixing] = useState(false);
  const [fixed, setFixed] = useState<FixFile[]>([]);

  const [symbol, setSymbol] = useState('');
  const [newName, setNewName] = useState('');
  const [rename, setRename] = useState<RenamePlan | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [applying, setApplying] = useState(false);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await runAgentTool<Analysis>('code.analyze', { path }, projectPath);
    setLoading(false);
    if (!res.ok) {
      setError(res.error || t('No se pudo analizar', 'Could not analyze'));
      return;
    }
    setAnalysis(res.data ?? null);
  }, [path, projectPath, t]);

  useEffect(() => {
    void analyze();
  }, [analyze]);

  const handleFix = async () => {
    setFixing(true);
    setError('');
    const res = await runAgentTool<{ files: FixFile[] }>('code.fix', { paths: [path] }, projectPath);
    setFixing(false);
    if (!res.ok) {
      setError(res.error || t('No se pudo formatear', 'Could not format'));
      return;
    }
    const files = res.data?.files ?? [];
    setFixed(files.filter((f) => f.changed));
    if (files.some((f) => f.changed)) {
      onFileChanged?.(path);
      void analyze();
    }
  };

  const handlePlanRename = async () => {
    if (!symbol.trim() || !newName.trim()) return;
    setRenaming(true);
    setError('');
    setRename(null);
    const res = await runAgentTool<RenamePlan>(
      'code.refactor',
      { path, symbol: symbol.trim(), newName: newName.trim() },
      projectPath
    );
    setRenaming(false);
    if (!res.ok) {
      setError(res.error || t('No se pudo renombrar', 'Could not rename'));
      return;
    }
    setRename(res.data ?? null);
  };

  const renameErrors = (rename?.files ?? []).reduce(
    (total, f) => total + (f.diagnostics ?? []).filter((d) => d.severity === 'error').length,
    0
  );
  const applyable = (rename?.files ?? []).filter((f) => f.changed && f.content !== undefined);

  const handleApplyRename = async () => {
    if (applyable.length === 0 || renameErrors > 0) return;
    setApplying(true);
    setError('');
    for (const file of applyable) {
      const res = await writeProjectFile(file.path, file.content as string, projectPath);
      if (!res.ok) {
        setApplying(false);
        setError(`${file.path}: ${res.error || t('no se pudo escribir', 'could not write')}`);
        return;
      }
    }
    setApplying(false);
    setRename(null);
    setSymbol('');
    setNewName('');
    onFileChanged?.(path);
    void analyze();
  };

  const renderDiff = (diff: string) => (
    <pre className="bg-black/60 text-[10px] text-white p-2 overflow-x-auto max-h-52 overflow-y-auto whitespace-pre">
      {diff.split('\n').slice(0, DIFF_PREVIEW_LINES).join('\n')}
    </pre>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-black border border-white/40 p-3 w-full max-w-3xl max-h-[85vh] overflow-y-auto font-mono">
        <div className="flex items-center justify-between mb-2">
          <div className="text-yellow-300 text-sm font-bold">
            {t('Revisar archivo', 'Review file')} <span className="text-white/60">{path}</span>
          </div>
          <button onClick={onClose} className="nc-button text-xs px-2 py-0.5" data-testid="review-close">
            {t('Cerrar', 'Close')}
          </button>
        </div>

        {error && <div className="text-red-300 text-[11px] mb-2">{error}</div>}

        {/* ── Análisis ── */}
        <div className="mb-3">
          <div className="text-cyan-300 text-[11px] font-bold mb-1">{t('ANÁLISIS', 'ANALYSIS')}</div>
          {loading && <div className="text-white/60 text-[10px]">{t('Analizando…', 'Analyzing…')}</div>}
          {!loading && analysis && (
            <>
              <div className="text-[10px] text-white/80 mb-1">
                {analysis.errorCount} {t('errores', 'errors')} · {analysis.warningCount} {t('avisos', 'warnings')} ·{' '}
                {analysis.unusedImports.length} {t('imports sin usar', 'unused imports')} · {analysis.rules.length}{' '}
                {t('reglas', 'rules')}
              </div>
              {analysis.note && <div className="text-white/50 text-[10px] mb-1">{analysis.note}</div>}
              <ul className="text-[10px] space-y-0.5 mb-1">
                {analysis.diagnostics.slice(0, MAX_LIST).map((d, i) => (
                  <li key={`d-${i}`} className={d.severity === 'error' ? 'text-red-300' : 'text-yellow-300'}>
                    {d.line}:{d.column} {d.code} · {d.message}
                  </li>
                ))}
                {analysis.unusedImports.slice(0, MAX_LIST).map((u, i) => (
                  <li key={`u-${i}`} className="text-white/70">
                    {u.line}:{u.column} {t('import sin usar', 'unused import')} · {u.name} ({u.module})
                  </li>
                ))}
                {analysis.rules.slice(0, MAX_LIST).map((r, i) => (
                  <li key={`r-${i}`} className="text-orange-300">
                    {r.line} · {r.rule} · {r.message} «{r.excerpt}»
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* ── Formatear y lintar ── */}
        <div className="mb-3">
          <div className="text-cyan-300 text-[11px] font-bold mb-1">{t('FORMATO Y LINT', 'FORMAT & LINT')}</div>
          <button
            onClick={handleFix}
            disabled={fixing}
            className="nc-button text-[10px] px-2 py-0.5"
            data-testid="review-fix"
          >
            {fixing ? t('Aplicando…', 'Applying…') : t('ESLINT + PRETTIER', 'ESLINT + PRETTIER')}
          </button>
          {fixed.length > 0 && (
            <div className="mt-1">
              <div className="text-white/70 text-[10px] mb-1">
                {t('Cambios aplicados en', 'Changes applied to')} {fixed.map((f) => f.path).join(', ')}
              </div>
              {fixed.map((f) => (
                <div key={f.path} className="mb-1">
                  {renderDiff(f.diff)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Renombrar ── */}
        <div>
          <div className="text-cyan-300 text-[11px] font-bold mb-1">{t('RENOMBRAR SÍMBOLO', 'RENAME SYMBOL')}</div>
          <div className="flex flex-wrap items-center gap-1 mb-1">
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder={t('símbolo', 'symbol')}
              spellCheck={false}
              className="bg-black/60 border border-white/30 text-white text-[10px] px-2 py-0.5 min-w-[140px] outline-none"
              data-testid="review-symbol"
            />
            <span className="text-white/50 text-[10px]">→</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('nombre nuevo', 'new name')}
              spellCheck={false}
              className="bg-black/60 border border-white/30 text-white text-[10px] px-2 py-0.5 min-w-[140px] outline-none"
              data-testid="review-new-name"
            />
            <button
              onClick={handlePlanRename}
              disabled={renaming || !symbol.trim() || !newName.trim()}
              className="nc-button text-[10px] px-2 py-0.5 disabled:opacity-40"
              data-testid="review-plan-rename"
            >
              {renaming ? t('Calculando…', 'Computing…') : t('PROPONER', 'PLAN')}
            </button>
          </div>

          {rename && (
            <div>
              <div className="text-white/70 text-[10px] mb-1">
                {rename.locations} {t('posiciones en', 'locations in')} {rename.files.length}{' '}
                {t('archivos', 'files')}
                {renameErrors > 0 && (
                  <span className="text-red-300">
                    {' '}
                    · {renameErrors} {t('errores de tipos: no se aplica', 'type errors: not applied')}
                  </span>
                )}
              </div>
              {rename.files
                .filter((f) => f.changed)
                .map((f) => (
                  <div key={f.path} className="mb-1">
                    <div className="text-white text-[10px]">
                      {f.path} <span className="text-green-300">+{f.additions}</span>{' '}
                      <span className="text-red-300">-{f.deletions}</span>
                    </div>
                    {renderDiff(f.diff)}
                  </div>
                ))}
              <div className="flex gap-2 justify-end mt-1">
                <button onClick={() => setRename(null)} className="nc-button text-[10px] px-2 py-0.5">
                  {t('Descartar', 'Discard')}
                </button>
                <button
                  onClick={handleApplyRename}
                  disabled={applying || renameErrors > 0 || applyable.length === 0}
                  className="nc-button text-[10px] px-2 py-0.5 bg-yellow-300 text-black font-bold disabled:opacity-40"
                  data-testid="review-apply-rename"
                >
                  {applying ? t('Aplicando…', 'Applying…') : t('APLICAR', 'APPLY')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CodeReviewModal;
