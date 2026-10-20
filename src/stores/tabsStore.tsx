/**
 * Tabs Store - Centralized multi-tab state management
 * 
 * Integrates with existing useTabs hook logic but as a global store
 * Manages: tabs array, active tab, project roots, tab-project associations
 */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect, useCallback, useRef, ReactNode } from 'react';
import type { ParameterConfig } from '../types/studio';
import type { WorkspaceTab } from '../hooks/useTabs';
import type { AgentRoot } from '../lib/agentProjects';
import { DEFAULT_MODEL, runDefaultModelMigration } from '../utils/defaultModel';
import { listAgentRoots, addAgentRoot, removeAgentRoot, createProject } from '../lib/agentProjects';
import { setActiveProjectRoot } from '../agent/activeProject';

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
  safetyHarassment: 'BLOCK_NONE',
  safetyHateSpeech: 'BLOCK_NONE',
  safetySexuallyExplicit: 'BLOCK_NONE',
  safetyDangerousContent: 'BLOCK_NONE',
  hfDevice: 'webgpu',
  hfQuantization: 'q4',
  hfApiToken: '',
  tools: {
    googleSearch: true,
    codeExecution: true,
    urlContext: true,
    customFunctions: [],
  },
};

function basename(p: string): string {
  if (!p) return '';
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function createTab(opts: Partial<WorkspaceTab> = {}): WorkspaceTab {
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

function persist(tabs: WorkspaceTab[], activeId: string) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(tabs.map((t) => ({ ...t, messages: t.messages.slice(-40) })))
    );
    localStorage.setItem(ACTIVE_KEY, tabs.find((t) => t.id === activeId)?.id || tabs[0]?.id || '');
  } catch {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(tabs.map((t) => ({ ...t, messages: t.messages.slice(-10) })))
      );
    } catch { /* ignore */ }
  }
}

export interface TabsState {
  tabs: WorkspaceTab[];
  activeId: string;
  agentRoots: AgentRoot[];
  isLoadingRoots: boolean;
}

type TabsAction =
  | { type: 'SET_TABS'; payload: WorkspaceTab[] }
  | { type: 'SET_ACTIVE_ID'; payload: string }
  | { type: 'UPDATE_TAB'; payload: { tabId: string; patch: Partial<WorkspaceTab> } }
  | { type: 'ADD_TAB'; payload: WorkspaceTab }
  | { type: 'CLOSE_TAB'; payload: string }
  | { type: 'CLOSE_OTHERS'; payload: string }
  | { type: 'RENAME_TAB'; payload: { tabId: string; title: string } }
  | { type: 'SET_PROJECT'; payload: { tabId: string; projectPath: string } }
  | { type: 'SET_AGENT_ROOTS'; payload: AgentRoot[] }
  | { type: 'ADD_AGENT_ROOT'; payload: AgentRoot[] }
  | { type: 'REMOVE_AGENT_ROOT'; payload: AgentRoot[] }
  | { type: 'SET_LOADING_ROOTS'; payload: boolean }
  | { type: 'HYDRATE'; payload: { tabs: WorkspaceTab[]; activeId: string; agentRoots: AgentRoot[] } };

const initialState: TabsState = {
  tabs: [],
  activeId: '',
  agentRoots: [],
  isLoadingRoots: false,
};

