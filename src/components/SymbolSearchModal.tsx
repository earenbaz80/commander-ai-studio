import type { Language } from '../i18n/translations';
/**
 * SymbolSearchModal — "Ir a símbolo del workspace" (LSP `workspace/symbol`).
 *
 * Busca símbolos en TODO el proyecto con el language server de TypeScript.
 * No está atado a un archivo: se apoya en la sesión LSP que ya inicializó el
 * editor (`useLSPClient`) y en el helper `searchWorkspaceSymbols`.
 *
 * Al elegir un resultado emite `commander:open-location`, el mismo evento que
 * usa el panel de Problemas, de modo que el Workbench abre el archivo y
 * posiciona el cursor.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Search, CornerDownLeft, X } from 'lucide-react';
import {
  searchWorkspaceSymbols,
  type LSPWorkspaceSymbol,
} from '../hooks/useLSPClient';
import { normalizeProblemPath } from '../utils/lspProblems';

interface SymbolSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Root del proyecto activo (para mostrar rutas relativas). */
  projectPath: string;
  lang?: Language;
}

/** Nombre legible del `SymbolKind` de LSP. */
const SYMBOL_KINDS = [
  'Archivo', 'Módulo', 'Namespace', 'Paquete', 'Clase', 'Método', 'Propiedad', 'Campo',
  'Constructor', 'Enum', 'Interfaz', 'Función', 'Variable', 'Constante', 'String', 'Número',
  'Booleano', 'Array', 'Objeto', 'Clave', 'Null', 'EnumMember', 'Struct', 'Evento',
  'Operador', 'TypeParameter',
];

const SYMBOL_KINDS_DE = [
  'Datei', 'Modul', 'Namespace', 'Paket', 'Klasse', 'Methode', 'Eigenschaft', 'Feld',
  'Konstruktor', 'Enum', 'Interface', 'Funktion', 'Variable', 'Konstante', 'String', 'Zahl',
  'Boolean', 'Array', 'Objekt', 'Schlüssel', 'Null', 'EnumMember', 'Struct', 'Ereignis',
  'Operator', 'TypeParameter',
];

function symbolKindName(kind: number, lang: Language = 'es'): string {
  const table = lang === 'de' ? SYMBOL_KINDS_DE : SYMBOL_KINDS;
  return table[kind] || (lang === 'de' ? 'Symbol' : 'Símbolo');
}

/** Convierte una ruta absoluta normalizada en ruta relativa al proyecto. */
function toRelative(absPath: string, root: string): string {
  const p = normalizeProblemPath(absPath);
  const r = normalizeProblemPath(root);
  if (r && p.startsWith(r + '/')) return p.slice(r.length + 1);
  if (r && p === r) return '.';
  return p;
}

export const SymbolSearchModal: React.FC<SymbolSearchModalProps> = ({
  isOpen,
  onClose,
  projectPath,
  lang = 'es',
}) => {
    const [query, setQuery] = useState('');
  const [items, setItems] = useState<LSPWorkspaceSymbol[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Al abrir: reiniciar y enfocar.
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setItems([]);
      setActive(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [isOpen]);

  // Búsqueda con debounce (evitamos saturar el language server al teclear).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    const handle = window.setTimeout(async () => {
      const result = await searchWorkspaceSymbols(query.trim());
      if (cancelled) return;
      setItems(result || []);
      setActive(0);
      setLoading(false);
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [isOpen, query]);

  // Mantener visible el resultado activo.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' });
  }, [active, items]);

  if (!isOpen) return null;

  const open = (sym: LSPWorkspaceSymbol) => {
    window.dispatchEvent(
      new CustomEvent('commander:open-location', {
        detail: {
          path: toRelative(normalizeProblemPath(sym.location.uri), projectPath),
          line: sym.location.range.start.line,
          character: sym.location.range.start.character,
        },
      })
    );
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(0, items.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sym = items[active];
      if (sym) open(sym);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-start justify-center pt-[12vh] bg-black/60"
      data-symbol-search
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[min(92vw,640px)] nc-panel border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] shadow-2xl">
        {/* Buscador */}
        <div className="flex items-center gap-2 px-3 py-2 border-b-2 border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)]">
          <Search className="w-4 h-4 text-[var(--nc-text)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              lang === 'es' ? 'Ir a símbolo del workspace…' : lang === 'de' ? 'Zu Symbol im Workspace springen…' : 'Go to symbol in workspace…'
            }
            aria-label={lang === 'es' ? 'Buscar símbolo en el workspace' : lang === 'de' ? 'Workspace-Symbol suchen' : 'Search workspace symbol'}
            className="flex-1 bg-transparent text-white placeholder-gray-400 outline-none text-sm font-mono"
          />
          {loading && <span className="text-[var(--nc-text-accent)] text-[10px] shrink-0">…</span>}
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'es' ? 'Cerrar búsqueda' : lang === 'de' ? 'Suche schließen' : 'Close search'}
            className="text-gray-300 hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Resultados */}
        <div ref={listRef} className="max-h-[56vh] overflow-y-auto py-1" role="listbox">
          {items.length === 0 && (
            <div className="px-3 py-4 text-center text-gray-400 text-xs font-mono">
              {loading
                ? lang === 'es' ? 'Buscando…'
                  : lang === 'de'
                    ? 'Suche läuft…'
                    : 'Searching…'
                : lang === 'es' ? 'Sin símbolos'
                  : lang === 'de'
                    ? 'Keine Symbole'
                    : 'No symbols'}
            </div>
          )}
          {items.map((sym, index) => (
            <button
              key={`${sym.location.uri}-${sym.name}-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              data-active={index === active ? 'true' : undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => open(sym)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono ${
                index === active ? 'bg-[var(--nc-highlight-bg)] text-black' : 'text-[var(--nc-text)] hover:bg-[var(--nc-highlight-bg)]/10'
              }`}
            >
              <span
                className={`shrink-0 px-1 rounded text-[10px] ${
                  index === active ? 'bg-black/20 text-black' : 'bg-[var(--nc-bg-deep)] text-[var(--nc-text)]'
                }`}
              >
                {symbolKindName(sym.kind, lang)}
              </span>
              <span className="font-bold truncate">{sym.name}</span>
              <span
                className={`ml-auto shrink-0 text-[10px] ${
                  index === active ? 'text-black/70' : 'text-[var(--nc-text)]/60'
                }`}
              >
                {toRelative(normalizeProblemPath(sym.location.uri), projectPath)}:
                {sym.location.range.start.line + 1}
              </span>
            </button>
          ))}
        </div>

        {/* Pie */}
        <div className="flex items-center justify-between px-3 py-1.5 border-t-2 border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] text-[10px] font-mono text-gray-300">
          <span>
            ↑↓ {lang === 'es' ? 'navegar' : lang === 'de' ? 'navigieren' : 'navigate'} · ↵ {lang === 'es' ? 'abrir' : lang === 'de' ? 'öffnen' : 'open'} · Esc{' '}
            {lang === 'es' ? 'cerrar' : lang === 'de' ? 'schließen' : 'close'}
          </span>
          <span className="flex items-center gap-1 text-[var(--nc-text)]">
            <CornerDownLeft className="w-3 h-3" /> Ctrl+P
          </span>
        </div>
      </div>
    </div>
  );
};

export default SymbolSearchModal;
