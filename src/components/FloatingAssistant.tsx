import React, { forwardRef, useRef, useEffect, useState } from 'react';
import { Clipboard, PanelRight, Hammer, Library, Search, Trash2, Plus, Send, X, Activity, Maximize2, Minimize2, Circle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FloatingAssistantProps, FloatingAssistantHandle, NonoExpression } from './nono/content';
import { NonoHead } from './nono/NonoHead';
import { resolveNonoSkin } from '../features/nono/nonoMemoryStore';
import {
  useNonoDrag,
  useNonoChat,
  useNonoSuggestions,
  useNonoMemory,
  useNonoContext,
  useNonoToasts,
  NonoToaster,
} from '../features/nono/hooks';

/** Umbral de auto-sueño de Nono: 5 minutos de inactividad. */
const IDLE_SLEEP_MS = 5 * 60 * 1000;
/** Sin interacción, Nono tarda esto en empezar a derivar alrededor de su ancla. */
const IDLE_DRIFT_MS = 15 * 1000;
/** Con el puntero quieto, el orbe empieza a mirar a los lados por su cuenta. */
const IDLE_GAZE_MS = 2200;
/** Duración de cada cierre de párpado; debe coincidir con `.nono-eye-shutter`. */
const BLINK_DURATION_MS = 180;
/** Pausa breve entre los dos cierres de un parpadeo doble. */
const DOUBLE_BLINK_GAP_MS = 90;
/** Probabilidad de encadenar un segundo cierre. */
const DOUBLE_BLINK_CHANCE = 0.2;
/** Cadencia normal entre parpadeos: 3,5–8,5 s. */
const BLINK_MIN_DELAY_MS = 3500;
const BLINK_DELAY_RANGE_MS = 5000;
/** Cadencia de la interpolación de la mirada (~60 fps). */
const EYE_FOLLOW_FRAME_MS = 16;
/** Constante de tiempo del seguimiento ocular: llega al puntero en una fracción de segundo. */
const EYE_FOLLOW_MS = 70;
/** Distancia al objetivo por debajo de la cual la mirada se da por asentada. */
const EYE_FOLLOW_EPSILON = 0.01;

/**
 * Nono - Asistente flotante (versión slim ~400 líneas).
 * Orquesta hooks especializados:
 * - useNonoDrag: posición, persistencia, arrastre
 * - useNonoChat: mensajes, input, comandos, IA
 * - useNonoSuggestions: hover, sugerencias proyecto, frases contextuales
 * - useNonoMemory: preferencias usuario, stack, patrones
 * 
 * Separation of concerns: contenido en ./nono/content, visual en ./nono/NonoHead
 */
