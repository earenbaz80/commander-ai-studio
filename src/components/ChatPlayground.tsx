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
  ChevronUp,
  ChevronDown,
  Send,
  GripVertical,
  CornerUpLeft,
  RefreshCw,
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
import { copyTextToClipboard } from '../utils/clipboard';
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
import { readChatQueue, writeChatQueue } from './chat/chatQueue';

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
  /** Reintenta la última respuesta fallida; recibe su id. */
  onRetryMessage?: (messageId: string) => void;
  onClearChat: () => void;
  lang?: Language;
  setMode?: (mode: StudioMode) => void;
  onOpenLiveViewer?: (snippets?: ChatCodeSnippet[], index?: number) => void;
  onOpenLocalLlmConfig?: () => void;
  /** Nombre del usuario (el saludo lo muestra Nono, no el chat). */
  displayName?: string;
  /** El usuario está conectado a una cuenta (si no, es invitado). */
  isAuthenticated?: boolean;
  /** Sesión dueña de la cola; cada pestaña/conversación conserva la suya. */
  queueKey?: string;
}

/** Mensaje escrito mientras el chat estaba ocupado; se envía al terminar. */
interface QueuedChatMessage {
  id: string;
  text: string;
  attachments: File[];
  runMode: RunMode;
}

/**
 * Preferencia por pestaña/sesión: al enviar con una acción en curso, cortarla y
 * enviar ya. Cada sesión guarda su propia elección.
 */
const INTERRUPT_ON_SEND_KEY = 'ai_studio_interrupt_on_send';

/** La confirmación de un envío inmediato permanece visible este tiempo. */
const INSTANT_SEND_NOTICE_MS = 4000;

/** La sesión forma parte de la clave: dos pestañas no comparten la elección. */
const interruptOnSendStorageKey = (sessionKey: string): string =>
  `${INTERRUPT_ON_SEND_KEY}:${encodeURIComponent(sessionKey)}`;

const readInterruptOnSend = (sessionKey: string): boolean => {
  try {
    return localStorage.getItem(interruptOnSendStorageKey(sessionKey)) === 'true';
  } catch {
    return false;
  }
};

