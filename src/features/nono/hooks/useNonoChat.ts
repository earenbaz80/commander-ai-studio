import { useState, useRef, useCallback, useImperativeHandle, useEffect } from 'react';
import type { Message, FloatingAssistantHandle, FloatingAssistantProps, Language, NonoExpression } from '../../../components/nono/content';
import { askNonoDetailed, type AskNonoResult } from '../../../utils/nonoAsk';
import { GREETINGS_ES, GREETINGS_EN, GREETINGS_DE, getExpressionForText, getResponse } from '../../../components/nono/content';
import { loadNonoChat, saveNonoChat, clearNonoChat } from '../nonoChatPersistence';

interface UseNonoChatOptions {
  lang: Language;
  displayName?: string;
  onNewPrompt?: () => void;
  onOpenWorkbench?: () => void;
  onOpenCompile?: () => void;
  onOpenGallery?: () => void;
  onOpenSearch?: () => void;
  selectedModel?: string;
  selectedProvider?: string;
  parameters?: FloatingAssistantProps['parameters'];
  codeContext?: string;
  /** Proyecto activo: separa el historial guardado de cada workspace. */
  projectId?: string | null;
  /** Contexto de proyecto que se manda al modelo (framework, tests, objetivo). */
  projectInfo?: FloatingAssistantProps['projectInfo'];
  inputRef: React.RefObject<HTMLInputElement | null>;
  ref: React.ForwardedRef<FloatingAssistantHandle>;
}

interface UseNonoChatReturn {
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  expression: NonoExpression;
  setExpression: React.Dispatch<React.SetStateAction<NonoExpression>>;
  messages: Message[];
  inputValue: string;
  setInputValue: (v: string) => void;
  isTyping: boolean;
  handleToggle: () => void;
  handleSend: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  handleClearChat: () => void;
  handleCopyLast: () => Promise<void>;
  handleNewPromptClick: () => void;
  /** Aviso efímero de la última acción (limpiar, copiar, comando) para la cabecera. */
  actionFeedback: string;
}

/**
 * Hook para lógica de chat de Nono.
 * - Mensajes + input + typing state, con historial persistido por proyecto
 * - Comandos rápidos (/workbench, /compile, etc.)
 * - Respuesta real con el proveedor activo y fallback a plantillas si tarda
 * - Handle imperativo para abrir con prompt desde fuera
 */
