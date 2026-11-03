import React, { useEffect, useRef } from 'react';
import { filterMentions, MentionItem } from '../data/contextMentions';
import { FileCode, BookOpen, Sliders, GitBranch, Sparkles } from 'lucide-react';

interface MentionAutocompleteProps {
  query: string;
  onSelect: (item: MentionItem) => void;
  onClose: () => void;
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  className?: string;
  /** Archivos reales del proyecto para el picker dinámico. */
  extraItems?: MentionItem[];
  /** Mientras se buscan archivos reales. */
  loading?: boolean;
}

export const MentionAutocomplete: React.FC<MentionAutocompleteProps> = ({
  query,
  onSelect,
  selectedIndex,
  setSelectedIndex,
  className = '',
  extraItems,
  loading = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredItems = React.useMemo(
    () => filterMentions(query, extraItems),
    [query, extraItems]
  );

  // Keep selected index within bounds
  useEffect(() => {
    if (selectedIndex >= filteredItems.length) {
      setSelectedIndex(Math.max(0, filteredItems.length - 1));
    }
  }, [filteredItems.length, selectedIndex, setSelectedIndex]);

  // Scroll active item into view
  useEffect(() => {
    const activeEl = containerRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (filteredItems.length === 0) {
    return (
      <div className={`absolute bottom-full mb-2 left-0 w-80 bg-[var(--nc-bg-panel)] border-2 border-[var(--nc-border-light)] p-2 shadow-2xl z-50 font-mono text-xs text-[var(--nc-text-accent)] ${className}`}>
        <div className="flex items-center gap-1 text-[11px] text-[var(--nc-text-dim)]">
          <Sparkles className="w-3.5 h-3.5" />
          <span>
            {loading
              ? 'Buscando archivos…'
              : <>No se encontraron menciones para &quot;{query}&quot;</>}
          </span>
        </div>
      </div>
    );
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'file':
        return <FileCode className="w-3.5 h-3.5 text-[var(--nc-text)] shrink-0" />;
      case 'doc':
        return <BookOpen className="w-3.5 h-3.5 text-[var(--nc-text-accent)] shrink-0" />;
      case 'param':
        return <Sliders className="w-3.5 h-3.5 text-[#ff77ff] shrink-0" />;
      case 'git':
        return <GitBranch className="w-3.5 h-3.5 text-[var(--nc-success)] shrink-0" />;
      default:
        return <Sparkles className="w-3.5 h-3.5 text-[var(--nc-text)] shrink-0" />;
    }
  };

  const getBadgeStyle = (category: string) => {
    switch (category) {
      case 'file':
        return 'bg-[var(--nc-bg-deep)] text-[var(--nc-text)] border-[var(--nc-border-light)]';
      case 'doc':
        return 'bg-[#555500] text-[var(--nc-text-accent)] border-[var(--nc-text-accent)]';
      case 'param':
        return 'bg-[#550055] text-[#ff77ff] border-[#ff77ff]';
      case 'git':
        return 'bg-[#004400] text-[var(--nc-success)] border-[var(--nc-success)]';
      default:
        return 'bg-[var(--nc-bg-deep)] text-white border-white';
    }
  };

  return (
    <div
      ref={containerRef}
      className={`absolute bottom-full mb-2 left-0 w-80 sm:w-96 max-h-64 bg-[var(--nc-bg-panel)] border-2 border-[var(--nc-border-light)] shadow-[4px_4px_0px_#000000] z-50 font-mono text-xs overflow-y-auto flex flex-col ${className}`}
    >
      <div className="bg-[var(--nc-header-bg)] text-black px-2 py-1 font-bold text-[10px] uppercase flex items-center justify-between border-b border-black shrink-0 sticky top-0 z-10">
        <span className="flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-black" />
          <span>CONTEXTO DINÁMICO (@FILES, @DOCS, @PARAMS, @GIT)</span>
        </span>
        <span className="text-[9px] text-[var(--nc-active-text)]">↑↓ NAVEGAR • ENTER SELECCIONAR</span>
      </div>

      <div className="p-1 space-y-0.5">
        {filteredItems.map((item, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <div
              key={item.id}
              data-index={idx}
              onMouseEnter={() => setSelectedIndex(idx)}
              onClick={() => onSelect(item)}
              className={`p-1.5 cursor-pointer border flex flex-col gap-0.5 transition-colors ${
                isSelected
                  ? 'bg-[var(--nc-highlight-bg)] text-black border-white font-bold'
                  : 'bg-[var(--nc-bg-main)] text-[var(--nc-text)] border-[var(--nc-border-dark)] hover:bg-[var(--nc-bg-hover)]'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 truncate">
                  {getCategoryIcon(item.category)}
                  <span className={`font-bold ${isSelected ? 'text-black' : 'text-[var(--nc-text-accent)]'}`}>
                    {item.label}
                  </span>
                </div>
                <span className={`text-[9px] px-1 font-bold border rounded-xs ${getBadgeStyle(item.category)}`}>
                  {item.badge}
                </span>
              </div>
              <p className={`text-[10px] truncate ${isSelected ? 'text-[var(--nc-active-text)]' : 'text-[var(--nc-text)]'}`}>
                {item.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