function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'SET_TABS': {
      return { ...state, tabs: action.payload };
    }
    
    case 'SET_ACTIVE_ID': {
      if (!state.tabs.some((t) => t.id === action.payload)) return state;
      return { ...state, activeId: action.payload };
    }
    
    case 'UPDATE_TAB': {
      const { tabId, patch } = action.payload;
      const next = state.tabs.map((t) =>
        t.id === tabId ? { ...t, ...patch, updatedAt: Date.now() } : t
      );
      persist(next, state.activeId);
      return { ...state, tabs: next };
    }
    
    case 'ADD_TAB': {
      const next = [...state.tabs, action.payload].slice(-MAX_TABS);
      persist(next, action.payload.id);
      return { ...state, tabs: next, activeId: action.payload.id };
    }
    
    case 'CLOSE_TAB': {
      const prev = state.tabs;
      if (prev.length <= 1) return state;
      const idx = prev.findIndex((t) => t.id === action.payload);
      const next = prev.filter((t) => t.id !== action.payload);
      let newActiveId = state.activeId;
      if (state.activeId === action.payload) {
        const fallback = next[Math.min(idx, next.length - 1)];
        newActiveId = fallback.id;
      }
      persist(next, newActiveId);
      return { ...state, tabs: next, activeId: newActiveId };
    }
    
    case 'CLOSE_OTHERS': {
      const target = state.tabs.find((t) => t.id === action.payload);
      if (!target) return state;
      const next = [target];
      persist(next, action.payload);
      return { ...state, tabs: next, activeId: action.payload };
    }
    
    case 'RENAME_TAB': {
      const { tabId, title } = action.payload;
      const next = state.tabs.map((t) =>
        t.id === tabId ? { ...t, title: title.trim().slice(0, 60) || 'Sesión', manualTitle: true, updatedAt: Date.now() } : t
      );
      persist(next, state.activeId);
      return { ...state, tabs: next };
    }
    
    case 'SET_PROJECT': {
      const { tabId, projectPath } = action.payload;
      const next = state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        if (!projectPath) {
          return { ...t, projectPath, updatedAt: Date.now() };
        }
        if (t.manualTitle) {
          return { ...t, projectPath, updatedAt: Date.now() };
        }
        return { ...t, projectPath, title: basename(projectPath), updatedAt: Date.now() };
      });
      persist(next, state.activeId);
      return { ...state, tabs: next };
    }
    
    case 'SET_AGENT_ROOTS': {
      return { ...state, agentRoots: action.payload, isLoadingRoots: false };
    }
    
    case 'ADD_AGENT_ROOT': {
      return { ...state, agentRoots: action.payload };
    }
    
    case 'REMOVE_AGENT_ROOT': {
      return { ...state, agentRoots: action.payload };
    }
    
    case 'SET_LOADING_ROOTS': {
      return { ...state, isLoadingRoots: action.payload };
    }
    
    case 'HYDRATE': {
      return { ...state, ...action.payload };
    }
    
    default:
      return state;
  }
}

interface TabsStoreContextValue {
  state: TabsState;
  dispatch: React.Dispatch<TabsAction>;
  // Computed
  activeTab: WorkspaceTab | null;
  // Actions
  selectTab: (tabId: string) => void;
  updateTab: (patch: Partial<WorkspaceTab>, tabId?: string) => void;
  newTab: (opts?: Partial<WorkspaceTab>) => string;
  closeTab: (tabId: string) => string | null;
  closeOthers: (tabId: string) => void;
  renameTab: (tabId: string, title: string) => void;
  autoTitle: (tabId: string, text: string) => void;
  setProject: (projectPath: string, tabId?: string) => void;
  // Agent roots
  loadAgentRoots: () => Promise<void>;
  addDirectory: (path: string) => Promise<void>;
  createNewProject: (name: string) => Promise<{ path: string; name: string }>;
  removeProject: (path: string) => Promise<void>;
}

const TabsStoreContext = createContext<TabsStoreContextValue | null>(null);

