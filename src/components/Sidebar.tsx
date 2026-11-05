import React from 'react';
import { MessageSquare, FileText, Code, Cpu, Trash2, Clock, Library, BarChart3, Columns, Code2, Bot, ChevronDown, ChevronRight, Hammer, Play, RefreshCw, Pin, Pencil } from 'lucide-react';
import { StudioMode, HistorySession } from '../types/studio';
import { Language, TRANSLATIONS } from '../i18n/translations';
import type { ConversationHit } from '../agent/persistence';

/** Sección colapsable del panel lateral (cabecera + items). */
const NavGroup: React.FC<{
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, open, onToggle, children }) => (
  <div className="flex flex-col">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={title}
      className="flex min-h-9 items-center gap-1 text-xs font-bold text-[var(--nc-text-accent)] uppercase tracking-wider px-1 py-2 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nc-text-accent)]"
    >
      {open ? (
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
      )}
      <span className="flex-1 text-left border-b border-[var(--nc-border-light)]/30 pb-0.5">{title}</span>
    </button>
    {open && <div className="flex flex-col gap-1.5 pl-1 pt-0.5">{children}</div>}
  </div>
);

/**
 * El servidor devuelve el fragmento tal cual lo guardó: el JSON de `parts` con
 * la coincidencia entre `<b>`. En una fila del sidebar eso se lee mal, así que
 * se deja texto plano (React ya escapa el resto).
 */
function plainSnippet(raw: string): string {
  let text = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') text = parsed;
    else if (parsed && typeof parsed === 'object') text = parsed.text || parsed.content || raw;
  } catch { /* no era JSON */ }
  return String(text).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

