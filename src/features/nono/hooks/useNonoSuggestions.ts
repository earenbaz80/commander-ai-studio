import { useState, useRef, useEffect, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Language, FloatingAssistantProps, NonoExpression } from '../../../components/nono/content';
import { buildHoverQuestions, generateProjectSuggestions } from '../../../components/nono/content';

interface UseNonoSuggestionsOptions {
  lang: Language;
  displayName?: string;
  projectInfo?: FloatingAssistantProps['projectInfo'];
  suggestionConfig?: FloatingAssistantProps['suggestionConfig'];
  isOpen: boolean;
  /**
   * Bandera de sueño, leída en el momento de decidir. Va como ref y no como
   * booleano para que una sugerencia no despierte a Nono en el mismo tick en que
   * se durmió, antes de que React re-renderice.
   */
  isAsleepRef?: { current: boolean };
  setExpression: Dispatch<SetStateAction<NonoExpression>>;
}

interface UseNonoSuggestionsReturn {
  hoverPhrase: string;
  contextPhrase: string;
  projectSuggestion: string;
  showProjectSuggestion: boolean;
  greetingVisible: boolean;
  setGreetingVisible: (v: boolean) => void;
  isWatchingChat: boolean;
  isChatTyping: boolean;
  /** Cambia al empezar cada ráfaga de escritura: remonta el SVG (rebote). */
  chatBounceToken: number;
  handleHeadMouseEnter: () => void;
  handleHeadMouseLeave: () => void;
  showContextPhrase: (text: string, ms?: number) => void;
}

/**
 * Hook para sugerencias proactivas y frases contextuales de Nono.
 * - Preguntas al hover
 * - Sugerencias por proyecto/modo/tarea (cada ~45-60s cuando inactivo)
 * - Frases contextuales que se autolimpi
 * - Saludo inicial con efecto typing
 * - Observación del chat: `curious` al escribir en `[data-chat-input]`, `watch`
 *   mientras ese campo tiene el foco y `neutral` al abandonarlo
 */
export function useNonoSuggestions({
  lang,
  displayName,
  projectInfo,
  suggestionConfig,
  isOpen,
  isAsleepRef,
  setExpression,
}: UseNonoSuggestionsOptions): UseNonoSuggestionsReturn {
  const [hoverPhrase, setHoverPhrase] = useState('');
  const [contextPhrase, setContextPhrase] = useState('');
  const [projectSuggestion, setProjectSuggestion] = useState('');
  const [showProjectSuggestion, setShowProjectSuggestion] = useState(false);
  const [greetingVisible, setGreetingVisible] = useState(false);
  const [isWatchingChat, setIsWatchingChat] = useState(false);
  const [isChatTyping, setIsChatTyping] = useState(false);
  const [chatBounceToken, setChatBounceToken] = useState(0);

  const greetingTypeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const greetingHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextPhraseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchingChatRef = useRef(false);
  const chatTypingRef = useRef(false);
  const chatTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Observa el chat: la expresión `curious` se activa SOLO cuando el usuario
  // escribe en el textarea del chat (`[data-chat-input]`); si deja de escribir
  // durante 1 s, Nono abandona `curious` (vuelve a `watch` si sigue enfocado).
  // El input del propio panel de Nono se ignora.
  useEffect(() => {
    const isOwnPanel = (target: HTMLElement) => target.closest('.nono-panel') !== null;

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || isOwnPanel(target)) return;
      if (target.hasAttribute('data-chat-input')) {
        watchingChatRef.current = true;
        setIsWatchingChat(true);
        setExpression('watch');
      }
    };

    const onFocusOut = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || isOwnPanel(target)) return;
      if (target.hasAttribute('data-chat-input')) {
        watchingChatRef.current = false;
        chatTypingRef.current = false;
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
      const target = e.target as HTMLElement | null;
      if (!target || isOwnPanel(target)) return;
      if (!target.hasAttribute('data-chat-input')) return;
      watchingChatRef.current = true;
      setIsWatchingChat(true);
      // El SVG se remonta sólo al empezar la ráfaga: así el rebote no se
      // reinicia con cada tecla, sino al volver a escribir tras la pausa.
      if (!chatTypingRef.current) {
        chatTypingRef.current = true;
        setChatBounceToken((t) => t + 1);
      }
      setIsChatTyping(true);
      setExpression('curious');
      // Reinicia el temporizador de 1 s de inactividad
      if (chatTypingTimerRef.current) clearTimeout(chatTypingTimerRef.current);
      chatTypingTimerRef.current = setTimeout(() => {
        chatTypingTimerRef.current = null;
        chatTypingRef.current = false;
        setIsChatTyping(false);
        setExpression((prev) =>
          prev === 'curious' ? (watchingChatRef.current ? 'watch' : 'neutral') : prev
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
  }, [setExpression]);

  // Frase contextual breve (se autolimpia)
  const showContextPhrase = useCallback((text: string, ms = 3800) => {
    setContextPhrase(text);
    if (contextPhraseTimerRef.current) clearTimeout(contextPhraseTimerRef.current);
    contextPhraseTimerRef.current = setTimeout(() => setContextPhrase(''), ms);
  }, []);

  // Preguntas dinámicas al hover
  const handleHeadMouseEnter = useCallback(() => {
    if (isOpen) return;
    if (!isWatchingChat) setExpression('happy');
    const questions = buildHoverQuestions(lang, displayName);
    setHoverPhrase(questions[Math.floor(Math.random() * questions.length)]);
  }, [isOpen, isWatchingChat, lang, displayName, setExpression]);

  const handleHeadMouseLeave = useCallback(() => {
    setHoverPhrase('');
    if (!isOpen && !isWatchingChat) setExpression('neutral');
  }, [isOpen, isWatchingChat, setExpression]);

  // Sugerencias de proyecto contextuales
  useEffect(() => {
    if (!projectInfo || isOpen || isWatchingChat) return;
    
    const showSuggestion = () => {
      if (isAsleepRef?.current) return; // dormido: no lo despertamos con una sugerencia
      const suggestions = generateProjectSuggestions(projectInfo, lang, suggestionConfig);
      if (suggestions.length > 0) {
        const suggestion = suggestions[Math.floor(Math.random() * suggestions.length)];
        setProjectSuggestion(suggestion);
        setShowProjectSuggestion(true);
        setExpression('thinking');
        
        setTimeout(() => {
          setShowProjectSuggestion(false);
          setProjectSuggestion('');
          // Si mientras tanto se durmió, la limpieza de la sugerencia no lo despierta.
          setExpression((prev) => (prev === 'sleepy' ? prev : 'neutral'));
        }, 5000);
      }
    };

    const idleTime = suggestionConfig?.idleTimeMs ?? 15000;
    suggestionTimerRef.current = setTimeout(showSuggestion, idleTime);
    
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectInfo, lang, isOpen, isWatchingChat, suggestionConfig]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (greetingTypeRef.current) clearInterval(greetingTypeRef.current);
      if (greetingHideRef.current) clearTimeout(greetingHideRef.current);
      if (contextPhraseTimerRef.current) clearTimeout(contextPhraseTimerRef.current);
      if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
      if (suggestionIntervalRef.current) clearInterval(suggestionIntervalRef.current);
    };
  }, []);

  return {
    hoverPhrase,
    contextPhrase,
    projectSuggestion,
    showProjectSuggestion,
    greetingVisible,
    setGreetingVisible,
    isWatchingChat,
    isChatTyping,
    chatBounceToken,
    handleHeadMouseEnter,
    handleHeadMouseLeave,
    showContextPhrase,
  };
}