export function TabsStoreProvider({ children, initialProjectPath = '' }: { children: ReactNode; initialProjectPath?: string }) {
  const [state, dispatch] = useReducer(tabsReducer, initialState, () => {
    // Initialize once with proper hydration
    const loadedTabs = loadTabs();
    if (initialProjectPath && !loadedTabs[0].projectPath) {
      loadedTabs[0] = { ...loadedTabs[0], projectPath: initialProjectPath };
    }
    const activeId = loadActiveId(loadedTabs);
    return { tabs: loadedTabs, activeId, agentRoots: [], isLoadingRoots: false };
  });

  const tabsRef = useRef(state.tabs);
  tabsRef.current = state.tabs;
  
  const seqRef = useRef(state.tabs.length);

  const activeTab = state.tabs.find((t) => t.id === state.activeId) || state.tabs[0];

  // Load agent roots on mount
  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'SET_LOADING_ROOTS', payload: true });
    listAgentRoots()
      .then((roots) => { if (!cancelled) dispatch({ type: 'SET_AGENT_ROOTS', payload: roots }); })
      .catch(() => { if (!cancelled) dispatch({ type: 'SET_AGENT_ROOTS', payload: [] }); });
    return () => { cancelled = true; };
  }, []);

  // Sync active project root to agent
  useEffect(() => {
    setActiveProjectRoot(activeTab?.projectPath || '');
  }, [activeTab?.projectPath]);

  const actions = {
    selectTab: useCallback((tabId: string) => {
      if (!tabsRef.current.some((t) => t.id === tabId)) return;
      dispatch({ type: 'SET_ACTIVE_ID', payload: tabId });
      try { localStorage.setItem(ACTIVE_KEY, tabId); } catch { /* ignore */ }
    }, []),

    updateTab: useCallback((patch: Partial<WorkspaceTab>, tabId?: string) => {
      const id = tabId || state.activeId;
      dispatch({ type: 'UPDATE_TAB', payload: { tabId: id, patch } });
    }, [state.activeId]),

    newTab: useCallback((opts: Partial<WorkspaceTab> = {}): string => {
      seqRef.current += 1;
      let title = opts.title;
      if (!title) title = `Sesión ${seqRef.current}`;
      const active = tabsRef.current.find((t) => t.id === state.activeId);
      const tab = createTab({
        mode: 'chat',
        projectPath: active?.projectPath || '',
        ...opts,
        title,
      });
      dispatch({ type: 'ADD_TAB', payload: tab });
      try { localStorage.setItem(ACTIVE_KEY, tab.id); } catch { /* ignore */ }
      return tab.id;
    }, [state.activeId]),

    closeTab: useCallback((tabId: string): string | null => {
      const prev = tabsRef.current;
      if (prev.length <= 1) return null;
      const idx = prev.findIndex((t) => t.id === tabId);
      const next = prev.filter((t) => t.id !== tabId);
      let newActiveId: string | null = null;
      if (state.activeId === tabId) {
        const fallback = next[Math.min(idx, next.length - 1)];
        newActiveId = fallback.id;
      }
      dispatch({ type: 'CLOSE_TAB', payload: tabId });
      return newActiveId;
    }, [state.activeId]),

    closeOthers: useCallback((tabId: string) => {
      const target = tabsRef.current.find((t) => t.id === tabId);
      if (!target) return;
      dispatch({ type: 'CLOSE_OTHERS', payload: tabId });
      try { localStorage.setItem(ACTIVE_KEY, tabId); } catch { /* ignore */ }
    }, []),

    renameTab: useCallback((tabId: string, title: string) => {
      dispatch({ type: 'RENAME_TAB', payload: { tabId, title } });
    }, []),

    autoTitle: useCallback((tabId: string, text: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      const clean = text.replace(/\s+/g, ' ').trim();
      if (!tab || !/^Nueva Sesión$|^Sesión \d+$/.test(tab.title) || clean.length < 3) return;
      if (/^(Realiza una AUDITORÍA GENERAL|Perform a GENERAL AUDIT)\b/.test(clean)) return;
      dispatch({ type: 'RENAME_TAB', payload: { tabId, title: clean.slice(0, 45) } });
    }, []),

    setProject: useCallback((projectPath: string, tabId?: string) => {
      const id = tabId || state.activeId;
      dispatch({ type: 'SET_PROJECT', payload: { tabId: id, projectPath } });
    }, [state.activeId]),

    loadAgentRoots: useCallback(async () => {
      dispatch({ type: 'SET_LOADING_ROOTS', payload: true });
      try {
        const roots = await listAgentRoots();
        dispatch({ type: 'SET_AGENT_ROOTS', payload: roots });
      } catch {
        dispatch({ type: 'SET_AGENT_ROOTS', payload: [] });
      }
    }, []),

    addDirectory: useCallback(async (path: string) => {
      try {
        const roots = await addAgentRoot(path.trim());
        dispatch({ type: 'ADD_AGENT_ROOT', payload: roots });
      } catch (e: any) {
        throw e;
      }
    }, []),

    createNewProject: useCallback(async (name: string) => {
      const created = await createProject(name.trim());
      const roots = await listAgentRoots();
      dispatch({ type: 'SET_AGENT_ROOTS', payload: roots });
      return created;
    }, []),

    removeProject: useCallback(async (path: string) => {
      const roots = await removeAgentRoot(path);
      dispatch({ type: 'REMOVE_AGENT_ROOT', payload: roots });
      const active = tabsRef.current.find((t) => t.id === state.activeId);
      if (active?.projectPath === path) {
        dispatch({ type: 'SET_PROJECT', payload: { tabId: state.activeId, projectPath: '' } });
      }
    }, [state.activeId]),
  };

  return (
    <TabsStoreContext.Provider value={{ state, dispatch, activeTab, ...actions }}>
      {children}
    </TabsStoreContext.Provider>
  );
}

export function useTabsStore() {
  const context = useContext(TabsStoreContext);
  if (!context) {
    throw new Error('useTabsStore must be used within a TabsStoreProvider');
  }
  return context;
}

export function useTabsState() {
  const { state } = useTabsStore();
  return state;
}

export function useTabsActions() {
  const actions = useTabsStore();
  return actions;
}

export function useActiveTab() {
  const { activeTab } = useTabsStore();
  return activeTab;
}