export const FloatingAssistant = forwardRef<FloatingAssistantHandle, FloatingAssistantProps>(({
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
  projectId,
  docked = false,
  onToggleDock,
  suggestionConfig,
  codeContext,
  hidden,
  busy = false,
}, ref) => {
  const headRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Texto corto por idioma (el resto del archivo usa ternarios en línea). */
  const tr = (es: string, en: string, de?: string) => (lang === 'es' ? es : lang === 'de' && de ? de : en);

  /** Mientras procesa, el orbe dice siempre que sí; un error cambia el aviso. */
  const affirmativePhrase =
    lang === 'es'
      ? '¡Sí! Voy con ello.'
      : lang === 'de'
        ? 'Ja! Ich mache das.'
        : 'Yes! On it.';

  // Deriva en reposo: se enciende cuando nadie interactúa con Nono.
  const [hovered, setHovered] = useState(false);
  const [idle, setIdle] = useState(false);
  // Mirada autónoma del orbe: se enciende cuando el puntero lleva un rato quieto.
  const [gazeIdle, setGazeIdle] = useState(false);

  /** Bandera síncrona de sueño: se enciende en el instante de dormirse, sin
   * esperar a un render, para que los ciclos propios de Nono no lo despierten. */
  const asleepRef = useRef(false);

  // Hooks especializados
  const {
    dragPos,
    handleMouseDown,
    handleTouchStart,
    handleDoubleClick,
  } = useNonoDrag({
    headRef,
  });

  const {
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
    messagesEndRef,
    handleClearChat,
    handleCopyLast,
    handleNewPromptClick,
    actionFeedback,
  } = useNonoChat({
    lang,
    displayName,
    onNewPrompt,
    onOpenWorkbench,
    onOpenCompile,
    onOpenGallery,
    onOpenSearch,
    selectedModel,
    selectedProvider,
    parameters,
    codeContext,
    projectId,
    projectInfo,
    inputRef,
    ref,
  });

  const {
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
  } = useNonoSuggestions({
    lang,
    displayName,
    projectInfo,
    suggestionConfig,
    isOpen,
    isAsleepRef: asleepRef,
    setExpression,
  });

  const { memory, updateUI } = useNonoMemory();
  const { suggestions, refresh, dismiss } = useNonoContext(memory.ui.showNono, projectId ?? null);
  const { showToast } = useNonoToasts();

  /**
   * Animación completa aunque el sistema pida menos movimiento.
   *
   * El CSS apaga lo agitado bajo `prefers-reduced-motion: reduce`; esta clase
   * en :root desactiva ese bloque. Va por clase y no por estilos en línea para
   * que el SVG no se remonte al cambiar la preferencia (remontarlo reiniciaría
   * el rebote y el parpadeo).
   */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('nono-force-motion', memory.ui.forceMotion);
    return () => root.classList.remove('nono-force-motion');
  }, [memory.ui.forceMotion]);

  /**
   * El asentimiento del orbe al procesar se decide en Configuración.
   *
   * Las clases del root permiten que la elección gane a
   * `prefers-reduced-motion` en ambos sentidos: activado asiente aunque el
   * sistema pida menos movimiento; desactivado no asiente aunque lo permita.
   */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('nono-orb-rotate-on', memory.ui.orbRotate);
    root.classList.toggle('nono-orb-rotate-off', !memory.ui.orbRotate);
    return () => root.classList.remove('nono-orb-rotate-on', 'nono-orb-rotate-off');
  }, [memory.ui.orbRotate]);

  // El contexto (diagnósticos, git, TODOs) se revisa al arrancar y cada 3 min
  // aunque el panel esté cerrado: antes sólo se calculaba al abrirlo, así que
  // la sugerencia llegaba cuando ya estabas dentro.
  useEffect(() => {
    if (!memory.ui.showNono || hidden) return;
    refresh();
    const timer = setInterval(() => {
      if (!isOpen) refresh();
    }, 180_000);
    return () => clearInterval(timer);
  }, [isOpen, memory.ui.showNono, hidden, refresh]);

  // Sugerencias que llegan con el panel cerrado: se avisan con el toast que ya
  // existía pero no se montaba en ninguna parte. Cada id se avisa una sola vez.
  const toastedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (isOpen || hidden || suggestions.length === 0) return;
    const fresh = suggestions.find((s) => !toastedRef.current.has(s.id));
    if (!fresh) return;
    toastedRef.current.add(fresh.id);
    showToast({
      type: fresh.severity,
      message: fresh.text,
      duration: 6000,
      action: {
        label: lang === 'es' ? 'Abrir Nono' : lang === 'de' ? 'Nono öffnen' : 'Open Nono',
        onClick: () => setIsOpen(true),
      },
      onClose: () => dismiss(fresh.id),
    });
  }, [suggestions, isOpen, hidden, showToast, lang, setIsOpen, dismiss]);

  // En modo docked el panel está siempre abierto (no hay cabeza flotante para abrirlo).
  useEffect(() => { if (docked) setIsOpen(true); }, [docked, setIsOpen]);
  // En versión completa pasarían como dependencias mutuas

  // Reacciones a eventos de la app (status)
  useEffect(() => {
    if (!status) return;
    const t = status.type;
    if (t === 'generating') setExpression('thinking');
    else if (t === 'done') { setExpression('happy'); setTimeout(() => setExpression('neutral'), 2500); }
    else if (t === 'error') { setExpression('error'); showContextPhrase(lang === 'es' ? '⚠️ Algo falló. ¿Reviso?' : '⚠️ Something failed. Check?'); setTimeout(() => setExpression('neutral'), 4500); }
    else if (t === 'success') { setExpression('love'); setTimeout(() => setExpression('neutral'), 3000); }
    else if (t === 'new_prompt') { setExpression('happy'); setTimeout(() => setExpression('neutral'), 2500); }
    else if (t === 'mode' && status.detail) {
      showContextPhrase(lang === 'es' ? `🔄 Modo ${status.detail}` : `🔄 Mode ${status.detail}`, 3000);
    }
  }, [status, lang, setExpression, showContextPhrase]);

  // Procesamiento en curso (respuesta del chat o corrida del agente): Nono
  // acompaña la espera con una cara propia y una frase corta; al terminar
  // celebra un instante. Sólo reacciona al cambio de estado, no a cada
  // re-render ni a cada token.
  const wasBusyRef = useRef(false);
  useEffect(() => {
    if (busy === wasBusyRef.current) return;
    wasBusyRef.current = busy;
    if (busy) {
      if (isOpen || asleepRef.current) return;
      setExpression('thinking');
      showContextPhrase(
        memory.ui.orbSkin
          ? affirmativePhrase
          : lang === 'es'
            ? 'Estoy en ello, dame un momento…'
            : lang === 'de'
              ? 'Ich bin dran, einen Moment…'
              : 'On it, give me a moment…',
        6000
      );
      return;
    }
    // Al acabar: alivio breve, salvo que el panel, el teclado o un error lleven
    // el mando. Un fallo no se celebra con «¡Listo!».
    if (isOpen || isTyping || asleepRef.current || status?.type === 'error') return;
    // Gafas de sol: la corrida terminó bien.
    setExpression('cool');
    showContextPhrase(lang === 'es' ? '¡Listo!' : lang === 'de' ? 'Fertig!' : 'Done!', 2500);
  }, [busy, isOpen, isTyping, lang, memory.ui.orbSkin, affirmativePhrase, status?.type, setExpression, showContextPhrase]);

  // El orbe no tiene la pantalla de binario del clásico: mientras procesa mira
  // hacia el chat y asiente, y el bocadillo dice siempre que sí. La frase se
  // refresca para que siga visible en esperas largas; un error la retira y deja
  // el aviso de fallo.
  useEffect(() => {
    if (!busy || !memory.ui.orbSkin || isOpen || asleepRef.current || status?.type === 'error') return;
    showContextPhrase(affirmativePhrase, 6000);
    const timer = setInterval(() => {
      if (status?.type !== 'error') showContextPhrase(affirmativePhrase, 6000);
    }, 5000);
    return () => clearInterval(timer);
  }, [busy, isOpen, memory.ui.orbSkin, showContextPhrase, status?.type, affirmativePhrase]);

  // Saludo inicial con typing effect
  const greetingText = (() => {
    const name = (displayName || '').trim();
    if (lang === 'es') return name ? `¡Hola, ${name}! Soy Nono. ¿En qué ayudo?` : '¡Hola! Soy Nono. ¿En qué ayudo?';
    if (lang === 'de') return name ? `Hallo, ${name}! Ich bin Nono. Wie kann ich helfen?` : 'Hallo! Ich bin Nono. Wie kann ich helfen?';
    return name ? `Hello, ${name}! I'm Nono. How can I help?` : "Hello! I'm Nono. How can I help?";
  })();

  const [typedGreeting, setTypedGreeting] = useState('');
  useEffect(() => {
    const reduceMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches && !memory.ui.forceMotion;
    setTypedGreeting(''); setGreetingVisible(false);
    const startDelay = setTimeout(() => {
      setGreetingVisible(true); setExpression('happy');
      if (reduceMotion) { setTypedGreeting(greetingText); setTimeout(() => setGreetingVisible(false), 8000); return; }
      let i = 0; const interval = setInterval(() => { i++; setTypedGreeting(greetingText.slice(0, i)); if (i >= greetingText.length) { clearInterval(interval); setExpression('neutral'); setTimeout(() => setGreetingVisible(false), 8000); } }, 42);
      return () => { clearTimeout(startDelay); clearInterval(interval); };
    }, 1100);
    return () => { clearTimeout(startDelay); };
  }, [greetingText, setGreetingVisible, setExpression, memory.ui.forceMotion]);

  // Saludo del orbe: un pop con balanceo la primera vez que aparece el saludo
  // flotante. El ref evita que se repita si el efecto de saludo se reejecuta
  // (cambio de idioma o del ajuste de animación).
  const [orbGreeting, setOrbGreeting] = useState(false);
  const orbGreetedRef = useRef(false);
  useEffect(() => {
    if (!greetingVisible || !memory.ui.orbSkin || orbGreetedRef.current) return;
    orbGreetedRef.current = true;
    setOrbGreeting(true);
  }, [greetingVisible, memory.ui.orbSkin]);
  useEffect(() => {
    if (!orbGreeting) return;
    const timer = setTimeout(() => setOrbGreeting(false), 1400);
    return () => clearTimeout(timer);
  }, [orbGreeting]);

  // Ojos: dirección desde el centro de la cabeza hasta el puntero.
  // NonoHead la recibe como vector unitario y desplaza las pupilas. El objetivo
  // se interpola en pasos cortos para que la mirada acompañe al puntero en vez
  // de saltar de una posición a otra con cada evento. La opción de accesibilidad
  // `instantGaze` desactiva esa interpolación y aplica el vector de inmediato.
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const eyeOffsetRef = useRef(eyeOffset);
  const eyeTargetRef = useRef(eyeOffset);
  const eyeFollowTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const instantGaze = memory.ui.instantGaze;

  useEffect(() => {
    const stopEyeFollow = () => {
      if (eyeFollowTimerRef.current !== null) {
        clearInterval(eyeFollowTimerRef.current);
        eyeFollowTimerRef.current = null;
      }
    };

    const stepEyeFollow = () => {
      const target = eyeTargetRef.current;
      const current = eyeOffsetRef.current;
      const alpha = 1 - Math.exp(-EYE_FOLLOW_FRAME_MS / EYE_FOLLOW_MS);
      const next = {
        x: current.x + (target.x - current.x) * alpha,
        y: current.y + (target.y - current.y) * alpha,
      };
      const settled = Math.hypot(target.x - next.x, target.y - next.y) < EYE_FOLLOW_EPSILON;
      const value = settled ? target : next;
      eyeOffsetRef.current = value;
      setEyeOffset(value);
      if (settled) stopEyeFollow();
    };

    // Al activar la mirada instantánea se corta la transición en curso y se
    // salta al último objetivo, sin esperar al siguiente movimiento.
    if (instantGaze) {
      stopEyeFollow();
      const target = eyeTargetRef.current;
      eyeOffsetRef.current = target;
      setEyeOffset(target);
    }

    const handleMouseMove = (e: MouseEvent) => {
      const head = headRef.current;
      if (!head) return;
      const rect = head.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const angle = Math.atan2(dy, dx);
      // Mover el puntero devuelve el control al cursor de inmediato, sin
      // esperar al primer frame de la interpolación.
      setGazeIdle(false);
      const target = { x: Math.cos(angle), y: Math.sin(angle) };
      eyeTargetRef.current = target;
      if (instantGaze) {
        stopEyeFollow();
        eyeOffsetRef.current = target;
        setEyeOffset(target);
        return;
      }
      if (eyeFollowTimerRef.current === null) {
        eyeFollowTimerRef.current = setInterval(stepEyeFollow, EYE_FOLLOW_FRAME_MS);
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      stopEyeFollow();
    };
  }, [instantGaze]);

  // Auto-sueño: en reposo Nono baja los párpados (LED verde + Zzz). La cuenta se
  // reinicia sólo con actividad del usuario. Las expresiones que Nono se provoca
  // solo (el ciclo de sugerencias, cada 50 s) no cuentan: si contaran, la cuenta
  // nunca llegaría a los 5 minutos y jamás se dormiría.
  const expressionRef = useRef(expression);
  expressionRef.current = expression;

  // Mantiene la bandera en sintonía cuando despierta por cualquier otro motivo.
  useEffect(() => {
    asleepRef.current = expression === 'sleepy';
  }, [expression]);

  useEffect(() => {
    // Con el panel abierto, el chat en uso o una interacción directa no se duerme.
    if (isOpen || isWatchingChat || hovered || dragPos || isTyping || isChatTyping) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (delay: number) => {
      timer = setTimeout(() => {
        // Si está en mitad de una animación propia (pensando, curioso, feliz por
        // un evento), se espera a que vuelva al reposo en vez de dormirlo a media
        // expresión.
        const current = expressionRef.current;
        const busy = current !== 'neutral' && current !== 'sleepy';
        if (busy) {
          schedule(10_000);
          return;
        }
        asleepRef.current = true;
        setExpression('sleepy');
      }, delay);
    };
    schedule(IDLE_SLEEP_MS);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isOpen, isWatchingChat, hovered, dragPos, isTyping, isChatTyping, setExpression]);

  // Deriva: tras un rato sin tocarlo ni escribir en el chat, Nono se desplaza
  // alrededor de su ancla. Cualquier interacción lo devuelve al centro.
  useEffect(() => {
    if (hovered || isOpen || isTyping || isChatTyping || dragPos) {
      setIdle(false);
      return;
    }
    const timer = setTimeout(() => setIdle(true), IDLE_DRIFT_MS);
    return () => clearTimeout(timer);
  }, [hovered, isOpen, isTyping, isChatTyping, dragPos]);

  // Parpadeo
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const schedule = (fn: () => void, delay: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!cancelled) fn();
      }, delay);
      timers.add(timer);
    };

    const closeEyes = () => {
      setBlink(true);
      schedule(() => {
        setBlink(false);
        // De vez en cuando, un segundo cierre corto: menos mecánico que un
        // parpadeo idéntico cada vez.
        if (Math.random() < DOUBLE_BLINK_CHANCE) {
          schedule(() => {
            setBlink(true);
            schedule(() => setBlink(false), BLINK_DURATION_MS);
          }, DOUBLE_BLINK_GAP_MS);
        }
      }, BLINK_DURATION_MS);
    };

    const loop = () => {
      if (cancelled) return;
      schedule(() => {
        closeEyes();
        loop();
      }, BLINK_MIN_DELAY_MS + Math.random() * BLINK_DELAY_RANGE_MS);
    };

    loop();
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // Mirada en reposo: si el puntero deja de moverse, el orbe barre la mirada a
  // los lados por su cuenta. Cualquier movimiento del ratón devuelve el control
  // al cursor. El parpadeo ya es autónomo y sigue funcionando en este estado.
  useEffect(() => {
    setGazeIdle(false);
    if (hovered || isOpen || busy || isTyping || isChatTyping || expression === 'sleepy') return;
    const timer = setTimeout(() => setGazeIdle(true), IDLE_GAZE_MS);
    return () => clearTimeout(timer);
  }, [hovered, isOpen, busy, isTyping, isChatTyping, expression, eyeOffset.x, eyeOffset.y]);

  // Anclaje a divider del chat
  const [anchor, setAnchor] = useState({ bottom: 8, right: 8 });
  useEffect(() => {
    const measure = () => {
      const divider = document.querySelector('[data-chat-divider]');
      if (divider) { const rect = divider.getBoundingClientRect(); setAnchor({ bottom: Math.max(0, window.innerHeight - rect.top - 4), right: 8 }); }
      else { setAnchor({ bottom: 8, right: 8 }); }
    };
    measure(); const mo = new MutationObserver(measure); mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', measure); const interval = setInterval(measure, 1000);
    return () => { mo.disconnect(); window.removeEventListener('resize', measure); clearInterval(interval); };
  }, []);

  // Cerrar con Escape
  useEffect(() => { const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen) setIsOpen(false); }; window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey); }, [isOpen, setIsOpen]);

  // Estilos computados
  const GAP = 8;
  const PANEL_MIN_HEIGHT = 320;
  const PANEL_MAX_HEIGHT = 520;
  const PANEL_MARGIN = 8;
  const headStyle: React.CSSProperties = dragPos
    ? { left: 0, top: 0, transform: `translate3d(${dragPos.x}px, ${dragPos.y}px, 0) ${isTyping ? 'rotate(-7deg)' : ''}`, willChange: 'transform', transition: isTyping ? 'transform 0.25s ease-out' : 'none' }
    : isTyping ? { bottom: anchor.bottom + GAP, right: anchor.right + GAP, transform: 'rotate(-7deg)', transition: 'transform 0.25s ease-out' } : { bottom: anchor.bottom + GAP, right: anchor.right + GAP };

  const headBottomEdge = dragPos ? window.innerHeight - dragPos.y - 64 : anchor.bottom;
  const viewportHeight = window.innerHeight;
  const panelHeight = Math.min(
    PANEL_MAX_HEIGHT,
    Math.max(PANEL_MIN_HEIGHT, Math.round(viewportHeight * 0.6)),
    Math.max(0, viewportHeight - PANEL_MARGIN * 2)
  );
  const panelBottom = Math.max(
    PANEL_MARGIN,
    Math.min(headBottomEdge + 68, viewportHeight - panelHeight - PANEL_MARGIN)
  );
  const panelStyle: React.CSSProperties = { bottom: panelBottom, right: PANEL_MARGIN, height: panelHeight };

  const headTopPx = dragPos ? dragPos.y : Math.max(0, window.innerHeight - anchor.bottom - GAP - 64);
  const headRightPx = dragPos ? Math.max(8, window.innerWidth - dragPos.x - 64) : anchor.right + GAP;
  const greetingStyle: React.CSSProperties = { top: Math.max(8, headTopPx - 58), right: headRightPx, maxWidth: 'min(280px, calc(100vw - 2rem))' };

  if (hidden || !memory.ui.showNono) return null;

  return (
    <>
      {/* Texto flotante: saludo / hover / sugerencia / frase contextual */}
      {(() => {
        if (docked) return null;
        const floatingMessage = hoverPhrase || contextPhrase || projectSuggestion || typedGreeting;
        const floatingVisible = !isOpen && (hoverPhrase || contextPhrase || showProjectSuggestion || greetingVisible);
        const typingCaret = !hoverPhrase && !contextPhrase && !showProjectSuggestion && greetingVisible && typedGreeting.length < greetingText.length;
        if (!floatingVisible && typedGreeting.length === 0) return null;
        return (
          <div
            className={`pointer-events-none fixed z-[9997] transition-opacity duration-300 ${floatingVisible ? 'opacity-100' : 'opacity-0'}`}
            style={greetingStyle}
            data-nono-greeting={greetingVisible ? 'true' : undefined}
            data-nono-hover={hoverPhrase ? 'true' : undefined}
            data-nono-suggestion={showProjectSuggestion ? 'true' : undefined}
            aria-live="polite"
          >
            <p className="text-right text-[var(--nc-text)] font-bold text-xs leading-snug" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.95), 0 0 16px rgba(0,255,255,0.4)' }}>
              {floatingMessage}
              {typingCaret && <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-[var(--nc-highlight-bg)] align-middle" />}
            </p>
          </div>
        );
      })()}

      {/* Panel de chat */}
      {isOpen && (
        <div className={`nono-panel ${docked ? 'relative w-full h-full' : 'fixed z-[9999] w-[360px] max-w-[calc(100vw-1rem)]'} bg-[var(--nc-bg-deep)] border-2 border-[var(--nc-border-light)] rounded-lg shadow-[0_0_30px_rgba(0,255,255,0.3)] flex flex-col overflow-hidden`} style={docked ? undefined : panelStyle}>
          <div className="flex items-center justify-between px-3 py-2 bg-[var(--nc-header-bg)] border-b-2 border-[var(--nc-border-dark)] shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-black font-bold text-sm">Nono</span>
              <span className="text-[10px] text-black/60">{isTyping ? '...' : 'online'}</span>
            </div>
            {actionFeedback && (
              <span className="ml-auto mr-1 text-[10px] text-[var(--nc-text-accent)] animate-pulse">{actionFeedback}</span>
            )}
            {onToggleDock && <button onClick={onToggleDock} aria-label={docked ? 'Desacoplar' : 'Acoplar'} className="text-black hover:text-[var(--nc-active-text)] font-bold leading-none px-1" title={docked ? 'Modo flotante' : 'Acoplar a panel'}><PanelRight className="w-4 h-4" /></button>}
            <button onClick={() => { if (docked && onToggleDock) onToggleDock(); else setIsOpen(false); }} aria-label="Cerrar" className="text-black hover:text-red-500 font-bold leading-none px-1"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex flex-nowrap items-center gap-1 px-2 py-1 bg-[var(--nc-bg-deep)] border-b border-[var(--nc-border-dark)] shrink-0 overflow-x-auto nc-x-scroll [&>button]:shrink-0">
            <button onClick={handleClearChat} aria-label="Limpiar chat" className="text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] border border-[var(--nc-border-dark)] rounded px-1.5 py-0.5 text-[10px] font-bold"><Trash2 className="w-3.5 h-3.5" /></button>
            <button onClick={handleCopyLast} aria-label="Copiar último" className="text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] border border-[var(--nc-border-dark)] rounded px-1.5 py-0.5 text-[10px] font-bold"><Clipboard className="w-3.5 h-3.5" /></button>
            {onNewPrompt && <button onClick={handleNewPromptClick} aria-label="Nuevo chat" className="text-[var(--nc-text-accent)] hover:bg-[var(--nc-bg-hover)] border border-[var(--nc-border-dark)] rounded px-1.5 py-0.5 text-[10px] font-bold"><Plus className="w-3.5 h-3.5" /></button>}
            <button
              onClick={() => updateUI('compactMode', !memory.ui.compactMode)}
              aria-label={
                memory.ui.compactMode
                  ? tr('Tamaño normal', 'Normal size', 'Normale Größe')
                  : tr('Tamaño compacto', 'Compact size', 'Kompakte Größe')
              }
              aria-pressed={memory.ui.compactMode}
              title={
                memory.ui.compactMode
                  ? tr('Volver al tamaño normal', 'Back to normal size', 'Zurück zur normalen Größe')
                  : tr('Hacer a Nono más pequeño', 'Make Nono smaller', 'Nono kleiner machen')
              }
              className="flex items-center gap-1 border rounded px-1.5 py-0.5 text-[10px] font-bold text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] border-[var(--nc-border-dark)]"
            >
              {memory.ui.compactMode ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
              {lang === 'es' ? 'tamaño' : lang === 'de' ? 'Größe' : 'size'}
            </button>
            <button
              onClick={() => updateUI('orbSkin', !memory.ui.orbSkin)}
              aria-label={memory.ui.orbSkin ? tr('Volver al Nono clásico', 'Back to classic Nono', 'Zurück zum klassischen Nono') : tr('Probar el Nono orbe', 'Try orb Nono', 'Kugel-Nono testen')}
              aria-pressed={memory.ui.orbSkin}
              title={
                memory.ui.orbSkin
                  ? tr('Variante orbe activa: esfera turquesa con ojos de barra', 'Orb variant on: turquoise sphere with bar eyes', 'Kugelvariante aktiv: türkisfarbene Kugel mit Balkenaugen')
                  : tr('Variante extra: esfera turquesa→verde con ojos de barra', 'Extra variant: turquoise→green sphere with bar eyes', 'Extra-Variante: türkis-grüne Kugel mit Balkenaugen')
              }
              className={`flex items-center gap-1 border rounded px-1.5 py-0.5 text-[10px] font-bold ${memory.ui.orbSkin ? 'bg-[var(--nc-active-bg)] text-black border-[var(--nc-text-accent)]' : 'text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] border-[var(--nc-border-dark)]'}`}
            >
              <Circle className="w-3.5 h-3.5" />
              {lang === 'es' ? 'orbe' : lang === 'de' ? 'Kugel' : 'orb'}
            </button>
            <button
              onClick={() => updateUI('forceMotion', !memory.ui.forceMotion)}
              aria-label={memory.ui.forceMotion ? 'Animar siempre: activado' : 'Animar siempre: desactivado'}
              aria-pressed={memory.ui.forceMotion}
              title={
                memory.ui.forceMotion
                  ? tr(
                      'Animar siempre: activo, se ignora la preferencia del sistema',
                      'Always animate: on, the system preference is ignored',
                      'Immer animieren: aktiv, die Systemeinstellung wird ignoriert'
                    )
                  : tr(
                      'Animar siempre aunque el sistema pida menos movimiento',
                      'Always animate even if the system asks for less motion',
                      'Immer animieren, auch wenn das System weniger Bewegung möchte'
                    )
              }
              className={`flex shrink-0 items-center gap-1 border rounded px-1.5 py-0.5 text-[10px] font-bold ${memory.ui.forceMotion ? 'bg-[var(--nc-active-bg)] text-black border-[var(--nc-text-accent)]' : 'text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] border-[var(--nc-border-dark)]'}`}
            >
              <Activity className="w-3.5 h-3.5" />
              {lang === 'es' ? 'animar' : lang === 'de' ? 'animieren' : 'animate'}
            </button>
          </div>

          {(onOpenWorkbench || onOpenCompile || onOpenGallery || onOpenSearch) && (
            <div className="flex flex-nowrap gap-1 px-2 py-1 bg-[var(--nc-bg-deep)] border-b border-[var(--nc-border-dark)] shrink-0 overflow-x-auto nc-x-scroll [&>button]:shrink-0">
              {onOpenWorkbench && <ActionChip icon={PanelRight} label={lang === 'es' ? 'Workbench' : 'Workbench'} onClick={() => { onOpenWorkbench(); setExpression('happy'); }} />}
              {onOpenCompile && <ActionChip icon={Hammer} label={lang === 'es' ? 'Compilar' : 'Compile'} onClick={() => { onOpenCompile(); setExpression('happy'); }} color="yellow" />}
              {onOpenGallery && <ActionChip icon={Library} label={lang === 'es' ? 'Galería' : 'Gallery'} onClick={() => { onOpenGallery(); setExpression('happy'); }} />}
              {onOpenSearch && <ActionChip icon={Search} label={lang === 'es' ? 'Buscar' : 'Search'} onClick={() => { onOpenSearch(); setExpression('happy'); }} />}
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="px-2 py-1 bg-[var(--nc-bg-deep)] border-b border-[var(--nc-border-dark)] shrink-0 space-y-1">
              {suggestions.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-[10px] text-[var(--nc-text-accent)] bg-[var(--nc-bg-deep)] border border-[var(--nc-border-dark)] rounded px-2 py-1">
                  <span>{s.text}</span>
                  <button onClick={() => dismiss(s.id)} aria-label="Descartar" className="text-[var(--nc-text)] hover:text-red-400 font-bold leading-none">×</button>
                </div>
              ))}
            </div>
          )}

          <div data-testid="nono-messages" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-2 bg-[var(--nc-bg-deep)]">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.fromUser ? 'justify-end' : 'justify-start'}`}>
                <div data-testid={msg.fromUser ? 'nono-user-bubble' : 'nono-message-bubble'} className={`max-w-[85%] break-words px-3 py-1.5 rounded-lg text-xs ${msg.fromUser ? 'bg-[var(--nc-active-bg)] text-black font-bold' : 'bg-[var(--nc-bg-deep)] text-[var(--nc-text)] border border-[var(--nc-border-dark)]'}`}>
                  <p>{msg.text}</p>
                  <span className="text-[9px] opacity-50 block text-right">{msg.timestamp}</span>
                </div>
              </div>
            ))}
            {isTyping && <div className="flex justify-start"><div className="bg-[var(--nc-bg-deep)] text-[var(--nc-text)] border border-[var(--nc-border-dark)] px-3 py-1.5 rounded-lg text-xs"><span className="animate-pulse">● ● ●</span></div></div>}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex gap-1 p-2 bg-[var(--nc-bg-deep)] border-t border-[var(--nc-border-dark)] shrink-0">
            <input ref={inputRef} type="text" value={inputValue} onChange={e => setInputValue(e.target.value)} onKeyDown={handleKeyDown} placeholder={lang === 'es' ? 'Escribe...' : lang === 'de' ? 'Eingabe...' : 'Type...'} className="min-w-0 flex-1 bg-[var(--nc-bg-panel)] text-[var(--nc-text)] text-xs px-2 py-1.5 rounded border border-[var(--nc-border-dark)] outline-none placeholder:text-[var(--nc-text)]/40 focus:border-[var(--nc-border-light)]" />
            <button onClick={handleSend} aria-label="Enviar" className="nc-button !px-2 !py-1 text-xs font-bold flex items-center gap-1"><Send className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      {/* Cabeza de Nono (solo en modo flotante) */}
      {!docked && (
      <div
        ref={headRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onClick={handleToggle}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => { setHovered(true); handleHeadMouseEnter(); }}
        onMouseLeave={() => { setHovered(false); handleHeadMouseLeave(); }}
        tabIndex={0}
        role="button"
        aria-label="Nono"
        aria-expanded={isOpen}
        onKeyDown={(e) => {
          // La cabeza ya era focusable: Enter/Espacio tienen que abrirla.
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggle();
          }
        }}
        className={`fixed z-[9998] select-none touch-none focus-visible:outline-2 focus-visible:outline-[var(--nc-text-accent)] cursor-pointer ${expression !== 'sleepy' ? (idle ? 'nono-awake nono-idle' : 'nono-awake') : 'nono-asleep'} ${busy ? 'nono-busy' : ''}`}
        style={headStyle}
      >
        {/* La inclinación va en un contenedor interno: así se suma al
            translate3d del arrastre en vez de competir con él. */}
        <div
          className={`nono-head-inner ${
            isChatTyping ? (memory.ui.orbSkin ? 'nono-orb-lean' : 'nono-lean-chat') : ''
          } ${orbGreeting ? 'nono-orb-greet' : ''}`}
        >
        {/* Charco de luz bajo Nono: sobre un fondo casi negro una sombra
            oscura no se ve, así que la altura se lee por el brillo que se
            apaga al subir. */}
        <div
          aria-hidden="true"
          data-nono-shadow="true"
          className="nono-shadow pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full"
          style={{
            bottom: -10,
            width: memory.ui.compactMode ? 42 : 56,
            height: 10,
            background:
              'radial-gradient(ellipse at center, rgba(0,255,255,0.5) 0%, rgba(0,255,255,0.16) 55%, transparent 82%)',
            filter: 'blur(3px)',
          }}
        />
        {/* `key` remonta el SVG al empezar a escribir, reiniciando el rebote. */}
        <NonoHead
          key={chatBounceToken}
          expression={expression as NonoExpression}
          eyeOffset={eyeOffset}
          blink={blink}
          size={memory.ui.compactMode ? 36 : 48}
          show3D={true}
          busy={busy}
          idleGaze={gazeIdle}
          variant={resolveNonoSkin(memory.ui)}
          orbColors={memory.ui.orbColors}
          classicAccent={memory.ui.classicAccent}
        />
        {expression === 'sleepy' && !hoverPhrase && !contextPhrase && (
          <div className="nono-sleep-z absolute pointer-events-none" aria-hidden="true">
            <span>Z</span><span>z</span><span>z</span>
          </div>
        )}
        </div>
      </div>
      )}
      <NonoToaster />
    </>
  );
});

FloatingAssistant.displayName = 'FloatingAssistant';

/** Chip de acción reutilizable */
interface ActionChipProps { icon: LucideIcon; label: string; onClick: () => void; color?: 'cyan' | 'yellow'; }
const ActionChip = ({ icon: Icon, label, onClick, color = 'cyan' }: ActionChipProps) => (
  <button onClick={onClick} className={`flex shrink-0 items-center gap-1 text-[9px] font-bold ${color === 'yellow' ? 'text-[var(--nc-text-accent)]' : 'text-[var(--nc-text)]'} bg-[var(--nc-bg-main)] hover:bg-[var(--nc-header-bg)] hover:text-black border border-[var(--nc-border-light)]/60 rounded px-1.5 py-0.5`}>
    <Icon className="w-3 h-3" /> {label}
  </button>
);

export { NonoHead } from './nono/NonoHead';
export type { NonoExpression, FloatingAssistantHandle, NonoStatusEvent } from './nono/content';
export default FloatingAssistant;