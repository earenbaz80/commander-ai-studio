/**
 * Paleta de comandos (estilo VS Code) para Commander AI Studio.
 *
 * - Se abre con Ctrl/Cmd+K (gestionado en App) o desde el botón del Header.
 * - Filtra comandos por nombre/grupo/palabras clave (insensible a acentos).
 * - Navegación con ↑/↓, ejecución con ↵, cierre con Escape.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, X } from 'lucide-react';
import { Language } from '../i18n/translations';
import { rankCommands } from './paletteSearch';

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  /** Texto corto a la derecha (p. ej. atajo o marca de modo activo). */
  hint?: string;
  /** Términos extra para la búsqueda. */
  keywords?: string;
  icon?: React.ReactNode;
  run: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandItem[];
  lang?: Language;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  commands,
  lang = 'es',
}) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => rankCommands(commands, query), [commands, query]);

  // Al abrir: limpiar y enfocar el buscador.
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActive(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [isOpen]);

  // Escape cierra desde cualquier foco. El manejador del input sólo cubre el
  // caso normal: si el foco se fue a la lista, al pie o al fondo, la paleta se
  // quedaba abierta y el atajo parecía muerto.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Mantener el índice activo dentro de rango.
  useEffect(() => {
    if (active >= filtered.length) {
      setActive(filtered.length > 0 ? filtered.length - 1 : 0);
    }
  }, [filtered, active]);

  // Desplazar el elemento activo a la vista.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, filtered]);

  if (!isOpen) return null;

  const runAt = (index: number) => {
    const cmd = filtered[index];
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (filtered.length ? (i + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(active);
    }
  };

  // Agrupar preservando el orden de aparición.
  const groups: { name: string; items: { cmd: CommandItem; index: number }[] }[] = [];
  filtered.forEach((cmd, index) => {
    let g = groups.find((x) => x.name === cmd.group);
    if (!g) {
      g = { name: cmd.group, items: [] };
      groups.push(g);
    }
    g.items.push({ cmd, index });
  });

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-start justify-center pt-[12vh] bg-black/60"
      data-command-palette
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[min(92vw,600px)] nc-panel border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] shadow-2xl">
        {/* Buscador */}
        <div className="flex items-center gap-2 px-3 py-2 border-b-2 border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)]">
          <Search className="w-4 h-4 text-[var(--nc-text)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={lang === 'es' ? 'Busca comandos, archivos, sesiones, tools o agentes…' : lang === 'de' ? 'Befehle, Dateien, Sitzungen, Tools oder Agenten suchen…' : 'Search commands, files, sessions, tools or agents…'}
            aria-label={lang === 'es' ? 'Paleta de comandos' : lang === 'de' ? 'Befehlspalette' : 'Command palette'}
            className="flex-1 bg-transparent text-white placeholder-gray-400 outline-none text-sm font-mono"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'es' ? 'Cerrar paleta' : lang === 'de' ? 'Palette schließen' : 'Close palette'}
            className="text-gray-300 hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Lista de comandos */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1" role="listbox">
          {groups.length === 0 && (
            <div className="px-3 py-4 text-center text-gray-400 text-xs font-mono">
              {lang === 'es' ? 'Sin coincidencias' : lang === 'de' ? 'Keine Treffer' : 'No matches'}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.name} className="mb-1" role="group" aria-label={group.name}>
              <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-[var(--nc-text-accent)] uppercase tracking-wider">
                {group.name}
              </div>
              {group.items.map(({ cmd, index }) => (
                <button
                  key={cmd.id}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active ? 'true' : undefined}
                  data-command-id={cmd.id}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => runAt(index)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono border-l-2 ${
                    index === active
                      ? 'bg-[var(--nc-highlight-bg)] text-black border-[var(--nc-text-accent)]'
                      : 'text-white border-transparent hover:bg-[var(--nc-bg-hover)]'
                  }`}
                >
                  {cmd.icon && <span className="shrink-0 flex items-center">{cmd.icon}</span>}
                  <span className="flex-1 truncate">{cmd.label}</span>
                  {cmd.hint && (
                    <span
                      className={`text-[10px] shrink-0 ${
                        index === active ? 'text-black/70' : 'text-[var(--nc-text)]'
                      }`}
                    >
                      {cmd.hint}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Pie con ayuda de teclado */}
        <div className="flex items-center justify-between px-3 py-1.5 border-t-2 border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] text-[10px] font-mono text-gray-300">
          <span>↑↓ {lang === 'es' ? 'navegar' : lang === 'de' ? 'navigieren' : 'navigate'} · ↵ {lang === 'es' ? 'ejecutar' : lang === 'de' ? 'ausführen' : 'run'} · Esc {lang === 'es' ? 'cerrar' : lang === 'de' ? 'schließen' : 'close'}</span>
          <span className="flex items-center gap-1 text-[var(--nc-text)]">
            <CornerDownLeft className="w-3 h-3" /> Ctrl+K
          </span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
