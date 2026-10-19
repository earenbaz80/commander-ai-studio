import type { Language } from '../i18n/translations';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  RotateCcw,
  Clock,
  X,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Terminal,
  Search,
  Download,
  Upload,
} from 'lucide-react';

export interface Checkpoint {
  id: string;
  timestamp: number;
  label: string;
  stepsCount: number;
  toolsUsed: string[];
  gitStatus: 'clean' | 'dirty' | 'conflict';
  size: number;
  description?: string;
}

export interface RollbackState {
  checkpoints: Checkpoint[];
  currentIndex: number;
  isPlaying: boolean;
  playbackSpeed: number;
  selectedRange: [number, number] | null;
  filter: 'all' | 'tools' | 'git' | 'errors';
  searchQuery: string;
}

interface RollbackTimelineProps {
  checkpoints: Checkpoint[];
  currentIndex: number;
  onRollbackTo: (index: number) => Promise<void>;
  onCompare: (fromIndex: number, toIndex: number) => void;
  onExport: (checkpoints: Checkpoint[]) => void;
  onImport: (file: File) => Promise<void>;
  isRollingBack: boolean;
  lang: Language;
}

const TimelineItem: React.FC<{
  checkpoint: Checkpoint;
  index: number;
  isCurrent: boolean;
  lang: Language;
  isRollingBack: boolean;
  onRollbackTo: (index: number) => void;
}> = ({ checkpoint, index, isCurrent, lang, isRollingBack, onRollbackTo }) => {
  const getGitStatusColor = (status: string) => {
    switch (status) {
      case 'clean': return 'text-[#88ff88]';
      case 'dirty': return 'text-[#ffff55]';
      case 'conflict': return 'text-[#ff5555]';
      default: return 'text-white/60';
    }
  };

  const gitStatusIcon = (status: string) => {
    switch (status) {
      case 'clean': return <CheckCircle className="w-3 h-3" />;
      case 'dirty': return <AlertTriangle className="w-3 h-3" />;
      case 'conflict': return <XCircle className="w-3 h-3" />;
      default: return <Terminal className="w-3 h-3" />;
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString(lang, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(lang, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  return (
    <div className={`relative group flex flex-col p-3 bg-[#000040] border rounded transition-all duration-200 ${
      isCurrent ? 'border-[#00ffff] bg-[#000080]/20' : 
      'border-[#00ffff]/20 hover:border-[#00ffff]/40'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono text-[#00ffff]/60 font-bold">
              #{index}
            </span>
            <span className="text-[11px] text-white font-bold truncate">
              {checkpoint.label}
            </span>
            <span className="text-[10px] text-[#00ffff]/60">
              {formatTime(checkpoint.timestamp)}
            </span>
            <span className="text-[10px] text-[#00ffff]/40">
              {formatDate(checkpoint.timestamp)}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-[10px] text-white/70">
              {checkpoint.stepsCount} steps
            </span>
            <span className="text-[10px] text-white/70">
              {checkpoint.toolsUsed.length} tools
            </span>
            <span className={`flex items-center gap-1 text-[10px] ${getGitStatusColor(checkpoint.gitStatus)}`}>
              {gitStatusIcon(checkpoint.gitStatus)}
              {checkpoint.gitStatus}
            </span>
          </div>

          {checkpoint.description && (
            <p className="text-[10px] text-white/60 mt-1 truncate">
              {checkpoint.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRollbackTo(index);
            }}
            disabled={isRollingBack || isCurrent}
            className="nc-button text-[10px] px-2 py-1 flex items-center gap-1 disabled:opacity-40"
            title={isCurrent
              ? (lang === 'es' ? 'Punto actual' : lang === 'de' ? 'Aktueller Punkt' : 'Current point')
              : (lang === 'es' ? 'Restaurar aquí' : lang === 'de' ? 'Hier zurücksetzen' : 'Rollback here')}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{lang === 'es' ? 'Restaurar' : lang === 'de' ? 'Zurücksetzen' : 'Rollback'}</span>
          </button>
        </div>
      </div>

      <div className="hidden group-hover:block mt-3 pt-3 border-t border-[#00ffff]/10">
        <div className="grid grid-cols-2 gap-4 text-[10px]">
          <div>
            <span className="text-[#00ffff]/60">{lang === 'es' ? 'Tamaño:' : lang === 'de' ? 'Größe:' : 'Size:'}</span>
            <span className="ml-1 font-mono">{formatBytes(checkpoint.size)}</span>
          </div>
          <div>
            <span className="text-[#00ffff]/60">{lang === 'es' ? 'Herramientas:' : lang === 'de' ? 'Tools:' : 'Tools:'}</span>
            <span className="ml-1 font-mono">
              {checkpoint.toolsUsed.length ? checkpoint.toolsUsed.join(', ') : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const RollbackTimeline: React.FC<RollbackTimelineProps> = ({
  checkpoints,
  currentIndex,
  onRollbackTo,
  onCompare,
  onExport,
  onImport,
  isRollingBack,
  lang,
}) => {
  const [state, setState] = useState({
    isPlaying: false,
    playbackSpeed: 1,
    selectedRange: null as [number, number] | null,
    filter: 'all' as 'all' | 'tools' | 'git' | 'errors',
    searchQuery: '',
  });

  const t = {
    checkpoints: lang === 'es' ? 'Puntos de Control' : lang === 'de' ? 'Checkpoints' : 'Checkpoints',
    current: lang === 'es' ? 'Actual' : lang === 'de' ? 'Aktuell' : 'Current',
    compare: lang === 'es' ? 'Comparar' : lang === 'de' ? 'Vergleichen' : 'Compare',
    export: lang === 'es' ? 'Exportar' : lang === 'de' ? 'Exportieren' : 'Export',
    import: lang === 'es' ? 'Importar' : lang === 'de' ? 'Importieren' : 'Import',
    play: lang === 'es' ? 'Reproducir' : lang === 'de' ? 'Abspielen' : 'Play',
    pause: lang === 'es' ? 'Pausar' : lang === 'de' ? 'Pause' : 'Pause',
    speed: lang === 'es' ? 'Velocidad' : lang === 'de' ? 'Geschwindigkeit' : 'Speed',
    filter: lang === 'es' ? 'Filtrar' : lang === 'de' ? 'Filter' : 'Filter',
    search: lang === 'es' ? 'Buscar...' : lang === 'de' ? 'Suchen...' : 'Search...',
    noCheckpoints: lang === 'es' ? 'Sin puntos de control' : lang === 'de' ? 'Keine Checkpoints' : 'No checkpoints',
    noCheckpointsHint: lang === 'es'
      ? 'Ejecuta el agente para crear puntos de control'
      : lang === 'de' ? 'Führe den Agenten aus, um Checkpoints zu erstellen' : 'Run the agent to create checkpoints',
    rollingBack: lang === 'es' ? 'Restaurando...' : lang === 'de' ? 'Wird zurückgesetzt...' : 'Rolling back...',
    confirm: lang === 'es'
      ? '¿Seguro que quieres restaurar a este punto?'
      : lang === 'de' ? 'Möchtest du wirklich zu diesem Punkt zurücksetzen?' : 'Are you sure you want to rollback to this point?',
    compareMode: lang === 'es' ? 'Modo comparación' : lang === 'de' ? 'Vergleichsmodus' : 'Compare mode',
    clearSelection: lang === 'es' ? 'Limpiar selección' : lang === 'de' ? 'Auswahl aufheben' : 'Clear selection',
    selectionHint: lang === 'es'
      ? 'Pulsa Mayús+clic para seleccionar un rango'
      : lang === 'de' ? 'Umschalt+Klick, um einen Bereich auszuwählen' : 'Shift+click to select a range',
  };

  const filteredCheckpoints = useMemo(() => {
    let filtered = [...checkpoints];

    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(cp =>
        cp.label.toLowerCase().includes(query) ||
        cp.toolsUsed.some(name => name.toLowerCase().includes(query)) ||
        (cp.description || '').toLowerCase().includes(query)
      );
    }

    if (state.filter !== 'all') {
      filtered = filtered.filter(cp => {
        switch (state.filter) {
          case 'tools':
            return cp.toolsUsed.length > 0;
          case 'git':
            return cp.gitStatus !== 'clean';
          case 'errors':
            return cp.gitStatus === 'conflict';
          default:
            return true;
        }
      });
    }

    return filtered;
  }, [checkpoints, state.searchQuery, state.filter]);

  // --- Reproducción automática (time-travel playback) ---
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!state.isPlaying || checkpoints.length === 0) return;
    timerRef.current = setInterval(() => {
      setState(prev => {
        if (prev.isPlaying && currentIndex < checkpoints.length - 1) {
          onRollbackTo(currentIndex + 1).catch(() => { /* best-effort */ });
          return prev;
        }
        return { ...prev, isPlaying: false };
      });
    }, 1000 / state.playbackSpeed);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state.isPlaying, state.playbackSpeed, checkpoints.length, currentIndex, onRollbackTo]);

  const handleRollbackTo = async (index: number) => {
    if (window.confirm(t.confirm)) {
      await onRollbackTo(index);
    }
  };

  const handlePlayPause = () => {
    setState(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
  };

  const handleSpeedChange = (speed: number) => {
    setState(prev => ({ ...prev, playbackSpeed: speed }));
  };

  /** Selección de rango: clic normal = uno, Mayús+clic = rango. */
  const handleCheckpointClick = (index: number, shiftKey: boolean) => {
    if (!shiftKey) {
      setState(prev => ({ ...prev, selectedRange: [index, index] }));
      return;
    }
    setState(prev => {
      const anchor = prev.selectedRange ? prev.selectedRange[0] : index;
      return { ...prev, selectedRange: [anchor, index] };
    });
  };

  const handleCompare = () => {
    if (state.selectedRange) {
      onCompare(state.selectedRange[0], state.selectedRange[1]);
    }
  };

  const handleExport = () => {
    onExport(checkpoints);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImport(file);
    }
  };

  const inSelectedRange = (index: number) =>
    !!state.selectedRange &&
    index >= state.selectedRange[0] &&
    index <= state.selectedRange[1];

  const selectAll = (
    <button
      type="button"
      onClick={() => setState(prev => ({ ...prev, selectedRange: [0, checkpoints.length - 1] }))}
      className="text-[10px] text-[#00ffff]/70 hover:text-[#00ffff] underline"
    >
      {lang === 'es' ? 'Seleccionar todo' : lang === 'de' ? 'Alle auswählen' : 'Select all'}
    </button>
  );

  return (
    <div className="flex flex-col h-full bg-[#000030] border-l-2 border-[#00ffff]/20 overflow-hidden">
      <div className="p-3 border-b-2 border-[#00ffff]/20 bg-[#000040] shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#ffff55]" />
            <span className="text-[#ffff55] font-bold text-sm">{t.checkpoints}</span>
            <span className="text-[#00ffff] text-xs px-2 py-0.5 bg-[#000040] rounded">
              {checkpoints.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              className="nc-button text-xs px-2 py-1 flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t.export}</span>
            </button>
            <input
              type="file"
              accept=".json"
              onChange={handleFileImport}
              className="hidden"
              id="timeline-import"
            />
            <label htmlFor="timeline-import" className="nc-button text-xs px-2 py-1 flex items-center gap-1 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>{t.import}</span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onRollbackTo(Math.max(0, currentIndex - 1))}
              disabled={isRollingBack || currentIndex <= 0}
              className="nc-button text-xs px-2 py-1 flex items-center gap-1 disabled:opacity-40"
              title={lang === 'es' ? 'Anterior' : lang === 'de' ? 'Zurück' : 'Previous'}
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handlePlayPause}
              disabled={isRollingBack || checkpoints.length === 0}
              className="nc-button px-3 py-1 flex items-center gap-1 disabled:opacity-40"
              title={state.isPlaying ? t.pause : t.play}
            >
              {state.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => onRollbackTo(Math.min(checkpoints.length - 1, currentIndex + 1))}
              disabled={isRollingBack || currentIndex >= checkpoints.length - 1}
              className="nc-button text-xs px-2 py-1 flex items-center gap-1 disabled:opacity-40"
              title={lang === 'es' ? 'Siguiente' : lang === 'de' ? 'Weiter' : 'Next'}
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#00ffff]/60">{t.speed}:</span>
            <select
              value={state.playbackSpeed}
              onChange={(e) => handleSpeedChange(Number(e.target.value))}
              className="bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-1 text-[10px] font-mono outline-none"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[10px] text-[#00ffff]/60">{t.filter}:</span>
            <select
              value={state.filter}
              onChange={(e) => setState(prev => ({ ...prev, filter: e.target.value as typeof prev.filter }))}
              className="bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-1 text-[10px] font-mono outline-none"
            >
              <option value="all">{lang === 'es' ? 'Todo' : lang === 'de' ? 'Alle' : 'All'}</option>
              <option value="tools">{lang === 'es' ? 'Herramientas' : lang === 'de' ? 'Tools' : 'Tools'}</option>
              <option value="git">Git</option>
              <option value="errors">{lang === 'es' ? 'Errores' : lang === 'de' ? 'Fehler' : 'Errors'}</option>
            </select>
          </div>
        </div>

        <div className="mt-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#00ffff]/40" />
            <input
              type="text"
              placeholder={t.search}
              value={state.searchQuery}
              onChange={(e) => setState(prev => ({ ...prev, searchQuery: e.target.value }))}
              className="w-full bg-[#000045] text-white border border-[#00ffff]/50 px-8 py-1.5 text-xs font-mono outline-none pl-8"
            />
          </div>
          {checkpoints.length > 0 && (
            <div className="flex items-center gap-2 mt-1 text-[10px] text-[#00ffff]/50">
              <span>{t.selectionHint}</span>
              {selectAll}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {checkpoints.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-[#00ffff]/50">
            <Clock className="w-12 h-12 mb-2 text-[#00ffff]/30" />
            <p className="text-xs">{t.noCheckpoints}</p>
            <p className="text-[10px] text-[#00ffff]/30 mt-1">{t.noCheckpointsHint}</p>
          </div>
        ) : filteredCheckpoints.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-[#00ffff]/50">
            <Search className="w-12 h-12 mb-2 text-[#00ffff]/30" />
            <p className="text-xs">{t.noCheckpoints}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredCheckpoints.map((checkpoint, index) => (
              <div
                key={checkpoint.id}
                onClick={(e) => handleCheckpointClick(index, e.shiftKey)}
                className={`cursor-pointer ${inSelectedRange(index) ? 'ring-1 ring-[#ffff55]' : ''}`}
              >
                <TimelineItem
                  checkpoint={checkpoint}
                  index={index}
                  isCurrent={checkpoints.indexOf(checkpoint) === currentIndex}
                  lang={lang}
                  isRollingBack={isRollingBack}
                  onRollbackTo={handleRollbackTo}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {state.selectedRange && (
        <div className="p-3 border-t-2 border-[#ffff55] bg-[#000040] shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-[#ffff55] font-bold text-xs">
              {t.compareMode}: {state.selectedRange[0]} → {state.selectedRange[1]}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCompare}
                disabled={state.selectedRange[0] === state.selectedRange[1]}
                className="nc-button text-xs px-2 py-1 flex items-center gap-1 disabled:opacity-40"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t.compare}</span>
              </button>
              <button
                type="button"
                onClick={() => setState(prev => ({ ...prev, selectedRange: null }))}
                className="nc-button text-xs px-2 py-1 text-red-400"
              >
                <X className="w-3.5 h-3.5" />
                <span>{t.clearSelection}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {isRollingBack && (
        <div className="px-3 py-1 text-[10px] text-[#ffff55] bg-[#000040] border-t border-[#ffff55]/40">
          {t.rollingBack}
        </div>
      )}
    </div>
  );
};

export default RollbackTimeline;
