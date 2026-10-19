import React, { useState, useEffect, useRef, useCallback, useImperativeHandle } from 'react';
import { Clipboard, PanelRight, Hammer, Library, Search, Trash2, Plus, Send, X } from 'lucide-react';
import { loadNonoPosition, saveNonoPosition, clearNonoPosition } from '../utils/nonoStorage';
import { askNono } from '../utils/nonoAsk';
import {
  buildGreeting,
  buildHoverQuestions,
  generateProjectSuggestions,
  getExpressionForText,
  getResponse,
  GREETINGS_DE,
  GREETINGS_EN,
  GREETINGS_ES,
  type FloatingAssistantHandle,
  type FloatingAssistantProps,
  type Message,
  type NonoExpression,
} from './nono/content';
import { NonoHead } from './nono/NonoHead';

/** Reexports: mantienen estables los imports de App.tsx, uiStore y los tests. */
export { NonoHead } from './nono/NonoHead';
export type { NonoExpression, NonoStatusEvent, FloatingAssistantHandle } from './nono/content';

/**
 * Nono - Asistente flotante: solo la cabeza del robot.
 * - Siempre visible, anclado a la linea divisoria entre el chat y los
 *   resultados ([data-chat-divider]), esquina inferior derecha.
 * - Ojos que siguen el puntero del mouse + parpadeo dinamico.
 * - Expresiones dinamicas segun contexto.
 * - Observa el chat cuando el usuario escribe.
 * - Arrastrable; doble clic para volver a la esquina.
 *
 * Estetica retro Norton (cyan #00ffff, amarillo #ffff55, navy).
 *
 * Este modulo solo orquesta estado y efectos:
 *   - ./nono/content  -> tipos, saludos, respuestas y sugerencias (dato puro)
 *   - ./nono/NonoHead -> el SVG de la cabeza
 */