const writeInterruptOnSend = (sessionKey: string, value: boolean): void => {
  try {
    localStorage.setItem(interruptOnSendStorageKey(sessionKey), String(value));
  } catch {
    /* preferencia best-effort */
  }
};

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
  onRetryMessage,
  onClearChat,
  lang = 'es',
  onOpenLocalLlmConfig,
  isAuthenticated,
  queueKey = 'default',
}) => {
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedChatMessage[]>(() =>
    readChatQueue(queueKey)
  );
  const [queueSessionKey, setQueueSessionKey] = useState(queueKey);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const [editingQueuedText, setEditingQueuedText] = useState('');
  const queuedSeq = useRef(0);
  const queueListRef = useRef<HTMLUListElement>(null);
  const dragQueuedIdRef = useRef<string | null>(null);
  const pointerDragRef = useRef<{
    id: string;
    pointerId: number;
    targetIndex: number | null;
    after: boolean;
  } | null>(null);
  const pointerDragCleanupRef = useRef<(() => void) | null>(null);
  const [draggingQueuedId, setDraggingQueuedId] = useState<string | null>(null);
  const [pointerDropTarget, setPointerDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  // Apagada por defecto: el comportamiento sigue siendo encolar. Encendida,
  // enviar corta la acción en curso y manda el mensaje en ese momento.
  const [interruptOnSend, setInterruptOnSend] = useState<boolean>(() =>
    readInterruptOnSend(queueKey)
  );
  // Contador, no booleano: cada envío inmediato reinicia el aviso y su tiempo.
  const [instantSendNotice, setInstantSendNotice] = useState(0);

  // La cola pertenece a una sesión: al cambiar de pestaña o de conversación se
  // cambia de cola en el mismo render, sin enseñar durante un frame la de la
  // sesión anterior.
  if (queueKey !== queueSessionKey) {
    setQueueSessionKey(queueKey);
    setEditingQueuedId(null);
    setEditingQueuedText('');
    setQueuedMessages(readChatQueue(queueKey));
    setInstantSendNotice(0);
    // La preferencia también pertenece a la sesión: al cambiar de pestaña no
    // se arrastra la elección de la anterior.
    setInterruptOnSend(readInterruptOnSend(queueKey));
  }

  // Cada cambio se respalda por sesión: así sobrevive a desmontar el chat al
  // cambiar de modo y a volver más tarde a esta pestaña o conversación.
  useEffect(() => {
    writeChatQueue(queueSessionKey, queuedMessages);
  }, [queueSessionKey, queuedMessages]);
  useEffect(() => {
    if (instantSendNotice === 0) return;
    const timer = setTimeout(() => setInstantSendNotice(0), INSTANT_SEND_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [instantSendNotice]);
  const flushingQueue = useRef(false);

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
      // Alt+M ciclo de modo; Ctrl/Cmd+Alt+M está reservado para la barra de contexto.
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'm') {
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

  /**
   * Envía el borrador. `forceInterrupt` lo usa Ctrl/Cmd+Enter: corta la acción
   * en curso aunque la preferencia «Interrumpir» esté apagada.
   */
  const submitMessage = (forceInterrupt: boolean) => {
    const text = inputText.trim();
    if (!text && attachments.length === 0) return;
    setMentionOpen(false);
    // Con «Interrumpir» activo o con el atajo, enviar corta la acción actual y
    // sale ya; si no, el mensaje espera en la cola como siempre.
    const interruptCurrent = isGenerating && (interruptOnSend || forceInterrupt);
    if (!interruptCurrent && (isGenerating || queuedMessages.length > 0)) {
      queuedSeq.current += 1;
      setQueuedMessages((prev) => [
        ...prev,
        { id: `queued-${Date.now()}-${queuedSeq.current}`, text, attachments, runMode },
      ]);
    } else {
      if (interruptCurrent) onStop?.();
      onSendMessage(text, attachments.length > 0 ? attachments : undefined, undefined, runMode);
    }
    setInputText('');
    setAttachments([]);
  };

  /** Envío normal: respeta la preferencia de interrumpir o encolar. */
  const handleSend = () => submitMessage(false);
  /** Atajo Ctrl/Cmd+Enter: interrumpe la acción actual y envía ya. */
  const handleInterruptAndSend = () => submitMessage(true);

  const toggleInterruptOnSend = () => {
    setInterruptOnSend((prev) => {
      const next = !prev;
      writeInterruptOnSend(queueKey, next);
      return next;
    });
  };

  const handleClearChat = () => {
    setQueuedMessages([]);
    setEditingQueuedId(null);
    setEditingQueuedText('');
    setInstantSendNotice(0);
    onClearChat();
  };

  // Al terminar la acción en curso se envía el siguiente mensaje de la cola.
  // El guard evita que dos renders seguidos (antes de que el padre marque
  // `isGenerating`) disparen el mismo envío o el siguiente de golpe.
  useEffect(() => {
    if (isGenerating) {
      flushingQueue.current = false;
      return;
    }
    if (flushingQueue.current || queuedMessages.length === 0) return;
    const [next] = queuedMessages;
    flushingQueue.current = true;
    setQueuedMessages((prev) => prev.slice(1));
    onSendMessage(next.text, next.attachments.length > 0 ? next.attachments : undefined, undefined, next.runMode);
  }, [isGenerating, queuedMessages, onSendMessage]);

  const queuedItemLabel = (item: QueuedChatMessage) =>
    item.text ||
    item.attachments.map((file) => file.name).join(', ') ||
    (lang === 'es' ? 'Archivo adjunto' : lang === 'de' ? 'Anhang' : 'Attachment');

  /** Muestra que un pendiente salió de la cola por un envío inmediato. */
  const notifyInstantQueuedSend = () => setInstantSendNotice((seq) => seq + 1);

  const startQueuedEdit = (item: QueuedChatMessage) => {
    setEditingQueuedId(item.id);
    setEditingQueuedText(item.text);
  };

  const cancelQueuedEdit = () => {
    setEditingQueuedId(null);
    setEditingQueuedText('');
  };

  const saveQueuedEdit = () => {
    if (!editingQueuedId) return;
    const text = editingQueuedText.trim();
    setQueuedMessages((prev) =>
      prev.map((item) => {
        if (item.id !== editingQueuedId) return item;
        // Sin texto y sin adjuntos no hay nada que enviar: se conserva.
        if (!text && item.attachments.length === 0) return item;
        return { ...item, text };
      })
    );
    cancelQueuedEdit();
  };

  /**
   * Envía ya el pendiente que se está editando con el texto actual del editor,
   * sin guardarlo antes en la cola. El resto de la cola se conserva.
   */
  const sendEditingQueuedNow = () => {
    if (!editingQueuedId) return;
    const item = queuedMessages.find((queued) => queued.id === editingQueuedId);
    if (!item) return;
    const text = editingQueuedText.trim();
    if (!text && item.attachments.length === 0) return;
    setQueuedMessages((prev) => prev.filter((queued) => queued.id !== item.id));
    cancelQueuedEdit();
    if (isGenerating) onStop?.();
    onSendMessage(
      text,
      item.attachments.length > 0 ? item.attachments : undefined,
      undefined,
      item.runMode
    );
    notifyInstantQueuedSend();
  };

  /** Envía un pendiente ya: corta la acción en curso y conserva el resto. */
  const sendQueuedNow = (item: QueuedChatMessage) => {
    setQueuedMessages((prev) => prev.filter((queued) => queued.id !== item.id));
    if (isGenerating) onStop?.();
    onSendMessage(
      item.text,
      item.attachments.length > 0 ? item.attachments : undefined,
      undefined,
      item.runMode
    );
    notifyInstantQueuedSend();
  };

  /**
   * Envía ya el primer pendiente. Si es el que se está editando, usa el texto
   * actual del editor, igual que el botón «Enviar ahora sin guardar».
   */
  const sendFirstQueuedNow = () => {
    const [first] = queuedMessages;
    if (!first) return;
    if (first.id === editingQueuedId) {
      sendEditingQueuedNow();
      return;
    }
    sendQueuedNow(first);
  };

  // Ctrl/Cmd+Shift+Enter envía ya el primer pendiente de la cola. El atajo
  // escucha en window para funcionar también desde el compositor; Ctrl/Cmd+Enter
  // sigue reservado para enviar el borrador de este último.
  useEffect(() => {
    if (queuedMessages.length === 0) return;
    const handler = (event: KeyboardEvent) => {
      if (
        event.key !== 'Enter' ||
        !event.shiftKey ||
        event.altKey ||
        event.isComposing ||
        event.repeat ||
        !(event.ctrlKey || event.metaKey)
      ) {
        return;
      }
      event.preventDefault();
      sendFirstQueuedNow();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [queuedMessages, editingQueuedId, editingQueuedText, isGenerating, onStop, onSendMessage]);

  /** Devuelve un pendiente al compositor con su texto y todos sus adjuntos. */
  const moveQueuedToComposer = (item: QueuedChatMessage) => {
    setInputText((prev) => {
      if (!prev.trim()) return item.text;
      if (!item.text) return prev;
      // No se pisa un borrador: se conserva y el pendiente se añade debajo.
      return `${prev.trimEnd()}\n\n${item.text}`;
    });
    setAttachments((prev) => [...prev, ...item.attachments]);
    setQueuedMessages((prev) => prev.filter((queued) => queued.id !== item.id));
    setMentionOpen(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      try {
        el.setSelectionRange(end, end);
      } catch {
        /* noop */
      }
    });
  };

  /** Mueve un pendiente un puesto arriba (-1) o abajo (1). */
  const moveQueued = (id: string, direction: -1 | 1) => {
    setQueuedMessages((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  /** Reordena la cola al soltar: inserta `id` antes o después de `targetIndex`. */
  const reorderQueued = (id: string, targetIndex: number, after: boolean) => {
    setQueuedMessages((prev) => {
      const from = prev.findIndex((item) => item.id === id);
      if (from < 0) return prev;
      let to = targetIndex + (after ? 1 : 0);
      // Al quitar el origen, los índices posteriores bajan uno.
      if (from < to) to -= 1;
      to = Math.max(0, Math.min(to, prev.length - 1));
      if (to === from) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const startQueuedDrag = (event: React.DragEvent<HTMLLIElement>, id: string) => {
    // Si el asa ya inició un arrastre por puntero (ratón o táctil), no se
    // dispara además el drag nativo HTML5.
    if (pointerDragRef.current) {
      event.preventDefault();
      return;
    }
    dragQueuedIdRef.current = id;
    setDraggingQueuedId(id);
    event.dataTransfer.effectAllowed = 'move';
    // Firefox exige datos para que el arrastre empiece.
    event.dataTransfer.setData('text/plain', id);
  };

  const endQueuedDrag = () => {
    dragQueuedIdRef.current = null;
    setDraggingQueuedId(null);
  };

  const dropQueued = (event: React.DragEvent<HTMLLIElement>, targetIndex: number) => {
    event.preventDefault();
    const id = dragQueuedIdRef.current || event.dataTransfer.getData('text/plain');
    if (!id) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    reorderQueued(id, targetIndex, after);
    endQueuedDrag();
  };

  /** Localiza la fila bajo el puntero para el arrastre táctil. */
  const findQueuedDropTarget = (clientX: number, clientY: number) => {
    const list = queueListRef.current;
    if (!list) return null;
    let row: HTMLElement | null = null;
    if (typeof document.elementFromPoint === 'function') {
      const hit = document.elementFromPoint(clientX, clientY);
      row = (hit?.closest('[data-queued-id]') as HTMLElement | null) ?? null;
      if (row && !list.contains(row)) row = null;
    }
    if (!row) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const candidate of Array.from(list.querySelectorAll<HTMLElement>('[data-queued-id]'))) {
        const rect = candidate.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
          row = candidate;
          break;
        }
        const distance = Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));
        if (distance < nearest) {
          nearest = distance;
          row = candidate;
        }
      }
    }
    if (!row) return null;
    const id = row.dataset.queuedId;
    if (!id) return null;
    const targetIndex = queuedMessages.findIndex((item) => item.id === id);
    if (targetIndex < 0) return null;
    const rect = row.getBoundingClientRect();
    return { id, targetIndex, after: clientY > rect.top + rect.height / 2 };
  };

  /**
   * Arrastre por puntero para touch/pen. El HTML5 drag no existe en móviles;\r
   * el asa captura el gesto y las filas se localizan por coordenadas, así que\r
   * también funciona cuando el dedo pasa por encima de botones o texto.
   */
  const startQueuedPointerDrag = (event: React.PointerEvent<HTMLElement>, id: string) => {
    if (pointerDragRef.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerDragCleanupRef.current?.();
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    pointerDragRef.current = { id, pointerId, targetIndex: null, after: false };
    setDraggingQueuedId(id);
    setPointerDropTarget(null);

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const target = findQueuedDropTarget(moveEvent.clientX, moveEvent.clientY);
      if (!target) return;
      pointerDragRef.current = {
        id,
        pointerId,
        targetIndex: target.targetIndex,
        after: target.after,
      };
      setPointerDropTarget({ id: target.id, after: target.after });
      if (moveEvent.cancelable) moveEvent.preventDefault();
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      pointerDragCleanupRef.current = null;
      pointerDragRef.current = null;
      setDraggingQueuedId(null);
      setPointerDropTarget(null);
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      const drag = pointerDragRef.current;
      if (drag && drag.targetIndex !== null) {
        reorderQueued(drag.id, drag.targetIndex, drag.after);
      }
      cleanup();
    };

    const onCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
    };

    pointerDragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  // Si el pendiente editado sale de la cola (enviado, borrado o cambio de
  // sesión), el editor se cierra en vez de quedarse apuntando a la nada.
  useEffect(() => {
    if (!editingQueuedId) return;
    if (queuedMessages.some((item) => item.id === editingQueuedId)) return;
    setEditingQueuedId(null);
    setEditingQueuedText('');
  }, [editingQueuedId, queuedMessages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/Cmd+Enter fuerza el envío inmediato; se comprueba antes del
    // autocompletado para que el atajo envíe el borrador tal cual.
    const forceInterrupt =
      e.key === 'Enter' && !e.shiftKey && !e.altKey && (e.ctrlKey || e.metaKey);
    if (forceInterrupt) {
      e.preventDefault();
      handleInterruptAndSend();
      return;
    }
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

  const handleCopyMessage = async (content: string) => {
    if (!(await copyTextToClipboard(content))) return;
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

  const instantSendNoticeText = () => {
    const remaining = queuedMessages.length;
    if (lang === 'es') {
      return remaining === 0
        ? 'Mensaje enviado al instante · la cola quedó vacía'
        : remaining === 1
          ? 'Mensaje enviado al instante · queda 1 en cola'
          : `Mensaje enviado al instante · quedan ${remaining} en cola`;
    }
    if (lang === 'de') {
      return remaining === 0
        ? 'Nachricht sofort gesendet · die Warteschlange ist jetzt leer'
        : `Nachricht sofort gesendet · noch ${remaining} in der Warteschlange`;
    }
    return remaining === 0
      ? 'Message sent immediately · the queue is now empty'
      : `Message sent immediately · ${remaining} still queued`;
  };

  return (
    <div className="flex flex-col h-full bg-[var(--nc-bg-panel)] text-white font-mono relative">
      {/* Messages Area */}
      {/* Laterales mínimos: con la barra lateral y el panel abiertos, 16px a cada
          lado se comían el ancho útil del texto. */}
      <div data-testid="chat-messages" className="flex-1 min-h-0 overflow-y-auto px-2 py-3 sm:px-4 sm:py-4 space-y-3 sm:space-y-4">
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
          messages.map((msg, msgIndex) => (
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
                    {msg.failed && onRetryMessage && msgIndex === messages.length - 1 && (
                      <button
                        type="button"
                        onClick={() => onRetryMessage(msg.id)}
                        className="text-[10px] font-bold text-[var(--nc-text-accent)] hover:brightness-125 transition-colors flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        {lang === 'es' ? 'Reintentar' : lang === 'de' ? 'Erneut versuchen' : 'Retry'}
                      </button>
                    )}
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
        {instantSendNotice > 0 && (
          <div
            key={instantSendNotice}
            role="status"
            aria-live="polite"
            data-testid="queue-send-notice"
            className="mb-2 flex items-center gap-2 rounded border border-[var(--nc-success)] bg-black/30 px-2 py-1.5 font-mono text-[11px] text-[var(--nc-success)]"
          >
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{instantSendNoticeText()}</span>
          </div>
        )}
        {queuedMessages.length > 0 && (
          <div
            data-testid="chat-queue"
            className="mb-2 rounded border border-cyan-400/40 bg-black/30 px-2 py-1.5 font-mono"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[10px]">
              <span className="font-bold uppercase tracking-wide text-[var(--nc-text-accent)]">
                {lang === 'es' ? `En cola · ${queuedMessages.length}` : lang === 'de' ? `In Warteschlange · ${queuedMessages.length}` : `Queued · ${queuedMessages.length}`}
              </span>
              <span className="text-[var(--nc-text-dim)]">
                {lang === 'es' ? 'Esperan turno; arrástralos para ordenar, edítalos o envíalos ya · Ctrl/Cmd+Shift+Enter envía el primero' : lang === 'de' ? 'Warten auf die aktuelle Aktion; ziehen, bearbeiten oder sofort senden · Strg/Cmd+Umschalt+Eingabe sendet die erste Nachricht' : 'Waiting for the current action; drag to reorder, edit or send now · Ctrl/Cmd+Shift+Enter sends the first'}
              </span>
            </div>
            <ul ref={queueListRef} className="mt-1 space-y-1">
              {queuedMessages.map((item, index) => {
                const label = queuedItemLabel(item);
                const editing = editingQueuedId === item.id;
                return (
                  <li
                    key={item.id}
                    data-queued-id={item.id}
                    draggable={!editing}
                    onDragStart={(event) => startQueuedDrag(event, item.id)}
                    onDragEnd={endQueuedDrag}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(event) => dropQueued(event, index)}
                    className={`rounded bg-[var(--nc-bg-main)]/70 px-2 py-1 text-xs transition-opacity ${
                      draggingQueuedId === item.id ? 'opacity-40' : ''
                    } ${pointerDropTarget?.id === item.id ? 'ring-1 ring-inset ring-[var(--nc-text-accent)]' : ''}`}
                  >
                    {editing ? (
                      <div className="flex items-start gap-2">
                        <textarea
                          value={editingQueuedText}
                          onChange={(e) => setEditingQueuedText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              saveQueuedEdit();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelQueuedEdit();
                            }
                          }}
                          aria-label={`${lang === 'es' ? 'Editar mensaje en cola' : lang === 'de' ? 'Nachricht in der Warteschlange bearbeiten' : 'Edit queued message'}: ${label}`}
                          rows={2}
                          autoFocus
                          className="min-w-0 flex-1 resize-none rounded border border-cyan-400/40 bg-black/40 px-2 py-1 text-xs text-white focus:border-cyan-300 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={saveQueuedEdit}
                          disabled={!editingQueuedText.trim() && item.attachments.length === 0}
                          aria-label={lang === 'es' ? 'Guardar cambios en cola' : lang === 'de' ? 'Änderungen in der Warteschlange speichern' : 'Save queued changes'}
                          title={lang === 'es' ? 'Guardar cambios' : lang === 'de' ? 'Änderungen speichern' : 'Save changes'}
                          className="shrink-0 nc-icon-btn text-[var(--nc-success)] transition-colors hover:text-[var(--nc-success)] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={sendEditingQueuedNow}
                          disabled={!editingQueuedText.trim() && item.attachments.length === 0}
                          aria-label={lang === 'es' ? 'Enviar ahora sin guardar' : lang === 'de' ? 'Jetzt senden, ohne zu speichern' : 'Send now without saving'}
                          title={lang === 'es' ? 'Enviar ahora con este texto, sin guardarlo en la cola' : lang === 'de' ? 'Jetzt mit diesem Text senden, ohne ihn zu speichern' : 'Send now with this text, without saving it to the queue'}
                          className="shrink-0 nc-icon-btn text-[var(--nc-text-accent)] transition-colors hover:text-[var(--nc-text-accent)] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Send className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelQueuedEdit}
                          aria-label={lang === 'es' ? 'Cancelar edición' : lang === 'de' ? 'Bearbeitung abbrechen' : 'Cancel edit'}
                          title={lang === 'es' ? 'Cancelar' : lang === 'de' ? 'Abbrechen' : 'Cancel'}
                          className="shrink-0 nc-icon-btn text-[var(--nc-text-dim)] transition-colors hover:text-[var(--nc-text)]"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          onPointerDown={(event) => startQueuedPointerDrag(event, item.id)}
                          className="shrink-0 touch-none cursor-grab select-none p-1 -m-1 text-[var(--nc-text-dim)] active:cursor-grabbing"
                          title={
                            lang === 'es'
                              ? 'Arrastrar para reordenar'
                              : lang === 'de'
                                ? 'Zum Sortieren ziehen'
                                : 'Drag to reorder'
                          }
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </span>
                        <span aria-hidden className="shrink-0 text-[10px] text-[var(--nc-text-dim)]">{index + 1}.</span>
                        <span className="min-w-0 flex-1 truncate text-[var(--nc-text)]" title={label}>
                          {label}
                        </span>
                        {item.attachments.length > 0 && (
                          <span className="flex shrink-0 items-center gap-1 text-[10px] text-cyan-400">
                            <Paperclip className="h-3 w-3" /> {item.attachments.length}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => moveQueued(item.id, -1)}
                          disabled={index === 0}
                          aria-label={`${lang === 'es' ? 'Subir en la cola' : lang === 'de' ? 'In der Warteschlange nach oben' : 'Move up in queue'}: ${label}`}
                          title={lang === 'es' ? 'Subir' : lang === 'de' ? 'Nach oben' : 'Move up'}
                          className="shrink-0 nc-icon-btn text-[var(--nc-text-dim)] transition-colors hover:text-[var(--nc-text)] disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveQueued(item.id, 1)}
                          disabled={index === queuedMessages.length - 1}
                          aria-label={`${lang === 'es' ? 'Bajar en la cola' : lang === 'de' ? 'In der Warteschlange nach unten' : 'Move down in queue'}: ${label}`}
                          title={lang === 'es' ? 'Bajar' : lang === 'de' ? 'Nach unten' : 'Move down'}
                          className="shrink-0 nc-icon-btn text-[var(--nc-text-dim)] transition-colors hover:text-[var(--nc-text)] disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveQueuedToComposer(item)}
                          aria-label={`${lang === 'es' ? 'Editar en el compositor' : lang === 'de' ? 'Im Composer bearbeiten' : 'Edit in composer'}: ${label}`}
                          title={lang === 'es' ? 'Editar en el compositor con todos los adjuntos' : lang === 'de' ? 'Im Composer mit allen Anhängen bearbeiten' : 'Edit in composer with all attachments'}
                          className="shrink-0 nc-icon-btn text-[var(--nc-text-dim)] transition-colors hover:text-[var(--nc-text-accent)]"
                        >
                          <CornerUpLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => startQueuedEdit(item)}
                          aria-label={`${lang === 'es' ? 'Editar de la cola' : lang === 'de' ? 'Aus der Warteschlange bearbeiten' : 'Edit from queue'}: ${label}`}
                          title={lang === 'es' ? 'Editar solo el texto' : lang === 'de' ? 'Nur Text bearbeiten' : 'Edit text only'}
                          className="shrink-0 nc-icon-btn text-[var(--nc-text-dim)] transition-colors hover:text-[var(--nc-text)]"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => sendQueuedNow(item)}
                          aria-label={`${lang === 'es' ? 'Enviar ahora' : lang === 'de' ? 'Jetzt senden' : 'Send now'}: ${label}`}
                          title={lang === 'es' ? 'Enviar ahora: interrumpe la acción actual' : lang === 'de' ? 'Jetzt senden: unterbricht die aktuelle Aktion' : 'Send now: interrupts the current action'}
                          className="shrink-0 nc-icon-btn text-[var(--nc-text-accent)] transition-colors hover:text-[var(--nc-text-accent)] hover:brightness-125"
                        >
                          <Send className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setQueuedMessages((prev) => prev.filter((queued) => queued.id !== item.id))}
                          aria-label={`${lang === 'es' ? 'Quitar de la cola' : lang === 'de' ? 'Aus der Warteschlange entfernen' : 'Remove from queue'}: ${label}`}
                          title={lang === 'es' ? 'Quitar de la cola' : lang === 'de' ? 'Aus der Warteschlange entfernen' : 'Remove from queue'}
                          className="shrink-0 nc-icon-btn text-[var(--nc-text-dim)] transition-colors hover:text-red-400"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((file, idx) => (
              <div
                key={idx}
                title={file.name}
                className="flex min-w-0 max-w-full items-center gap-1 bg-black/30 border border-cyan-400/30 rounded px-2 py-1 text-xs"
              >
                <span className="flex min-w-0 items-center gap-1"><Paperclip className="w-3 h-3 shrink-0" /> <span className="truncate">{file.name}</span></span>
                <button
                  onClick={() => removeAttachment(idx)}
                  className="shrink-0 nc-icon-btn text-red-400 transition-colors hover:text-red-300"
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
            placeholder={
              isGenerating
                ? interruptOnSend
                  ? lang === 'es' ? 'Escribe un mensaje; al enviar se interrumpirá la acción actual...' : lang === 'de' ? 'Schreibe eine Nachricht; beim Senden wird die aktuelle Aktion unterbrochen...' : 'Type a message; sending will interrupt the current action...'
                  : lang === 'es' ? 'Escribe otro mensaje; se enviará al terminar...' : lang === 'de' ? 'Schreibe eine weitere Nachricht; sie wird danach gesendet...' : 'Type another message; it will be sent when this finishes...'
                : lang === 'es' ? 'Escribe tu mensaje...' : lang === 'de' ? 'Schreibe deine Nachricht...' : 'Type your message...'
            }
            className="w-full bg-black/30 border border-cyan-400/30 rounded-lg p-3 text-white placeholder-gray-500 resize-none focus:outline-none focus:border-cyan-400"
            rows={2}
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
          interruptOnSend={interruptOnSend}
          onToggleInterruptOnSend={toggleInterruptOnSend}
          onSend={handleSend}
          onClearChat={handleClearChat}
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
          onChangeContextLength={
            setParameters
              ? (tokens: number) => setParameters((prev) => ({ ...prev, contextLength: tokens }))
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
