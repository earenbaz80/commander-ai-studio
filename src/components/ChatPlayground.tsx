import { getCachedApiKey } from '../lib/apiKeys';
import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Copy,
  Bot,
  Paperclip,
  X,
  Edit3,
  RefreshCw,
  Check,
  Zap,
  User,
  Link,
  Cpu,
  Settings,
  HelpCircle
} from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { PermissionsModal } from './PermissionsModal';
import { getActiveProjectRoot } from '../agent/activeProject';
import { MentionAutocomplete } from './MentionAutocomplete';
import { AgentStepViewer } from './AgentStepViewer';
import { ChatLiveAppViewerModal, ChatCodeSnippet } from './ChatLiveAppViewerModal';
import { MentionItem, filterMentions } from '../data/contextMentions';
import { searchFiles } from '../utils/codeSearchApi';
import { ChatMessage, ParameterConfig, StudioMode, AIModel, RunMode } from '../types/studio';
import {
  GEMINI_MODELS,
  ANTHROPIC_MODELS,
  HUGGINGFACE_MODELS,
  XAI_MODELS,
  OLLAMA_MODELS,
  OPENROUTER_FREE_MODELS,
  POLLINATIONS_MODELS,
  CUSTOM_MODELS,
  ALL_MODELS,
} from '../data/models';
import { Language } from '../i18n/translations';

