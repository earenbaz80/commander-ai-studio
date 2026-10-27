import { useState, useRef, useCallback, useImperativeHandle, useEffect } from 'react';
import type { Message, FloatingAssistantHandle, FloatingAssistantProps, Language } from '../../../components/nono/content';
import { askNono } from '../../../utils/nonoAsk';
import { GREETINGS_ES, GREETINGS_EN, GREETINGS_DE, getExpressionForText, getResponse } from '../../../components/nono/content';

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
  inputRef: React.RefObject<HTMLInputElement | null>;
  ref: React.ForwardedRef<FloatingAssistantHandle>;
}

import type { NonoExpression } from '../../../components/nono/content';

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
 * - Mensajes + input + typing state
 * - Comandos rápidos (/workbench, /compile, etc.)
 * - Fallback a respuestas plantilla si IA tarda
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
  inputRef,
  ref,
}: UseNonoChatOptions): UseNonoChatReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [expression, setExpression] = useState<NonoExpression>('neutral');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [actionFeedback, setActionFeedback] = useState('');

  const onAskRef = useRef<(text: string) => Promise<string | null>>(async () => null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const handleSendRef = useRef<(() => void) | undefined>(undefined);

  // Mantiene ask actualizado con parámetros actuales
  const ask = useCallback(
    async (text: string) => {
      return askNono(text, { selectedModel, selectedProvider, parameters, lang, codeContext });
    },
    [selectedModel, selectedProvider, parameters, lang, codeContext]
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

    // Fallback con plantillas (timing predecible)
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = setTimeout(() => {
      const response = getResponse(text, lang);
      addMessage(response, false);
      setIsTyping(false);
      setExpression('happy');
      setTimeout(() => setExpression('neutral'), 3000);
    }, 1000 + Math.random() * 1500);

    void (async () => {
      let reply: string | null = null;
      try {
        reply = await onAskRef.current(text);
      } catch {
        reply = null;
      }
      if (reply && reply.trim()) {
        clearTimeout(fallbackTimerRef.current!);
        addMessage(reply.trim(), false);
        setIsTyping(false);
        setExpression('happy');
        setTimeout(() => setExpression('neutral'), 3000);
      }
    })();
  }, [inputValue, lang, addMessage, handleCommand, getExpressionForText]);

  // Actualizar ref después de definir handleSend
  handleSendRef.current = handleSend;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend();
  }, [handleSend]);

  const handleClearChat = useCallback(() => {
    setMessages([]);
    setExpression('happy');
    showActionFeedback(lang === 'es' ? '🗑️ Chat limpiado' : lang === 'de' ? '🗑️ Chat geleert' : '🗑️ Chat cleared');
  }, [lang, showActionFeedback]);

  const handleCopyLast = useCallback(async () => {
    const last = messages[messages.length - 1];
    if (!last) {
      showActionFeedback(lang === 'es' ? 'Nada que copiar' : lang === 'de' ? 'Nichts zum Kopieren' : 'Nothing to copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(last.text);
      setExpression('happy');
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