import type { Language } from '../../i18n/translations';
/**
 * Buscador de código del proyecto (P0 #2).
 *
 * Búsqueda de contenido (líneas que coinciden) con debounce, agrupada por
 * archivo. Reutiliza el endpoint `/api/search/code`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, FileCode } from 'lucide-react';
import { searchCode, type CodeHit } from '../../utils/codeSearchApi';

interface CodeSearchViewProps {
  projectPath: string;
  lang?: Language;
}

export function CodeSearchView({ projectPath, lang = 'es' }: CodeSearchViewProps) {
  
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CodeHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [semantic, setSemantic] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  
  const run = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setError(null);
        setSemantic(false);
        return;
      }
      setLoading(true);
      const r = await searchCode(q, projectPath, 40);
      setResults(r.results);
      setError(r.error || null);
      setSemantic(r.semantic === true);
      setLoading(false);
    },
    [projectPath]
  );

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void run(query);
    }, 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, run]);

  return (
    <div className="flex flex-col h-full min-h-0 text-[11px] font-mono">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[#004466] shrink-0">
        <Search className="w-3.5 h-3.5 text-[#00ffff]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={lang === 'es' ? 'Buscar en el código' : lang === 'de' ? 'Code durchsuchen' : 'Search code'}
          placeholder={lang === 'es' ? 'Buscar en el código…' : lang === 'de' ? 'Code durchsuchen…' : 'Search code…'}
          className="flex-1 min-w-0 bg-[#000022] border border-[#004466] text-[#00ffff] px-2 py-1 outline-none focus:border-[#00ffff]"
        />
        {semantic && (
          <span
            className="shrink-0 text-[9px] font-bold text-black bg-[#00ff66] px-1.5 py-0.5 border border-[#00ff66] rounded-sm"
            title={lang === 'es' ? 'Búsqueda re-ordenada con embeddings (semántico)' : lang === 'de' ? 'Ergebnisse mit Embeddings neu sortiert (semantisch)' : 'Results re-ranked with embeddings (semantic)'}
          >
            SEMÁNTICO
          </span>
        )}
      </div>

      {error && <div className="px-2 py-1 text-red-300 border-b border-[#004466] shrink-0">{error}</div>}

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {loading && <div className="text-[#00ffff]">{lang === 'es' ? 'Buscando…' : lang === 'de' ? 'Suche läuft…' : 'Searching…'}</div>}

        {!loading && !query.trim() && (
          <div className="text-white/60 leading-relaxed">
            {lang === 'es' ? 'Escribe para buscar coincidencias en todo el proyecto.'
              : lang === 'de'
                ? 'Tippe, um Übereinstimmungen im gesamten Projekt zu suchen.'
                : 'Type to search matches across the whole project.'}
          </div>
        )}

        {!loading && query.trim() && results.length === 0 && (
          <div className="text-white/60">{lang === 'es' ? 'Sin coincidencias.' : lang === 'de' ? 'Keine Treffer.' : 'No matches.'}</div>
        )}

        {!loading &&
          results.map((hit) => (
            <div key={hit.path} className="border border-[#004466] bg-[#000022]">
              <div className="flex items-center gap-1 px-1.5 py-1 bg-[#000044] text-[#ffff55]">
                <FileCode className="w-3 h-3 shrink-0" />
                <span className="truncate" title={hit.path}>
                  {hit.path}
                </span>
                <span className="ml-auto text-[9px] text-[#00ffff]">{hit.matches.length}</span>
              </div>
              <div className="divide-y divide-[#002233]">
                {hit.matches.map((m, i) => (
                  <div key={i} className="flex gap-2 px-1.5 py-0.5">
                    <span className="text-[#00aaaa] shrink-0 w-8 text-right">{m.line}</span>
                    <span className="nc-x-scroll nc-x-nowrap whitespace-pre text-white/85">{m.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
