import { useCallback } from 'react';
import type { HistorySession, ChatMessage } from '../types/studio';
import type { ChatCodeSnippet } from '../components/ChatLiveAppViewerModal';
import { extractSnippetsFromMessages } from '../utils/codeSnippetExtractor';

export interface HistoryHandlersOptions {
  activeTabId: string;
  firstTabIdRef: React.MutableRefObject<string>;
  currentSessionId: React.MutableRefObject<string>;
  tabs: any;
  setPromptTitle: (title: string) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setParameters: (params: any) => void;
  setSelectedModel: (model: string) => void;
  setMode: (mode: any) => void;
  setLiveViewerSnippets: (snippets: ChatCodeSnippet[]) => void;
  setActiveSnippetIndex: (index: number) => void;
  setIsLiveViewerOpen: (open: boolean) => void;
  setHistory: (fn: (prev: HistorySession[]) => HistorySession[]) => void;
  lang: string;
  selectedModel: string;
  playRetroSuccessSound: () => void;
  sendBrowserNotification: (title: string, body: string) => void;
}

export function useHistoryHandlers(opts: HistoryHandlersOptions) {
  const {
    activeTabId, firstTabIdRef, currentSessionId, tabs,
    setPromptTitle, setMessages, setParameters, setSelectedModel, setMode,
    setLiveViewerSnippets, setActiveSnippetIndex, setIsLiveViewerOpen, setHistory,
    lang, selectedModel, playRetroSuccessSound, sendBrowserNotification,
  } = opts;

  const handleSelectHistoryItem = useCallback((item: HistorySession) => {
    const owner = item.tabId || firstTabIdRef.current;
    if (owner !== activeTabId) return;

    currentSessionId.current = item.id;
    tabs.updateTab({ sessionId: item.id });
    const displayTitle = item.promptTitle || item.title || 'Proyecto Restaurado';
    setPromptTitle(displayTitle);

    if (item.messages && Array.isArray(item.messages) && item.messages.length > 0) {
      setMessages([...item.messages]);
    } else {
      const queryText = item.title || displayTitle;
      setMessages([
        {
          id: `${item.id}-usr`,
          role: 'user',
          content: queryText,
          timestamp: item.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
        {
          id: `${item.id}-ai`,
          role: 'model',
          content: `✓ Sesión "${displayTitle}" restaurada desde el historial.\n\nPuedes continuar la conversación o solicitar nuevas aplicaciones interactivas.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          modelUsed: item.selectedModel || selectedModel,
        }
      ]);
    }

    if (item.parameters) {
      setParameters({ ...item.parameters });
    }

    if (item.selectedModel) {
      setSelectedModel(item.selectedModel);
    }

    setMode(item.mode || 'chat');

    playRetroSuccessSound();
    sendBrowserNotification(
      lang === 'es' ? '📂 Sesión Restaurada' : lang === 'de' ? '📂 Sitzung wiederhergestellt' : '📂 Session Restored',
      lang === 'es'
        ? `Se ha restaurado "${displayTitle}" en el espacio de trabajo.`
        : lang === 'de'
          ? `"${displayTitle}" wurde im Arbeitsbereich wiederhergestellt.`
          : `"${displayTitle}" restored to workspace.`
    );
  }, [activeTabId, firstTabIdRef, currentSessionId, tabs, setPromptTitle, setMessages, setParameters, setSelectedModel, setMode, lang, selectedModel, playRetroSuccessSound, sendBrowserNotification]);

  const handleRunHistoryItem = useCallback((item: HistorySession) => {
    handleSelectHistoryItem(item);

    let snippets: ChatCodeSnippet[] = [];
    if (item.messages && Array.isArray(item.messages) && item.messages.length > 0) {
      snippets = extractSnippetsFromMessages(item.messages);
    } else if (item.codeSnippet) {
      snippets = [
        {
          id: `${item.id}-snippet`,
          title: item.promptTitle || item.title || 'App Ejecutable',
          language: item.codeLanguage || 'html',
          code: item.codeSnippet,
        }
      ];
    }

    if (snippets.length === 0 || (snippets.length === 1 && snippets[0].id === 'default-app')) {
      const displayTitle = item.promptTitle || item.title || 'Sesión Historial';
      snippets = [
        {
          id: `${item.id}-interactive-runner`,
          title: displayTitle,
          language: 'html',
          code: `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${displayTitle}</title>
  <style>
    body { background: #000080; color: #ffff55; font-family: monospace; padding: 24px; text-align: center; }
    .box { border: 2px solid #00ffff; background: #0000aa; padding: 24px; max-width: 550px; margin: 40px auto; box-shadow: 4px 4px 0px #000033; }
    h2 { color: #00ffff; margin-top: 0; }
    p { color: #ffffff; line-height: 1.6; font-size: 13px; }
    .badge { background: #000055; border: 1px solid #00ffff; color: #00ffff; padding: 4px 10px; display: inline-block; margin-bottom: 15px; font-size: 11px; }
    button { background: #ffff55; color: #000; border: 2px solid #fff; padding: 8px 20px; font-weight: bold; cursor: pointer; margin-top: 15px; font-family: monospace; font-size: 12px; }
    button:hover { background: #00ffff; }
  </style>
</head>
<body>
  <div class="box">
    <div class="badge">COMMANDER LIVE VIEWER • SESIÓN RESTAURADA</div>
    <h2>⚡ ${displayTitle}</h2>
    <p>Esta conversación fue cargada con éxito en el chat. Para ejecutar aplicaciones completas (HTML, CSS, JS o React), puedes pedirle a la IA que cree una app o juego en el chat.</p>
    <button onclick="alert('✓ ¡Sesión activa en Commander AI Studio!')">PROBAR INTERACCIÓN</button>
  </div>
</body>
</html>`
        }
      ];
    }

    setLiveViewerSnippets(snippets);
    setActiveSnippetIndex(snippets.length > 0 ? snippets.length - 1 : 0);
    setIsLiveViewerOpen(true);
  }, [handleSelectHistoryItem, setLiveViewerSnippets, setActiveSnippetIndex, setIsLiveViewerOpen]);

  const handleDeleteHistoryItem = useCallback((id: string) => {
    setHistory((prev) => {
      const target = prev.find((h) => h.id === id);
      if (!target) return prev;
      const owner = target.tabId || firstTabIdRef.current;
      if (owner !== activeTabId) return prev;
      return prev.filter((item) => item.id !== id);
    });
  }, [setHistory, firstTabIdRef, activeTabId]);

  const handleClearHistory = useCallback(() => {
    const tabId = activeTabId;
    setHistory((prev) => prev.filter((item) => {
      const owner = item.tabId || firstTabIdRef.current;
      return owner !== tabId;
    }));
    tabs.updateTab({ messages: [], sessionId: `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` });
  }, [activeTabId, setHistory, firstTabIdRef, tabs]);

  return { handleSelectHistoryItem, handleRunHistoryItem, handleDeleteHistoryItem, handleClearHistory };
}
