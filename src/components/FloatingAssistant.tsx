import React, { forwardRef, useRef, useEffect, useState } from 'react';
import { Clipboard, PanelRight, Hammer, Library, Search, Trash2, Plus, Send, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FloatingAssistantProps, FloatingAssistantHandle, NonoExpression } from './nono/content';
import { NonoHead } from './nono/NonoHead';
import {
  useNonoDrag,
  useNonoChat,
  useNonoSuggestions,
  useNonoMemory,
} from '../features/nono/hooks';

/** Umbral de auto-sueño de Nono: 5 minutos de inactividad. */
const IDLE_SLEEP_MS = 5 * 60 * 1000;

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
  suggestionConfig,
  codeContext,
  hidden,
}, ref) => {
  const headRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    setExpression,
  });

  const { memory } = useNonoMemory();

  // Sincronizar isOpen con drag hook (simplificado)
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

  // Saludo inicial con typing effect
  const greetingText = (() => {
    const name = (displayName || '').trim();
    if (lang === 'es') return name ? `¡Hola, ${name}! Soy Nono. ¿En qué ayudo?` : '¡Hola! Soy Nono. ¿En qué ayudo?';
    if (lang === 'de') return name ? `Hallo, ${name}! Ich bin Nono. Wie kann ich helfen?` : 'Hallo! Ich bin Nono. Wie kann ich helfen?';
    return name ? `Hello, ${name}! I'm Nono. How can I help?` : "Hello! I'm Nono. How can I help?";
  })();

  const [typedGreeting, setTypedGreeting] = useState('');
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTypedGreeting(''); setGreetingVisible(false);
    const startDelay = setTimeout(() => {
      setGreetingVisible(true); setExpression('happy');
      if (reduceMotion) { setTypedGreeting(greetingText); setTimeout(() => setGreetingVisible(false), 8000); return; }
      let i = 0; const interval = setInterval(() => { i++; setTypedGreeting(greetingText.slice(0, i)); if (i >= greetingText.length) { clearInterval(interval); setExpression('neutral'); setTimeout(() => setGreetingVisible(false), 8000); } }, 42);
      return () => { clearTimeout(startDelay); clearInterval(interval); };
    }, 1100);
    return () => { clearTimeout(startDelay); };
  }, [greetingText, setGreetingVisible, setExpression]);

  // Ojos: dirección desde el centro de la cabeza hasta el puntero.
  // NonoHead la recibe como vector unitario y desplaza las pupilas.
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const head = headRef.current;
      if (!head) return;
      const rect = head.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const angle = Math.atan2(dy, dx);
      setEyeOffset({ x: Math.cos(angle), y: Math.sin(angle) });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Auto-sueño: en reposo Nono baja los párpados (LED verde + Zzz). Cualquier
  // cambio de expresión o de estado de observación reinicia la cuenta.
  useEffect(() => {
    if (isOpen) return; // con el panel abierto no se duerme
    const timer = setTimeout(() => setExpression('sleepy'), IDLE_SLEEP_MS);
    return () => clearTimeout(timer);
  }, [isOpen, isWatchingChat, expression, setExpression]);

  // Parpadeo
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    const loop = () => { setTimeout(() => { setBlink(true); setTimeout(() => setBlink(false), 120); loop(); }, 2000 + Math.random() * 4000); };
    loop();
  }, []);

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
  useEffect(() => { const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen) setIsOpen(false); }; window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey); }, [isOpen]);

  // Estilos computados
  const GAP = 8;
  const headStyle: React.CSSProperties = dragPos
    ? { left: 0, top: 0, transform: `translate3d(${dragPos.x}px, ${dragPos.y}px, 0) ${isTyping ? 'rotate(-7deg)' : ''}`, willChange: 'transform', transition: isTyping ? 'transform 0.25s ease-out' : 'none' }
    : isTyping ? { bottom: anchor.bottom + GAP, right: anchor.right + GAP, transform: 'rotate(-7deg)', transition: 'transform 0.25s ease-out' } : { bottom: anchor.bottom + GAP, right: anchor.right + GAP };

  const headBottomEdge = dragPos ? window.innerHeight - dragPos.y - 64 : anchor.bottom;
  const panelStyle: React.CSSProperties = { bottom: Math.max(8, Math.min(headBottomEdge + 68, window.innerHeight - 340)), right: 8, height: 320 };

  const headTopPx = dragPos ? dragPos.y : Math.max(0, window.innerHeight - anchor.bottom - GAP - 64);
  const headRightPx = dragPos ? Math.max(8, window.innerWidth - dragPos.x - 64) : anchor.right + GAP;
  const greetingStyle: React.CSSProperties = { top: Math.max(8, headTopPx - 58), right: headRightPx, maxWidth: 'min(280px, calc(100vw - 2rem))' };

  if (hidden || !memory.ui.showNono) return null;

  return (
    <>
      {/* Texto flotante: saludo / hover / sugerencia / frase contextual */}
      {(() => {
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
            <p className="text-right text-[#00ffff] font-bold text-xs leading-snug" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.95), 0 0 16px rgba(0,255,255,0.4)' }}>
              {floatingMessage}
              {typingCaret && <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-[#00ffff] align-middle" />}
            </p>
          </div>
        );
      })()}

      {/* Panel de chat */}
      {isOpen && (
        <div className="nono-panel fixed z-[9999] w-80 max-w-[calc(100vw-2rem)] bg-[#001a33] border-2 border-[#00ffff] rounded-lg shadow-[0_0_30px_rgba(0,255,255,0.3)] flex flex-col overflow-hidden" style={panelStyle}>
          <div className="flex items-center justify-between px-3 py-2 bg-[#00aaaa] border-b-2 border-[#000055] shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-black font-bold text-sm">Nono</span>
              <span className="text-[10px] text-black/60">{isTyping ? '...' : 'online'}</span>
            </div>
            {actionFeedback && (
              <span className="ml-auto mr-1 text-[10px] text-[#ffff55] animate-pulse">{actionFeedback}</span>
            )}
            <button onClick={() => setIsOpen(false)} aria-label="Cerrar" className="text-black hover:text-red-500 font-bold leading-none px-1"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex items-center gap-1 px-2 py-1 bg-[#00243e] border-b border-[#004466] shrink-0">
            <button onClick={handleClearChat} aria-label="Limpiar chat" className="text-[#00ffff] hover:bg-[#000080] border border-[#004466] rounded px-1.5 py-0.5 text-[10px] font-bold"><Trash2 className="w-3.5 h-3.5" /></button>
            <button onClick={handleCopyLast} aria-label="Copiar último" className="text-[#00ffff] hover:bg-[#000080] border border-[#004466] rounded px-1.5 py-0.5 text-[10px] font-bold"><Clipboard className="w-3.5 h-3.5" /></button>
            {onNewPrompt && <button onClick={handleNewPromptClick} aria-label="Nuevo chat" className="text-[#ffff55] hover:bg-[#000080] border border-[#004466] rounded px-1.5 py-0.5 text-[10px] font-bold"><Plus className="w-3.5 h-3.5" /></button>}
          </div>

          {(onOpenWorkbench || onOpenCompile || onOpenGallery || onOpenSearch) && (
            <div className="flex flex-wrap gap-1 px-2 py-1 bg-[#001633] border-b border-[#004466] shrink-0">
              {onOpenWorkbench && <ActionChip icon={PanelRight} label={lang === 'es' ? 'Workbench' : 'Workbench'} onClick={() => { onOpenWorkbench(); setExpression('happy'); }} />}
              {onOpenCompile && <ActionChip icon={Hammer} label={lang === 'es' ? 'Compilar' : 'Compile'} onClick={() => { onOpenCompile(); setExpression('happy'); }} color="yellow" />}
              {onOpenGallery && <ActionChip icon={Library} label={lang === 'es' ? 'Galería' : 'Gallery'} onClick={() => { onOpenGallery(); setExpression('happy'); }} />}
              {onOpenSearch && <ActionChip icon={Search} label={lang === 'es' ? 'Buscar' : 'Search'} onClick={() => { onOpenSearch(); setExpression('happy'); }} />}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#000d1a]">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.fromUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`nc-x-scroll max-w-[85%] px-3 py-1.5 rounded-lg text-xs ${msg.fromUser ? 'bg-[#ffff55] text-black font-bold' : 'bg-[#00243e] text-[#00ffff] border border-[#004466]'}`}>
                  <p>{msg.text}</p>
                  <span className="text-[9px] opacity-50 block text-right">{msg.timestamp}</span>
                </div>
              </div>
            ))}
            {isTyping && <div className="flex justify-start"><div className="bg-[#00243e] text-[#00ffff] border border-[#004466] px-3 py-1.5 rounded-lg text-xs"><span className="animate-pulse">● ● ●</span></div></div>}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex gap-1 p-2 bg-[#001a33] border-t border-[#004466] shrink-0">
            <input ref={inputRef} type="text" value={inputValue} onChange={e => setInputValue(e.target.value)} onKeyDown={handleKeyDown} placeholder={lang === 'es' ? 'Escribe...' : lang === 'de' ? 'Eingabe...' : 'Type...'} className="flex-1 bg-[#000080] text-[#00ffff] text-xs px-2 py-1.5 rounded border border-[#004466] outline-none placeholder:text-[#00ffff]/40 focus:border-[#00ffff]" />
            <button onClick={handleSend} aria-label="Enviar" className="nc-button !px-2 !py-1 text-xs font-bold flex items-center gap-1"><Send className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      {/* Cabeza de Nono */}
      <div
        ref={headRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onClick={handleToggle}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={handleHeadMouseEnter}
        onMouseLeave={handleHeadMouseLeave}
        tabIndex={0}
        role="button"
        aria-label="Nono"
        className={`fixed z-[9998] select-none touch-none focus-visible:outline-2 focus-visible:outline-[#ffff55] cursor-pointer ${expression !== 'sleepy' ? 'nono-awake' : ''} ${isChatTyping && !dragPos ? 'nono-lean-chat' : ''}`}
        style={headStyle}
      >
        {/* `key` remonta el SVG al empezar a escribir, reiniciando el rebote. */}
        <NonoHead key={chatBounceToken} expression={expression as NonoExpression} eyeOffset={eyeOffset} blink={blink} size={48} show3D={true} />
        {expression === 'sleepy' && !hoverPhrase && !contextPhrase && (
          <div className="nono-sleep-z absolute pointer-events-none" aria-hidden="true">
            <span>Z</span><span>z</span><span>z</span>
          </div>
        )}
      </div>
    </>
  );
});

FloatingAssistant.displayName = 'FloatingAssistant';

/** Chip de acción reutilizable */
interface ActionChipProps { icon: LucideIcon; label: string; onClick: () => void; color?: 'cyan' | 'yellow'; }
const ActionChip = ({ icon: Icon, label, onClick, color = 'cyan' }: ActionChipProps) => (
  <button onClick={onClick} className={`flex items-center gap-1 text-[9px] font-bold ${color === 'yellow' ? 'text-[#ffff55]' : 'text-[#00ffff]'} bg-[#0000aa] hover:bg-[#00aaaa] hover:text-black border border-[#00ffff]/60 rounded px-1.5 py-0.5`}>
    <Icon className="w-3 h-3" /> {label}
  </button>
);

export { NonoHead } from './nono/NonoHead';
export type { NonoExpression, FloatingAssistantHandle, NonoStatusEvent } from './nono/content';
export default FloatingAssistant;