import React, { useState, useRef, useEffect } from 'react';
import {
  Copy,
  Bot,
  Paperclip,
  X,
  Edit3,
  Check,
  User,
  Link,
} from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { EmptyState } from './EmptyState';
import { PermissionsModal } from './PermissionsModal';
import { getActiveProjectRoot } from '../agent/activeProject';
import { MentionAutocomplete } from './MentionAutocomplete';
import { AgentStepViewer } from './AgentStepViewer';
import { ChatLiveAppViewerModal, ChatCodeSnippet } from './ChatLiveAppViewerModal';
import { MentionItem, filterMentions } from '../data/contextMentions';
import { searchFiles } from '../utils/codeSearchApi';
import { ChatMessage, ParameterConfig, StudioMode, RunMode } from '../types/studio';
import { Language } from '../i18n/translations';
import { ComposerToolbar } from './chat/ComposerToolbar';
import { ContextMeter } from './chat/ContextMeter';
import { applyEffort, type EffortLevel } from './chat/effortProfiles';
import { MentionHelpModal } from './chat/MentionHelpModal';
import { buildModelGroups, findModel } from './chat/modelGroups';
import { useModelsCatalog } from '../data/modelsLoader';
import { useDictation } from '../hooks/useDictation';
import { mergeDictationText } from '../lib/dictation';

export interface ChatPlaygroundProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  parameters: ParameterConfig;
  /** Cambia los ajustes de la sesión; sin él los perfiles de esfuerzo no aplican. */
  setParameters?: React.Dispatch<React.SetStateAction<ParameterConfig>>;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  isGenerating: boolean;
  /** Detiene la generación en curso (respuesta del chat o corrida del agente). */
  onStop?: () => void;
  /** Retoma la corrida que se detuvo, si el hook la conserva. */
  onResume?: () => void;
  resumable?: boolean;
  onSendMessage: (userText: string, attachments?: any[], modelOverride?: string, runMode?: RunMode) => void;
  onClearChat: () => void;
  lang?: Language;
  setMode?: (mode: StudioMode) => void;
  onOpenLiveViewer?: (snippets?: ChatCodeSnippet[], index?: number) => void;
  onOpenLocalLlmConfig?: () => void;
  /** Nombre del usuario (el saludo lo muestra Nono, no el chat). */
  displayName?: string;
  /** El usuario está conectado a una cuenta (si no, es invitado). */
  isAuthenticated?: boolean;
}