export function useNonoChat({
  lang,
  displayName: _displayName,
  onNewPrompt,
  onOpenWorkbench,
  onOpenCompile,
  onOpenGallery,
  onOpenSearch,
  selectedModel,
  selectedProvider,
  parameters,
  codeContext,
  projectId = null,
  projectInfo,
  inputRef,
  ref,
}: UseNonoChatOptions): UseNonoChatReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [expression, setExpression] = useState<NonoExpression>('neutral');
  const [messages, setMessages] = useState<Message[]>(() => loadNonoChat(projectId));
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [actionFeedback, setActionFeedback] = useState('');

  const onAskRef = useRef<(text: string) => Promise<AskNonoResult>>(async () => ({ text: null }));
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const handleSendRef = useRef<(() => void) | undefined>(undefined);

  // Se guarda el hilo para poder retomarlo tras recargar. El `<FloatingAssistant>`
  // se remonta al cambiar de proyecto, así que la clave no cambia en caliente.
  useEffect(() => {
    saveNonoChat(projectId, messages);
  }, [projectId, messages]);

  // Mantiene ask actualizado con parámetros e historial actuales.
  const ask = useCallback(
    async (text: string) => {
      return askNonoDetailed(text, {
        selectedModel,
        selectedProvider,
        parameters,
        lang,
        codeContext,
        projectInfo,
        history: messages
          .filter((m) => m.text.trim().length > 0)
          .slice(-8)
          .map((m) => ({ fromUser: m.fromUser, text: m.text })),
      });
    },
    [selectedModel, selectedProvider, parameters, lang, codeContext, projectInfo, messages]
  );
  onAskRef.current = ask;

  // Scroll al final
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cerrar con Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const addMessage = useCallback((text: string, fromUser: boolean) => {
    const msg: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text,
      fromUser,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, msg]);
  }, []);

  /** Aviso breve en la cabecera del panel; se autolimpia a los 1,8 s. */
  const showActionFeedback = useCallback((message: string) => {
    setActionFeedback(message);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setActionFeedback(''), 1800);
  }, []);

  // Limpieza de temporizadores pendientes al desmontar
  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    };
  }, []);

  /**
   * Comandos rápidos del chat. Cada uno abre su panel mediante el callback que
   * recibe el componente; si ese callback no existe, el comando se reporta como
   * desconocido en vez de fallar en silencio.
   */
  const handleCommand = useCallback((cmdRaw: string) => {
    const cmd = cmdRaw.toLowerCase();
    if (cmd.startsWith('/workbench') && onOpenWorkbench) {
      onOpenWorkbench();
      showActionFeedback(lang === 'es' ? '🧩 Abriendo Workbench' : lang === 'de' ? '🧩 Workbench wird geöffnet' : '🧩 Opening Workbench');
    } else if (cmd.startsWith('/comp') && onOpenCompile) {
      onOpenCompile();
      showActionFeedback(lang === 'es' ? '🛠️ Abriendo compilador' : lang === 'de' ? '🛠️ Compiler wird geöffnet' : '🛠️ Opening compiler');
    } else if (cmd.startsWith('/galer') && onOpenGallery) {
      onOpenGallery();
      showActionFeedback(lang === 'es' ? '🌐 Abriendo galería' : lang === 'de' ? '🌐 Galerie wird geöffnet' : '🌐 Opening gallery');
    } else if (cmd.startsWith('/bus') && onOpenSearch) {
      onOpenSearch();
      showActionFeedback(lang === 'es' ? '🔍 Abriendo búsqueda' : lang === 'de' ? '🔍 Suche wird geöffnet' : '🔍 Opening search');
    } else if (cmd.startsWith('/nuevo') || cmd.startsWith('/new')) {
      onNewPrompt?.();
      setIsOpen(false);
    } else {
      setIsTyping(true);
      setTimeout(() => {
        addMessage(
          lang === 'es'
            ? 'Comando no reconocido. Prueba: /workbench, /compilar, /galeria, /buscar, /nuevo'
            : lang === 'de' ? 'Unbekannter Befehl. Versuche: /workbench, /compile, /gallery, /search, /new' : 'Unknown command. Try: /workbench, /compile, /gallery, /search, /new',
          false
        );
        setIsTyping(false);
      }, 500);
    }
  }, [lang, onNewPrompt, onOpenWorkbench, onOpenCompile, onOpenGallery, onOpenSearch, addMessage, showActionFeedback]);

  const handleToggle = useCallback(() => {
    if (!isOpen && messages.length === 0) {
      const greetings = lang === 'es' ? GREETINGS_ES : lang === 'de' ? GREETINGS_DE : GREETINGS_EN;
      const greeting = greetings[Math.floor(Math.random() * greetings.length)];
      setExpression('happy');
      addMessage(greeting, false);
    }
    setIsOpen((prev) => !prev);
    if (!isOpen) {
      setExpression('happy');
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen, messages.length, lang, addMessage, inputRef]);

  // Handle imperativo (usa ref para evitar dependencia circular)
  useImperativeHandle(ref, () => ({
    openWithPrompt: (prompt: string, sendImmediately = false) => {
      setIsOpen(true);
      setInputValue(prompt);
      if (sendImmediately && prompt.trim()) {
        setTimeout(() => handleSendRef.current?.(), 50);
      }
    },
  }), []);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;
    addMessage(text, true);
    setInputValue('');
    setExpression(getExpressionForText(text));

    if (text.startsWith('/')) {
      handleCommand(text);
      return;
    }

    setIsTyping(true);

    // Fallback con plantillas (timing predecible) si el modelo no contesta.
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = setTimeout(() => {
      const response = getResponse(text, lang);
      addMessage(response, false);
      setIsTyping(false);
      setExpression('happy');
      setTimeout(() => setExpression('neutral'), 3000);
    }, 1000 + Math.random() * 1500);

    void (async () => {
      let result: AskNonoResult = { text: null };
      try {
        result = await onAskRef.current(text);
      } catch (e) {
        result = { text: null, error: e instanceof Error ? e.message : 'error de red' };
      }
      if (result.text && result.text.trim()) {
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        addMessage(result.text.trim(), false);
        setIsTyping(false);
        setExpression('happy');
        setTimeout(() => setExpression('neutral'), 3000);
      } else if (result.error) {
        // El proveedor estaba configurado pero no respondió (LM Studio apagado,
        // red caída, clave rechazada): Nono lo siente en vez de fingir.
        setExpression('sad');
        setTimeout(() => setExpression('neutral'), 3000);
      }
    })();
  }, [inputValue, lang, addMessage, handleCommand, setExpression]);

  // Actualizar ref después de definir handleSend
  handleSendRef.current = handleSend;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend();
  }, [handleSend]);

  const handleClearChat = useCallback(() => {
    setMessages([]);
    clearNonoChat(projectId);
    // Guiño de complicidad al vaciar el hilo.
    setExpression('wink');
    setTimeout(() => setExpression('neutral'), 1200);
    showActionFeedback(lang === 'es' ? '🗑️ Chat limpiado' : lang === 'de' ? '🗑️ Chat geleert' : '🗑️ Chat cleared');
  }, [lang, projectId, showActionFeedback]);

  const handleCopyLast = useCallback(async () => {
    const last = messages[messages.length - 1];
    if (!last) {
      showActionFeedback(lang === 'es' ? 'Nada que copiar' : lang === 'de' ? 'Nichts zum Kopieren' : 'Nothing to copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(last.text);
      setExpression('wink');
      setTimeout(() => setExpression('neutral'), 1500);
      showActionFeedback(lang === 'es' ? '📋 ¡Copiado!' : lang === 'de' ? '📋 Kopiert!' : '📋 Copied!');
    } catch {
      showActionFeedback(lang === 'es' ? 'Error al copiar' : lang === 'de' ? 'Kopieren fehlgeschlagen' : 'Copy failed');
    }
  }, [messages, lang, showActionFeedback]);

  const handleNewPromptClick = useCallback(() => {
    onNewPrompt?.();
    setIsOpen(false);
    showActionFeedback(lang === 'es' ? '🆕 Nuevo chat' : lang === 'de' ? '🆕 Neuer Chat' : '🆕 New chat');
  }, [onNewPrompt, lang, showActionFeedback]);

  return {
    isOpen,
    setIsOpen,
    expression,
    setExpression,
    messages,
    inputValue,
    setInputValue,
    isTyping,
    handleToggle,
    handleSend,
    handleKeyDown,
    // Extras para UI
    messagesEndRef,
    handleClearChat,
    handleCopyLast,
    handleNewPromptClick,
    actionFeedback,
  };
}
