import { getCachedApiKey } from './lib/apiKeys';

import { resolveChatRoute } from './lib/aiRouting';
import { detectProvider } from './lib/aiProviders';
import { formatErrorMessage } from './utils/errorFormatter';
import { useAppExecutors } from './hooks/useAppExecutors';
import { useAppHandlers } from './hooks/useAppHandlers';
import { useAppVersions } from './hooks/useAppVersions';
import { useAppTelemetry } from './hooks/useAppTelemetry';
import { useAppEffects } from './hooks/useAppEffects';
import { useAppAuth } from './hooks/useAppAuth';
import { useAppModels } from './hooks/useAppModels';
import { useAppPrompts } from './hooks/useAppPrompts';
import { useHistoryHandlers } from './hooks/useHistoryHandlers';
import { useCommandPaletteShortcut } from './hooks/useCommandPaletteShortcut';
import { useTabProjectHandlers } from './hooks/useTabProjectHandlers';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useResizableWidth } from './hooks/useResizableWidth';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { FloatingAssistant, type FloatingAssistantHandle } from './components/FloatingAssistant';
import { WorkbenchPanel } from './components/WorkbenchPanel';
import { Sidebar } from './components/Sidebar';
import { Playground } from './components/Playground';
// Vistas pesadas y modales bajo demanda: no forman parte del primer pintado.
// Cada una vive en su propio chunk y se descarga al abrirse por primera vez.
const CodeModal = React.lazy(() =>
  import('./components/CodeModal').then((m) => ({ default: m.CodeModal }))
);
const PreferencesModal = React.lazy(() =>
  import('./components/PreferencesModal').then((m) => ({ default: m.PreferencesModal }))
);
import type { SettingsSection } from './components/PreferencesModal';
const LibraryModal = React.lazy(() =>
  import('./components/LibraryModal').then((m) => ({ default: m.LibraryModal }))
);
const AuthModal = React.lazy(() =>
  import('./components/AuthModal').then((m) => ({ default: m.AuthModal }))
);
const TelemetryDashboard = React.lazy(() =>
  import('./components/TelemetryDashboard').then((m) => ({ default: m.TelemetryDashboard }))
);
const VersionHistoryModal = React.lazy(() =>
  import('./components/VersionHistoryModal').then((m) => ({ default: m.VersionHistoryModal }))
);
const LiveVoiceModal = React.lazy(() =>
  import('./components/LiveVoiceModal').then((m) => ({ default: m.LiveVoiceModal }))
);
const HelpModal = React.lazy(() =>
  import('./components/HelpModal').then((m) => ({ default: m.HelpModal }))
);
const AboutModal = React.lazy(() =>
  import('./components/AboutModal').then((m) => ({ default: m.AboutModal }))
);
const CompilerModal = React.lazy(() =>
  import('./components/CompilerModal').then((m) => ({ default: m.CompilerModal }))
);
const KeyboardShortcutsModal = React.lazy(() =>
  import('./components/KeyboardShortcutsModal').then((m) => ({ default: m.KeyboardShortcutsModal }))
);
const AgentMode = React.lazy(() =>
  import('./components/AgentMode').then((m) => ({ default: m.AgentMode }))
);
const AgentApprovalModal = React.lazy(() =>
  import('./components/AgentApprovalModal').then((m) => ({ default: m.AgentApprovalModal }))
);
const AgentQuestionModal = React.lazy(() =>
  import('./components/AgentQuestionModal').then((m) => ({ default: m.AgentQuestionModal }))
);
import { CommandPalette } from './components/CommandPalette';
import { NonoDock } from './features/nono/NonoDock';
import { StatusBar } from './components/StatusBar';
import { buildPaletteCommands } from './components/paletteCommands';
import { listProjectFiles } from './utils/agentToolsApi';
import { AGENT_FUNCTION_DECLARATIONS } from './agent/fnTools';
import { listTemplates } from './agent/subagentTemplates';
import { SymbolSearchModal } from './components/SymbolSearchModal';

import { useAgent } from './agent/useAgent';
import { useChatStore } from './stores/chatStore';
import { useUIStore } from './stores/uiStore';
import { TabBar } from './components/TabBar';
import { useTabs } from './hooks/useTabs';
import {
  listAgentRoots,
  type AgentRoot,
} from './lib/agentProjects';


import { OnboardingModal } from './components/OnboardingModal';
import { setActiveProjectRoot } from './agent/activeProject';

import { ChatLiveAppViewerModal } from './components/ChatLiveAppViewerModal';
import { ExtensionsManager } from './components/ExtensionsManager';
import type { Language } from './i18n/translations';

/** Fallback estático (sin animación) mientras se descarga un chunk bajo demanda. */
const LazyFallback: React.FC<{ lang: Language }> = ({ lang }) => (
  <div className="flex-1 flex items-center justify-center text-[var(--nc-text)] font-mono text-xs p-4">
    {lang === 'es' ? 'CARGANDO…' : lang === 'de' ? 'LÄDT…' : 'LOADING…'}
  </div>
);

import { resolveMentionsForPrompt } from './utils/mentionResolver';
import { RetroBiosBoot } from './components/RetroBiosBoot';
import { GlobalTooltip } from './components/GlobalTooltip';
import { sendBrowserNotification, playRetroSuccessSound } from './utils/browserNotifications';



import { 
  StudioMode, 
  ChatMessage,
  HistorySession,
  RunMode
} from './types/studio';
import { HUGGINGFACE_MODELS } from './data/models';