export const ChatPlayground: React.FC<ChatPlaygroundProps> = ({
  messages,
  setMessages,
  parameters,
  setParameters,
  selectedModel,
  setSelectedModel,
  isGenerating,
  onStop,
  onResume,
  resumable = false,
  onSendMessage,
  onClearChat,
  lang = 'es',
  onOpenLocalLlmConfig,
  isAuthenticated,
}) => {
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);

  // Menciones `@` con archivos reales del proyecto activo
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [fileItems, setFileItems] = useState<MentionItem[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const mentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentionItems = React.useMemo(
    () => (mentionOpen ? filterMentions(mentionQuery, fileItems) : []),
    [mentionOpen, mentionQuery, fileItems]
  );
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Dictado: escribe la instrucción hablada en el mensaje, no la envía sola.
  const dictation = useDictation({
    lang,
    onText: (text) => setInputText((prev) => mergeDictationText(prev, text)),
  });

  // Live App Viewer State
  const [isLiveViewerOpen, setIsLiveViewerOpen] = useState(false);
  const liveViewerSnippets: ChatCodeSnippet[] = [];
  const activeSnippetIndex = 0;

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Modo de ejecución: Build / Plan / Sólo lectura (persistente)
  const [runMode, setRunMode] = useState<RunMode>(() => {
    try {
      const v = localStorage.getItem('ai_studio_run_mode');
      return v === 'plan' || v === 'readonly' ? v : 'build';
    } catch {
      return 'build';
    }
  });
  const [permsOpen, setPermsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Keyboard shortcut to toggle run mode (Alt+M)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        const next: RunMode = runMode === 'build' ? 'plan' : runMode === 'plan' ? 'readonly' : 'build';
        changeRunMode(next);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [runMode]);

  const changeRunMode = (mode: RunMode) => {
    setRunMode(mode);
    try {
      localStorage.setItem('ai_studio_run_mode', mode);
    } catch {
      /* sin almacenamiento */
    }
    // Sincroniza el modo con el servidor (aplicado en handleAgentRunTool).
    try {
      const root = getActiveProjectRoot();
      void fetch('/api/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(root ? { root, permissions: { mode } } : { permissions: { mode } }),
      });
    } catch {
      /* best-effort */
    }
  };

  // Catálogo vivo: incluye proveedores configurados después de arrancar
  // (OpenAI, NVIDIA, LM Studio) y sus modelos reales.
  const { models: catalog, providers } = useModelsCatalog();
  // El estado por proveedor viaja al selector: conectado, guardado o caído.
  const modelGroups = React.useMemo(() => buildModelGroups(catalog, providers), [catalog, providers]);

  // Modelo activo en el catálogo (puede ser undefined si fue descargado de HF).
  const currentModel = React.useMemo(
    () => catalog.find((m) => m.id === selectedModel) ?? findModel(selectedModel),
    [catalog, selectedModel]
  );

  const getMentionToken = (value: string, caret: number): { start: number; query: string } | null => {
    const before = value.slice(0, caret);
    const m = before.match(/@([^\s@]*)$/);
    if (!m) return null;
    return { start: caret - m[0].length, query: m[0] };
  };

  const loadMentionFiles = (q: string) => {
    if (mentionTimer.current) clearTimeout(mentionTimer.current);
    setMentionLoading(true);
    mentionTimer.current = setTimeout(async () => {
      const { files } = await searchFiles(q.replace(/^@/, ''), undefined, 20);
      setFileItems(
        files.map((f) => ({
          id: `@${f.path}`,
          label: `@${f.path}`,
          category: 'file' as const,
          description: f.path,
          badge: 'FILE',
          getContent: () => '',
        }))
      );
      setMentionLoading(false);
    }, 120);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInputText(value);
    // En jsdom (y al asignar value por código) selectionStart puede quedar en 0;
    // en ese caso asumimos el final del texto (donde el usuario acaba de escribir).
    const rawCaret = e.target.selectionStart;
    const caret = rawCaret == null ? value.length : rawCaret === 0 && value.length > 0 ? value.length : rawCaret;
    const token = getMentionToken(value, caret);
    
    // Trigger @nono: abre el panel de Nono con el resto del texto como prompt
    if (token && token.query.toLowerCase() === '@nono') {
      const afterNono = value.slice(caret).trimStart();
      window.dispatchEvent(new CustomEvent('nono:open-with-prompt', {
        detail: { prompt: afterNono || '', send: false }
      }));
      setMentionOpen(false);
      return;
    }
    
    if (token) {
      setMentionQuery(token.query);
      setMentionIndex(0);
      setMentionOpen(true);
      loadMentionFiles(token.query);
    } else {
      setMentionOpen(false);
    }
  };

  const handleSelectMention = (item: MentionItem) => {
    const el = textareaRef.current;
    let caret = el?.selectionStart ?? inputText.length;
    if (caret === 0 && inputText.length > 0) caret = inputText.length;
    const token = getMentionToken(inputText, caret);
    const insert = `${item.id} `;
    const next = token
      ? inputText.slice(0, token.start) + insert + inputText.slice(caret)
      : inputText + insert;
    setInputText(next);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = (token ? token.start : inputText.length) + insert.length;
      try {
        el?.setSelectionRange(pos, pos);
      } catch {
        /* noop */
      }
    });
  };

  const handleSend = () => {
    if (!inputText.trim() && attachments.length === 0) return;
    setMentionOpen(false);
    onSendMessage(inputText.trim(), attachments.length > 0 ? attachments : undefined, undefined, runMode);
    setInputText('');
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => i + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (mentionItems.length > 0) {
          e.preventDefault();
          handleSelectMention(mentionItems[Math.min(mentionIndex, mentionItems.length - 1)]);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAttachmentChangeFiles = (files: FileList) => {
    setAttachments((prev) => [...prev, ...Array.from(files)]);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(content.slice(0, 20));
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleEditMessage = (messageId: string, currentContent: string) => {
    setEditingMessageId(messageId);
    setEditText(currentContent);
  };

  const handleSaveEdit = () => {
    if (!editingMessageId) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === editingMessageId ? { ...m, content: editText } : m))
    );
    setEditingMessageId(null);
    setEditText('');
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-[var(--nc-bg-panel)] text-white font-mono relative">
      {/* Messages Area */}
      {/* Laterales mínimos: con la barra lateral y el panel abiertos, 16px a cada
          lado se comían el ancho útil del texto. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-3 sm:px-4 sm:py-4 space-y-3 sm:space-y-4">
        {messages.length === 0 ? (
          <EmptyState
            title="Commander AI Studio"
            titleClassName="commander-title mx-auto text-xl sm:text-2xl text-center leading-tight px-2"
            description={
              (lang === 'es' ? 'Escribe tu mensaje o adjunta un archivo para comenzar' : lang === 'de' ? 'Schreibe eine Nachricht oder hänge eine Datei an, um zu beginnen' : 'Type your message or attach a file to start') +
              (!isAuthenticated ? '\n' + (lang === 'es' ? 'Sesión de invitado — el historial se guarda solo en este dispositivo' : lang === 'de' ? 'Gastsitzung — der Verlauf wird nur auf diesem Gerät gespeichert' : 'Guest session — history is saved on this device only') : '')
            }
          />
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              data-msg-id={msg.id}
              className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                // La respuesta ocupa todo el ancho (una guía lateral basta para
                // separarla); la pregunta se queda en burbuja, más corta. Así el
                // texto aprovecha la ventana al redimensionarla.
                className={`min-w-0 break-words rounded-sm px-3 py-2 sm:px-4 sm:py-3 ${
                  msg.role === 'user'
                    ? 'max-w-[85%] sm:max-w-[70%] bg-[var(--nc-bg-main)] border border-cyan-400/30'
                    : 'w-full max-w-full bg-[var(--nc-bg-deep)] border-l-2 border-[var(--nc-text-accent)]/40'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold flex items-center gap-1 ${msg.role === 'user' ? 'text-[var(--nc-text)]' : 'text-[var(--nc-text-accent)]'}`}>
                    {msg.role === 'user' ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                    {msg.role === 'user' ? 'TÚ' : 'AI'}
                  </span>
                  {msg.modelUsed && (
                    <span className="text-[10px] text-[var(--nc-text-dim)]">{msg.modelUsed}</span>
                  )}
                  <span className="text-[10px] text-[var(--nc-text-dim)]">{msg.timestamp}</span>
                </div>

                {editingMessageId === msg.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full bg-black/30 border border-cyan-400/30 rounded p-2 text-sm text-white resize-none"
                      rows={4}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveEdit}
                        className="px-3 py-1 bg-[var(--nc-success)] text-[var(--nc-bg-main)] hover:brightness-110 rounded text-xs flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" /> Guardar
                      </button>
                      <button
                        onClick={() => setEditingMessageId(null)}
                        className="px-3 py-1 bg-[var(--nc-bg-hover)] text-[var(--nc-text)] hover:bg-[var(--nc-header-bg)] hover:text-[var(--nc-header-text)] rounded text-xs flex items-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" /> Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm whitespace-pre-wrap">
                    <MarkdownRenderer content={msg.content} />
                  </div>
                )}

                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {msg.attachments.map((att, idx) => (
                      <div key={idx} className="text-xs text-cyan-400 bg-black/20 px-2 py-1 rounded flex items-center gap-1">
                        <Paperclip className="w-3 h-3" /> {att.name}
                      </div>
                    ))}
                  </div>
                )}

                {msg.role === 'model' && (
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => handleCopyMessage(msg.content)}
                      className="text-[10px] text-[var(--nc-text-dim)] hover:text-[var(--nc-text)] transition-colors flex items-center gap-1"
                    >
                      {copiedId === msg.content.slice(0, 20) ? (
                        <>
                          <Check className="w-3 h-3" /> Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Copiar
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleEditMessage(msg.id, msg.content)}
                      className="text-[10px] text-[var(--nc-text-dim)] hover:text-[var(--nc-text-accent)] transition-colors flex items-center gap-1"
                    >
                      <Edit3 className="w-3 h-3" /> Editar
                    </button>
                    {msg.groundingSources && msg.groundingSources.length > 0 && (
                      <span className="text-[10px] text-[var(--nc-success)] flex items-center gap-1">
                        <Link className="w-3 h-3" /> {msg.groundingSources.length} fuentes
                      </span>
                    )}
                    {msg.tokensUsed && (
                      <span className="text-[10px] text-[var(--nc-text-dim)]">
                        {msg.tokensUsed} tokens
                      </span>
                    )}
                  </div>
                )}

                {msg.agentSteps && msg.agentSteps.length > 0 && (
                  <AgentStepViewer steps={msg.agentSteps} />
                )}
              </div>
            </div>
          ))
        )}
        {/* Actividad en curso: el botón ya dice Detener, así que la señal de que
            algo está pasando vive aquí, en el propio chat. */}
        {isGenerating && (
          <div
            role="status"
            aria-live="polite"
            data-testid="chat-activity"
            className="flex items-center gap-2 px-1 text-[11px] font-mono text-[var(--nc-text-accent)] select-none"
          >
            <span
              aria-hidden
              className="inline-block w-2 h-3 bg-[var(--nc-text-accent)] animate-pulse"
            />
            <span>{lang === 'es' ? 'Procesando' : lang === 'de' ? 'Verarbeite' : 'Processing'}</span>
            <span aria-hidden className="flex gap-0.5">
              <span className="animate-pulse">.</span>
              <span className="animate-pulse [animation-delay:200ms]">.</span>
              <span className="animate-pulse [animation-delay:400ms]">.</span>
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div data-chat-divider className="border-t border-[var(--nc-border-mid)]/40 bg-[var(--nc-bg-deep)] p-2 sm:p-4">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1 bg-black/30 border border-cyan-400/30 rounded px-2 py-1 text-xs"
              >
                <span className="flex items-center gap-1"><Paperclip className="w-3 h-3" /> {file.name}</span>
                <button
                  onClick={() => removeAttachment(idx)}
                  className="text-red-400 hover:text-red-300"
                  aria-label={lang === 'es' ? 'Quitar adjunto' : lang === 'de' ? 'Anhang entfernen' : 'Remove attachment'}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative">
          <textarea
            ref={textareaRef}
            data-chat-input
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={lang === 'es' ? 'Escribe tu mensaje...' : lang === 'de' ? 'Schreibe deine Nachricht...' : 'Type your message...'}
            className="w-full bg-black/30 border border-cyan-400/30 rounded-lg p-3 text-white placeholder-gray-500 resize-none focus:outline-none focus:border-cyan-400"
            rows={2}
            disabled={isGenerating}
          />
          {mentionOpen && (
            <MentionAutocomplete
              query={mentionQuery}
              extraItems={fileItems}
              loading={mentionLoading}
              onSelect={handleSelectMention}
              onClose={() => setMentionOpen(false)}
              selectedIndex={mentionIndex}
              setSelectedIndex={setMentionIndex}
            />
          )}
        </div>

        <ComposerToolbar
          lang={lang}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          currentModel={currentModel}
          modelGroups={modelGroups}
          runMode={runMode}
          onChangeRunMode={changeRunMode}
          isGenerating={isGenerating}
          onStop={() => onStop?.()}
          onResume={onResume}
          resumable={resumable}
          canSend={Boolean(inputText.trim()) || attachments.length > 0}
          onSend={handleSend}
          onClearChat={onClearChat}
          onAttach={handleAttachmentChangeFiles}
          onOpenLocalLlmConfig={onOpenLocalLlmConfig}
          onOpenAdvanced={() => setPermsOpen(true)}
          onOpenMentionHelp={() => setHelpOpen(true)}
          dictationState={dictation.state}
          dictationSupported={dictation.supported}
          dictationError={dictation.error}
          dictationSeconds={dictation.seconds}
          onToggleDictation={dictation.toggle}
        />

        {/* Contexto y esfuerzo: barra de estado al pie, debajo del campo de
            escritura y de los botones, para no cargar la zona superior. */}
        <ContextMeter
          messages={messages}
          parameters={parameters}
          model={currentModel}
          lang={lang}
          onChangeEffort={
            setParameters
              ? (level: EffortLevel) => setParameters((prev) => applyEffort(prev, level))
              : undefined
          }
        />
      </div>

      {helpOpen && <MentionHelpModal lang={lang} onClose={() => setHelpOpen(false)} />}
      {/* Live Viewer Modal */}
      {isLiveViewerOpen && (
        <ChatLiveAppViewerModal
          isOpen={isLiveViewerOpen}
          snippets={liveViewerSnippets}
          initialSnippetIndex={activeSnippetIndex}
          onClose={() => setIsLiveViewerOpen(false)}
        />
      )}

      {/* Configuración avanzada (tools + globs) */}
      {permsOpen && (
        <PermissionsModal
          lang={lang}
          onClose={() => setPermsOpen(false)}
          onSaved={() => { /* no-op; modo se controla por toggle */ }}
        />
      )}
    </div>
  );
};
