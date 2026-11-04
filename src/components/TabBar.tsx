import React from 'react';
import { Plus, X, FolderPlus, FolderOpen, Trash2, Stethoscope, Loader2 } from 'lucide-react';
import type { WorkspaceTab } from '../hooks/useTabs';
import type { AgentRoot } from '../lib/agentProjects';
import type { Language } from '../i18n/translations';

interface TabBarProps {
  tabs: WorkspaceTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onNewTab: () => void;
  onRename: (id: string, title: string) => void;
  roots: AgentRoot[];
  onSelectProject: (path: string) => void;
  onAddDirectory: () => void;
  onCreateProject: () => void;
  onRemoveProject: (path: string) => void;
  onGeneralAudit: () => void;
  auditing?: boolean;
  /** La pestaña activa tiene un proyecto real: sin él no hay nada que auditar. */
  canAudit?: boolean;
  lang?: Language;
  isolateSessions?: boolean;
  onToggleIsolate?: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeId,
  onSelect,
  onClose,
  onCloseOthers,
  onNewTab,
  onRename,
  roots,
  onSelectProject,
  onAddDirectory,
  onCreateProject,
  onRemoveProject,
  onGeneralAudit,
  auditing,
  canAudit = true,
  lang = 'es',
  isolateSessions = false,
  onToggleIsolate,
}) => {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const commitRename = () => {
    if (editing && draft.trim()) onRename(editing, draft.trim());
    setEditing(null);
    setDraft('');
  };

  const active = tabs.find((t) => t.id === activeId);

  return (
    <div className="flex items-stretch gap-1 border-b-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-deep)] px-1 py-1 shrink-0 select-none">
      {/* Pestañas */}
      <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const isEditing = editing === tab.id;
          return (
            <div
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              onDoubleClick={() => { setEditing(tab.id); setDraft(tab.title); }}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(tab.id); } }}
              onContextMenu={(e) => { e.preventDefault(); onClose(tab.id); }}
              title={`${tab.title}\n${lang === 'es' ? 'Doble clic para renombrar · clic derecho para cerrar' : lang === 'de' ? 'Doppelklick zum Umbenennen · Rechtsklick zum Schließen' : 'Double-click to rename · right-click to close'}`}
              className={`group flex items-center gap-1.5 px-2.5 py-1 border text-[11px] font-mono cursor-pointer whitespace-nowrap transition-colors shrink-0 max-w-[220px] ${
                isActive
                  ? 'bg-[var(--nc-highlight-bg)] text-black font-bold border-[var(--nc-border-light)]'
                  : 'bg-[var(--nc-bg-panel)] text-[var(--nc-text)] border-[var(--nc-border-light)]/40 hover:border-[var(--nc-border-light)]'
              }`}
            >
              {isEditing ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-[var(--nc-bg-deep)] text-white border border-[var(--nc-text-accent)] px-1 text-[11px] outline-none w-24 font-mono"
                />
              ) : (
                <>
                  <span className="truncate">{tab.title}</span>
                  {tab.projectPath && (
                    <FolderOpen className="w-3 h-3 shrink-0 opacity-70" />
                  )}
                </>
              )}
              {tabs.length > 1 && !isEditing && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                  className={`shrink-0 font-bold leading-none ${
                    isActive ? 'text-black hover:text-[#aa0000]' : 'text-[var(--nc-text)]/70 hover:text-[var(--nc-danger)]'
                  }`}
                  title={lang === 'es' ? 'Cerrar pestaña' : lang === 'de' ? 'Tab schließen' : 'Close tab'}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        <button
          onClick={onNewTab}
          className="nc-button !px-1.5 !py-1 shrink-0 bg-[var(--nc-bg-panel)] text-[var(--nc-text)] border-[var(--nc-border-light)]/40 hover:border-[var(--nc-border-light)]"
          title={lang === 'es' ? 'Nueva pestaña (Ctrl+T)' : lang === 'de' ? 'Neuer Tab (Strg+T)' : 'New tab (Ctrl+T)'}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        {onToggleIsolate && (
          <button
            onClick={onToggleIsolate}
            className={`nc-button !px-1.5 !py-1 shrink-0 ${isolateSessions ? 'bg-[#00aa00] text-black border-[var(--nc-success)]' : 'bg-[var(--nc-bg-panel)] text-[var(--nc-text)] border-[var(--nc-border-light)]/40'}`}
            title={lang === 'es' ? 'Aislar sesiones' : lang === 'de' ? 'Sitzungen isolieren' : 'Isolate sessions'}
          >
            <span className="text-[9px] font-mono">{isolateSessions ? 'ISO' : 'SHR'}</span>
          </button>
        )}
      </div>

      {/* Selector de proyecto */}
      <div className="relative flex items-center gap-1 shrink-0" ref={menuRef}>
        <select
          value={active?.projectPath || ''}
          onChange={(e) => onSelectProject(e.target.value)}
          className="bg-[var(--nc-bg-panel)] border border-[var(--nc-border-light)]/50 text-[var(--nc-text)] text-[10px] font-mono px-1.5 py-1 outline-none focus:border-[var(--nc-border-light)] max-w-[180px] cursor-pointer"
          title={lang === 'es' ? 'Proyecto de la pestaña activa' : lang === 'de' ? 'Projekt des aktiven Tabs' : 'Active tab project'}
        >
          <option value="">
            {lang === 'es' ? '(sin proyecto)' : lang === 'de' ? '(kein Projekt)' : '(no project)'}
          </option>
          {roots.map((r) => (
            <option key={r.path} value={r.path}>
              {r.name}{r.cwd ? ' ★' : ''}
            </option>
          ))}
        </select>

        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="nc-button !px-1.5 !py-1 bg-[var(--nc-bg-panel)] text-[var(--nc-text)] border-[var(--nc-border-light)]/40 hover:border-[var(--nc-border-light)]"
          title={lang === 'es' ? 'Gestionar proyectos' : lang === 'de' ? 'Projekte verwalten' : 'Manage projects'}
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 nc-panel border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-deep)] p-2 w-80 shadow-lg">
            <div className="text-[10px] font-bold text-[var(--nc-text-accent)] mb-2 uppercase">
              {lang === 'es' ? 'Proyectos' : lang === 'de' ? 'Projekte' : 'Projects'}
            </div>

            <div className="max-h-48 overflow-y-auto mb-2">
              {roots.length === 0 ? (
                <div className="text-[10px] text-[var(--nc-text-dim)] italic p-1">
                  {lang === 'es' ? 'Sin proyectos' : lang === 'de' ? 'Keine Projekte' : 'No projects'}
                </div>
              ) : roots.map((r) => (
                <div key={r.path} className="flex items-center gap-1 p-1 hover:bg-[var(--nc-bg-hover)] group">
                  <span
                    className="text-[10px] text-[var(--nc-text)] font-mono truncate flex-1 cursor-pointer"
                    title={r.path}
                    onClick={() => { onSelectProject(r.path); setMenuOpen(false); }}
                  >
                    {r.name}
                    {r.cwd && <span className="text-[var(--nc-text-accent)]"> (cwd)</span>}
                  </span>
                  {r.removable && (
                    <button
                      onClick={() => onRemoveProject(r.path)}
                      className="text-[var(--nc-danger)] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      title={lang === 'es' ? 'Quitar de la lista' : lang === 'de' ? 'Aus Liste entfernen' : 'Remove from list'}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <button
                onClick={() => { onCreateProject(); setMenuOpen(false); }}
                className="nc-button !py-1 text-[10px] bg-[var(--nc-active-bg)] text-black font-bold hover:bg-white"
              >
                <FolderPlus className="w-3 h-3" /> {lang === 'es' ? 'Nuevo proyecto' : lang === 'de' ? 'Neues Projekt' : 'New project'}
              </button>
              <button
                onClick={() => { onAddDirectory(); setMenuOpen(false); }}
                className="nc-button !py-1 text-[10px] bg-[var(--nc-bg-panel)] text-[var(--nc-text)] hover:border-[var(--nc-border-light)]"
              >
                <FolderOpen className="w-3 h-3" /> {lang === 'es' ? 'Añadir directorio' : lang === 'de' ? 'Verzeichnis hinzufügen' : 'Add directory'}
              </button>
              {tabs.length > 1 && active && (
                <button
                  onClick={() => { onCloseOthers(active.id); setMenuOpen(false); }}
                  className="nc-button !py-1 text-[10px] bg-[var(--nc-bg-panel)] text-[#ffaa00] hover:border-[#ffaa00]"
                >
                  {lang === 'es' ? 'Cerrar otras pestañas' : lang === 'de' ? 'Andere Tabs schließen' : 'Close other tabs'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Auditoría General */}
      <button
        onClick={onGeneralAudit}
        disabled={auditing || !canAudit}
        className="nc-button !px-2 !py-1 shrink-0 flex items-center gap-1.5 bg-[#aa00aa] text-white font-bold hover:bg-[#ff00ff] disabled:opacity-60 disabled:cursor-wait border-[#ff00ff]"
        title={
          !canAudit
            ? lang === 'es'
              ? 'Elige, añade o crea un proyecto para poder auditar'
              : lang === 'de'
                ? 'Wähle, füge hinzu oder erstelle ein Projekt, um zu prüfen'
                : 'Pick, add or create a project to run the audit'
            : lang === 'es'
              ? 'Auditoría General: revisión completa del proyecto activo (bugs, seguridad, deuda técnica)'
              : lang === 'de' ? 'Allgemeine Prüfung: vollständige Überprüfung des aktiven Projekts' : 'General audit: full review of the active project'
        }
      >
        {auditing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stethoscope className="w-3.5 h-3.5" />}
        <span className="text-[11px] font-mono hidden md:inline">Auditoría General</span>
      </button>
    </div>
  );
};