interface ChatPlaygroundProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  parameters: ParameterConfig;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  isGenerating: boolean;
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
  selectedModel,
  setSelectedModel,
  isGenerating,
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

  // Live App Viewer State
  const [isLiveViewerOpen, setIsLiveViewerOpen] = useState(false);
  const liveViewerSnippets: ChatCodeSnippet[] = [];
  const activeSnippetIndex = 0;

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fontScale, setFontScale] = useState<'normal' | 'lg' | 'xl'>('normal');

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

  // Modelos agrupados por proveedor para el selector inferior
  const MODEL_GROUPS: Array<{ label: string; models: AIModel[] }> = [
    { label: 'Google Gemini', models: GEMINI_MODELS },
    { label: 'Anthropic Claude', models: ANTHROPIC_MODELS },
    { label: 'xAI Grok', models: XAI_MODELS },
    { label: 'HuggingFace (Local)', models: HUGGINGFACE_MODELS },
    { label: 'Ollama (Local)', models: OLLAMA_MODELS },
    { label: 'OpenRouter', models: OPENROUTER_FREE_MODELS },
    { label: 'Pollinations', models: POLLINATIONS_MODELS },
    { label: 'Personalizado', models: CUSTOM_MODELS },
  ];
  const currentModel = ALL_MODELS.find((m) => m.id === selectedModel);

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

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachments((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
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

  const fontScaleClass = fontScale === 'lg' ? 'text-lg' : fontScale === 'xl' ? 'text-xl' : 'text-sm';

  return (
    <div className="flex flex-col h-full bg-[#000080] text-white font-mono relative">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-4">
              <h1 className="commander-title mx-auto text-3xl sm:text-4xl md:text-5xl text-center leading-tight px-2">
                Commander AI Studio
              </h1>
              {/* El saludo ("¡Hola…") lo muestra únicamente Nono, de forma flotante */}
              <p className="text-yellow-500/70 text-xs">
                {lang === 'es' ? 'Escribe tu mensaje o adjunta un archivo para comenzar' : lang === 'de' ? 'Schreibe eine Nachricht oder hänge eine Datei an, um zu beginnen' : 'Type your message or attach a file to start'}
              </p>
              {!isAuthenticated && (
                <p className="text-[10px] text-cyan-500/60 pt-1 flex items-center justify-center gap-1">
                  <Zap className="w-3 h-3 shrink-0" />
                  {lang === 'es'
                    ? 'Sesión de invitado — el historial se guarda solo en este dispositivo'
                    : lang === 'de' ? 'Gastsitzung — der Verlauf wird nur auf diesem Gerät gespeichert' : 'Guest session — history is saved on this device only'}
                </p>
              )}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-3 ${
                  msg.role === 'user'
                    ? 'bg-[#0000aa] border border-cyan-400/30'
                    : 'bg-[#000044] border border-yellow-500/30'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold flex items-center gap-1 ${msg.role === 'user' ? 'text-cyan-400' : 'text-yellow-500'}`}>
                    {msg.role === 'user' ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                    {msg.role === 'user' ? 'TÚ' : 'AI'}
                  </span>
                  {msg.modelUsed && (
                    <span className="text-[10px] text-gray-400">{msg.modelUsed}</span>
                  )}
                  <span className="text-[10px] text-gray-500">{msg.timestamp}</span>
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
                        className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-xs flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" /> Guardar
                      </button>
                      <button
                        onClick={() => setEditingMessageId(null)}
                        className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs flex items-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" /> Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`${fontScaleClass} whitespace-pre-wrap`}>
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
                      className="text-[10px] text-gray-400 hover:text-cyan-400 transition-colors flex items-center gap-1"
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
                      className="text-[10px] text-gray-400 hover:text-yellow-500 transition-colors flex items-center gap-1"
                    >
                      <Edit3 className="w-3 h-3" /> Editar
                    </button>
                    {msg.groundingSources && msg.groundingSources.length > 0 && (
                      <span className="text-[10px] text-green-400 flex items-center gap-1">
                        <Link className="w-3 h-3" /> {msg.groundingSources.length} fuentes
                      </span>
                    )}
                    {msg.tokensUsed && (
                      <span className="text-[10px] text-gray-500">
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
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div data-chat-divider className="border-t border-cyan-400/30 bg-[#000066] p-4">
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

        {/* Barra inferior: adjuntar, modelo, Build/Plan y acciones a la derecha */}
        <div className="mt-2 flex items-center gap-2 text-[10px] font-mono">
          {/* Icono de ayuda para menciones @ */}
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            title={lang === 'es'
              ? 'Ayuda: @nono = abre Nono · @archivo = archivos · @ayuda = info'
              : lang === 'de' ? 'Hilfe: @nono = öffnet Nono · @archivo = Dateien · @ayuda = Info' : 'Help: @nono = opens Nono · @archivo = files · @ayuda = info'
            }
            aria-label={lang === 'es' ? 'Ayuda de menciones' : lang === 'de' ? 'Erwähnungshilfe' : 'Mention help'}
            className="shrink-0 p-1.5 bg-[#000080] border border-cyan-400/40 rounded hover:bg-[#0000cc] transition-colors cursor-help"
          >
            <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
          </button>

          {/* Botón adjuntar: antes de la elección de modelo */}
          <label
            className="cursor-pointer shrink-0 p-1.5 bg-[#0000aa] border border-cyan-400/40 rounded hover:bg-[#0000cc] transition-colors"
            title={lang === 'es' ? 'Adjuntar archivos' : lang === 'de' ? 'Dateien anhängen' : 'Attach files'}
            aria-label={lang === 'es' ? 'Adjuntar archivos' : lang === 'de' ? 'Dateien anhängen' : 'Attach files'}
          >
            <Paperclip className="w-3.5 h-3.5 text-cyan-400" />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleAttachmentChange}
              className="hidden"
              accept="image/*,.pdf,.txt,.md,.json,.js,.ts,.tsx,.jsx,.html,.css"
            />
          </label>

          {/* Selector de modelo: el que se usará para responder */}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            aria-label={lang === 'es' ? 'Modelo que se usará para responder' : lang === 'de' ? 'Modell für die Antwort' : 'Model used to answer'}
            title={
              lang === 'es'
                ? `Modelo en uso${currentModel?.description ? `: ${currentModel.description}` : ''}`
                : lang === 'de'
                  ? `Verwendetes Modell${currentModel?.description ? `: ${currentModel.description}` : ''}`
                  : `Model in use${currentModel?.description ? `: ${currentModel.description}` : ''}`
            }
            className="min-w-0 flex-1 max-w-[260px] bg-[#000080] border border-cyan-400/40 text-[#00ffff] text-[10px] font-mono px-1.5 py-1 rounded outline-none focus:border-cyan-400 cursor-pointer truncate"
          >
            {/* Modelo no listado (p. ej. descargado de HuggingFace) */}
            {!currentModel && <option value={selectedModel}>{selectedModel}</option>}
            {MODEL_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.badge ? ` · ${m.badge}` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Quick Local LLM indicator / switcher */}
          {(() => {
            const isLocal = selectedModel.startsWith('ollama/') || selectedModel.startsWith('openai/');
            const ollamaHost = getCachedApiKey('OLLAMA_HOST') || 'http://localhost:11434';
            const customBase = getCachedApiKey('CUSTOM_BASE_URL') || 'http://localhost:1234/v1';
            const hasLocalConfig = getCachedApiKey('OLLAMA_HOST') || getCachedApiKey('CUSTOM_BASE_URL');
            return hasLocalConfig ? (
              <button
                onClick={() => onOpenLocalLlmConfig?.()}
                title={lang === 'es'
                  ? isLocal
                    ? `Usando LLM local · ${selectedModel} · Clic para configurar`
                    : `LLM local configurado (${ollamaHost || customBase}) · Clic para activar`
                  : lang === 'de'
                    ? isLocal
                      ? `Lokales LLM in Verwendung · ${selectedModel} · Klicken zum Konfigurieren`
                      : `Lokales LLM konfiguriert (${ollamaHost || customBase}) · Klicken zum Aktivieren`
                    : isLocal
                      ? `Using local LLM · ${selectedModel} · Click to configure`
                      : `Local LLM configured (${ollamaHost || customBase}) · Click to activate`
                }
                aria-label={lang === 'es' ? 'Configurar LLM local' : lang === 'de' ? 'Lokales LLM konfigurieren' : 'Configure local LLM'}
                className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-bold shrink-0 transition-colors ${
                  isLocal
                    ? 'border-[#00aa00] bg-[#002200] text-[#00ff00]'
                    : 'border-[#00aaaa]/40 bg-[#0000aa] text-[#00ffff] hover:bg-[#0000cc]'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                {lang === 'es' ? 'Local' : lang === 'de' ? 'Lokal' : 'Local'}
              </button>
            ) : null;
          })()}

          {/* Run Mode (Build / Plan / Read-only) as collapsible select menu */}
          <select
            value={runMode}
            onChange={(e) => changeRunMode(e.target.value as RunMode)}
            title={lang === 'es'
              ? `Modo: ${runMode === 'build' ? 'Build (ejecuta)' : runMode === 'plan' ? 'Plan (solo analiza)' : 'Solo lectura'} · Menú para cambiar`
              : lang === 'de'
                ? `Modus: ${runMode === 'build' ? 'Build (führt aus)' : runMode === 'plan' ? 'Plan (analysiert nur)' : 'Nur Lesen'} · Menü zum Ändern`
                : `Mode: ${runMode === 'build' ? 'Build (acts)' : runMode === 'plan' ? 'Plan (analyzes only)' : 'Read-only'} · Menu to change`}
            aria-label={lang === 'es' ? 'Modo del agente' : lang === 'de' ? 'Agentenmodus' : 'Agent mode'}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-bold shrink-0 transition-colors cursor-pointer ${
              runMode === 'build'
                ? 'border-[#00aa00] bg-[#002200] text-[#00ff00]'
                : runMode === 'plan'
                  ? 'border-[#ffff55] bg-[#222200] text-[#ffff55]'
                  : 'border-[#aa0000] bg-[#220000] text-[#ff5555]'
            }`}
          >
            <option value="build">{lang === 'es' ? 'Build (ejecuta)' : lang === 'de' ? 'Build (handelt)' : 'Build (acts)'}</option>
            <option value="plan">{lang === 'es' ? 'Plan (solo analiza)' : lang === 'de' ? 'Plan (nur Analyse)' : 'Plan (analyzes only)'}</option>
            <option value="readonly">{lang === 'es' ? 'Solo lectura' : lang === 'de' ? 'Nur lesen' : 'Read-only'}</option>
          </select>

          <button
            onClick={() => setPermsOpen(true)}
            title={lang === 'es' ? 'Configuración avanzada (tools, globs)' : lang === 'de' ? 'Erweiterte Einstellungen (Tools, Globs)' : 'Advanced settings (tools, globs)'}
            aria-label={lang === 'es' ? 'Configuración avanzada' : lang === 'de' ? 'Erweiterte Einstellungen' : 'Advanced settings'}
            className="flex items-center gap-1 rounded border border-cyan-400/40 px-2 py-1 text-[10px] font-bold text-[#00ffff] hover:bg-[#0000aa] shrink-0"
          >
            <Settings className="w-3 h-3" />
            {lang === 'es' ? 'Avanzado' : lang === 'de' ? 'Erweitert' : 'Advanced'}
          </button>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            <button
              onClick={() => setFontScale(fontScale === 'normal' ? 'lg' : fontScale === 'lg' ? 'xl' : 'normal')}
              title={lang === 'es' ? 'Tamaño del texto' : lang === 'de' ? 'Textgröße' : 'Text size'}
              className="text-gray-400 hover:text-cyan-400"
            >
              A{fontScale === 'lg' ? '+' : fontScale === 'xl' ? '++' : ''}
            </button>
            <button
              onClick={onClearChat}
              title={lang === 'es' ? 'Limpiar conversación' : lang === 'de' ? 'Unterhaltung leeren' : 'Clear conversation'}
              aria-label={lang === 'es' ? 'Limpiar conversación' : lang === 'de' ? 'Unterhaltung leeren' : 'Clear conversation'}
              className="text-gray-400 hover:text-red-400"
            >
              Limpiar
            </button>
            {/* Botón de enviar: a la derecha del botón Limpiar */}
            <button
              onClick={handleSend}
              disabled={isGenerating || (!inputText.trim() && attachments.length === 0)}
              aria-label={lang === 'es' ? 'Enviar mensaje' : lang === 'de' ? 'Nachricht senden' : 'Send message'}
              title={lang === 'es' ? 'Enviar mensaje' : lang === 'de' ? 'Nachricht senden' : 'Send message'}
              className="p-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded transition-colors"
            >
              {isGenerating ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Modal de ayuda de menciones - estilo Norton */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="w-full max-w-md border-2 border-[#00ffff] bg-[#000080] shadow-[0_0_30px_rgba(0,255,255,0.4)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-[#00ffff]/40 px-4 py-2">
              <div className="flex items-center gap-2 text-[#ffff55] text-sm font-bold">
                <HelpCircle className="w-4 h-4" />
                {lang === 'es' ? 'Ayuda de menciones' : lang === 'de' ? 'Erwähnungshilfe' : 'Mention help'}
              </div>
              <button
                onClick={() => setHelpOpen(false)}
                className="text-[#00ffff] hover:text-white"
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4 text-xs">
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <code className="shrink-0 bg-[#000045] border border-[#00ffff]/40 px-2 py-1 font-mono text-[10px] text-[#00ffff]">@nono</code>
                  <span className="text-[10px] text-[#00ffff]/80">{lang === 'es' ? 'Abre el asistente Nono con un prompt pre-rellenado' : lang === 'de' ? 'Öffnet den Assistenten Nono mit vorausgefülltem Prompt' : 'Opens Nono assistant with prefilled prompt'}</span>
                </div>
                <div className="flex items-start gap-2">
                  <code className="shrink-0 bg-[#000045] border border-[#00ffff]/40 px-2 py-1 font-mono text-[10px] text-[#00ffff]">@archivo</code>
                  <span className="text-[10px] text-[#00ffff]/80">{lang === 'es' ? 'Sugiere archivos del proyecto' : lang === 'de' ? 'Schlägt Projektdateien vor' : 'Suggests project files'}</span>
                </div>
                <div className="flex items-start gap-2">
                  <code className="shrink-0 bg-[#000045] border border-[#00ffff]/40 px-2 py-1 font-mono text-[10px] text-[#00ffff]">@ayuda</code>
                  <span className="text-[10px] text-[#00ffff]/80">{lang === 'es' ? 'Muestra información rápida' : lang === 'de' ? 'Zeigt Kurzinfos' : 'Shows quick info'}</span>
                </div>
              </div>
              <p className="text-[10px] text-[#00ffff]/50 pt-2 border-t border-[#00ffff]/20">
                {lang === 'es'
                  ? 'Escribe @ seguido de una palabra en el chat para ver sugerencias.'
                  : lang === 'de' ? 'Gib @ gefolgt von einem Wort im Chat ein, um Vorschläge zu sehen.' : 'Type @ followed by a word in the chat to see suggestions.'}
              </p>
            </div>

            <div className="flex justify-end border-t border-[#00ffff]/40 px-4 py-2">
              <button
                onClick={() => setHelpOpen(false)}
                className="border border-[#ffff55] bg-[#ffff55] px-3 py-1 font-bold text-black text-xs"
              >
                {lang === 'es' ? 'Cerrar' : lang === 'de' ? 'Schließen' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

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