export const FloatingAssistant = React.forwardRef<FloatingAssistantHandle, FloatingAssistantProps>(({
  lang = 'es',
  displayName,
  onNewPrompt,
  status,
  onOpenWorkbench,
  onOpenCompile,
  onOpenGallery,
  onOpenSearch,
  selectedModel,
  selectedProvider,
  parameters,
  projectInfo,
  suggestionConfig,
  codeContext,
  hidden,
}, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [expression, setExpression] = useState<NonoExpression>('neutral');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const [isWatchingChat, setIsWatchingChat] = useState(false);
  const [isChatTyping, setIsChatTyping] = useState(false);
  const [chatBounceToken, setChatBounceToken] = useState(0);
  const [anchor, setAnchor] = useState({ bottom: 8, right: 8 });
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [actionFeedback, setActionFeedback] = useState('');
  const [typedGreeting, setTypedGreeting] = useState('');
  const [greetingVisible, setGreetingVisible] = useState(false);
  const [hoverPhrase, setHoverPhrase] = useState('');
  const [contextPhrase, setContextPhrase] = useState('');

  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isWatchingChatRef = useRef(false);
  const chatTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);
  const hasMovedRef = useRef(false);
  const dragRafRef = useRef<number | null>(null);
  const pendingDragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetingTypeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const greetingHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const onAskRef = useRef<(text: string) => Promise<string | null>>(askNono);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextPhraseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [projectSuggestion, setProjectSuggestion] = useState('');
  const [showProjectSuggestion, setShowProjectSuggestion] = useState(false);

  // Mantiene la referencia actual de `askNono` con los parámetros del momento.
  const ask = useCallback(
    async (text: string) => {
      return askNono(text, { selectedModel, selectedProvider, parameters, lang, codeContext });
    },
    [selectedModel, selectedProvider, parameters, lang, codeContext]
  );
  onAskRef.current = ask;

  // Restaurar posición guardada (con clamp a la ventana actual)
  useEffect(() => {
    const saved = loadNonoPosition();
    if (saved) {
      setDragPos({
        x: Math.max(0, Math.min(saved.x, window.innerWidth - 70)),
        y: Math.max(0, Math.min(saved.y, window.innerHeight - 70)),
      });
    }
  }, []);

  // Persistir posición cuando el usuario suelta a Nono
  useEffect(() => {
    if (dragPos && !isDragging) {
      saveNonoPosition(dragPos);
    }
  }, [dragPos, isDragging]);

  // Anclaje a la línea divisoria del chat ([data-chat-divider])
  useEffect(() => {
    let ro: ResizeObserver | null = null;
    let currentDivider: Element | null = null;

    const measure = () => {
      const divider = document.querySelector('[data-chat-divider]');
      if (divider !== currentDivider) {
        if (ro) { ro.disconnect(); ro = null; }
        currentDivider = divider;
        if (divider) {
          ro = new ResizeObserver(measure);
          ro.observe(divider);
        }
      }
      if (divider) {
        const rect = divider.getBoundingClientRect();
        // Borde inferior de Nono se sienta sobre la línea (4px de solape)
        setAnchor({
          bottom: Math.max(0, window.innerHeight - rect.top - 4),
          right: 8,
        });
      } else {
        setAnchor({ bottom: 8, right: 8 });
      }
    };

    measure();
    const mo = new MutationObserver(measure);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    // Fallback por si el divider aparece tarde (cambio de modo)
    const interval = setInterval(measure, 1000);

    return () => {
      mo.disconnect();
      window.removeEventListener('resize', measure);
      clearInterval(interval);
      if (ro) ro.disconnect();
    };
  }, []);

  // Saludo flotante con efecto de tipeado (solo lo muestra Nono, sin recuadro)
  const greetingText = buildGreeting(lang, displayName);
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    setTypedGreeting('');
    setGreetingVisible(false);
    if (greetingTypeRef.current) clearInterval(greetingTypeRef.current);
    if (greetingHideRef.current) clearTimeout(greetingHideRef.current);

    const startDelay = setTimeout(() => {
      setGreetingVisible(true);
      setExpression('happy');

      // Con "reduced motion" mostramos el texto completo de golpe
      if (reduceMotion) {
        setTypedGreeting(greetingText);
        greetingHideRef.current = setTimeout(() => setGreetingVisible(false), 8000);
        return;
      }

      let i = 0;
      greetingTypeRef.current = setInterval(() => {
        i += 1;
        setTypedGreeting(greetingText.slice(0, i));
        if (i >= greetingText.length) {
          if (greetingTypeRef.current) clearInterval(greetingTypeRef.current);
          greetingTypeRef.current = null;
          setExpression((prev) => (prev === 'happy' ? 'neutral' : prev));
          greetingHideRef.current = setTimeout(() => setGreetingVisible(false), 8000);
        }
      }, 42);
    }, 1100);

    return () => {
      clearTimeout(startDelay);
      if (greetingTypeRef.current) clearInterval(greetingTypeRef.current);
      if (greetingHideRef.current) clearTimeout(greetingHideRef.current);
    };
  }, [greetingText]);

  // Ojos siguen el mouse globalmente
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const head = headRef.current;
      if (!head) return;
      const rect = head.getBoundingClientRect();
      const headCenterX = rect.left + rect.width / 2;
      const headCenterY = rect.top + rect.height / 2;
      const dx = e.clientX - headCenterX;
      const dy = e.clientY - headCenterY;
      const angle = Math.atan2(dy, dx);
      setEyeOffset({
        x: Math.cos(angle),
        y: Math.sin(angle),
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Parpadeo aleatorio
  useEffect(() => {
    let cancelled = false;
    const blinkLoop = () => {
      if (cancelled) return;
      blinkTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        setTimeout(() => {
          if (cancelled) return;
          setBlink(false);
          blinkLoop();
        }, 120);
      }, 2000 + Math.random() * 4000);
    };
    blinkLoop();
    return () => {
      cancelled = true;
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
    };
  }, []);

  // Observa el chat: la expresión curious se activa SOLO cuando el usuario
  // escribe en el textarea del chat; si deja de escribir durante 1s, Nono
  // abandona "curious" (vuelve a 'watch' si sigue enfocado, o 'neutral').
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.nono-panel')) return;
      if (target.hasAttribute('data-chat-input')) {
        isWatchingChatRef.current = true;
        setIsWatchingChat(true);
        setExpression('watch');
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.nono-panel')) return;
      if (target.hasAttribute('data-chat-input')) {
        isWatchingChatRef.current = false;
        setIsWatchingChat(false);
        setIsChatTyping(false);
        if (chatTypingTimerRef.current) {
          clearTimeout(chatTypingTimerRef.current);
          chatTypingTimerRef.current = null;
        }
        setExpression((prev) => (prev === 'curious' ? 'neutral' : prev));
      }
    };
    const onChatInput = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.closest('.nono-panel')) return;
      if (!target.hasAttribute('data-chat-input')) return;
      isWatchingChatRef.current = true;
      setIsWatchingChat(true);
      // Reinicia el temporizador de 1s de inactividad
      if (chatTypingTimerRef.current) clearTimeout(chatTypingTimerRef.current);
      setIsChatTyping((prev) => {
        if (!prev) setChatBounceToken((t) => t + 1);
        return true;
      });
      setExpression('curious');
      chatTypingTimerRef.current = setTimeout(() => {
        chatTypingTimerRef.current = null;
        setIsChatTyping(false);
        setExpression((prev) =>
          prev === 'curious' ? (isWatchingChatRef.current ? 'watch' : 'neutral') : prev
        );
      }, 1000);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('input', onChatInput, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('input', onChatInput, true);
      if (chatTypingTimerRef.current) {
        clearTimeout(chatTypingTimerRef.current);
        chatTypingTimerRef.current = null;
      }
    };
  }, []);

  // Auto-sleep después de inactividad (con un ojo abierto)
  // Nono aparenta dormir pero conserva su estado de observación.
  // Si estaba watching chat, mantiene ese estado al "dormir".
  useEffect(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      // Dormir con "un ojo abierto": expresión sleepy pero manteniendo
      // el estado de observación si estaba activo antes.
      if (!isOpen && isWatchingChat) {
        // Estaba viendo el chat -> dormir pero con ojo medio abierto
        setExpression('sleepy');
        // Mantener isWatchingChat true mientras dormimos
      } else if (!isOpen && !isWatchingChat) {
        // Inactividad pura -> dormir de verdad
        setExpression('sleepy');
      }
      // Si open, no dormir
    }, 300000); // 5 minutes instead of 30 seconds
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [expression, isOpen, isWatchingChat]);

  // Sugerencias de proyecto contextuales (cada 45-60s cuando Nono está inactivo)
  useEffect(() => {
    if (!projectInfo || isOpen || isWatchingChat) return;
    
    const showSuggestion = () => {
      const suggestions = generateProjectSuggestions(projectInfo, lang, suggestionConfig);
      if (suggestions.length > 0) {
        const suggestion = suggestions[Math.floor(Math.random() * suggestions.length)];
        setProjectSuggestion(suggestion);
        setShowProjectSuggestion(true);
        setExpression('thinking');
        
        // Ocultar después de 5 segundos
        setTimeout(() => {
          setShowProjectSuggestion(false);
          setProjectSuggestion('');
          setExpression((prev) => (prev === 'thinking' ? 'neutral' : prev));
        }, 5000);
      }
    };

    // Primera sugerencia después de 15s de inactividad
    const idleTime = suggestionConfig?.idleTimeMs ?? 8000;
    suggestionTimerRef.current = setTimeout(showSuggestion, idleTime);
    
    // Luego cada 45-60s
    suggestionIntervalRef.current = setInterval(() => {
      if (!isOpen && !isWatchingChat && projectInfo) {
        showSuggestion();
      }
    }, 50000);

    return () => {
      if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
      if (suggestionIntervalRef.current) clearInterval(suggestionIntervalRef.current);
      setShowProjectSuggestion(false);
    };
  }, [projectInfo, lang, isOpen, isWatchingChat]);

  // Frase contextual breve (reacciones de la app); se limpia sola.
  const showContextPhrase = useCallback((text: string, ms = 3800) => {
    setContextPhrase(text);
    if (contextPhraseTimerRef.current) clearTimeout(contextPhraseTimerRef.current);
    contextPhraseTimerRef.current = setTimeout(() => setContextPhrase(''), ms);
  }, []);

  // Reacciones contextuales según el último evento de la app.
  useEffect(() => {
    if (!status) return;
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);

    const t = status.type;
    if (t === 'generating') {
      setExpression('thinking');
    } else if (t === 'done') {
      setExpression('happy');
      reactionTimerRef.current = setTimeout(() => {
        setExpression((prev) => (prev === 'happy' ? 'neutral' : prev));
      }, 2500);
    } else if (t === 'error') {
      setExpression('error');
      showContextPhrase(lang === 'es' ? '⚠️ Algo falló. ¿Reviso el error?' : lang === 'de' ? '⚠️ Etwas ist fehlgeschlagen. Soll ich mir das ansehen?' : '⚠️ Something failed. Want me to look?');
      reactionTimerRef.current = setTimeout(() => {
        setExpression((prev) => (prev === 'error' ? 'neutral' : prev));
      }, 4500);
    } else if (t === 'success') {
      setExpression('love');
      reactionTimerRef.current = setTimeout(() => {
        setExpression((prev) => (prev === 'love' ? 'neutral' : prev));
      }, 3000);
    } else if (t === 'mode') {
      if (status.detail) {
        showContextPhrase(
          lang === 'es' ? `🔄 Modo ${status.detail}` : lang === 'de' ? `🔄 Modus ${status.detail}` : `🔄 Mode ${status.detail}`,
          3000
        );
      }
    } else if (t === 'new_prompt') {
      setExpression('happy');
      reactionTimerRef.current = setTimeout(() => {
        setExpression((prev) => (prev === 'happy' ? 'neutral' : prev));
      }, 2500);
    }

    return () => {
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    };
  }, [status, lang, showContextPhrase]);

  // Scroll al final de mensajes
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

  const handleToggle = () => {
    setGreetingVisible(false);
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
  };

  const handleCommand = (cmdRaw: string) => {
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
  };

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text) return;
    addMessage(text, true);
    setInputValue('');
    setExpression(getExpressionForText(text));

    // Comandos de consola rápidos (sin pasar por el modelo).
    if (text.startsWith('/')) {
      handleCommand(text);
      return;
    }

    setIsTyping(true);

    // Respaldo con plantillas: se agenda YA (timing predecible y offline).
    // Si el modelo contesta rápido, se cancela y se usa su respuesta.
    const fallbackTimer = setTimeout(() => {
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
        clearTimeout(fallbackTimer);
        addMessage(reply.trim(), false);
        setIsTyping(false);
        setExpression('happy');
        setTimeout(() => setExpression('neutral'), 3000);
      }
    })();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend();
  };

  // Handle imperativo: abrir Nono con un prompt desde fuera (ej. @nono en chat general)
  useImperativeHandle(ref, () => ({
    openWithPrompt: (prompt: string, sendImmediately = false) => {
      setIsOpen(true);
      setInputValue(prompt);
      if (sendImmediately && prompt.trim()) {
        // Pequeño delay para que el input se actualice antes de enviar
        setTimeout(() => handleSend(), 50);
      }
    },
  }), [handleSend]);

  // ---- Acciones rápidas del mini-chat ----
  const showActionFeedback = useCallback((message: string) => {
    setActionFeedback(message);
    setTimeout(() => setActionFeedback(''), 1800);
  }, []);

  const handleClearChat = () => {
    setMessages([]);
    setExpression('happy');
    showActionFeedback(lang === 'es' ? '🗑️ Chat limpiado' : lang === 'de' ? '🗑️ Chat geleert' : '🗑️ Chat cleared');
  };

  const handleCopyLast = async () => {
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
  };

  const handleNewPromptClick = () => {
    onNewPrompt?.();
    setIsOpen(false);
    showActionFeedback(lang === 'es' ? '🆕 Nuevo prompt' : lang === 'de' ? '🆕 Neuer Prompt' : '🆕 New prompt');
  };

  // Preguntas dinámicas al pasar el puntero por Nono
  const handleHeadMouseEnter = () => {
    if (isOpen) return;
    if (!isWatchingChat) setExpression('happy');
    const questions = buildHoverQuestions(lang, displayName);
    setHoverPhrase(questions[Math.floor(Math.random() * questions.length)]);
  };

  const handleHeadMouseLeave = () => {
    setHoverPhrase('');
    if (!isOpen && !isTyping && !isWatchingChat) setExpression('neutral');
  };

  // Drag handlers (posición absoluta mientras se arrastra)
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.nono-panel')) return;
    setGreetingVisible(false);
    hasMovedRef.current = false;
    suppressClickRef.current = false;
    setIsDragging(true);
    const rect = headRef.current?.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: rect ? rect.left : 0,
      startPosY: rect ? rect.top : 0,
    };
  };

  const handleMouseMove = useCallback((e: any) => {
    if (!isDragging || !dragRef.current) return;
    const clientX = typeof e?.clientX === 'number' ? e.clientX : (e?.touches?.[0]?.clientX ?? 0);
    const clientY = typeof e?.clientY === 'number' ? e.clientY : (e?.touches?.[0]?.clientY ?? 0);

    if (!hasMovedRef.current) {
      const dx = clientX - dragRef.current.startX;
      const dy = clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 5) hasMovedRef.current = true;
    }

    const newX = Math.max(0, Math.min(dragRef.current.startPosX + (clientX - dragRef.current.startX), window.innerWidth - 70));
    const newY = Math.max(0, Math.min(dragRef.current.startPosY + (clientY - dragRef.current.startY), window.innerHeight - 70));

    pendingDragPositionRef.current = { x: newX, y: newY };

    if (dragRafRef.current === null) {
      dragRafRef.current = requestAnimationFrame(() => {
        const next = pendingDragPositionRef.current;
        if (next) setDragPos(next);
        dragRafRef.current = null;
        pendingDragPositionRef.current = null;
      });
    }
  }, [isDragging]);

  const handleMouseUp = () => {
    suppressClickRef.current = hasMovedRef.current;

    // Flush any pending drag frame to avoid a skipped last movement.
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    const pending = pendingDragPositionRef.current;
    if (pending) setDragPos(pending);
    pendingDragPositionRef.current = null;

    setIsDragging(false);
    dragRef.current = null;
    hasMovedRef.current = false;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('.nono-panel')) return;
    setGreetingVisible(false);
    hasMovedRef.current = false;
    suppressClickRef.current = false;
    setIsDragging(true);
    const t = e.touches[0];
    const rect = headRef.current?.getBoundingClientRect();
    dragRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      startPosX: rect ? rect.left : 0,
      startPosY: rect ? rect.top : 0,
    };
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('touchmove', handleMouseMove, { passive: false });
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchend', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('touchmove', handleMouseMove as any);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchend', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove]);

  // Estilo de la cabeza: anclada a la línea o arrastrada
  // Offset de ~2mm (≈8px) — la sombra es vectorial (SVG filter)
  const GAP = 8; // 2 mm ≈ 8px
  const headStyle: React.CSSProperties = dragPos
    ? {
        left: 0,
        top: 0,
        transform: `translate3d(${dragPos.x}px, ${dragPos.y}px, 0) ${isChatTyping && !isDragging ? 'rotate(-7deg)' : ''}`,
        willChange: 'transform',
        transition: isChatTyping ? 'transform 0.25s ease-out' : 'none',
      }
    : isChatTyping
      ? { bottom: anchor.bottom + GAP, right: anchor.right + GAP, transform: 'rotate(-7deg)', transition: 'transform 0.25s ease-out' }
      : { bottom: anchor.bottom + GAP, right: anchor.right + GAP };

  // Panel: se abre justo encima de la cabeza (64px de altura + 4px de margen)
  const headBottomEdge = dragPos
    ? window.innerHeight - dragPos.y - 64
    : anchor.bottom;
  const panelStyle: React.CSSProperties = {
    bottom: Math.max(8, Math.min(headBottomEdge + 68, window.innerHeight - 340)),
    right: 8,
    height: 320,
  };

  // Saludo flotante: se sitúa encima de la cabeza, alineado a su borde derecho
  const headTopPx = dragPos
    ? dragPos.y
    : Math.max(0, window.innerHeight - anchor.bottom - GAP - 64);
  const headRightPx = dragPos
    ? Math.max(8, window.innerWidth - dragPos.x - 64)
    : anchor.right + GAP;
  const greetingStyle: React.CSSProperties = {
    top: Math.max(8, headTopPx - 58),
    right: headRightPx,
    maxWidth: 'min(280px, calc(100vw - 2rem))',
  };

  if (hidden) return null;

  return (
    <>
      {/* Texto flotante de Nono: saludo con tipeado o pregunta dinámica al pasar el puntero */}
      {(() => {
        const floatingMessage = hoverPhrase || contextPhrase || projectSuggestion || typedGreeting;
        const floatingVisible = Boolean(hoverPhrase) || Boolean(contextPhrase) || showProjectSuggestion || greetingVisible;
        const typingCaret = !hoverPhrase && !contextPhrase && !showProjectSuggestion && greetingVisible && typedGreeting.length < greetingText.length;
        if (!floatingVisible && typedGreeting.length === 0) return null;
        return (
          <div
            className={`pointer-events-none fixed z-[9997] transition-opacity duration-300 ${
              floatingVisible ? 'opacity-100' : 'opacity-0'
            }`}
            style={greetingStyle}
            data-nono-greeting="true"
            data-nono-hover={hoverPhrase ? 'true' : undefined}
            data-nono-suggestion={showProjectSuggestion ? 'true' : undefined}
            aria-live="polite"
          >
            <p
              className="text-right text-[#00ffff] font-bold text-sm leading-snug"
              style={{
                textShadow:
                  '0 2px 8px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.95), 0 0 16px rgba(0,255,255,0.4)',
              }}
            >
              {floatingMessage}
              {typingCaret && (
                <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-[#00ffff] align-middle" />
              )}
            </p>
          </div>
        );
      })()}

      {/* Panel de chat */}
      {isOpen && (
        <div
          className="nono-panel fixed z-[9999] w-80 max-w-[calc(100vw-2rem)] bg-[#001a33] border-2 border-[#00ffff] rounded-lg shadow-[0_0_30px_rgba(0,255,255,0.3)] flex flex-col overflow-hidden"
          style={panelStyle}
        >
          {/* Header del panel */}
          <div className="flex items-center justify-between px-3 py-2 bg-[#00aaaa] border-b-2 border-[#000055] shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-black font-bold text-sm">Nono</span>
              <span className="text-[10px] text-black/60">{isTyping ? '...' : 'online'}</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              aria-label={lang === 'es' ? 'Cerrar panel' : lang === 'de' ? 'Panel schließen' : 'Close panel'}
              data-tooltip={lang === 'es' ? 'Cerrar panel' : lang === 'de' ? 'Panel schließen' : 'Close panel'}
              className="text-black hover:text-red-500 font-bold leading-none px-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Acciones rápidas */}
          <div className="flex items-center gap-1 px-2 py-1 bg-[#00243e] border-b border-[#004466] shrink-0">
            <button
              onClick={handleClearChat}
              data-tooltip={lang === 'es' ? 'Limpiar chat' : lang === 'de' ? 'Chat leeren' : 'Clear chat'}
              aria-label={lang === 'es' ? 'Limpiar chat' : lang === 'de' ? 'Chat leeren' : 'Clear chat'}
              className="text-[#00ffff] hover:bg-[#000080] border border-[#004466] rounded px-1.5 py-0.5 text-[10px] font-bold"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleCopyLast}
              data-tooltip={lang === 'es' ? 'Copiar último mensaje' : lang === 'de' ? 'Letzte Nachricht kopieren' : 'Copy last message'}
              aria-label={lang === 'es' ? 'Copiar último mensaje' : lang === 'de' ? 'Letzte Nachricht kopieren' : 'Copy last message'}
              className="text-[#00ffff] hover:bg-[#000080] border border-[#004466] rounded px-1.5 py-0.5 text-[10px] font-bold"
            >
              <Clipboard className="w-3.5 h-3.5" />
            </button>
            {onNewPrompt && (
              <button
                onClick={handleNewPromptClick}
                data-tooltip={lang === 'es' ? 'Nuevo prompt' : lang === 'de' ? 'Neuer Prompt' : 'New prompt'}
                aria-label={lang === 'es' ? 'Nuevo prompt' : lang === 'de' ? 'Neuer Prompt' : 'New prompt'}
                className="text-[#ffff55] hover:bg-[#000080] border border-[#004466] rounded px-1.5 py-0.5 text-[10px] font-bold"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
            {actionFeedback && (
              <span className="ml-auto text-[10px] text-[#ffff55] animate-pulse">{actionFeedback}</span>
            )}
          </div>

          {/* Chips de acciones reales de la app */}
          {(onOpenWorkbench || onOpenCompile || onOpenGallery || onOpenSearch) && (
            <div className="flex flex-wrap gap-1 px-2 py-1 bg-[#001633] border-b border-[#004466] shrink-0">
              {onOpenWorkbench && (
                <button
                  onClick={() => { onOpenWorkbench(); setExpression('happy'); }}
                  data-tooltip={lang === 'es' ? 'Abrir Workbench' : lang === 'de' ? 'Workbench öffnen' : 'Open Workbench'}
                  data-tooltip-sub={lang === 'es' ? 'Abre el panel de archivos y herramientas' : lang === 'de' ? 'Panel für Dateien und Tools öffnen' : 'Open the files & tools panel'}
                  aria-label={lang === 'es' ? 'Abrir Workbench' : lang === 'de' ? 'Workbench öffnen' : 'Open Workbench'}
                  className="flex items-center gap-1 text-[9px] font-bold text-[#00ffff] bg-[#0000aa] hover:bg-[#00aaaa] hover:text-black border border-[#00ffff]/60 rounded px-1.5 py-0.5"
                >
                  <PanelRight className="w-3 h-3" /> {lang === 'es' ? 'Workbench' : lang === 'de' ? 'Workbench' : 'Workbench'}
                </button>
              )}
              {onOpenCompile && (
                <button
                  onClick={() => { onOpenCompile(); setExpression('happy'); }}
                  data-tooltip={lang === 'es' ? 'Compilar / Exportar proyecto' : lang === 'de' ? 'Projekt kompilieren / exportieren' : 'Compile / Export project'}
                  data-tooltip-sub={lang === 'es' ? 'Abre el compilador nativo' : lang === 'de' ? 'Nativen Compiler öffnen' : 'Open the native compiler'}
                  aria-label={lang === 'es' ? 'Compilar / Exportar proyecto' : lang === 'de' ? 'Projekt kompilieren / exportieren' : 'Compile / Export project'}
                  className="flex items-center gap-1 text-[9px] font-bold text-[#ffff55] bg-[#0000aa] hover:bg-[#00aaaa] hover:text-black border border-[#00ffff]/60 rounded px-1.5 py-0.5"
                >
                  <Hammer className="w-3 h-3" /> {lang === 'es' ? 'Compilar' : lang === 'de' ? 'Kompilieren' : 'Compile'}
                </button>
              )}
              {onOpenGallery && (
                <button
                  onClick={() => { onOpenGallery(); setExpression('happy'); }}
                  data-tooltip={lang === 'es' ? 'Galería de proyectos' : lang === 'de' ? 'Projektgalerie' : 'Project gallery'}
                  data-tooltip-sub={lang === 'es' ? 'Explora y carga proyectos de la comunidad' : lang === 'de' ? 'Community-Projekte durchsuchen und laden' : 'Browse and load community projects'}
                  aria-label={lang === 'es' ? 'Galería de proyectos' : lang === 'de' ? 'Projektgalerie' : 'Project gallery'}
                  className="flex items-center gap-1 text-[9px] font-bold text-[#00ffff] bg-[#0000aa] hover:bg-[#00aaaa] hover:text-black border border-[#00ffff]/60 rounded px-1.5 py-0.5"
                >
                  <Library className="w-3 h-3" /> {lang === 'es' ? 'Galería' : lang === 'de' ? 'Galerie' : 'Gallery'}
                </button>
              )}
              {onOpenSearch && (
                <button
                  onClick={() => { onOpenSearch(); setExpression('happy'); }}
                  data-tooltip={lang === 'es' ? 'Buscar en el proyecto' : lang === 'de' ? 'Projekt durchsuchen' : 'Search the project'}
                  data-tooltip-sub={lang === 'es' ? 'Abre la búsqueda de código' : lang === 'de' ? 'Codesuche öffnen' : 'Open the code search'}
                  aria-label={lang === 'es' ? 'Buscar en el proyecto' : lang === 'de' ? 'Projekt durchsuchen' : 'Search the project'}
                  className="flex items-center gap-1 text-[9px] font-bold text-[#00ffff] bg-[#0000aa] hover:bg-[#00aaaa] hover:text-black border border-[#00ffff]/60 rounded px-1.5 py-0.5"
                >
                  <Search className="w-3 h-3" /> {lang === 'es' ? 'Buscar' : lang === 'de' ? 'Suchen' : 'Search'}
                </button>
              )}
            </div>
          )}

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#000d1a]">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.fromUser ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`nc-x-scroll max-w-[85%] px-3 py-1.5 rounded-lg text-xs ${
                    msg.fromUser
                      ? 'bg-[#ffff55] text-black font-bold'
                      : 'bg-[#00243e] text-[#00ffff] border border-[#004466]'
                  }`}
                >
                  <p>{msg.text}</p>
                  <span className="text-[9px] opacity-50 block text-right">{msg.timestamp}</span>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-[#00243e] text-[#00ffff] border border-[#004466] px-3 py-1.5 rounded-lg text-xs">
                  <span className="animate-pulse">● ● ●</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="flex gap-1 p-2 bg-[#001a33] border-t border-[#004466] shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={lang === 'es' ? 'Escribe un mensaje...' : lang === 'de' ? 'Nachricht eingeben...' : 'Type a message...'}
              className="flex-1 bg-[#000080] text-[#00ffff] text-xs px-2 py-1.5 rounded border border-[#004466] outline-none placeholder:text-[#00ffff]/40 focus:border-[#00ffff]"
            />
            <button
              onClick={handleSend}
              aria-label={lang === 'es' ? 'Enviar mensaje' : lang === 'de' ? 'Nachricht senden' : 'Send message'}
              className="nc-button !px-2 !py-1 text-xs font-bold flex items-center gap-1"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Cabeza flotante de Nono - solo la cabeza, sin botón ni marco */}
      <div
        ref={headRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onClick={(e) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            e.preventDefault();
            return;
          }
          handleToggle();
        }}
        onDoubleClick={() => { setDragPos(null); clearNonoPosition(); }}
        onMouseEnter={handleHeadMouseEnter}
        onMouseLeave={handleHeadMouseLeave}
        tabIndex={0}
        aria-grabbed={isDragging}
        aria-expanded={isOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            handleToggle();
          }
        }}
        className={`fixed z-[9998] select-none touch-none focus:outline-none focus-visible:outline-none outline-none ${isDragging ? 'cursor-grabbing' : ''} ${expression !== 'sleepy' ? 'nono-awake' : ''} ${isChatTyping && !isDragging ? 'nono-lean-chat' : ''}`}
        style={headStyle}
        aria-label="Nono"
      >
        <NonoHead key={chatBounceToken} expression={expression} eyeOffset={eyeOffset} blink={blink} size={64} show3D={true} />
        {/* "Zzz" de cómic mientras Nono duerme */}
        {expression === 'sleepy' && !hoverPhrase && !contextPhrase && (
          <div className="nono-sleep-z absolute pointer-events-none" aria-hidden="true">
            <span>Z</span>
            <span>z</span>
            <span>z</span>
          </div>
        )}
      </div>
    </>
  );
});

export default FloatingAssistant;