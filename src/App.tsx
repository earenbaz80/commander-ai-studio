import { getCachedApiKey } from './lib/apiKeys';

import { resolveChatRoute } from './lib/aiRouting';
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
import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { FloatingAssistant, type FloatingAssistantHandle } from './components/FloatingAssistant';
import { WorkbenchPanel } from './components/WorkbenchPanel';
import { Sidebar } from './components/Sidebar';
import { RightPanel } from './components/RightPanel';
import { ChatPlayground } from './components/ChatPlayground';
import { FreeformPlayground } from './components/FreeformPlayground';
import { StructuredPlayground } from './components/StructuredPlayground';
import { ComposerPlayground } from './components/ComposerPlayground';
// Vistas pesadas y modales bajo demanda: no forman parte del primer pintado.
// Cada una vive en su propio chunk y se descarga al abrirse por primera vez.
const HuggingFacePlayground = React.lazy(() =>
  import('./components/HuggingFacePlayground').then((m) => ({ default: m.HuggingFacePlayground }))
);
const CodeModal = React.lazy(() =>
  import('./components/CodeModal').then((m) => ({ default: m.CodeModal }))
);
const PreferencesModal = React.lazy(() =>
  import('./components/PreferencesModal').then((m) => ({ default: m.PreferencesModal }))
);
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
const ComparePlayground = React.lazy(() =>
  import('./components/ComparePlayground').then((m) => ({ default: m.ComparePlayground }))
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
const LocalLlmModal = React.lazy(() =>
  import('./components/LocalLlmModal').then((m) => ({ default: m.LocalLlmModal }))
);
const AgentMode = React.lazy(() =>
  import('./components/AgentMode').then((m) => ({ default: m.AgentMode }))
);
const AgentApprovalModal = React.lazy(() =>
  import('./components/AgentApprovalModal').then((m) => ({ default: m.AgentApprovalModal }))
);
import { CommandPalette } from './components/CommandPalette';
import { buildPaletteCommands } from './components/paletteCommands';
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
import { McpServerManager } from './components/McpServerManager';
import { ExtensionsManager } from './components/ExtensionsManager';
import type { Language } from './i18n/translations';

/** Fallback estático (sin animación) mientras se descarga un chunk bajo demanda. */
const LazyFallback: React.FC<{ lang: Language }> = ({ lang }) => (
  <div className="flex-1 flex items-center justify-center text-[#00ffff] font-mono text-xs p-4">
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
  const [isMcpManagerOpen, setIsMcpManagerOpen] = useState(false);
  const [isExtensionsOpen, setIsExtensionsOpen] = useState(false);
  const [isSymbolSearchOpen, setIsSymbolSearchOpen] = useState(false);
  const agent = useAgent('.', selectedModel);

  // Modals
  const {
    isCodeModalOpen, isLibraryModalOpen, isPreferencesModalOpen, isInspectorOpen, isPaletteOpen,
    isAuthModalOpen, isGalleryModalOpen, isVersionHistoryModalOpen, isHelpModalOpen, isAboutModalOpen,
    isCompilerModalOpen, isShortcutsModalOpen, isLocalLlmModalOpen, isBooting, isLiveViewerOpen,
    liveViewerSnippets, activeSnippetIndex, isWorkbenchOpen, isSidebarOpen, lang, showTooltips,
    lowResourceMode, powerSaverMode, defaultExportFolder, batteryInfo, isOffline, theme, nonoStatus, projectToast,
    suggestionConfig,
  } = ui.state;
  const setIsCodeModalOpen = ui.setIsCodeModalOpen;
  const setIsLibraryModalOpen = ui.setIsLibraryModalOpen;
  const setIsPreferencesModalOpen = ui.setIsPreferencesModalOpen;
  const setIsInspectorOpen = ui.setIsInspectorOpen;
  const setIsPaletteOpen = ui.setIsPaletteOpen;
  const setIsAuthModalOpen = ui.setIsAuthModalOpen;
  const setIsGalleryModalOpen = ui.setIsGalleryModalOpen;
  const setIsVersionHistoryModalOpen = ui.setIsVersionHistoryModalOpen;
  const setIsHelpModalOpen = ui.setIsHelpModalOpen;
  const setIsAboutModalOpen = ui.setIsAboutModalOpen;
  const setIsCompilerModalOpen = ui.setIsCompilerModalOpen;
  const setIsShortcutsModalOpen = ui.setIsShortcutsModalOpen;
  const setIsLocalLlmModalOpen = ui.setIsLocalLlmModalOpen;
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


  // Sincronización automática de selectedProvider según el modelo elegido
  useEffect(() => {
    const isHfModel =
      selectedModel.includes('/') ||
      HUGGINGFACE_MODELS.some((m) => m.id === selectedModel) ||
      downloadedModels.some((m) => m.hfRepoId === selectedModel || m.id === selectedModel);
    if (isHfModel) {
      setSelectedProvider('huggingface');
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
  const [agentRoots, setAgentRoots] = useState<AgentRoot[]>([]);
  const [isAuditing, setIsAuditing] = useState(false);

  const activeTab = tabs.activeTab;
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

      const payload = isAnthropic
        ? {
            prompt: userText,
            messages: messages.map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: userText }]),
            model: activeModel,
            anthropicApiKey,
            systemInstruction: effectiveSystemInstruction,
            temperature: parameters.temperature,
            maxTokens: parameters.maxTokens,
          }
        : isHf
        ? {
            prompt: userText,
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
              if (parameters.tools?.customFunctions && parameters.tools.customFunctions.length > 0) {
                const funcs = parameters.tools.customFunctions.map((f) => {
                  let parsedParams = {};
                  try {
                    parsedParams = typeof f.parametersJson === 'string' ? JSON.parse(f.parametersJson) : f.parametersJson;
                  } catch (e) {
                    console.warn('Error parsing function params JSON:', e);
                  }
                  return {
                    name: f.name,
                    description: f.description,
                    parameters: parsedParams,
                  };
                });
                t.push({ functionDeclarations: funcs });
              }
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
        let finalFunctionCalls: any[] = [];
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
                finalFunctionCalls = data.functionCalls || [];
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
          functionCalls: finalFunctionCalls,
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
            functionCalls: data.functionCalls,
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

  // handleGeneralAudit and handleNewPrompt
  const { handleGeneralAudit, handleNewPrompt } = useAppPrompts({
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
    setIsInspectorOpen,
    setIsSidebarOpen,
    setIsWorkbenchOpen,
    setIsCompilerModalOpen,
    setIsSymbolSearchOpen,
    handleNewPrompt,
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
    handleNewPrompt,
    setIsGalleryModalOpen,
    setIsLibraryModalOpen,
    setIsInspectorOpen,
    setIsSymbolSearchOpen,
    setIsPreferencesModalOpen,
    setIsLocalLlmModalOpen,
    setIsMcpManagerOpen,
    setIsExtensionsOpen,
    setIsCompilerModalOpen,
    setIsHelpModalOpen,
    setIsAboutModalOpen,
    setIsWorkbenchOpen,
    setIsSidebarOpen,
  });

  return (
    <div className="flex flex-col h-screen bg-[#131314] overflow-hidden">
      {/* Top Header */}
      <Header
        mode={mode}
        setMode={setMode}
        selectedModel={selectedModel}
        onOpenInspector={() => setIsInspectorOpen(!isInspectorOpen)}
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
        onOpenPreferences={() => setIsPreferencesModalOpen(true)}
        onToggleNono={() => setShowNono((v) => !v)}
        isNonoVisible={showNono}
      />

      {/* Offline Status Banner (Service Worker Active) */}
      {isOffline && (
        <div className="bg-[#880000] text-[#ffff55] px-3 py-1 text-[11px] font-mono font-bold flex items-center justify-between border-b-2 border-black z-30 select-none animate-pulse">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block shadow-[0_0_8px_#ffff55]" />
            <span>
              {lang === 'es'
                ? '⚡ MODO SIN CONEXIÓN (OFFLINE) • SERVICE WORKER ACTIVO: Interfaz y plantillas cargadas desde la caché local'
                : lang === 'de' ? '⚡ OFFLINE-MODUS AKTIV • SERVICE WORKER AKTIV: Kern-Oberfläche & Vorlagen aus dem lokalen Cache geladen' : '⚡ OFFLINE MODE ACTIVE • SERVICE WORKER ACTIVE: Core UI & templates loaded from local cache'}
            </span>
          </div>
          <span className="text-[10px] bg-black/50 px-2 py-0.5 border border-[#ffff55] text-white">
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
              ? 'bg-[#003300] text-[#00ff00] border-[#00ff00]/50'
              : 'bg-[#330000] text-[#ff5555] border-[#ff5555]/50'
          }`}
        >
          {projectToast.text}
        </div>
      )}

      <div className="flex flex-row flex-1 overflow-hidden nc-container min-h-0 min-w-0 relative">
        {/* Left Navigation Sidebar */}
        {isSidebarOpen && (
          <Sidebar
            mode={mode}
            setMode={setMode}
            recentHistory={tabHistory}
            onSelectHistoryItem={handleSelectHistoryItem}
            onRunHistoryItem={handleRunHistoryItem}
            onDeleteHistoryItem={handleDeleteHistoryItem}
            onClearHistory={handleClearHistory}
            onNewPrompt={handleNewPrompt}
            onOpenGallery={() => setIsGalleryModalOpen(true)}
            onOpenCompile={() => setIsCompilerModalOpen(true)}
            onOpenLocalLlmConfig={() => setIsLocalLlmModalOpen(true)}
            parameters={parameters}
            setParameters={setParameters}
            lang={lang as any}
          />
        )}

        {/* Center Canvas View based on active mode */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0 h-full">
          {mode === 'chat' && (
            <ChatPlayground
              messages={messages}
              setMessages={setMessages}
              parameters={parameters}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              isGenerating={isGenerating}
              onSendMessage={handleSendMessage}
              onClearChat={() => setMessages([])}
              lang={lang as any}
              setMode={setMode}
              onOpenLiveViewer={handleOpenLiveViewer}
              onOpenLocalLlmConfig={() => setIsLocalLlmModalOpen(true)}
              displayName={displayName}
              isAuthenticated={!!currentUser}
            />
          )}

          {mode === 'freeform' && (
            <FreeformPlayground
              parameters={parameters}
              setParameters={setParameters}
              selectedModel={selectedModel}
              selectedProvider={selectedProvider}
              isGenerating={isGenerating}
              onExecute={handleExecuteFreeform}
              lang={lang as any}
            />
          )}

          {mode === 'structured' && (
            <StructuredPlayground
              parameters={parameters}
              selectedModel={selectedModel}
              selectedProvider={selectedProvider}
              isGenerating={isGenerating}
              onExecuteStructured={handleExecuteStructured}
              lang={lang as any}
            />
          )}

          {mode === 'composer' && (
            <ComposerPlayground
              parameters={parameters}
              setParameters={setParameters}
              selectedModel={selectedModel}
              lang={lang as any}
            />
          )}

          {mode === 'compare' && (
            <React.Suspense fallback={<LazyFallback lang={lang} />}>
              <ComparePlayground
                parameters={parameters}
                setParameters={setParameters}
                lang={lang as any}
              />
            </React.Suspense>
          )}

          {mode === 'huggingface' && (
            <React.Suspense fallback={<LazyFallback lang={lang} />}>
              <HuggingFacePlayground
              parameters={parameters}
              setParameters={setParameters}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              onExecuteHf={handleExecuteHfTab}
              isGenerating={isGenerating}
              downloadedModels={downloadedModels}
              onAddDownloadedModel={handleAddDownloadedModel}
              onRemoveDownloadedModel={handleRemoveDownloadedModel}
              lang={lang as any}
            />
            </React.Suspense>
          )}

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
                onFork={agent.forkSession}
                onRollbackRun={agent.rollbackRun}
                onPlanChange={agent.setPlan}
                lang={lang as any}
              />
              {agent.pendingApproval && (
                <AgentApprovalModal
                  approval={agent.pendingApproval}
                  onResolve={agent.resolveApproval}
                  lang={lang as any}
                />
              )}
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

        {/* Right Parameters Panel (Hidden in Exporter mode to give max space to wizard) */}
        {isInspectorOpen && (
          <RightPanel
            parameters={parameters}
            setParameters={setParameters}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            selectedProvider={selectedProvider}
            setSelectedProvider={setSelectedProvider}
            setMode={setMode}
            onShowCodeModal={() => setIsCodeModalOpen(true)}
            onSaveVersion={handleSaveVersion}
            onViewHistory={() => setIsVersionHistoryModalOpen(true)}
            onClose={() => setIsInspectorOpen(false)}
            lang={lang as any}
            showTooltips={showTooltips}
            onOpenHelp={() => setIsHelpModalOpen(true)}
            onOpenAbout={() => setIsAboutModalOpen(true)}
            onOpenCompile={() => setIsCompilerModalOpen(true)}
            onOpenLocalLlmConfig={() => setIsLocalLlmModalOpen(true)}
          />
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
          />
        </React.Suspense>
      )}

      {/* MCP Server Manager */}
      {isMcpManagerOpen && (
        <McpServerManager
          isOpen={isMcpManagerOpen}
          onClose={() => setIsMcpManagerOpen(false)}
        />
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

      {/* Local LLM Server Configuration Modal */}
      {isLocalLlmModalOpen && (
        <React.Suspense fallback={<LazyFallback lang={lang} />}>
          <LocalLlmModal
            isOpen={isLocalLlmModalOpen}
            onClose={() => setIsLocalLlmModalOpen(false)}
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
      <FloatingAssistant
        ref={nonoRef}
        lang={lang as any}
        displayName={displayName}
        onNewPrompt={handleNewPrompt}
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
    </div>
  );
}


