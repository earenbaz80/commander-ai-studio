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
      <div className={`absolute bottom-full mb-2 left-0 w-80 bg-[#000080] border-2 border-[#00ffff] p-2 shadow-2xl z-50 font-mono text-xs text-[#ffff55] ${className}`}>
        <div className="flex items-center gap-1 text-[11px] text-[#00aaaa]">
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
        return <FileCode className="w-3.5 h-3.5 text-[#00ffff] shrink-0" />;
      case 'doc':
        return <BookOpen className="w-3.5 h-3.5 text-[#ffff55] shrink-0" />;
      case 'param':
        return <Sliders className="w-3.5 h-3.5 text-[#ff77ff] shrink-0" />;
      case 'git':
        return <GitBranch className="w-3.5 h-3.5 text-[#55ff55] shrink-0" />;
      default:
        return <Sparkles className="w-3.5 h-3.5 text-[#00ffff] shrink-0" />;
    }
  };

  const getBadgeStyle = (category: string) => {
    switch (category) {
      case 'file':
        return 'bg-[#004466] text-[#00ffff] border-[#00ffff]';
      case 'doc':
        return 'bg-[#555500] text-[#ffff55] border-[#ffff55]';
      case 'param':
        return 'bg-[#550055] text-[#ff77ff] border-[#ff77ff]';
      case 'git':
        return 'bg-[#004400] text-[#55ff55] border-[#55ff55]';
      default:
        return 'bg-[#000055] text-white border-white';
    }
  };

  return (
    <div
      ref={containerRef}
      className={`absolute bottom-full mb-2 left-0 w-80 sm:w-96 max-h-64 bg-[#000080] border-2 border-[#00ffff] shadow-[4px_4px_0px_#000000] z-50 font-mono text-xs overflow-y-auto flex flex-col ${className}`}
    >
      <div className="bg-[#00aaaa] text-black px-2 py-1 font-bold text-[10px] uppercase flex items-center justify-between border-b border-black shrink-0 sticky top-0 z-10">
        <span className="flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-black" />
          <span>CONTEXTO DINÁMICO (@FILES, @DOCS, @PARAMS, @GIT)</span>
        </span>
        <span className="text-[9px] text-[#000080]">↑↓ NAVEGAR • ENTER SELECCIONAR</span>
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
                  ? 'bg-[#00ffff] text-black border-white font-bold'
                  : 'bg-[#0000aa] text-white border-[#000080] hover:bg-[#000066]'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 truncate">
                  {getCategoryIcon(item.category)}
                  <span className={`font-bold ${isSelected ? 'text-black' : 'text-[#ffff55]'}`}>
                    {item.label}
                  </span>
                </div>
                <span className={`text-[9px] px-1 font-bold border rounded-xs ${getBadgeStyle(item.category)}`}>
                  {item.badge}
                </span>
              </div>
              <p className={`text-[10px] truncate ${isSelected ? 'text-[#000080]' : 'text-[#a8c7fa]'}`}>
                {item.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
