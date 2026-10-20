import type { Language } from '../../i18n/translations';
/**
 * ProblemsView â€” panel agregado de diagnÃ³sticos del language server.
 *
 * Muestra todos los archivos con problemas (errores/avisos/info) y permite
 * saltar a la lÃ­nea exacta. Al hacer click se emite `commander:open-location`,
 * que el Workbench traduce en "abre el archivo y posiciona el cursor".
 */
import React, { useMemo } from 'react';
import { AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import {
  useLspProblems,
  useLspProblemCounts,
  normalizeProblemPath,
  type LspProblem,
} from '../../utils/lspProblems';

interface ProblemsViewProps {
  projectPath: string;
  lang?: Language;
}

/** Convierte una ruta absoluta normalizada en ruta relativa al proyecto. */
function toRelative(absPath: string, root: string): string {
  const p = normalizeProblemPath(absPath);
  const r = normalizeProblemPath(root);
  if (r && p.startsWith(r + '/')) return p.slice(r.length + 1);
  if (r && p === r) return '.';
  return p;
}

const SEV = {
  1: { Icon: AlertCircle, cls: 'text-[#ff5555]', label: 'Error' },
  2: { Icon: AlertTriangle, cls: 'text-[#ffff55]', label: 'Aviso' },
  3: { Icon: Info, cls: 'text-[#00ffff]', label: 'Info' },
} as const;

function severityOf(severity: number) {
  return severity === 1 || severity === 2 ? SEV[severity as 1 | 2] : SEV[3];
}

export const ProblemsView: React.FC<ProblemsViewProps> = ({ projectPath, lang = 'es' }) => {
  
  
  const groups = useLspProblems();
  const counts = useLspProblemCounts();

  const open = (problem: LspProblem) => {
    window.dispatchEvent(
      new CustomEvent('commander:open-location', {
        detail: {
          path: toRelative(problem.path, projectPath),
          line: problem.line,
          character: problem.character,
        },
      })
    );
  };

  const header = useMemo(
    () => (
      <div className="flex items-center gap-2 px-2 py-1.5 bg-[#000080] border-b border-[#00ffff]/40 shrink-0 text-[10px]">
        <span className="text-[#ff5555] font-bold">{counts.error} âœ•</span>
        <span className="text-[#ffff55] font-bold">{counts.warning} âš </span>
        <span className="text-[#00ffff] font-bold">{counts.info} â„¹</span>
        <span className="ml-auto text-[#00ffff]/50">{counts.total} {lang === 'es' ? 'total' : lang === 'de' ? 'gesamt' : 'total'}</span>
      </div>
    ),
    [counts, lang]
  );

  return (
    <div className="h-full min-h-0 flex flex-col font-mono text-[11px] bg-[#000014]">
      {header}
      <div className="flex-1 min-h-0 overflow-auto">
        {groups.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[#88ff88]">
            <CheckCircle2 className="w-4 h-4" />
            {lang === 'es' ? 'Sin problemas' : lang === 'de' ? 'Keine Probleme' : 'No problems'}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.path} className="border-b border-[#004466]/40">
              <div className="sticky top-0 px-2 py-1 bg-[#000033] text-[#00ffff] truncate">
                {toRelative(group.path, projectPath)} ({group.problems.length})
              </div>
              <ul>
                {group.problems.map((p, i) => {
                  const { Icon, cls } = severityOf(p.severity);
                  return (
                    <li key={`${p.line}-${p.character}-${i}`}>
                      <button
                        type="button"
                        onClick={() => open(p)}
                        className="w-full text-left px-3 py-1 flex items-start gap-2 hover:bg-[#00ffff]/10"
                      >
                        <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cls}`} />
                        <span className="text-[#c8c8c8] break-words">{p.message}</span>
                        <span className="ml-auto shrink-0 text-[#00ffff]/50">
                          {p.line + 1}:{p.character + 1}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ProblemsView;
