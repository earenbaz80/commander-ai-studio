/**
 * Estado multi-pestaña: cada pestaña es una sesión completa
 * con su propio modo, modelo, parámetros, conversación y proyecto.
 *
 * La clave de la pestaña activa vive en App.tsx; aquí solo se gestiona el
 * conjunto de pestañas y las operaciones sobre ellas.
 */

import { useState, useCallback, useRef } from 'react';
import type { StudioMode, ParameterConfig, ChatMessage } from '../types/studio';
import { DEFAULT_MODEL, runDefaultModelMigration } from '../utils/defaultModel';

/** Nombre legible de una ruta, compatible con Windows y POSIX. */
export function basename(p: string): string {
  if (!p) return '';
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export interface WorkspaceTab {
  id: string;
  title: string;
  mode: StudioMode;
  selectedModel: string;
  parameters: ParameterConfig;
  messages: ChatMessage[];
  /** Directorio del proyecto donde trabaja esta pestaña (allowlist del server). */
  projectPath: string;
  /** true si el usuario renombró la pestaña manualmente (el proyecto no la pisa). */
  manualTitle?: boolean;
  /** Id de la entrada de historial que esta pestaña está editando. */
  sessionId: string;
  /** Título del prompt de la sesión (usado por el historial y las versiones). */
  promptTitle: string;
  /** Id del workspace aislado (fork) asociado a esta pestaña, si aplica. */
  sessionWorkspaceId?: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'ai_studio_tabs_v1';
const ACTIVE_KEY = 'ai_studio_active_tab';
const MAX_TABS = 12;

let counter = 0;
function newTabId(): string {
  counter += 1;
  return `tab-${Date.now().toString(36)}-${counter}`;
}

export const DEFAULT_PARAMETERS: ParameterConfig = {
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  maxTokens: 2048,
  thinkingLevel: 'LOW',
  responseFormat: 'text',
  jsonSchema: '',
  systemInstruction: 'Eres un asistente experto en ingeniería de software, IA y empaquetado nativo.',
  examples: [],
  hfQuantization: 'q4',
  hfApiToken: '',
  tools: {
    googleSearch: true,
    codeExecution: true,
    urlContext: true,
  },
};

export function createTab(opts: Partial<WorkspaceTab> = {}): WorkspaceTab {
  const now = Date.now();
  return {
    id: opts.id || newTabId(),
    title: opts.title || 'Nueva Sesión',
    mode: opts.mode || 'chat',
    selectedModel: opts.selectedModel || DEFAULT_MODEL,
    parameters: opts.parameters || { ...DEFAULT_PARAMETERS },
    messages: opts.messages || [],
    projectPath: opts.projectPath || '',
    manualTitle: opts.manualTitle,
    sessionId: opts.sessionId || `sess-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    promptTitle: opts.promptTitle || 'Mi Proyecto Commander AI Studio',
    createdAt: opts.createdAt || now,
    updatedAt: now,
  };
}

/** Al cargar: cada tab conserva solo los últimos 40 mensajes (localStorage es finito). */
function hydrate(raw: any): WorkspaceTab | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  try {
    return {
      ...createTab(),
      ...raw,
      parameters: { ...DEFAULT_PARAMETERS, ...(raw.parameters || {}) },
      messages: Array.isArray(raw.messages) ? raw.messages.slice(-40) : [],
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

function loadTabs(): WorkspaceTab[] {
  runDefaultModelMigration();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [createTab({ title: 'Sesión 1' })];
    const parsed = JSON.parse(raw);
    const tabs = Array.isArray(parsed) ? parsed.map(hydrate).filter(Boolean) as WorkspaceTab[] : [];
    return tabs.length ? tabs : [createTab({ title: 'Sesión 1' })];
  } catch {
    return [createTab({ title: 'Sesión 1' })];
  }
}

function loadActiveId(tabs: WorkspaceTab[]): string {
  try {
    const saved = localStorage.getItem(ACTIVE_KEY);
    if (saved && tabs.some((t) => t.id === saved)) return saved;
  } catch { /* ignore */ }
  return tabs[0].id;
}

export function useTabs(initialProjectPath = '') {
  // Cargamos UNA sola vez: la pestaña activa debe pertenecer al mismo conjunto
  // que `tabs`. Antes loadTabs() se invocaba dos veces y cada llamada generaba
  // una pestaña por defecto con ids distintos, dejando `activeId` apuntando a
  // una pestaña fantasma (updateTab/setProject sobre esa id no hacían nada).
  const [initialState] = useState(() => {
    const loaded = loadTabs();
    if (initialProjectPath && !loaded[0].projectPath) {
      loaded[0] = { ...loaded[0], projectPath: initialProjectPath };
    }
    return { tabs: loaded, activeId: loadActiveId(loaded) };
  });
  const [tabs, setTabs] = useState<WorkspaceTab[]>(initialState.tabs);
  const [activeId, setActiveId] = useState<string>(initialState.activeId);
  // Espejo en ref para que los callbacks no dependan del estado actual.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  // Contador monótono para numerar pestañas sin colisiones.
  const seqRef = useRef(tabs.length);

  const activeTab = tabs.find((t) => t.id === activeId) || tabs[0];

  const persist = useCallback((next: WorkspaceTab[]) => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(next.map((t) => ({ ...t, messages: t.messages.slice(-40) })))
      );
      localStorage.setItem(ACTIVE_KEY, next.find((t) => t.id === activeId)?.id || next[0]?.id || '');
    } catch {
      // Cuota excedida: recortamos mensajes y reintentamos una vez.
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(next.map((t) => ({ ...t, messages: t.messages.slice(-10) })))
        );
      } catch { /* ignore */ }
    }
  }, [activeId]);

  /** Actualiza la pestaña indicada (por defecto la activa) y persiste. */
  const updateTab = useCallback((patch: Partial<WorkspaceTab>, tabId?: string) => {
    const id = tabId || activeId;
    setTabs((prev) => {
      const next = prev.map((t) =>
        t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t
      );
      persist(next);
      return next;
    });
  }, [activeId, persist]);

  /**
   * Aplica el siguiente estado y persiste fuera del updater (los updaters
   * deben ser puros: React los puede ejecutar dos veces en StrictMode).
   */
  const commit = useCallback((compute: (prev: WorkspaceTab[]) => WorkspaceTab[]) => {
    setTabs((prev) => {
      const next = compute(prev);
      queueMicrotask(() => persist(next));
      return next;
    });
  }, [persist]);

  const newTab = useCallback((opts: Partial<WorkspaceTab> = {}): string => {
    // Usamos un contador propio (no tabs.length) porque varios newTab() pueden
    // ejecutarse en el mismo tick, antes de que React re-renderice y el ref
    // refleje las pestañas nuevas: con length darían todas el mismo nombre.
    seqRef.current += 1;
    let title = opts.title;
    if (!title) title = `Sesión ${seqRef.current}`;
    const tab = createTab({
      mode: 'chat',
      projectPath: activeTab?.projectPath || '',
      ...opts,
      title,
    });
    commit((prev) => [...prev, tab].slice(-MAX_TABS));
    setActiveId(tab.id);
    try { localStorage.setItem(ACTIVE_KEY, tab.id); } catch { /* ignore */ }
    return tab.id;
  }, [activeTab?.projectPath, commit]);

  const closeTab = useCallback((tabId: string): string | null => {
    const prev = tabsRef.current;
    if (prev.length <= 1) return null; // siempre queda al menos una pestaña
    const closing = prev.find((t) => t.id === tabId);
    if (closing?.sessionWorkspaceId) {
      import('../lib/sessionWorkspace').then((m) => m.deleteSessionWorkspace(closing.sessionWorkspaceId!)).catch(() => {});
    }
    const idx = prev.findIndex((t) => t.id === tabId);
    const next = prev.filter((t) => t.id !== tabId);
    commit(() => next);
    if (activeId === tabId) {
      const fallback = next[Math.min(idx, next.length - 1)];
      setActiveId(fallback.id);
      try { localStorage.setItem(ACTIVE_KEY, fallback.id); } catch { /* ignore */ }
      return fallback.id;
    }
    return null;
  }, [activeId, commit]);

  const closeOthers = useCallback((tabId: string) => {
    const target = tabsRef.current.find((t) => t.id === tabId);
    if (!target) return;
    commit(() => [target]);
    setActiveId(tabId);
    try { localStorage.setItem(ACTIVE_KEY, tabId); } catch { /* ignore */ }
  }, [commit]);

  const selectTab = useCallback((tabId: string) => {
    if (!tabsRef.current.some((t) => t.id === tabId)) return;
    setActiveId(tabId);
    try { localStorage.setItem(ACTIVE_KEY, tabId); } catch { /* ignore */ }
  }, []);

  const renameTab = useCallback((tabId: string, title: string) => {
    // Marca el título como manual para que el cambio de proyecto no lo pise.
    // Hacemos trim: un título de solo espacios no es un nombre válido.
    updateTab({ title: title.trim().slice(0, 60) || 'Sesión', manualTitle: true }, tabId);
  }, [updateTab]);

  /** Renombra automáticamente con el primer mensaje del usuario. */
  const autoTitle = useCallback((tabId: string, text: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    const clean = text.replace(/\s+/g, ' ').trim();
    // Solo si el título sigue siendo el generado automáticamente.
    if (!tab || !/^Nueva Sesión$|^Sesión \d+$/.test(tab.title) || clean.length < 3) return;
    // Los prompts automáticos (auditoría) no sirven como título de pestaña.
    if (/^(Realiza una AUDITORÍA GENERAL|Perform a GENERAL AUDIT)\b/.test(clean)) return;
    updateTab({ title: clean.slice(0, 45) }, tabId);
  }, [updateTab]);

  /**
   * Asigna el proyecto de la pestaña. Al hacerlo, la pestaña adquiere el nombre
   * del proyecto, salvo que el usuario la haya renombrado a mano.
   */
  const setProject = useCallback((projectPath: string, tabId?: string, workspaceId?: string) => {
    const id = tabId || activeId;
    if (!projectPath) {
      updateTab({ projectPath, sessionWorkspaceId: undefined }, id);
      return;
    }
    const tab = tabsRef.current.find((t) => t.id === id);
    if (tab?.manualTitle) {
      updateTab({ projectPath, sessionWorkspaceId: workspaceId }, id);
    } else {
      updateTab({ projectPath, title: basename(projectPath), sessionWorkspaceId: workspaceId }, id);
    }
  }, [activeId, updateTab]);

  return {
    tabs,
    activeTab,
    activeId,
    setActiveId: selectTab,
    updateTab,
    newTab,
    closeTab,
    closeOthers,
    selectTab,
    renameTab,
    autoTitle,
    setProject,
  };
}

export type TabsApi = ReturnType<typeof useTabs>;