export default function App() {
  const chat = useChatStore();
  const ui = useUIStore();
  const { mode, promptTitle, selectedModel, selectedProvider, isGenerating, parameters, messages, history, downloadedModels } = chat.state;
  const [savedCodeContext, setSavedCodeContext] = useState<string>('');

  // --- Roadmap #2: auto-run/tests/refactor on save ---
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const content = typeof detail.content === 'string' ? detail.content : '';
      if (content) {
        setSavedCodeContext(content);
      }
    };
    window.addEventListener('commander:file-saved', handler);
    return () => window.removeEventListener('commander:file-saved', handler);
  }, []);
  const setMode = chat.setMode;
  const setPromptTitle = chat.setPromptTitle;
  const setSelectedModel = chat.setSelectedModel;
  const setSelectedProvider = chat.setSelectedProvider;
  const setIsGenerating = chat.setIsGenerating;
  const setParameters = chat.setParameters;
  const setMessages = chat.setMessages;
  const setHistory = chat.setHistory;
  const setDownloadedModels = chat.setDownloadedModels;
  const [isExtensionsOpen, setIsExtensionsOpen] = useState(false);
  const [isSymbolSearchOpen, setIsSymbolSearchOpen] = useState(false);
  /** Sección que debe mostrar el único panel de Configuración. */
  const [preferencesSection, setPreferencesSection] = useState<SettingsSection>('general');
  const agent = useAgent('.', selectedModel);
  /** Campaña autónoma del servidor: corre fuera del orquestador local. */
  const [autonomousRunning, setAutonomousRunning] = useState(false);
  const sidebarResize = useResizableWidth({ key: 'commander_sidebar_width', defaultWidth: 256, min: 180, max: 400 });

  // Modals
  const {
    isCodeModalOpen, isLibraryModalOpen, isPreferencesModalOpen, isPaletteOpen,
    isAuthModalOpen, isGalleryModalOpen, isVersionHistoryModalOpen, isHelpModalOpen, isAboutModalOpen,
    isCompilerModalOpen, isShortcutsModalOpen, isBooting, isLiveViewerOpen,
    liveViewerSnippets, activeSnippetIndex, isWorkbenchOpen, isSidebarOpen, lang, showTooltips,
    lowResourceMode, powerSaverMode, defaultExportFolder, batteryInfo, isOffline, theme, nonoStatus, projectToast,
    suggestionConfig,
  } = ui.state;
  const setIsCodeModalOpen = ui.setIsCodeModalOpen;
  const setIsLibraryModalOpen = ui.setIsLibraryModalOpen;
  const setIsPreferencesModalOpen = ui.setIsPreferencesModalOpen;
  const setIsPaletteOpen = ui.setIsPaletteOpen;
  const setIsAuthModalOpen = ui.setIsAuthModalOpen;
  const setIsGalleryModalOpen = ui.setIsGalleryModalOpen;
  const setIsVersionHistoryModalOpen = ui.setIsVersionHistoryModalOpen;
  const setIsHelpModalOpen = ui.setIsHelpModalOpen;
  const setIsAboutModalOpen = ui.setIsAboutModalOpen;
  const setIsCompilerModalOpen = ui.setIsCompilerModalOpen;
  const setIsShortcutsModalOpen = ui.setIsShortcutsModalOpen;
  const setIsBooting = ui.setBooting;
  const setIsLiveViewerOpen = ui.setIsLiveViewerOpen;
  const setLiveViewerSnippets = ui.setLiveViewerSnippets;
  const setActiveSnippetIndex = ui.setActiveSnippetIndex;
  const setIsWorkbenchOpen = ui.setIsWorkbenchOpen;
  const setIsSidebarOpen = ui.setIsSidebarOpen;
  const setLang = ui.setLang;
  const setShowTooltips = ui.setShowTooltips;
  const setLowResourceMode = ui.setLowResourceMode;
  const setPowerSaverMode = ui.setPowerSaverMode;
  const setDefaultExportFolder = ui.setDefaultExportFolder;
  const setTheme = ui.setTheme;

  // Un solo punto de entrada: cada botón contextual abre la sección que le
  // corresponde, sin abrir un segundo menú de configuración.
  const openSettings = useCallback(
    (section: SettingsSection = 'general') => {
      setPreferencesSection(section);
      setIsPreferencesModalOpen(true);
    },
    [setIsPreferencesModalOpen]
  );

  // Eventos contextuales para Nono (generando, error, cambio de modo…).
  const setNonoStatus = ui.setNonoStatus;
  const setProjectToast = ui.setProjectToast;
  const wasGeneratingRef = useRef(false);
  const prevModeRef = useRef<StudioMode | null>(null);
  // Ref al FloatingAssistant para abrirlo desde @nono en chat general
  const nonoRef = useRef<FloatingAssistantHandle>(null);
  const [showNono, setShowNono] = useState(() => {
    try { return localStorage.getItem('commander_show_nono') !== 'false'; } catch { return true; }
  });
  const [nonoDocked, setNonoDocked] = useState(() => {
    try { return localStorage.getItem('commander_nono_docked') === 'true'; } catch { return false; }
  });
  const [isolateSessions, setIsolateSessions] = useState(() => {
    try { return localStorage.getItem('commander_isolate_sessions') === 'true'; } catch { return false; }
  });
  useAppEffects({
    showNono,
    isolateSessions,
    nonoRef,
  });
  // Atajo global de la paleta de comandos: Ctrl/Cmd+K
  // Atajo global de la paleta de comandos: Ctrl/Cmd+K
  useCommandPaletteShortcut(setIsPaletteOpen);
  const { handleOpenLiveViewer, handleAddDownloadedModel, handleRemoveDownloadedModel } = useAppModels({
    messages,
    setLiveViewerSnippets,
    setActiveSnippetIndex,
    setIsLiveViewerOpen,
    setDownloadedModels,
  });
  const { currentUser, identity, displayName } = useAppAuth({});


  // Sincronización automática de selectedProvider según el modelo elegido.
  // Los prefijos de proveedor se resuelven ANTES de la heurística de `/` de
  // HuggingFace; antes, elegir `nvidia/meta/...` o `lmstudio/...` lo mandaba a HF.
  useEffect(() => {
    const providerPrefix = /^(ollama|lmstudio|openrouter|pollinations|custom|local|freebuff|openai|nvidia)\//.test(
      selectedModel
    );
    if (providerPrefix) {
      setSelectedProvider(detectProvider(selectedModel, 'google', downloadedModels));
      return;
    }
    const isHfModel =
      selectedModel.includes('/') ||
      HUGGINGFACE_MODELS.some((m) => m.id === selectedModel) ||
      downloadedModels.some((m) => m.hfRepoId === selectedModel || m.id === selectedModel);
    if (isHfModel) {
      setSelectedProvider('huggingface');
    } else if (/^(gpt-|o\d)/i.test(selectedModel)) {
      setSelectedProvider('openai');
    } else if (selectedModel.startsWith('claude')) {
      setSelectedProvider('anthropic');
    } else if (selectedModel.startsWith('gemini') || selectedModel.startsWith('antigravity')) {
      setSelectedProvider('google');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel, downloadedModels]);

  // El id de sesión vive ahora en la pestaña activa (useTabs.currentSessionId).
  // Este ref se mantiene solo como espejo para las llamadas que aún lo usan.
  const currentSessionId = React.useRef<string>(Date.now().toString());

  // ==================== PESTAÑAS Y PROYECTOS ====================

  const tabs = useTabs();
  const [serverSessions, setServerSessions] = useState<any[]>([]);
  const [paletteFiles, setPaletteFiles] = useState<string[]>([]);
  const [agentGoalRequest, setAgentGoalRequest] = useState<{ text: string; nonce: number } | null>(null);
  const [agentRoots, setAgentRoots] = useState<AgentRoot[]>([]);
  const [isAuditing, setIsAuditing] = useState(false);

  /** Convierte los mensajes persistidos (SQLite) al formato del chat. */
  const toChatMessages = useCallback((msgs: any[]) =>
    msgs.map((m: any) => {
      let content = '';
      try { const p = JSON.parse(m.parts_json); content = typeof p === 'string' ? p : (p?.text || p?.content || JSON.stringify(p)); } catch { content = m.parts_json; }
      return { id: `srv-${m.seq}`, role: m.role === 'assistant' ? 'model' : m.role, content, timestamp: new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    }), []);

  /**
   * Un hilo se abre en su propia pestaña, enlazada por `sessionId === thread.id`:
   * antes la conversación se volcaba sobre la pestaña activa y se comía lo que
   * el usuario tuviera delante.
   */
  const handleSelectServerSession = useCallback(async (thread: any) => {
    const owner = tabs.tabs.find((t) => t.sessionId === thread.id);
    if (owner) {
      if (owner.id !== tabs.activeId) { tabs.selectTab(owner.id); return; }
      if (owner.messages.length > 0) return;
    }
    try {
      const { loadMessages } = await import('./agent/persistence');
      const parsed = toChatMessages(await loadMessages(thread.id));
      if (owner) {
        // Pestaña enlazada pero vacía (se cerró el navegador antes del volcado).
        if (parsed.length > 0) { setMessages(parsed as any); setPromptTitle(thread.title || owner.title); }
        return;
      }
      tabs.newTab({
        sessionId: thread.id,
        title: thread.title || 'Sesión restaurada',
        projectPath: thread.project_path || tabs.activeTab?.projectPath || '',
        messages: parsed as any,
      });
      if (parsed.length > 0) setMessages(parsed as any);
      setPromptTitle(thread.title || 'Sesión restaurada');
    } catch { /* servidor caído: no hay nada que abrir */ }
  }, [tabs, setMessages, setPromptTitle, toChatMessages]);

  // ==================== BÚSQUEDA EN CONVERSACIONES ====================
  // /api/search ya existía y nadie lo llamaba: el sidebar sólo filtraba títulos
  // en memoria. Aquí se pide al servidor y se descartan las respuestas que
  // llegan tarde, porque el input escribe más rápido que la red.
  const [searchHits, setSearchHits] = useState<import('./agent/persistence').ConversationHit[]>([]);
  const [isSearchingMessages, setIsSearchingMessages] = useState(false);
  const searchReqRef = React.useRef(0);

  const handleSearchMessages = useCallback(async (q: string) => {
    const term = q.trim();
    const req = ++searchReqRef.current;
    if (term.length < 2) {
      setSearchHits([]);
      setIsSearchingMessages(false);
      return;
    }
    setIsSearchingMessages(true);
    try {
      const { searchConversations } = await import('./agent/persistence');
      const hits = await searchConversations(term, 20);
      if (req !== searchReqRef.current) return; // respuesta vieja
      setSearchHits(hits);
    } catch {
      if (req === searchReqRef.current) setSearchHits([]);
    } finally {
      if (req === searchReqRef.current) setIsSearchingMessages(false);
    }
  }, []);

  const handleOpenSearchResult = useCallback(async (hit: import('./agent/persistence').ConversationHit) => {
    try {
      const { getThread, loadMessages } = await import('./agent/persistence');
      const [thread, msgs] = await Promise.all([getThread(hit.thread_id), loadMessages(hit.thread_id)]);
      const parsed = toChatMessages(msgs);
      if (parsed.length === 0) return;
      setMessages(parsed as any);
      setPromptTitle(thread?.title || 'Sesión restaurada');
      // El chat se vuelve a pintar y él mismo hace scroll al final: el salto se
      // hace después, cuando ya existe el nodo del mensaje buscado.
      setTimeout(() => {
        document
          .querySelector(`[data-msg-id="srv-${hit.seq}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 120);
    } catch { /* ignore */ }
  }, [setMessages, setPromptTitle, toChatMessages]);
  const activeTab = tabs.activeTab;

  // La paleta busca también en los archivos del proyecto activo. Se cargan al
  // abrirla (no al arrancar) y se descarta la respuesta si cambió el proyecto.
  useEffect(() => {
    if (!isPaletteOpen) return;
    const projectPath = activeTab?.projectPath || '';
    if (!projectPath) { setPaletteFiles([]); return; }
    let cancelled = false;
    void listProjectFiles(projectPath).then((res) => {
      if (!cancelled) setPaletteFiles(res.files.slice(0, 150));
    });
    return () => { cancelled = true; };
  }, [isPaletteOpen, activeTab?.projectPath]);

  const handleOpenPaletteFile = useCallback((path: string) => {
    setIsWorkbenchOpen(true);
    // El Workbench escucha este evento aunque esté cerrado; el timeout deja
    // que se monte el editor antes de pedirle la posición.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('commander:open-location', {
        detail: { path, line: 0, character: 0 },
      }));
    }, 0);
  }, [setIsWorkbenchOpen]);

  const handleUsePaletteTool = useCallback((name: string) => {
    const prefix = lang === 'es'
      ? `Usa la herramienta ${name} para `
      : lang === 'de'
        ? `Nutze das Werkzeug ${name}, um `
        : `Use the ${name} tool to `;
    setAgentGoalRequest({ text: prefix, nonce: Date.now() });
    setMode('agent');
  }, [lang, setMode]);

  const handleUsePaletteAgent = useCallback((name: string) => {
    const prefix = lang === 'es'
      ? `Lanza el subagente ${name} para `
      : lang === 'de'
        ? `Starte den Subagenten ${name}, um `
        : `Launch the ${name} subagent to `;
    setAgentGoalRequest({ text: prefix, nonce: Date.now() });
    setMode('agent');
  }, [lang, setMode]);

  // Todos los hilos, no sólo los de la pestaña activa: el sidebar los agrupa por
  // proyecto, y así una sesión abierta en otra carpeta no desaparece.
  const refreshServerSessions = useCallback(async () => {
    try {
      const { listThreads } = await import('./agent/persistence');
      setServerSessions(await listThreads());
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { refreshServerSessions(); }, [refreshServerSessions]);

  // Las conversaciones de chat sólo existían en localStorage. Con este volcado
  // (con retardo) pasan a ser hilos del servidor y se pueden retomar en otra
  // máquina; el id del hilo es el sessionId de la pestaña, así no se duplican.
  useEffect(() => {
    if (!activeTab || messages.length === 0) return;
    void import('./agent/tabSync').then(({ scheduleTabSync }) => {
      scheduleTabSync({ ...activeTab, messages }, refreshServerSessions);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeTab?.sessionId, activeTab?.title, activeTab?.projectPath, refreshServerSessions]);

  /**
   * Otra máquina: localStorage vacío y sin historial, pero el servidor conserva
   * los hilos. Se reanuda ahí el más reciente en la primera pestaña.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (tabs.tabs.length !== 1 || tabs.tabs[0].messages.length > 0) return;
      if (history.length > 0) return;
      try {
        const { listThreads, loadMessages } = await import('./agent/persistence');
        const threads = await listThreads();
        // El orden ya viene con los fijados primero: se retoma el primero libre.
        const latest = threads.find((t) => !t.pinned) || threads[0];
        if (!latest || cancelled) return;
        const parsed = toChatMessages(await loadMessages(latest.id));
        if (cancelled || parsed.length === 0) return;
        const title = latest.title || tabs.tabs[0].title;
        tabs.updateTab({ sessionId: latest.id, title, projectPath: latest.project_path || '', messages: parsed as any });
        setPromptTitle(title);
        setMessages(parsed as any);
      } catch { /* servidor caído: se queda la pestaña vacía */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRenameServerSession = useCallback(async (id: string, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    const { updateThread } = await import('./agent/persistence');
    const updated = await updateThread(id, { title: clean });
    if (updated) setServerSessions((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)));
    else refreshServerSessions();
  }, [refreshServerSessions]);

  const handleToggleServerSessionPin = useCallback(async (thread: any) => {
    const { updateThread } = await import('./agent/persistence');
    const updated = await updateThread(thread.id, { pinned: !thread.pinned });
    // El orden lo pone el servidor (fijados primero): recargar es más simple que reordenar aquí.
    if (updated) await refreshServerSessions();
  }, [refreshServerSessions]);

  const handleDeleteServerSession = useCallback(async (id: string) => {
    // Optimista: la fila desaparece ya; si el servidor falla, se recarga la lista.
    setServerSessions((prev) => prev.filter((t) => t.id !== id));
    // La pestaña enlazada se desengancha: si no, el siguiente volcado resucitaría
    // el hilo que el usuario acaba de borrar.
    const owner = tabs.tabs.find((t) => t.sessionId === id);
    if (owner) tabs.updateTab({ sessionId: 'sess-' + Date.now().toString(36) }, owner.id);
    const { deleteThread } = await import('./agent/persistence');
    if (!(await deleteThread(id))) await refreshServerSessions();
  }, [refreshServerSessions, tabs]);
  const activeTabId = tabs.activeId;

  /**
   * Sincroniza el estado global con la pestaña activa.
   * `suppressSync` evita el efecto inverso durante la hidratación.
   */
  const suppressSync = React.useRef(false);

  // Las entradas de historial antiguas (sin tabId) se asignan a la primera pestaña.
  const firstTabIdRef = React.useRef<string>(tabs.tabs[0]?.id || '');

  // Inicializa firstTabIdRef al montar (evita asignación condicional en cada render).
  useEffect(() => {
    if (!firstTabIdRef.current && tabs.tabs[0]) {
      firstTabIdRef.current = tabs.tabs[0].id;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistencia del historial completo (ya particionado por tabId).
  useEffect(() => {
    try {
      localStorage.setItem('ai_studio_history_sessions', JSON.stringify(history));
    } catch (e) {
      console.warn('Failed to save history sessions to localStorage', e);
    }
  }, [history]);

  // Carga los proyectos permitidos por el servidor.
  useEffect(() => {
    let cancelled = false;
    listAgentRoots()
      .then((roots) => { if (!cancelled) setAgentRoots(roots); })
      .catch(() => { /* el servidor puede no estar arriba */ });
    return () => { cancelled = true; };
  }, []);

  // Las tools del agente necesitan saber en qué proyecto trabaja la pestaña activa.
  useEffect(() => {
    setActiveProjectRoot(activeTab?.projectPath || '');
  }, [activeTab?.projectPath]);

  // El historial de una pestaña comienza con su última conversación guardada.
  useEffect(() => {
    if (!activeTab) return;
    const owner = firstTabIdRef.current;
    const mine = history.filter((h) => (h.tabId || owner) === activeTabId);
    if (mine.length && mine[0].messages?.length && activeTab.messages.length === 0) {
      suppressSync.current = true;
      setMessages([...mine[0].messages]);
      setPromptTitle(mine[0].promptTitle || mine[0].title);
      const t = setTimeout(() => { suppressSync.current = false; }, 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Sincroniza el estado global con la pestaña activa.
   * Al cambiar de pestaña, volcamos el estado actual en la anterior y cargamos el nuevo.
   * `suppressSync` (declarado arriba) evita el efecto inverso durante la hidratación.
   */

  // Estado -> pestaña activa
  useEffect(() => {
    if (suppressSync.current) return;
    tabs.updateTab({ mode, selectedModel, parameters, messages, promptTitle });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedModel, parameters, messages, promptTitle]);

  // Pestaña activa -> estado global
  useEffect(() => {
    if (!activeTab) return;
    suppressSync.current = true;
    setMode(activeTab.mode);
    setSelectedModel(activeTab.selectedModel);
    setParameters(activeTab.parameters);
    setMessages(activeTab.messages);
    currentSessionId.current = activeTab.sessionId;
    if (activeTab.promptTitle) setPromptTitle(activeTab.promptTitle);
    // Se libera en el siguiente tick para no interferir con la hidratación.
    const t = setTimeout(() => { suppressSync.current = false; }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  // Título automático de la pestaña a partir del primer mensaje del usuario.
  useEffect(() => {
    if (!activeTab) return;
    const firstUser = activeTab.messages.find((m) => m.role === 'user');
    if (firstUser) tabs.autoTitle(activeTabId, firstUser.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.messages.length]);

  const { handleTabProject, handleAddDirectory, handleCreateProject, handleRemoveProject } = useTabProjectHandlers({
    tabs,
    setProjectToast,
    isolateSessions,
    agentRoots,
    setAgentRoots,
    activeTab,
  });

  useEffect(() => {
    if (!projectToast) return;
    const t = setTimeout(() => setProjectToast(null), 4000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectToast]);

  /** Audición General: lanza el agente en modo chat sobre el proyecto activo. */


  // Handle Selecting and Restoring Session from History (dentro de la pestaña activa)
  const { handleSelectHistoryItem, handleRunHistoryItem, handleDeleteHistoryItem, handleClearHistory } = useHistoryHandlers({
    activeTabId,
    firstTabIdRef,
    currentSessionId,
    tabs,
    setPromptTitle,
    setMessages,
    setParameters,
    setSelectedModel,
    setMode,
    setLiveViewerSnippets,
    setActiveSnippetIndex,
    setIsLiveViewerOpen,
    setHistory,
    lang,
    selectedModel,
    playRetroSuccessSound,
    sendBrowserNotification,
  });
  /** Historial visible en el sidebar: solo el de la pestaña activa. */
  const { tabHistory, logTelemetry } = useAppTelemetry({
    history,
    activeTabId,
    firstTabIdRef,
  });

  // Handle New Prompt Reset

  // Add or Update Full Session in History (siempre dentro de la pestaña activa)
  const addToHistory = (title: string, currentMode: StudioMode, updatedMsgs?: ChatMessage[]) => {
    const sessionMessages = updatedMsgs || messages;
    const isCustomTitle = promptTitle && !promptTitle.includes('Mi Proyecto Commander') && !promptTitle.includes('Nuevo Proyecto');
    const cleanTitle = isCustomTitle ? promptTitle.trim() : (title || promptTitle || 'Consulta AI Studio');
    const sessionId = activeTab?.sessionId || currentSessionId.current;
    const tabId = activeTabId;
    const entry: HistorySession = {
      id: sessionId,
      title: cleanTitle.slice(0, 45),
      mode: currentMode,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      promptTitle: promptTitle.trim() || cleanTitle,
      messages: sessionMessages,
      parameters,
      selectedModel,
      tabId,
    };

    setHistory((prev) => {
      const existingIdx = prev.findIndex((h) => h.id === sessionId);
      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx] = entry;
        return copy;
      }
      // Recorte por pestaña: cada una mantiene hasta 30 entradas propias.
      const mine = prev.filter((h) => h.tabId === tabId);
      const others = prev.filter((h) => h.tabId !== tabId);
      return [entry, ...mine.slice(0, 29), ...others];
    });
  };

  const { handleSaveVersion, handleLoadVersion } = useAppVersions({
    promptTitle,
    parameters,
    setParameters,
    setPromptTitle,
    setNonoStatus,
  });

  // Keyboard Shortcuts Global Event Listener — extraído a useKeyboardShortcuts.

  // Execution handlers extracted to a custom hook (App.tsx refactor).
  const { handleExecuteFreeform, handleExecuteStructured, handleExecuteHfTab } = useAppExecutors({
    selectedModel,
    selectedProvider,
    parameters,
    downloadedModels,
    lang: lang as string,
    setIsGenerating,
    addToHistory,
    messages,
  });

  // Execution Handler for Chat
  const handleSendMessage = async (userText: string, attachments?: File[], modelOverride?: string, runMode: RunMode = 'build') => {
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      attachments: attachments?.map(f => ({ 
        type: f.type.startsWith('image') ? 'image' : 'file',
        url: URL.createObjectURL(f),
        name: f.name,
        mimeType: f.type
      })),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsGenerating(true);

    // Resolver menciones `@` (docs/params + archivos reales) e inyectarlas como contexto.
    // Nunca debe bloquear el envío: cualquier fallo se ignora silenciosamente.
    try {
      const { context } = await resolveMentionsForPrompt(userText, {
        parameters,
        selectedModel: modelOverride || selectedModel,
      });
      if (context) userText = `${userText}\n\n${context}`;
    } catch {
      /* resolución de menciones best-effort */
    }

    const activeModel = modelOverride || selectedModel;
    // Modo Plan: el agente solo analiza y propone, sin ejecutar cambios.
    const planSuffix =
      runMode === 'plan'
        ? lang === 'es'
          ? '\n\n[MODO PLAN] Estás en modo Plan: analiza, investiga y propone un plan detallado. NO ejecutes cambios, ni escribas ni modifiques archivos; entrega el plan y espera aprobación.'
          : lang === 'de' ? '\n\n[PLANMODUS] Du bist im Planmodus: analysiere, untersuche und schlage einen detaillierten Plan vor. Nimm KEINE Änderungen vor, schreibe oder ändere keine Dateien; liefere den Plan und warte auf Freigabe.' : '\n\n[PLAN MODE] You are in Plan mode: analyze, investigate and propose a detailed plan. Do NOT make changes, write or modify files; deliver the plan and await approval.'
        : '';
    const effectiveSystemInstruction = `${parameters.systemInstruction || ''}${planSuffix}`;
    let currentBotMsgId: string | null = null;

    try {
      const {
        endpoint,
        streamEndpoint,
        isAnthropic,
        isFreeProvider,
        isCustom,
        isLocal,
        isHf,
      } = resolveChatRoute({
        modelId: activeModel,
        provider: selectedProvider,
        downloadedModels,
      });
      const anthropicApiKey = parameters.anthropicApiKey || getCachedApiKey('ANTHROPIC_API_KEY') || undefined;
      const geminiApiKey = getCachedApiKey('GEMINI_API_KEY') || undefined;

      // Convert files to base64 parts
      const fileParts = attachments ? await Promise.all(attachments.map(async (file) => {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
        return {
          inlineData: {
            data: base64,
            mimeType: file.type
          }
        };
      })) : [];

      const historyForProvider = messages.map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: userText }]);

      const payload = isAnthropic
        ? {
            prompt: userText,
            messages: historyForProvider,
            model: activeModel,
            anthropicApiKey,
            systemInstruction: effectiveSystemInstruction,
            temperature: parameters.temperature,
            maxTokens: parameters.maxTokens,
          }
        : isHf
        ? {
            prompt: userText,
            messages: historyForProvider,
            model: activeModel,
            hfApiToken: parameters.hfApiToken || getCachedApiKey('HF_API_TOKEN') || undefined,
            systemInstruction: effectiveSystemInstruction,
            temperature: parameters.temperature,
            maxTokens: parameters.maxTokens,
            geminiApiKey: geminiApiKey || getCachedApiKey('GEMINI_API_KEY') || undefined,
          }
        : isFreeProvider || isLocal
        ? {
            prompt: userText,
            messages: historyForProvider,
            model: isLocal ? activeModel.replace(/^local\//, '') : activeModel,
            systemInstruction: effectiveSystemInstruction,
            temperature: parameters.temperature,
            maxTokens: parameters.maxTokens,
            openrouterApiKey: getCachedApiKey('OPENROUTER_API_KEY') || undefined,
            ollamaHost: getCachedApiKey('OLLAMA_HOST') || undefined,
          }
        : isCustom
        ? {
            prompt: userText,
            messages: historyForProvider,
            model: getCachedApiKey('CUSTOM_MODEL') || activeModel,
            systemInstruction: effectiveSystemInstruction,
            temperature: parameters.temperature,
            maxTokens: parameters.maxTokens,
            baseURL: getCachedApiKey('CUSTOM_BASE_URL') || undefined,
            apiKey: getCachedApiKey('CUSTOM_API_KEY') || getCachedApiKey('OPENCODE_API_KEY') || undefined,
          }
        : {
            apiKey: geminiApiKey,
            contents: [
              ...fileParts,
              { text: parameters.examples.length > 0 
                ? `${parameters.examples.map(ex => `Input: ${ex.input}\nOutput: ${ex.output}`).join('\n\n')}\n\nInput: ${userText}\nOutput:`
                : userText 
              }
            ],
            systemInstruction: effectiveSystemInstruction,
            model: activeModel,
            temperature: parameters.temperature,
            topP: parameters.topP,
            topK: parameters.topK,
            maxTokens: parameters.maxTokens,
            thinkingLevel: parameters.thinkingLevel,
            responseMimeType: parameters.responseFormat === 'json' ? 'application/json' : undefined,
            responseSchema: parameters.responseFormat === 'json' ? parameters.jsonSchema : undefined,
            tools: (() => {
              const t: any[] = [];
              if (parameters.tools?.googleSearch) t.push({ googleSearch: {} });
              if (parameters.tools?.codeExecution) t.push({ codeExecution: {} });
              return t.length > 0 ? t : undefined;
            })(),
          };

      // 0. Antigravity Agent Handler (Gemini Interactions API)
      if (activeModel === 'antigravity-preview-09-2026') {
        const botMsgId = (Date.now() + 1).toString();
        currentBotMsgId = botMsgId;
        const initialBotMsg: ChatMessage = {
          id: botMsgId,
          role: 'model',
          content: '🤖 [Iniciando sesión del Agente Antigravity en Sandbox Linux remoto...]',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          modelUsed: activeModel,
          providerUsed: 'google',
        };
        setMessages((prev) => [...prev, initialBotMsg]);

        const antigravityTools: any[] = [];
        if (parameters.tools?.googleSearch) antigravityTools.push({ type: 'google_search' });
        if (parameters.tools?.codeExecution) antigravityTools.push({ type: 'code_execution' });
        if (parameters.tools?.urlContext !== false) antigravityTools.push({ type: 'url_context' });

        // Find previous interaction & environment from the conversation history
        const lastAgentMsg = [...messages].reverse().find(
          (m) => m.role === 'model' && m.modelUsed === 'antigravity-preview-09-2026' && m.interactionId && m.environmentId
        );

        const previous_interaction_id = lastAgentMsg?.interactionId;
        const environment = lastAgentMsg?.environmentId || 'remote';
        const geminiApiKey = getCachedApiKey('GEMINI_API_KEY') || undefined;

        const response = await fetch('/api/gemini/interactions/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent: 'antigravity-preview-09-2026',
            input: userText,
            environment,
            previous_interaction_id,
            tools: antigravityTools,
            apiKey: geminiApiKey,
          }),
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || 'Error al ejecutar Antigravity Agent');
        }

        const rawSteps = data.interaction.steps || [];
        const parsedSteps: any[] = rawSteps.map((step: any, idx: number) => {
          let type: any = 'thought';
          let title = `Paso #${idx + 1}`;
          let content = '';
          let toolName = step.tool_name || step.name || step.type;

          if (step.thought || step.type === 'thought' || step.thinking) {
            type = 'thought';
            title = '🧠 Razonamiento y Planificación';
            content = step.thought || step.thinking || step.text || JSON.stringify(step, null, 2);
          } else if (step.tool_calls || step.type === 'tool_call' || step.action) {
            type = 'tool_call';
            toolName = step.tool_name || step.name || 'Herramienta';
            title = `⚡ Llamada a ${toolName}`;
            content = typeof step.args === 'object' ? JSON.stringify(step.args, null, 2) : (step.text || JSON.stringify(step, null, 2));
          } else if (step.tool_result || step.type === 'tool_result' || step.output) {
            type = 'tool_result';
            title = `📥 Salida de ${toolName || 'Herramienta'}`;
            content = typeof step.result === 'object' ? JSON.stringify(step.result, null, 2) : String(step.result || step.output || step.text || '');
          } else {
            content = typeof step === 'object' ? JSON.stringify(step, null, 2) : String(step);
          }

          return {
            id: `step_${idx}_${Date.now()}`,
            type,
            title,
            content,
            toolName,
            status: 'completed',
          };
        });

        const finalAgentMsg: ChatMessage = {
          id: botMsgId,
          role: 'model',
          content: data.interaction.output_text || '✓ Interacción completada en el entorno remoto.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          modelUsed: activeModel,
          providerUsed: 'google',
          agentSteps: parsedSteps.length > 0 ? parsedSteps : undefined,
          environmentId: data.interaction.environment_id,
          interactionId: data.interaction.id,
          metrics: {
            latencyMs: data.interaction.latencyMs,
            totalTokens: data.interaction.usage?.total_tokens,
          },
        };

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMsgId ? finalAgentMsg : msg
          )
        );
        setIsGenerating(false);
        addToHistory(userText.slice(0, 30) + '...', 'chat', [...messages, userMsg, finalAgentMsg]);
        sendBrowserNotification(
          lang === 'es' ? '🤖 Tarea de Agente Completada' : lang === 'de' ? '🤖 Agentenaufgabe abgeschlossen' : '🤖 Agent Task Completed',
          lang === 'es' 
            ? `El Agente Antigravity finalizó con éxito en ${(data.interaction.latencyMs / 1000).toFixed(1)}s`
            : lang === 'de'
              ? `Der Antigravity-Agent wurde erfolgreich in ${(data.interaction.latencyMs / 1000).toFixed(1)}s abgeschlossen`
              : `Antigravity Agent completed successfully in ${(data.interaction.latencyMs / 1000).toFixed(1)}s`
        );
        playRetroSuccessSound();
        return;
      }

      if (!isHf && (selectedProvider === 'google' || selectedProvider === 'anthropic')) {
        // Streaming SSE en tiempo real (Google Gemini & Anthropic Claude)
        const botMsgId = (Date.now() + 1).toString();
        currentBotMsgId = botMsgId;
        const initialBotMsg: ChatMessage = {
          id: botMsgId,
          role: 'model',
          content: '',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          modelUsed: activeModel,
          providerUsed: selectedProvider,
        };
        setMessages((prev) => [...prev, initialBotMsg]);

        const streamResponse = await fetch(streamEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!streamResponse.ok || !streamResponse.body) {
          throw new Error('Error al conectar con el flujo de streaming.');
        }

        const reader = streamResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulatedText = '';
        let finalGroundingSources: any[] = [];
        let finalWebSearchQueries: string[] = [];
        let finalMetrics: any = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              let data: any = null;
              try {
                data = JSON.parse(trimmed.slice(6));
              } catch (_err) {
                // Ignore malformed chunk
                continue;
              }
              if (!data) continue;
              if (data.type === 'chunk') {
                accumulatedText += data.text || '';
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === botMsgId ? { ...m, content: accumulatedText } : m
                  )
                );
              } else if (data.type === 'done') {
                accumulatedText = data.fullText || accumulatedText;
                finalGroundingSources = data.groundingSources || [];
                finalWebSearchQueries = data.webSearchQueries || [];
                finalMetrics = data.metrics;
              } else if (data.type === 'error') {
                throw new Error(data.error || 'Error en streaming');
              }
            }
          }
        }

        const finalStreamBotMsg: ChatMessage = {
          id: botMsgId,
          role: 'model',
          content: accumulatedText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          modelUsed: activeModel,
          providerUsed: selectedProvider,
          groundingSources: finalGroundingSources,
          webSearchQueries: finalWebSearchQueries,
          tokensUsed: finalMetrics?.totalTokens,
          latencyMs: finalMetrics?.latencyMs,
        };

        setMessages((prev) =>
          prev.map((m) => (m.id === botMsgId ? finalStreamBotMsg : m))
        );

        addToHistory(userText.slice(0, 30) + '...', 'chat', [...messages, userMsg, finalStreamBotMsg]);
        logTelemetry({
          modelUsed: activeModel,
          latencyMs: finalMetrics?.latencyMs || 0,
          tokensUsed: finalMetrics?.totalTokens || 0,
          error: null,
        });
        sendBrowserNotification(
          lang === 'es' ? '💬 Respuesta Completada' : lang === 'de' ? '💬 Antwort bereit' : '💬 Response Ready',
          lang === 'es'
            ? `${activeModel} respondió en ${((finalMetrics?.latencyMs || 0) / 1000).toFixed(1)}s`
            : lang === 'de'
              ? `${activeModel} antwortete in ${((finalMetrics?.latencyMs || 0) / 1000).toFixed(1)}s`
              : `${activeModel} responded in ${((finalMetrics?.latencyMs || 0) / 1000).toFixed(1)}s`
        );
        playRetroSuccessSound();
      } else {
        // Fallback no-stream para Hugging Face local / Ollama / OpenRouter / Pollinations / Custom / xAI
        // Ollama necesita el host del servidor local en la query (así llega de verdad al server).
        const isOllamaCall = endpoint === '/api/ollama/generate';
        const host = isOllamaCall ? (payload as { ollamaHost?: string }).ollamaHost : undefined;
        const response = await fetch(
          isOllamaCall && host ? `${endpoint}?host=${encodeURIComponent(host)}` : endpoint,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );

        const data = await response.json();

        if (data.success) {
          const botMsg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'model',
            content: data.text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            tokensUsed: data.metrics?.totalTokens,
            latencyMs: data.metrics?.latencyMs,
            thinkingProcess: isHf ? `[Ejecución Local Hugging Face: ${selectedModel}]` : undefined,
            providerUsed: selectedProvider,
            modelUsed: activeModel,
            groundingSources: data.groundingSources,
            webSearchQueries: data.webSearchQueries,
          };

          setMessages((prev) => [...prev, botMsg]);
          addToHistory(userText.slice(0, 30) + '...', 'chat', [...messages, userMsg, botMsg]);
          logTelemetry({
            modelUsed: activeModel,
            latencyMs: data.metrics?.latencyMs || 0,
            tokensUsed: data.metrics?.totalTokens || 0,
            error: null
          });
        } else {
          throw new Error(data.error || 'Error en la respuesta');
        }
      }
    } catch (error: any) {
      setNonoStatus({ type: 'error' });
      logTelemetry({
        modelUsed: activeModel,
        latencyMs: 0,
        tokensUsed: 0,
        error: error.message
      });
      console.error('Error al generar respuesta:', error);
      const errorText = `⚠️ Error al procesar consulta: ${formatErrorMessage(error, activeModel)}`;
      if (currentBotMsgId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === currentBotMsgId ? { ...m, content: errorText } : m
          )
        );
      } else {
        const errorMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'model',
          content: errorText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // handleGeneralAudit and handleNewChat
  const { handleGeneralAudit, handleNewChat } = useAppPrompts({
    activeTab,
    setProjectToast,
    lang,
    tabs,
    setMode,
    handleSendMessage,
    setIsAuditing,
    currentSessionId,
    setPromptTitle,
    setNonoStatus,
  });


  // Keyboard Shortcuts Global Event Listener — extraído a useKeyboardShortcuts.
  useKeyboardShortcuts({
    lang,
    promptTitle,
    parameters,
    tabs,
    setIsShortcutsModalOpen,
    setIsPreferencesModalOpen,
    setIsSidebarOpen,
    setIsWorkbenchOpen,
    setIsCompilerModalOpen,
    setIsSymbolSearchOpen,
    setIsPaletteOpen,
    handleNewChat,
    handleSaveVersion,
    handleGeneralAudit,
    sendBrowserNotification,
  });
  // Nono reacciona al estado de generación (thinking → feliz; errores aparte).
  useEffect(() => {
    if (isGenerating) {
      wasGeneratingRef.current = true;
      setNonoStatus({ type: 'generating' });
    } else if (wasGeneratingRef.current) {
      wasGeneratingRef.current = false;
      setNonoStatus((prev) => (prev?.type === 'error' ? prev : { type: 'done' }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating]);

  // Nono comenta al cambiar de modo.
  useEffect(() => {
    if (prevModeRef.current !== null && prevModeRef.current !== mode) {
      setNonoStatus({ type: 'mode', detail: mode });
    }
    prevModeRef.current = mode;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Select Template from Library / Select Project from Cloud Gallery
  const { handleSelectTemplate, handleSelectGalleryProject } = useAppHandlers({
    setParameters,
    setPromptTitle,
    setSelectedModel,
    setSelectedProvider,
    setMode,
    setMessages,
  });

  if (isBooting) {
    return (
      <RetroBiosBoot 
        onComplete={() => setIsBooting(false)} 
        lang={lang as any} 
        theme={theme} 
      />
    );
  }
  // Paleta de comandos (Ctrl+K): modos, herramientas y vistas.
  const paletteCommands = buildPaletteCommands({
    lang,
    mode,
    setMode,
    handleNewChat,
    setIsGalleryModalOpen,
    setIsLibraryModalOpen,
    setIsSymbolSearchOpen,
    setIsPreferencesModalOpen,
    setIsExtensionsOpen,
    setIsCompilerModalOpen,
    setIsHelpModalOpen,
    setIsAboutModalOpen,
    setIsWorkbenchOpen,
    setIsSidebarOpen,
    files: paletteFiles.map((path) => ({ path, projectPath: activeTab?.projectPath })),
    onOpenFile: handleOpenPaletteFile,
    sessions: serverSessions.map((s: any) => ({ id: s.id, title: s.title, project_path: s.project_path })),
    onSelectSession: (session) => {
      const full = serverSessions.find((s: any) => s.id === session.id);
      if (full) void handleSelectServerSession(full);
    },
    tools: AGENT_FUNCTION_DECLARATIONS.map((tool) => ({ name: tool.name, description: tool.description })),
    onUseTool: handleUsePaletteTool,
    agents: listTemplates().map((agent) => ({ name: agent.name, description: agent.description, role: agent.role })),
    onUseAgent: handleUsePaletteAgent,
  });

  return (
    <div className="flex flex-col h-screen bg-[var(--nc-bg-main)] overflow-hidden">
      {/* Top Header */}
      <Header
        mode={mode}
        setMode={setMode}
        selectedModel={selectedModel}
        onToggleWorkbench={() => setIsWorkbenchOpen((v) => !v)}
        isWorkbenchOpen={isWorkbenchOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        onOpenAuth={() => {
            if (!currentUser) identity.reopen();
            else setIsAuthModalOpen(true);
          }}
        currentUser={currentUser}
        guestName={identity.guestName}
        promptTitle={promptTitle}
        lang={lang as any}
        onOpenHelp={() => setIsHelpModalOpen(true)}
        onOpenAbout={() => setIsAboutModalOpen(true)}
        onOpenCommandPalette={() => setIsPaletteOpen(true)}
        onOpenPreferences={() => openSettings('general')}
        onToggleNono={() => setShowNono((v) => !v)}
        isNonoVisible={showNono}
      />

      {/* Offline Status Banner (Service Worker Active) */}
      {isOffline && (
        <div className="bg-[#880000] text-[var(--nc-text-accent)] px-3 py-1 text-[11px] font-mono font-bold flex items-center justify-between border-b-2 border-black z-30 select-none animate-pulse">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block shadow-[0_0_8px_var(--nc-text-accent)]" />
            <span>
              {lang === 'es'
                ? '⚡ MODO SIN CONEXIÓN (OFFLINE) • SERVICE WORKER ACTIVO: Interfaz y plantillas cargadas desde la caché local'
                : lang === 'de' ? '⚡ OFFLINE-MODUS AKTIV • SERVICE WORKER AKTIV: Kern-Oberfläche & Vorlagen aus dem lokalen Cache geladen' : '⚡ OFFLINE MODE ACTIVE • SERVICE WORKER ACTIVE: Core UI & templates loaded from local cache'}
            </span>
          </div>
          <span className="text-[10px] bg-black/50 px-2 py-0.5 border border-[var(--nc-text-accent)] text-white">
            {lang === 'es' ? 'CACHE ACTIVA' : lang === 'de' ? 'ZWISCHENGESPEICHERT' : 'CACHED'}
          </span>
        </div>
      )}

      {/* Main Workspace Body */}
      {/* Barra de pestañas multi-sesión */}
      <TabBar
        tabs={tabs.tabs}
        activeId={tabs.activeId}
        onSelect={tabs.selectTab}
        onClose={(id) => tabs.closeTab(id)}
        onCloseOthers={tabs.closeOthers}
        onNewTab={() => tabs.newTab()}
        onRename={tabs.renameTab}
        roots={agentRoots}
        onSelectProject={handleTabProject}
        onAddDirectory={handleAddDirectory}
        onCreateProject={handleCreateProject}
        onRemoveProject={handleRemoveProject}
        onGeneralAudit={handleGeneralAudit}
        auditing={isAuditing}
        lang={lang as any}
        isolateSessions={isolateSessions}
        onToggleIsolate={() => setIsolateSessions((v) => !v)}
      />

      {/* Aviso de proyecto (añadido/creado/quitado) */}
      {projectToast && (
        <div
          className={`shrink-0 px-2 py-1 text-[10px] font-mono border-b ${
            projectToast.kind === 'ok'
              ? 'bg-[#003300] text-[var(--nc-success)] border-[var(--nc-success)]/50'
              : 'bg-[#330000] text-[var(--nc-danger)] border-[var(--nc-danger)]/50'
          }`}
        >
          {projectToast.text}
        </div>
      )}

      <div className="flex flex-row flex-1 overflow-hidden nc-container min-h-0 min-w-0 relative">
        {/* Left Navigation Sidebar */}
        {isSidebarOpen && (
          <>
            <Sidebar
              isSidebarOpen={isSidebarOpen}
              mode={mode}
              setMode={setMode}
              recentHistory={tabHistory}
              onSelectHistoryItem={handleSelectHistoryItem}
              onRunHistoryItem={handleRunHistoryItem}
              onDeleteHistoryItem={handleDeleteHistoryItem}
              onClearHistory={handleClearHistory}
              onNewPrompt={handleNewChat}
              onOpenGallery={() => setIsGalleryModalOpen(true)}
              onOpenCompile={() => setIsCompilerModalOpen(true)}
              lang={lang as any}
              width={sidebarResize.width}
              serverSessions={serverSessions}
              onSelectServerSession={handleSelectServerSession}
              onRefreshServerSessions={refreshServerSessions}
              onRenameServerSession={handleRenameServerSession}
              onDeleteServerSession={handleDeleteServerSession}
              onToggleServerSessionPin={handleToggleServerSessionPin}
              searchHits={searchHits}
              isSearchingMessages={isSearchingMessages}
              onSearchMessages={handleSearchMessages}
              onOpenSearchResult={handleOpenSearchResult}
            />
            {/* Drag handle (persisted width) */}
            <div
              onMouseDown={sidebarResize.onMouseDown}
              onDoubleClick={sidebarResize.onDoubleClick}
              className="w-1.5 shrink-0 cursor-col-resize bg-[var(--nc-highlight-bg)]/20 hover:bg-[var(--nc-highlight-bg)]/60 transition-colors z-40"
              title="Arrastra para redimensionar · doble clic para resetear"
            />
          </>
        )}

        {/* Center Canvas View based on active mode */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0 h-full">
          {/* Un solo armazón para los seis playgrounds */}
          <Playground
            mode={mode}
            setMode={setMode}
            lang={lang as any}
            selectedModel={selectedModel}
            chat={{
              messages,
              setMessages,
              parameters,
              selectedModel,
              setSelectedModel,
              isGenerating,
              onSendMessage: handleSendMessage,
              onClearChat: () => setMessages([]),
              lang: lang as any,
              setMode,
              onOpenLiveViewer: handleOpenLiveViewer,
              onOpenLocalLlmConfig: () => openSettings('proveedores'),
              displayName,
              isAuthenticated: !!currentUser,
            }}
            freeform={{
              parameters,
              setParameters,
              selectedModel,
              selectedProvider,
              isGenerating,
              onExecute: handleExecuteFreeform,
              lang: lang as any,
            }}
            structured={{
              parameters,
              selectedModel,
              selectedProvider,
              isGenerating,
              onExecuteStructured: handleExecuteStructured,
              lang: lang as any,
            }}
            composer={{
              parameters,
              setParameters,
              selectedModel,
              lang: lang as any,
            }}
            compare={{
              parameters,
              setParameters,
              lang: lang as any,
            }}
            huggingface={{
              parameters,
              setParameters,
              selectedModel,
              setSelectedModel,
              onExecuteHf: handleExecuteHfTab,
              isGenerating,
              downloadedModels,
              onAddDownloadedModel: handleAddDownloadedModel,
              onRemoveDownloadedModel: handleRemoveDownloadedModel,
              lang: lang as any,
            }}
            fallback={<LazyFallback lang={lang} />}
          />

          {mode === 'telemetry' && (
            <React.Suspense fallback={<LazyFallback lang={lang} />}>
              <TelemetryDashboard lang={lang as any} />
            </React.Suspense>
          )}

          {mode === 'agent' && (
            <React.Suspense fallback={<LazyFallback lang={lang} />}>
            <>
              <AgentMode
                cwd={activeTab?.projectPath || '.'}
                onStartTask={agent.startTask}
                onStop={agent.stop}
                state={agent.state}
                onRunTool={agent.runTool}
                onRestore={agent.restoreSession}
                onContinue={agent.continueSession}
                onFork={agent.forkSession}
                onRollbackRun={agent.rollbackRun}
                onUndoStep={agent.undoStep}
                onRedoStep={agent.redoStep}
                onPlanChange={agent.setPlan}
                onAutonomousRunningChange={setAutonomousRunning}
                goalRequest={agentGoalRequest}
                lang={lang as any}
              />
              {agent.pendingApproval &&
                ((agent.pendingApproval.meta as any)?.kind === 'question' ? (
                  <AgentQuestionModal
                    approval={agent.pendingApproval}
                    onResolve={(ok, answer) => agent.resolveApproval(ok, undefined, answer)}
                    lang={lang as any}
                  />
                ) : (
                  <AgentApprovalModal
                    approval={agent.pendingApproval}
                    onResolve={agent.resolveApproval}
                    lang={lang as any}
                  />
                ))}
            </>
            </React.Suspense>
          )}

          </main>

        {/* Workbench: archivos / pestañas / terminal / navegador (panel derecho) */}
        <WorkbenchPanel
          isOpen={isWorkbenchOpen}
          onClose={() => setIsWorkbenchOpen(false)}
          lang={lang as any}
          projectPath={activeTab?.projectPath || ''}
          tabs={tabs.tabs}
          activeTabId={tabs.activeId}
          onSelectTab={tabs.selectTab}
          onCloseTab={tabs.closeTab}
          onNewTab={() => tabs.newTab()}
          onRenameTab={tabs.renameTab}
          selectedModel={selectedModel}
          parameters={parameters}
        />

        {/* Nono acoplado (panel derecho, ancho arrastrable) */}
        {nonoDocked && showNono && (
          <NonoDock lang={lang as any}>
            <FloatingAssistant
              ref={nonoRef}
              lang={lang as any}
              displayName={displayName}
              projectId={activeTab?.projectPath || null}
              onNewPrompt={handleNewChat}
              status={nonoStatus}
              onOpenWorkbench={() => setIsWorkbenchOpen(true)}
              onOpenCompile={() => setIsCompilerModalOpen(true)}
              onOpenGallery={() => setIsGalleryModalOpen(true)}
              onOpenSearch={() => setIsWorkbenchOpen(true)}
              selectedModel={selectedModel}
              selectedProvider={selectedProvider}
              parameters={parameters}
              suggestionConfig={suggestionConfig}
              hidden={false}
              projectInfo={{ mode: (mode === 'agent' || mode === 'freeform') ? mode : 'chat', goal: promptTitle, hasPackageJson: true, hasTsConfig: true, hasGit: false, framework: 'react', mainLanguage: 'typescript', files: [] }}
              codeContext={savedCodeContext || ''}
              docked={true}
              onToggleDock={() => setNonoDocked(v => { const n = !v; try { localStorage.setItem('commander_nono_docked', String(n)); } catch {} return n; })}
            />
          </NonoDock>
        )}

      </div>

      {/* Code Modal */}
      {isCodeModalOpen && (
        <React.Suspense fallback={<LazyFallback lang={lang} />}>
          <CodeModal
            isOpen={isCodeModalOpen}
            onClose={() => setIsCodeModalOpen(false)}
            selectedModel={selectedModel}
            parameters={parameters}
            promptText={messages[messages.length - 1]?.content || 'Ejemplo de prompt para exportación de código'}
            lang={lang as any}
          />
        </React.Suspense>
      )}

      {/* Biblioteca única: Galería de Proyectos + Librería de Plantillas */}
      {(isGalleryModalOpen || isLibraryModalOpen) && (
        <React.Suspense fallback={<LazyFallback lang={lang} />}>
          <LibraryModal
            isOpen={isGalleryModalOpen || isLibraryModalOpen}
            initialTab={isGalleryModalOpen ? 'gallery' : 'templates'}
            onClose={() => {
              setIsGalleryModalOpen(false);
              setIsLibraryModalOpen(false);
            }}
            onSelectProject={handleSelectGalleryProject}
            onSelectTemplate={handleSelectTemplate}
            currentPromptTitle={promptTitle}
            currentSystemInstruction={parameters.systemInstruction}
            currentSelectedModel={selectedModel}
            parameters={parameters}
            lang={lang as any}
          />
        </React.Suspense>
      )}

      {/* Preferences Modal */}
      {isPreferencesModalOpen && (
        <React.Suspense fallback={<LazyFallback lang={lang} />}>
          <PreferencesModal
            isOpen={isPreferencesModalOpen}
            onClose={() => setIsPreferencesModalOpen(false)}
            theme={theme}
            setTheme={setTheme}
            lang={lang as any}
            setLang={setLang}
            showTooltips={showTooltips}
            setShowTooltips={setShowTooltips}
            lowResourceMode={lowResourceMode}
            setLowResourceMode={setLowResourceMode}
            powerSaverMode={powerSaverMode}
            setPowerSaverMode={setPowerSaverMode}
            batteryInfo={batteryInfo}
            defaultExportFolder={defaultExportFolder}
            setDefaultExportFolder={setDefaultExportFolder}
            selectedModel={selectedModel}
            selectedProvider={selectedProvider}
            parameters={parameters}
            setParameters={setParameters}
            initialSection={preferencesSection}
          />
        </React.Suspense>
      )}

      {/* Extensions Manager */}
      {isExtensionsOpen && (
        <ExtensionsManager
          isOpen={isExtensionsOpen}
          onClose={() => setIsExtensionsOpen(false)}
          lang={lang}
        />
      )}

      {/* Onboarding de primer arranque: registro o invitado */}
      {identity.isOpen && !isBooting && (
        <React.Suspense fallback={<LazyFallback lang={lang} />}>
          <OnboardingModal
            isOpen={identity.isOpen && !isBooting}
            onClose={() => identity.close()}
            onContinueAsGuest={(name) => identity.continueAsGuest(name)}
            onAuthenticated={() => identity.markSeen()}
            lang={lang as any}
            isSwitching={identity.hasSeenOnboarding === true}
          />
        </React.Suspense>
      )}

      {/* User Auth Modal */}
      {isAuthModalOpen && (
        <React.Suspense fallback={<LazyFallback lang={lang} />}>
          <AuthModal
            isOpen={isAuthModalOpen}
            onClose={() => setIsAuthModalOpen(false)}
            currentUser={currentUser}
          />
        </React.Suspense>
      )}

      {/* Version History Modal */}
      {isVersionHistoryModalOpen && (
        <React.Suspense fallback={<LazyFallback lang={lang} />}>
          <VersionHistoryModal
            isOpen={isVersionHistoryModalOpen}
            onClose={() => setIsVersionHistoryModalOpen(false)}
            projectId={promptTitle.toLowerCase().replace(/[^a-z0-9]/g, '-')}
            currentInstruction={parameters.systemInstruction}
            onLoadVersion={handleLoadVersion}
          />
        </React.Suspense>
      )}

      {/* Live Voice Realtime Modal */}
      {mode === 'live_voice' && (
        <React.Suspense fallback={<LazyFallback lang={lang} />}>
          <LiveVoiceModal
            isOpen={mode === 'live_voice'}
            onClose={() => setMode('chat')}
            selectedModel={selectedModel}
            parameters={parameters}
            lang={lang as any}
          />
        </React.Suspense>
      )}

      {/* Detailed Help Manual Modal */}
      {isHelpModalOpen && (
        <React.Suspense fallback={<LazyFallback lang={lang} />}>
          <HelpModal
            isOpen={isHelpModalOpen}
            onClose={() => setIsHelpModalOpen(false)}
            lang={lang as any}
          />
        </React.Suspense>
      )}

      {/* About Modal */}
      {isAboutModalOpen && (
        <React.Suspense fallback={<LazyFallback lang={lang} />}>
          <AboutModal
            isOpen={isAboutModalOpen}
            onClose={() => setIsAboutModalOpen(false)}
            lang={lang as any}
          />
        </React.Suspense>
      )}

      {/* Compiler & Native Artifact Builder Modal */}
      {isCompilerModalOpen && (
        <React.Suspense fallback={<LazyFallback lang={lang} />}>
          <CompilerModal
            isOpen={isCompilerModalOpen}
            onClose={() => setIsCompilerModalOpen(false)}
            onSuccess={() => setNonoStatus({ type: 'success' })}
            promptTitle={promptTitle}
            selectedModel={selectedModel}
            parameters={parameters}
            defaultPrompt={messages[messages.length - 1]?.content || 'Prompt ejecutable nativo'}
            defaultExportFolder={defaultExportFolder}
            lang={lang as any}
          />
        </React.Suspense>
      )}

      {/* Keyboard Shortcuts Help Overlay Modal */}
      {isShortcutsModalOpen && (
        <React.Suspense fallback={<LazyFallback lang={lang} />}>
          <KeyboardShortcutsModal
            isOpen={isShortcutsModalOpen}
            onClose={() => setIsShortcutsModalOpen(false)}
            lang={lang as any}
          />
        </React.Suspense>
      )}

      {/* Universal Chat Live App Viewer Modal */}
      <ChatLiveAppViewerModal
        isOpen={isLiveViewerOpen}
        onClose={() => setIsLiveViewerOpen(false)}
        snippets={liveViewerSnippets}
        initialSnippetIndex={activeSnippetIndex}
        onSendToComposer={(_code, _lang) => {
          setIsLiveViewerOpen(false);
          setMode('composer');
        }}
        lang={lang as any}
      />

      {/* Global Interactive Hover Tooltip System */}
      <GlobalTooltip />

      {/* Nono - Asistente flotante interactivo */}
      {!nonoDocked && (
      <FloatingAssistant
        lang={lang as any}
        displayName={displayName}
        projectId={activeTab?.projectPath || null}
        onNewPrompt={handleNewChat}
        status={nonoStatus}
        onOpenWorkbench={() => setIsWorkbenchOpen(true)}
        onOpenCompile={() => setIsCompilerModalOpen(true)}
        onOpenGallery={() => setIsGalleryModalOpen(true)}
        onOpenSearch={() => setIsWorkbenchOpen(true)}
        selectedModel={selectedModel}
        selectedProvider={selectedProvider}
        parameters={parameters}
        suggestionConfig={suggestionConfig}
        hidden={!showNono}
        projectInfo={{
          mode: (mode === 'agent' || mode === 'freeform') ? mode : 'chat',
          goal: promptTitle,
          hasPackageJson: true,
          hasTsConfig: true,
          hasGit: false,
          framework: 'react',
          mainLanguage: 'typescript',
          files: [],
        }}
        codeContext={savedCodeContext ||
          (() => {
            const msgs = (messages || []) as Array<{ text?: string; content?: string }>;
            for (let i = msgs.length - 1; i >= 0; i--) {
              const text = msgs[i]?.text || msgs[i]?.content || '';
              if (typeof text === 'string' && text.includes('```')) return text;
            }
            const last = msgs[msgs.length - 1];
            return last ? (last.text || last.content || '') : '';
          })()}
      />
      )}

      {/* Búsqueda de símbolos del workspace (LSP) */}
      {isSymbolSearchOpen && (
        <SymbolSearchModal
          isOpen={isSymbolSearchOpen}
          onClose={() => setIsSymbolSearchOpen(false)}
          projectPath={activeTab?.projectPath || ''}
          lang={lang as any}
        />
      )}

      {/* Paleta de comandos (Ctrl+K) */}
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        commands={paletteCommands}
        lang={lang as any}
      />
      {/* Status bar Norton */}
      <StatusBar lang={lang as any} model={selectedModel} isGenerating={isGenerating || agent.state.running || autonomousRunning} />
    </div>
  );
}