interface SidebarProps {
  mode: StudioMode;
  setMode: (mode: StudioMode) => void;
  recentHistory: HistorySession[];
  onSelectHistoryItem: (item: HistorySession) => void;
  onRunHistoryItem?: (item: HistorySession) => void;
  onDeleteHistoryItem?: (id: string) => void;
  onClearHistory: () => void;
  onNewPrompt: () => void;
  onOpenGallery: () => void;
  /** Abre el compilador/exportador nativo (movido desde el menú del header). */
  onOpenCompile?: () => void;
  lang?: Language;
  isSidebarOpen?: boolean;
  width?: number;
  serverSessions?: any[];
  onSelectServerSession?: (t: any) => void;
  onRefreshServerSessions?: () => void;
  onRenameServerSession?: (id: string, title: string) => void;
  onDeleteServerSession?: (id: string) => void;
  onToggleServerSessionPin?: (t: any) => void;
  /** Coincidencias dentro de los mensajes (las busca el servidor). */
  searchHits?: ConversationHit[];
  isSearchingMessages?: boolean;
  onSearchMessages?: (q: string) => void;
  onOpenSearchResult?: (hit: ConversationHit) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  mode,
  setMode,
  recentHistory,
  onSelectHistoryItem,
  onRunHistoryItem,
  onDeleteHistoryItem,
  onClearHistory,
  onNewPrompt,
  onOpenGallery,
  onOpenCompile,
  lang = 'es',
  isSidebarOpen = false,
  width,
  serverSessions = [],
  onSelectServerSession,
  onRefreshServerSessions,
  onRenameServerSession,
  onDeleteServerSession,
  onToggleServerSessionPin,
  searchHits = [],
  isSearchingMessages = false,
  onSearchMessages,
  onOpenSearchResult,
}) => {
  const t = TRANSLATIONS[lang];
  const [searchTerm, setSearchTerm] = React.useState('');

  // El filtro de abajo sólo mira títulos. Los mensajes los busca el servidor
  // (/api/search) y sin retardo se dispara una petición por pulsación.
  React.useEffect(() => {
    if (!onSearchMessages) return;
    const term = searchTerm.trim();
    const id = window.setTimeout(() => onSearchMessages(term), 250);
    return () => window.clearTimeout(id);
  }, [searchTerm, onSearchMessages]);

  /**
   * Un solo historial: lo guardado en este equipo y los hilos del servidor son
   * la misma conversación vista desde dos sitios, y a menudo con el mismo id
   * (al restaurar una entrada local la pestaña adopta ese id y se sube con él).
   * Antes eran dos listas, dos buscadores y dos borrados; ahora es una fila por
   * conversación con etiquetas que dicen dónde vive.
   */
  const historyRows = React.useMemo(() => {
    type Row = {
      key: string;
      title: string;
      meta: string;
      project: string;
      pinned: boolean;
      local?: HistorySession;
      server?: any;
    };
    const term = searchTerm.trim().toLowerCase();
    const byId = new Map<string, any>();
    for (const thread of serverSessions) byId.set(String(thread.id), thread);

    const projectOf = (path: unknown): string =>
      path ? String(path).split(/[\\/]/).filter(Boolean).pop() || String(path) : '';

    const rows: Row[] = [];
    const taken = new Set<string>();

    for (const item of recentHistory) {
      const server = byId.get(String(item.id));
      if (server) taken.add(String(server.id));
      const messageCount = item.messages?.length || 0;
      rows.push({
        key: 'local:' + item.id,
        title: item.promptTitle || item.title || item.id,
        meta: [item.timestamp, messageCount > 0 ? messageCount + ' msgs' : item.mode].filter(Boolean).join(' · '),
        project: projectOf(server?.project_path),
        pinned: !!server?.pinned,
        local: item,
        server,
      });
    }

    for (const thread of serverSessions) {
      if (taken.has(String(thread.id))) continue;
      const updated = thread.updated_at ? new Date(thread.updated_at) : null;
      rows.push({
        key: 'server:' + thread.id,
        title: thread.title || String(thread.id).slice(0, 8),
        meta: updated && !Number.isNaN(updated.getTime())
          ? updated.toLocaleString()
          : String(thread.id).slice(0, 8),
        project: projectOf(thread.project_path),
        pinned: !!thread.pinned,
        server: thread,
      });
    }

    const filtered = term
      ? rows.filter((row) =>
          row.title.toLowerCase().includes(term) || row.project.toLowerCase().includes(term))
      : rows;
    // Los fijados suben; el resto conserva su orden (equipo primero, servidor
    // después), porque el servidor ya los devuelve del más nuevo al más viejo.
    return filtered.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [recentHistory, serverSessions, searchTerm]);

  const hasHistory = recentHistory.length > 0 || serverSessions.length > 0;

  // Renombrar en sitio: una fila a la vez, Enter guarda y Escape sale sin tocar el hilo.
  const [editingSessionId, setEditingSessionId] = React.useState<string | null>(null);
  const [sessionDraft, setSessionDraft] = React.useState('');
  const renameCommitted = React.useRef(false);

  // Group openness belongs only to this mount, never to saved preferences.
  const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>({
    crear: true, agentes: true, modelos: true, sistema: true,
  });
  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const isGroupOpen = (id: string) => !collapsedGroups[id];
  const groupTitles =
    lang === 'es'
      ? { crear: 'Crear', agentes: 'Agentes', modelos: 'Modelos', sistema: 'Herramientas' }
      : lang === 'de'
        ? { crear: 'Erstellen', agentes: 'Agenten', modelos: 'Modelle', sistema: 'Werkzeuge' }
        : { crear: 'Create', agentes: 'Agents', modelos: 'Models', sistema: 'Tools' };

  return (
    <aside 
      className={isSidebarOpen ? 'shrink-0 h-full nc-panel p-3 flex flex-col gap-3 border-r-2 border-[var(--nc-border-light)] overflow-y-auto select-none min-h-0 max-w-[45vw]' : 'hidden'}
      style={width ? { width } : undefined}
      aria-label={lang === 'es' ? 'Navegación principal' : lang === 'de' ? 'Hauptnavigation' : 'Main navigation'}
    >
      <div className="flex flex-col gap-2.5 shrink-0">
        {/* ── CREAR: modos de creación/interacción ── */}
        <NavGroup
          title={groupTitles.crear}
          open={isGroupOpen('crear')}
          onToggle={() => toggleGroup('crear')}
        >
        <button
          onClick={onNewPrompt}
          className="nc-button flex items-center gap-2.5 text-xs py-1.5"
          data-tooltip={lang === 'es' ? 'Nuevo chat (nueva sesión)' : lang === 'de' ? 'Neuer Chat (neue Sitzung)' : 'New chat (new session)'}
          data-tooltip-sub={lang === 'es' ? 'Crea siempre una nueva sesión con una conversación limpia' : lang === 'de' ? 'Erstellt immer eine neue Sitzung mit leerem Chat' : 'Always creates a new session with a clean chat'}
        >
          <MessageSquare className="w-6 h-6" /> {lang === 'es' ? 'Nuevo chat' : lang === 'de' ? 'Neuer Chat' : 'New chat'}
        </button>
        <button 
          onClick={() => setMode('freeform')} 
          className={`nc-button flex items-center gap-2.5 text-xs py-1.5 ${mode === 'freeform' ? 'nc-active' : ''}`}
          data-tooltip={lang === 'es' ? 'Modo Freeform (Texto Libre)' : lang === 'de' ? 'Freitext-Modus' : 'Freeform Text Mode'}
          data-tooltip-sub={lang === 'es' ? 'Completado de texto y generación de código sin restricciones' : lang === 'de' ? 'Freie Prompt-Vervollständigung & Codeerzeugung' : 'Free prompt completion & code generation'}
        >
          <FileText className="w-6 h-6" /> {t.modeFreeform}
        </button>
        <button 
          onClick={() => setMode('structured')} 
          className={`nc-button flex items-center gap-2.5 text-xs py-1.5 ${mode === 'structured' ? 'nc-active' : ''}`}
          data-tooltip={lang === 'es' ? 'Modo Estructurado (JSON / Tabla)' : lang === 'de' ? 'Strukturierter Modus (JSON / Tabelle)' : 'Structured Mode (JSON / Table)'}
          data-tooltip-sub={lang === 'es' ? 'Define esquemas de salida estrictos con formato JSON o tabla' : lang === 'de' ? 'Erzwingt Ausgaben mit striktem JSON-Schema' : 'Enforces strict JSON schema outputs'}
        >
          <Code className="w-6 h-6" /> {t.modeStructured}
        </button>
        <button 
          onClick={() => setMode('composer')} 
          className={`nc-button flex items-center gap-2.5 text-xs py-1.5 ${mode === 'composer' ? 'nc-active' : ''}`}
          data-tooltip={lang === 'es' ? 'Commander Composer (Multi-Archivo & Diffs)' : lang === 'de' ? 'Commander Composer (Mehrdatei & Diffs)' : 'Commander Composer (Multi-File & Diffs)'}
          data-tooltip-sub={lang === 'es' ? 'Agente de código multi-archivo, diffs interactivos y Live Sandbox' : lang === 'de' ? 'Mehrdatei-Coding-Agent & Live-Runner' : 'Multi-file coding agent & live runner'}
        >
          <Code2 className="w-6 h-6 text-[var(--nc-text-accent)]" /> {t.modeComposer}
        </button>
        <button 
          onClick={() => setMode('compare')} 
          className={`nc-button flex items-center gap-2.5 text-xs py-1.5 ${mode === 'compare' ? 'nc-active' : ''}`}
          data-tooltip={lang === 'es' ? 'Comparador de Modelos en Paralelo' : lang === 'de' ? 'Modellvergleich nebeneinander' : 'Side-by-Side Model Comparison'}
          data-tooltip-sub={lang === 'es' ? 'Ejecuta el mismo prompt en Claude, Gemini y HuggingFace a la vez' : lang === 'de' ? 'Prompt gleichzeitig mit mehreren Modellen ausführen' : 'Run prompt across multiple models simultaneously'}
        >
          <Columns className="w-6 h-6 text-[var(--nc-text-accent)]" /> {t.modeCompare}
        </button>
        <button
          onClick={onOpenGallery}
          className="nc-button flex items-center gap-2.5 text-xs py-1.5"
          data-tooltip={lang === 'es' ? 'Galería Pública de Proyectos' : lang === 'de' ? 'Öffentliche Projektgalerie' : 'Public Project Gallery'}
        >
          <Library className="w-6 h-6" /> {t.modeGallery}
        </button>
        </NavGroup>

        <NavGroup title={groupTitles.agentes} open={isGroupOpen('agentes')} onToggle={() => toggleGroup('agentes')}>
        <button
          onClick={() => setMode('agent')}
          className={`nc-button flex items-center gap-2.5 text-xs py-1.5 ${mode === 'agent' ? 'nc-active' : ''}`}
          data-tooltip={lang === 'es' ? '🤖 Modo Agente' : lang === 'de' ? '🤖 Agentenmodus' : '🤖 Agent Mode'}
          data-tooltip-sub={lang === 'es' ? 'Agente autónomo con tools FS+shell' : lang === 'de' ? 'Autonomer Agent mit Dateisystem- und Shell-Tools' : 'Autonomous agent with FS+shell tools'}
        >
          <Bot className="w-6 h-6" /> {t.modeAgent}
        </button>
        </NavGroup>

        {/* ── MODELOS: ejecución local en el navegador ── */}
        <NavGroup
          title={groupTitles.modelos}
          open={isGroupOpen('modelos')}
          onToggle={() => toggleGroup('modelos')}
        >
        <button 
          onClick={() => setMode('huggingface')} 
          className={`nc-button flex items-center gap-2.5 text-xs py-1.5 ${mode === 'huggingface' ? 'nc-active' : ''}`}
          data-tooltip={lang === 'es' ? 'Modelos Hugging Face en Local' : lang === 'de' ? 'Lokale Hugging-Face-Transformer' : 'Hugging Face Local Transformers'}
          data-tooltip-sub={lang === 'es' ? 'Descarga y corre modelos ONNX/Transformers.js 100% en tu navegador' : lang === 'de' ? 'ONNX-Gewichte im Browser ausführen, 100 % privat' : 'Run in-browser ONNX weights 100% private'}
        >
          <Cpu className="w-6 h-6" /> {t.modeHuggingFace}
        </button>
        </NavGroup>

        <NavGroup
          title={groupTitles.sistema}
          open={isGroupOpen('sistema')}
          onToggle={() => toggleGroup('sistema')}
        >
        {onOpenCompile && (
          <button 
            onClick={onOpenCompile} 
            className="nc-button flex items-center gap-2.5 text-xs py-1.5"
            data-tooltip={lang === 'es' ? 'Compilar / Exportar Proyecto' : lang === 'de' ? 'Projekt kompilieren / exportieren' : 'Compile / Export Project'}
            data-tooltip-sub={lang === 'es' ? 'Compila la aplicación nativa para Windows, Android, iOS, macOS y Linux' : lang === 'de' ? 'Die native App für Desktop und Mobilgeräte bauen' : 'Build the native app for desktop and mobile'}
          >
            <Hammer className="w-6 h-6 text-[var(--nc-text-accent)]" /> {lang === 'es' ? 'Compilar Proyecto' : lang === 'de' ? 'Projekt kompilieren' : 'Compile Project'}
          </button>
        )}
        <button 
          onClick={() => setMode('telemetry')} 
          className={`nc-button flex items-center gap-2.5 text-xs py-1.5 ${mode === 'telemetry' ? 'nc-active' : ''}`}
          data-tooltip={lang === 'es' ? 'Panel de Telemetría & Rendimiento' : lang === 'de' ? 'Telemetrie- & Leistungs-Dashboard' : 'Telemetry & Performance Dashboard'}
          data-tooltip-sub={lang === 'es' ? 'Métricas de latencia, conteo de tokens y tasa de errores' : lang === 'de' ? 'Latenz, Token und Fehlerraten überwachen' : 'Monitor latency, tokens and error rates'}
        >
          <BarChart3 className="w-6 h-6" /> {t.modeTelemetry}
        </button>
        </NavGroup>
      </div>

      <div className="border-t-2 border-[var(--nc-border-light)] pt-2 mt-2">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="flex items-center gap-1 font-bold">
            <Clock className="w-3.5 h-3.5" /> {lang === 'es' ? 'HISTORIAL' : lang === 'de' ? 'VERLAUF' : 'HISTORY'}
            {historyRows.length > 0 && (
              <span className="bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)]/40 text-[var(--nc-text)] px-1 text-[9px] font-mono">
                {historyRows.length}
              </span>
            )}
          </span>
          <span className="flex items-center gap-0.5">
            {onRefreshServerSessions && (
              <button
                onClick={onRefreshServerSessions}
                className="text-[var(--nc-text)] hover:text-white p-1"
                title={lang === 'es' ? 'Actualizar sesiones del servidor' : lang === 'de' ? 'Server-Sitzungen aktualisieren' : 'Refresh server sessions'}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
            {recentHistory.length > 0 && (
              <button
                onClick={onClearHistory}
                className="text-[var(--nc-text)] hover:text-white p-1"
                title={lang === 'es' ? 'Borrar el historial de este equipo' : lang === 'de' ? 'Lokalen Verlauf leeren' : 'Clear local history'}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </span>
        </div>

        {/* Search Past Projects Input */}
        {hasHistory && (
          <div className="mb-2">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={lang === 'es' ? 'Buscar historial...' : lang === 'de' ? 'Verlauf durchsuchen...' : 'Search history...'}
              className="w-full bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)]/40 text-white placeholder-[#00aaaa]/50 text-[10px] px-2 py-1 outline-none focus:border-[var(--nc-border-light)] transition-colors rounded font-mono"
            />
          </div>
        )}

        {/* Coincidencias dentro de los mensajes: lo que el filtro de títulos no ve */}
        {onSearchMessages && searchTerm.trim().length >= 2 && (searchHits.length > 0 || isSearchingMessages) && (
          <div className="mb-2 border border-[var(--nc-border-light)]/40 bg-[var(--nc-bg-deep)] rounded" data-testid="message-search-results">
            <div className="flex items-center justify-between px-2 py-1 border-b border-[var(--nc-border-light)]/20 text-[9px] font-mono text-[var(--nc-text)]">
              <span>{lang === 'es' ? 'EN MENSAJES' : lang === 'de' ? 'IN NACHRICHTEN' : 'IN MESSAGES'}</span>
              <span>{isSearchingMessages ? '…' : searchHits.length}</span>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {searchHits.length === 0 ? (
                <div className="text-[10px] text-[var(--nc-danger)] italic p-2 text-center">
                  {lang === 'es' ? 'Sin coincidencias en mensajes' : lang === 'de' ? 'Keine Treffer in Nachrichten' : 'No matches in messages'}
                </div>
              ) : (
                searchHits.map((hit) => (
                  <button
                    key={`${hit.thread_id}-${hit.seq}`}
                    type="button"
                    onClick={() => onOpenSearchResult?.(hit)}
                    // Sin etiqueta el botón no anuncia nada útil; el nombre calculado
                    // desde los spans tampoco incluía el fragmento.
                    aria-label={plainSnippet(hit.snippet)}
                    className="w-full text-left px-2 py-1 text-[10px] text-white hover:bg-[var(--nc-bg-hover)] transition-colors border-b border-[var(--nc-border-light)]/10 last:border-b-0"
                    title={plainSnippet(hit.snippet)}
                  >
                    <span className="block truncate font-mono text-[var(--nc-text-accent)]">
                      {hit.thread_id.slice(0, 8)} · #{hit.seq}
                    </span>
                    <span className="block truncate text-[#aaffff]/80">{plainSnippet(hit.snippet)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        <div className="space-y-1">
          {historyRows.length === 0 ? (
            <div className="text-[11px] text-[var(--nc-text-dim)] italic p-2 text-center">
              {hasHistory
                ? (lang === 'es' ? 'Sin coincidencias' : lang === 'de' ? 'Keine Treffer gefunden' : 'No matches found')
                : (lang === 'es' ? 'Sin conversaciones guardadas' : lang === 'de' ? 'Noch keine Unterhaltungen' : 'No conversations yet')}
            </div>
          ) : (
            historyRows.map((row) => {
              const item = row.local;
              const thread = row.server;
              const rowTitle = row.title;
              return (
                <div
                  key={row.key}
                  data-testid={thread ? 'session-row-' + thread.id : undefined}
                  className="bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)]/40 hover:border-[var(--nc-border-light)] rounded p-1.5 text-[10px] transition-colors"
                >
                  {thread && editingSessionId === thread.id ? (
                    <input
                      autoFocus
                      value={sessionDraft}
                      onChange={(e) => setSessionDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          renameCommitted.current = true;
                          if (sessionDraft.trim()) onRenameServerSession?.(thread.id, sessionDraft.trim());
                          setEditingSessionId(null);
                        } else if (e.key === 'Escape') {
                          setEditingSessionId(null);
                        }
                      }}
                      onBlur={() => {
                        // Enter ya guardó y desmontó el campo: el blur posterior no repite el PATCH.
                        if (renameCommitted.current) { renameCommitted.current = false; return; }
                        if (sessionDraft.trim()) onRenameServerSession?.(thread.id, sessionDraft.trim());
                        setEditingSessionId(null);
                      }}
                      aria-label="Nuevo nombre del hilo"
                      className="w-full bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)] text-[var(--nc-text-accent)] text-[10px] px-1 py-0.5 outline-none font-mono"
                    />
                  ) : (
                    <>
                      <div className="flex items-start gap-1">
                        <button
                          type="button"
                          onClick={() => (item ? onSelectHistoryItem(item) : onSelectServerSession?.(thread))}
                          className="flex-1 min-w-0 text-left"
                          title={rowTitle}
                        >
                          <span className="flex items-center gap-1 font-bold text-[var(--nc-text-accent)] truncate">
                            {row.pinned && <Pin className="w-2.5 h-2.5 shrink-0" />}
                            <span className="truncate">{rowTitle}</span>
                          </span>
                          <span className="block text-[var(--nc-text)]/70 font-mono text-[9px] truncate">
                            {[row.meta, row.project].filter(Boolean).join(' · ')}
                          </span>
                        </button>
                        <span className="flex items-center gap-0.5 shrink-0">
                          {item && (
                            <span
                              className="bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)]/40 text-[var(--nc-text)] px-1 text-[8px] font-mono"
                              title={lang === 'es' ? 'Guardada en este equipo' : lang === 'de' ? 'Auf diesem Gerät gespeichert' : 'Saved on this device'}
                            >
                              EQ
                            </span>
                          )}
                          {thread && (
                            <span
                              className="bg-[var(--nc-bg-deep)] border border-[var(--nc-text-accent)]/40 text-[var(--nc-text-accent)] px-1 text-[8px] font-mono"
                              title={lang === 'es' ? 'Guardada en el servidor' : lang === 'de' ? 'Auf dem Server gespeichert' : 'Saved on the server'}
                            >
                              SRV
                            </span>
                          )}
                          {thread && onToggleServerSessionPin && (
                            <button
                              type="button"
                              onClick={() => onToggleServerSessionPin(thread)}
                              aria-label={(thread.pinned ? 'Soltar ' : 'Fijar ') + rowTitle}
                              title={thread.pinned ? 'Quitar de fijados' : 'Fijar arriba'}
                              className={thread.pinned ? 'text-[var(--nc-text-accent)] hover:text-white p-0.5' : 'text-[var(--nc-text)]/60 hover:text-white p-0.5'}
                            >
                              <Pin className="w-3 h-3" />
                            </button>
                          )}
                          {thread && onRenameServerSession && (
                            <button
                              type="button"
                              onClick={() => { setSessionDraft(thread.title || ''); setEditingSessionId(thread.id); }}
                              aria-label={'Renombrar ' + rowTitle}
                              title="Renombrar"
                              className="text-[var(--nc-text)]/60 hover:text-white p-0.5"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                          {((item && onDeleteHistoryItem) || (thread && onDeleteServerSession)) && (
                            <button
                              type="button"
                              onClick={() => {
                                // Una fila es una conversación: si vive en los dos
                                // sitios, borrarla la borra en los dos.
                                if (item && onDeleteHistoryItem) onDeleteHistoryItem(item.id);
                                if (thread && onDeleteServerSession) onDeleteServerSession(thread.id);
                              }}
                              aria-label={'Eliminar ' + rowTitle}
                              title={
                                item && thread
                                  ? (lang === 'es' ? 'Eliminar aquí y en el servidor' : lang === 'de' ? 'Hier und auf dem Server löschen' : 'Delete here and on the server')
                                  : item
                                    ? (lang === 'es' ? 'Eliminar de este equipo' : lang === 'de' ? 'Von diesem Gerät löschen' : 'Delete from this device')
                                    : (lang === 'es' ? 'Eliminar este hilo y sus mensajes' : lang === 'de' ? 'Diesen Thread löschen' : 'Delete this thread and its messages')
                              }
                              className="text-red-400 hover:text-white p-0.5"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      </div>
                      {item && (
                        <div className="flex items-center gap-1 pt-1 mt-1 border-t border-[var(--nc-border-dark)]">
                          <button
                            type="button"
                            onClick={() => onSelectHistoryItem(item)}
                            className="nc-button !px-1.5 !py-0.5 text-[10px] flex-1 text-center bg-[var(--nc-bg-panel)] text-[var(--nc-text)] hover:text-white"
                            title={lang === 'es' ? 'Restaurar conversación y parámetros' : lang === 'de' ? 'Unterhaltung und Parameter wiederherstellen' : 'Restore conversation and parameters'}
                          >
                            {lang === 'es' ? 'Restaurar' : lang === 'de' ? 'Wiederherstellen' : 'Restore'}
                          </button>
                          {onRunHistoryItem && (
                            <button
                              type="button"
                              onClick={() => onRunHistoryItem(item)}
                              className="nc-button !px-1.5 !py-0.5 text-[10px] bg-[var(--nc-highlight-bg)] text-black font-bold hover:bg-white flex items-center gap-1 shrink-0"
                              title={lang === 'es' ? 'Restaurar y ejecutar en vivo' : lang === 'de' ? 'Wiederherstellen und im Live-Viewer ausführen' : 'Restore and run in live viewer'}
                            >
                              <span className="flex items-center gap-1">
                                <Play className="w-3 h-3" /> {lang === 'es' ? 'Ejecutar' : lang === 'de' ? 'Ausführen' : 'Run'}
                              </span>
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>


    </aside>
  );
};
