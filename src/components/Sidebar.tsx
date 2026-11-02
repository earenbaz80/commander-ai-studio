import React from 'react';
import { MessageSquare, FileText, Code, Cpu, Trash2, Clock, Library, BarChart3, Columns, Radio, Code2, Bot, ChevronDown, ChevronRight, Hammer, Server, X, Play, RefreshCw, Pin, Pencil } from 'lucide-react';
import { StudioMode, HistorySession, ParameterConfig } from '../types/studio';
import { Language, TRANSLATIONS } from '../i18n/translations';
import { SYSTEM_PRESETS } from '../data/systemPresets';
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
      className="flex min-h-9 items-center gap-1 text-xs font-bold text-[#ffff55] uppercase tracking-wider px-1 py-2 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffff55]"
    >
      {open ? (
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
      )}
      <span className="flex-1 text-left border-b border-[#00ffff]/30 pb-0.5">{title}</span>
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
  /** Abre la configuración del servidor LLM local (Ollama / OpenAI-compatible). */
  onOpenLocalLlmConfig?: () => void;
  /** Editor de "Instrucciones del sistema" (trasladado desde el panel de parámetros). */
  parameters?: ParameterConfig;
  setParameters?: React.Dispatch<React.SetStateAction<ParameterConfig>>;
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
  onOpenLocalLlmConfig,
  parameters,
  setParameters,
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

  const filteredHistory = recentHistory.filter((item) =>
    item.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Los hilos del servidor se agrupan por proyecto: la ruta es lo único que dice
  // de dónde sale cada sesión. Los que no tienen proyecto van al final.
  const sessionGroups = React.useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const byProject = new Map<string, any[]>();
    for (const t of serverSessions) {
      if (term && !String(t.title || t.id).toLowerCase().includes(term)) continue;
      const key = String(t.project_path || '');
      const list = byProject.get(key);
      if (list) list.push(t); else byProject.set(key, [t]);
    }
    const groups = [...byProject.entries()].map(([projectPath, threads]) => ({
      projectPath,
      label: projectPath
        ? projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath
        : (lang === 'es' ? 'Sin proyecto' : lang === 'de' ? 'Ohne Projekt' : 'No project'),
      threads,
    }));
    return groups.sort((a, b) => {
      if (!a.projectPath !== !b.projectPath) return a.projectPath ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [serverSessions, searchTerm, lang]);

  // Renombrar en sitio: una fila a la vez, Enter guarda y Escape sale sin tocar el hilo.
  const [editingSessionId, setEditingSessionId] = React.useState<string | null>(null);
  const [sessionDraft, setSessionDraft] = React.useState('');
  const renameCommitted = React.useRef(false);

  // Group openness belongs only to this mount, never to saved preferences.
  const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>({
    crear: true, agentes: true, modelos: true, instrucciones: true, sistema: true,
  });
  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const isGroupOpen = (id: string) => !collapsedGroups[id];
  const groupTitles =
    lang === 'es'
      ? { crear: 'Crear', agentes: 'Agentes', modelos: 'Modelos', instrucciones: 'Instrucciones', sistema: 'Herramientas' }
      : lang === 'de'
        ? { crear: 'Erstellen', agentes: 'Agenten', modelos: 'Modelle', instrucciones: 'Anweisungen', sistema: 'Werkzeuge' }
        : { crear: 'Create', agentes: 'Agents', modelos: 'Models', instrucciones: 'Instructions', sistema: 'Tools' };

  return (
    <aside 
      className={isSidebarOpen ? 'shrink-0 h-full nc-panel p-3 flex flex-col gap-3 border-r-2 border-[#00ffff] overflow-y-auto select-none min-h-0 max-w-[45vw]' : 'hidden'}
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
          <Code2 className="w-6 h-6 text-[#ffff55]" /> {t.modeComposer}
        </button>
        <button 
          onClick={() => setMode('compare')} 
          className={`nc-button flex items-center gap-2.5 text-xs py-1.5 ${mode === 'compare' ? 'nc-active' : ''}`}
          data-tooltip={lang === 'es' ? 'Comparador de Modelos en Paralelo' : lang === 'de' ? 'Modellvergleich nebeneinander' : 'Side-by-Side Model Comparison'}
          data-tooltip-sub={lang === 'es' ? 'Ejecuta el mismo prompt en Claude, Gemini y HuggingFace a la vez' : lang === 'de' ? 'Prompt gleichzeitig mit mehreren Modellen ausführen' : 'Run prompt across multiple models simultaneously'}
        >
          <Columns className="w-6 h-6 text-[#ffff55]" /> {t.modeCompare}
        </button>
        <button 
          onClick={() => setMode('live_voice')} 
          className={`nc-button flex items-center gap-2.5 text-xs py-1.5 ${mode === 'live_voice' ? 'nc-active' : ''}`}
          data-tooltip={lang === 'es' ? 'Voz en Vivo Bidireccional (Gemini Live)' : lang === 'de' ? 'Echtzeit-Sprache (Gemini Live)' : 'Realtime Voice (Gemini Live)'}
          data-tooltip-sub={lang === 'es' ? 'Streaming de audio con micrófono y síntesis de voz en tiempo real' : lang === 'de' ? 'Sprachinteraktion in Echtzeit mit geringer Latenz' : 'Low latency real-time voice interaction'}
        >
          <Radio className="w-6 h-6 text-[#00ffff]" /> {t.modeVoice}
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
        {onOpenLocalLlmConfig && (
          <button
            onClick={onOpenLocalLlmConfig}
            className="nc-button flex items-center gap-2.5 text-xs py-1.5"
            data-tooltip={lang === 'es' ? 'Configurar LLM Local' : lang === 'de' ? 'Lokales LLM konfigurieren' : 'Configure Local LLM'}
            data-tooltip-sub={lang === 'es' ? 'Servidor y modelo del LLM local (Ollama / OpenAI-compatible)' : lang === 'de' ? 'Lokaler LLM-Server & Modell (Ollama / OpenAI-kompatibel)' : 'Local LLM server & model (Ollama / OpenAI-compatible)'}
          >
            <Server className="w-6 h-6 text-[#00ffff]" /> {lang === 'es' ? 'Configurar LLM Local' : lang === 'de' ? 'Lokales LLM konfigurieren' : 'Configure Local LLM'}
          </button>
        )}
        </NavGroup>

        {/* ── INSTRUCCIONES: rol / system instruction (trasladado del panel de parámetros) ── */}
        {parameters && setParameters && (
          <NavGroup
            title={groupTitles.instrucciones}
            open={isGroupOpen('instrucciones')}
            onToggle={() => toggleGroup('instrucciones')}
          >
            <div className="space-y-1.5 pl-0.5">
              <select
                onChange={(e) => {
                  const selectedPreset = SYSTEM_PRESETS.find((p) => p.id === e.target.value);
                  if (selectedPreset) {
                    setParameters((p) => ({ ...p, systemInstruction: selectedPreset.instruction }));
                  }
                }}
                defaultValue=""
                className="w-full bg-[#0000aa] border border-[#00ffff] p-1 text-[10px] text-[#00ffff] font-bold outline-none cursor-pointer"
                aria-label={lang === 'es' ? 'Preset de rol' : lang === 'de' ? 'Rollenvorlage' : 'Role preset'}
              >
                <option value="" disabled>{lang === 'es' ? '⚡ PRESET DE ROL...' : lang === 'de' ? '⚡ ROLLENVORLAGE...' : '⚡ ROLE PRESET...'}</option>
                {SYSTEM_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
              <textarea
                value={parameters.systemInstruction}
                onChange={(e) => {
                  // Capturar el valor en el momento del evento (React restaura el DOM
                  // al valor controlado después; leer e.target.value de forma perezosa
                  // dentro del updater daría el valor previo).
                  const next = e.target.value;
                  setParameters((p) => ({ ...p, systemInstruction: next }));
                }}
                rows={4}
                className="w-full bg-[#000080] border border-[#00ffff] p-1.5 text-[10px] text-white outline-none resize-y font-mono leading-snug"
                placeholder={lang === 'es' ? 'Instrucción del sistema...' : lang === 'de' ? 'Systemanweisung...' : 'System instruction...'}
                aria-label={lang === 'es' ? 'Instrucciones del sistema' : lang === 'de' ? 'Systemanweisungen' : 'System instructions'}
              />
            </div>
          </NavGroup>
        )}

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
            <Hammer className="w-6 h-6 text-[#ffff55]" /> {lang === 'es' ? 'Compilar Proyecto' : lang === 'de' ? 'Projekt kompilieren' : 'Compile Project'}
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

      <div className="border-t-2 border-[#00ffff] pt-2 mt-2">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="flex items-center gap-1 font-bold">
            <Clock className="w-3.5 h-3.5" /> {lang === 'es' ? 'HISTORIAL' : lang === 'de' ? 'VERLAUF' : 'HISTORY'}
            {recentHistory.length > 0 && (
              <span className="bg-[#000055] border border-[#00ffff]/40 text-[#00ffff] px-1 text-[9px] font-mono">
                {recentHistory.length}
              </span>
            )}
          </span>
          {recentHistory.length > 0 && (
            <button onClick={onClearHistory} className="text-[#00ffff] hover:text-white p-1" title={lang === 'es' ? 'Borrar Historial' : lang === 'de' ? 'Verlauf leeren' : 'Clear History'}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Search Past Projects Input */}
        {(recentHistory.length > 0 || serverSessions.length > 0) && (
          <div className="mb-2">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={lang === 'es' ? 'Buscar historial...' : lang === 'de' ? 'Verlauf durchsuchen...' : 'Search history...'}
              className="w-full bg-[#000044] border border-[#00ffff]/40 text-white placeholder-[#00aaaa]/50 text-[10px] px-2 py-1 outline-none focus:border-[#00ffff] transition-colors rounded font-mono"
            />
          </div>
        )}

        {/* Coincidencias dentro de los mensajes: lo que el filtro de títulos no ve */}
        {onSearchMessages && searchTerm.trim().length >= 2 && (searchHits.length > 0 || isSearchingMessages) && (
          <div className="mb-2 border border-[#00ffff]/40 bg-[#000044] rounded" data-testid="message-search-results">
            <div className="flex items-center justify-between px-2 py-1 border-b border-[#00ffff]/20 text-[9px] font-mono text-[#00ffff]">
              <span>{lang === 'es' ? 'EN MENSAJES' : lang === 'de' ? 'IN NACHRICHTEN' : 'IN MESSAGES'}</span>
              <span>{isSearchingMessages ? '…' : searchHits.length}</span>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {searchHits.length === 0 ? (
                <div className="text-[10px] text-[#ff5555] italic p-2 text-center">
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
                    className="w-full text-left px-2 py-1 text-[10px] text-white hover:bg-[#0000aa] transition-colors border-b border-[#00ffff]/10 last:border-b-0"
                    title={plainSnippet(hit.snippet)}
                  >
                    <span className="block truncate font-mono text-[#ffff55]">
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
          {recentHistory.length === 0 ? (
            <div className="text-[11px] text-[#00aaaa] italic p-2 text-center">
              {lang === 'es' ? 'Sin historial reciente' : lang === 'de' ? 'Kein aktueller Verlauf' : 'No recent history'}
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="text-[10px] text-[#ff5555] italic p-2 text-center">
              {lang === 'es' ? 'Sin coincidencias' : lang === 'de' ? 'Keine Treffer gefunden' : 'No matches found'}
            </div>
          ) : (
            filteredHistory.map((item) => (
              <div
                key={item.id}
                className="bg-[#0000aa] border border-[#00ffff]/40 hover:border-[#00ffff] p-1.5 rounded text-[11px] space-y-1 group transition-colors"
              >
                <div className="flex items-center justify-between gap-1">
                  <span 
                    onClick={() => onSelectHistoryItem(item)}
                    className="font-bold text-[#ffff55] truncate cursor-pointer hover:underline flex-1"
                    title={item.promptTitle || item.title}
                  >
                    {item.promptTitle || item.title}
                  </span>
                  {onDeleteHistoryItem && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteHistoryItem(item.id);
                      }}
                      className="text-red-400 hover:text-white px-1 font-bold text-[10px] shrink-0"
                      title={lang === 'es' ? 'Eliminar esta sesión' : lang === 'de' ? 'Sitzung löschen' : 'Delete session'}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between text-[10px] text-[#00ffff]/80 font-mono">
                  <span>{item.timestamp}</span>
                  <span className="bg-[#000055] px-1 py-0.5 border border-[#00ffff]/30 uppercase text-[9px]">
                    {item.messages && item.messages.length > 0 ? `${item.messages.length} msgs` : item.mode}
                  </span>
                </div>
                <div className="flex items-center gap-1 pt-1 border-t border-[#000055]">
                  <button
                    type="button"
                    onClick={() => onSelectHistoryItem(item)}
                    className="nc-button !px-1.5 !py-0.5 text-[10px] flex-1 text-center bg-[#000080] text-[#00ffff] hover:text-white"
                    title={lang === 'es' ? 'Restaurar conversación y parámetros' : lang === 'de' ? 'Unterhaltung und Parameter wiederherstellen' : 'Restore conversation and parameters'}
                  >
                    {lang === 'es' ? 'Restaurar' : lang === 'de' ? 'Wiederherstellen' : 'Restore'}
                  </button>
                  {onRunHistoryItem && (
                    <button
                      type="button"
                      onClick={() => onRunHistoryItem(item)}
                      className="nc-button !px-1.5 !py-0.5 text-[10px] bg-[#00ffff] text-black font-bold hover:bg-white flex items-center gap-1 shrink-0"
                      title={lang === 'es' ? 'Restaurar y ejecutar en vivo' : lang === 'de' ? 'Wiederherstellen und im Live-Viewer ausführen' : 'Restore and run in live viewer'}
                    >
                      <span className="flex items-center gap-1">
                        <Play className="w-3 h-3" /> {lang === 'es' ? 'Ejecutar' : lang === 'de' ? 'Ausführen' : 'Run'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

        {/* Sesiones persistidas en servidor (SQLite) */}
        <div className="border-t-2 border-[#00ffff] pt-2 mt-2">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="flex items-center gap-1 font-bold">
              <Clock className="w-3.5 h-3.5" /> {lang === 'es' ? 'SESIONES (servidor)' : lang === 'de' ? 'SITZUNGEN (Server)' : 'SESSIONS (server)'}
              {serverSessions.length > 0 && (
                <span className="bg-[#000055] border border-[#00ffff]/40 text-[#00ffff] px-1 text-[9px] font-mono">
                  {serverSessions.length}
                </span>
              )}
            </span>
            {onRefreshServerSessions && (
              <button onClick={onRefreshServerSessions} className="text-[#00ffff] hover:text-white p-1" title={lang === 'es' ? 'Actualizar' : lang === 'de' ? 'Aktualisieren' : 'Refresh'}>
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {serverSessions.length === 0 ? (
              <div className="text-[11px] text-[#00aaaa] italic p-2 text-center">
                {lang === 'es' ? 'Sin sesiones en servidor' : lang === 'de' ? 'Keine Server-Sitzungen' : 'No server sessions'}
              </div>
            ) : sessionGroups.length === 0 ? (
              <div className="text-[10px] text-[#ff5555] italic p-2 text-center">
                {lang === 'es' ? 'Sin coincidencias' : lang === 'de' ? 'Keine Treffer gefunden' : 'No matches found'}
              </div>
            ) : (
              sessionGroups.map((group) => {
                const groupKey = 'session:' + group.projectPath;
                const open = isGroupOpen(groupKey);
                return (
                  <div key={groupKey} className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => toggleGroup(groupKey)}
                      aria-expanded={open}
                      aria-label={'Proyecto ' + group.label}
                      className="flex min-h-7 items-center gap-1 text-[10px] font-bold text-[#00ffff] px-1 py-1 hover:text-white"
                    >
                      {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                      <span className="flex-1 text-left truncate" title={group.projectPath || group.label}>{group.label}</span>
                      <span className="font-mono text-[9px] text-[#00aaaa]">{group.threads.length}</span>
                    </button>
                    {open && group.threads.map((t: any) => (
                      <div
                        key={t.id}
                        data-testid={'session-row-' + t.id}
                        className="bg-[#0000aa] border border-[#00ffff]/40 hover:border-[#00ffff] rounded p-1 mb-1 text-[10px] transition-colors"
                      >
                        {editingSessionId === t.id ? (
                          <input
                            autoFocus
                            value={sessionDraft}
                            onChange={(e) => setSessionDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                renameCommitted.current = true;
                                if (sessionDraft.trim()) onRenameServerSession?.(t.id, sessionDraft.trim());
                                setEditingSessionId(null);
                              } else if (e.key === 'Escape') {
                                setEditingSessionId(null);
                              }
                            }}
                            onBlur={() => {
                              // Enter ya guardó y desmontó el campo: el blur posterior no repite el PATCH.
                              if (renameCommitted.current) { renameCommitted.current = false; return; }
                              if (sessionDraft.trim()) onRenameServerSession?.(t.id, sessionDraft.trim());
                              setEditingSessionId(null);
                            }}
                            aria-label="Nuevo nombre del hilo"
                            className="w-full bg-[#000044] border border-[#00ffff] text-[#ffff55] text-[10px] px-1 py-0.5 outline-none font-mono"
                          />
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onSelectServerSession?.(t)}
                              className="flex-1 min-w-0 text-left"
                              title={t.title || t.id}
                            >
                              <div className="font-bold text-[#ffff55] truncate flex items-center gap-1">
                                {t.pinned ? <Pin className="w-2.5 h-2.5 shrink-0" /> : null}
                                <span className="truncate">{t.title || t.id}</span>
                              </div>
                              <div className="text-[#00ffff]/70 font-mono text-[9px] truncate">
                                {t.updated_at ? new Date(t.updated_at).toLocaleString() : String(t.id).slice(0, 8)}
                              </div>
                            </button>
                            {onToggleServerSessionPin && (
                              <button
                                type="button"
                                onClick={() => onToggleServerSessionPin(t)}
                                aria-label={(t.pinned ? 'Soltar ' : 'Fijar ') + (t.title || t.id)}
                                title={t.pinned ? 'Quitar de fijados' : 'Fijar arriba'}
                                className={t.pinned ? 'text-[#ffff55] hover:text-white p-0.5 shrink-0' : 'text-[#00ffff]/60 hover:text-white p-0.5 shrink-0'}
                              >
                                <Pin className="w-3 h-3" />
                              </button>
                            )}
                            {onRenameServerSession && (
                              <button
                                type="button"
                                onClick={() => { setSessionDraft(t.title || ''); setEditingSessionId(t.id); }}
                                aria-label={'Renombrar ' + (t.title || t.id)}
                                title="Renombrar"
                                className="text-[#00ffff]/60 hover:text-white p-0.5 shrink-0"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            )}
                            {onDeleteServerSession && (
                              <button
                                type="button"
                                onClick={() => onDeleteServerSession(t.id)}
                                aria-label={'Eliminar ' + (t.title || t.id)}
                                title="Eliminar este hilo y sus mensajes"
                                className="text-red-400 hover:text-white p-0.5 shrink-0"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>
  );
};
