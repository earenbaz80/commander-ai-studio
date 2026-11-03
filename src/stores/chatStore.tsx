/**
 * Chat Store - Centralized state for chat/conversation
 * 
 * Manages: messages, mode, selectedModel, selectedProvider, parameters, promptTitle
 */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect, useCallback, ReactNode } from 'react';
import type { StudioMode, ProviderType, ParameterConfig, ChatMessage, DownloadedLocalModel, HistorySession } from '../types/studio';
import { DEFAULT_MODEL, runDefaultModelMigration } from '../utils/defaultModel';
import { detectProvider } from '../lib/aiProviders';
import { DEFAULT_PARAMETERS } from '../hooks/useTabs';

/**
 * Valor o función actualizadora (estilo useState).
 * Permite `setX(v)` y `setX(prev => next)`.
 */
export type SetterValue<T> = T | ((prev: T) => T);

export interface ChatState {
  // Core chat state
  mode: StudioMode;
  promptTitle: string;
  selectedModel: string;
  selectedProvider: ProviderType;
  parameters: ParameterConfig;
  messages: ChatMessage[];
  isGenerating: boolean;
  
  // Downloaded local models
  downloadedModels: DownloadedLocalModel[];
  
  // History (partitioned by tab)
  history: HistorySession[];
}

type ChatAction =
  | { type: 'SET_MODE'; payload: StudioMode }
  | { type: 'SET_PROMPT_TITLE'; payload: string }
  | { type: 'SET_SELECTED_MODEL'; payload: string }
  | { type: 'SET_SELECTED_PROVIDER'; payload: ProviderType }
  | { type: 'SET_PARAMETERS'; payload: SetterValue<ParameterConfig> }
  | { type: 'SET_MESSAGES'; payload: SetterValue<ChatMessage[]> }
  | { type: 'ADD_MESSAGE'; payload: ChatMessage }
  | { type: 'UPDATE_MESSAGE'; payload: { id: string; updates: Partial<ChatMessage> } }
  | { type: 'SET_IS_GENERATING'; payload: boolean }
  | { type: 'SET_DOWNLOADED_MODELS'; payload: SetterValue<DownloadedLocalModel[]> }
  | { type: 'ADD_DOWNLOADED_MODEL'; payload: DownloadedLocalModel }
  | { type: 'REMOVE_DOWNLOADED_MODEL'; payload: string }
  | { type: 'SET_HISTORY'; payload: SetterValue<HistorySession[]> }
  | { type: 'ADD_HISTORY_ITEM'; payload: HistorySession }
  | { type: 'DELETE_HISTORY_ITEM'; payload: string }
  | { type: 'CLEAR_HISTORY'; payload: string } // tabId
  | { type: 'HYDRATE'; payload: Partial<ChatState> }
  | { type: 'RESET_SESSION'; payload?: { projectPath?: string; sessionId?: string } };

const initialState: ChatState = {
  mode: 'chat',
  promptTitle: 'Mi Proyecto Commander AI Studio',
  selectedModel: DEFAULT_MODEL,
  selectedProvider: 'google',
  parameters: { ...DEFAULT_PARAMETERS },
  messages: [],
  isGenerating: false,
  downloadedModels: [
    {
      id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
      name: 'DeepSeek-R1 Distill 1.5B',
      hfRepoId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
      sizeMb: 1200,
      downloadDate: '2026-09-30',
      pipelineTag: 'text-generation',
      quantization: 'q4',
      status: 'ready',
    },
    {
      id: 'meta-llama/Llama-3.2-3B-Instruct',
      name: 'Llama 3.2 3B Instruct',
      hfRepoId: 'meta-llama/Llama-3.2-3B-Instruct',
      sizeMb: 2400,
      downloadDate: '2026-09-30',
      pipelineTag: 'text-generation',
      quantization: 'q4',
      status: 'ready',
    },
    {
      id: 'Xenova/all-MiniLM-L6-v2',
      name: 'HF MiniLM Embeddings',
      hfRepoId: 'Xenova/all-MiniLM-L6-v2',
      sizeMb: 120,
      downloadDate: '2026-09-30',
      pipelineTag: 'feature-extraction',
      quantization: 'q8',
      status: 'ready',
    },
  ],
  history: [],
};

function loadFromStorage(key: string, fallback: any) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: any) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Failed to save ${key} to localStorage`, e);
  }
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_MODE': {
      const newState = { ...state, mode: action.payload };
      return newState;
    }
    
    case 'SET_PROMPT_TITLE': {
      const newState = { ...state, promptTitle: action.payload };
      saveToStorage('ai_studio_prompt_title', action.payload);
      return newState;
    }
    
    case 'SET_SELECTED_MODEL': {
      runDefaultModelMigration();
      const newModel = action.payload;
      const newProvider = detectProvider(newModel, state.selectedProvider, state.downloadedModels);
      const newState = { 
        ...state, 
        selectedModel: newModel,
        selectedProvider: newProvider,
      };
      saveToStorage('ai_studio_selected_model', newModel);
      return newState;
    }
    
    case 'SET_SELECTED_PROVIDER': {
      const newState = { ...state, selectedProvider: action.payload };
      return newState;
    }
    
    case 'SET_PARAMETERS': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.parameters)
        : action.payload;
      return { ...state, parameters: next };
    }
    
    case 'SET_MESSAGES': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.messages)
        : action.payload;
      return { ...state, messages: next };
    }
    
    case 'ADD_MESSAGE': {
      const newMessages = [...state.messages, action.payload];
      return { ...state, messages: newMessages };
    }
    
    case 'UPDATE_MESSAGE': {
      const newMessages = state.messages.map((m) =>
        m.id === action.payload.id ? { ...m, ...action.payload.updates } : m
      );
      return { ...state, messages: newMessages };
    }
    
    case 'SET_IS_GENERATING': {
      return { ...state, isGenerating: action.payload };
    }
    
    case 'SET_DOWNLOADED_MODELS': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.downloadedModels)
        : action.payload;
      const newState = { ...state, downloadedModels: next };
      saveToStorage('ai_studio_downloaded_models', next);
      return newState;
    }
    
    case 'ADD_DOWNLOADED_MODEL': {
      if (state.downloadedModels.some((m) => m.hfRepoId === action.payload.hfRepoId)) {
        return state;
      }
      const newModels = [action.payload, ...state.downloadedModels];
      return chatReducer(state, { type: 'SET_DOWNLOADED_MODELS', payload: newModels });
    }
    
    case 'REMOVE_DOWNLOADED_MODEL': {
      const newModels = state.downloadedModels.filter((m) => m.id !== action.payload);
      return chatReducer(state, { type: 'SET_DOWNLOADED_MODELS', payload: newModels });
    }
    
    case 'SET_HISTORY': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.history)
        : action.payload;
      return { ...state, history: next };
    }
    
    case 'ADD_HISTORY_ITEM': {
      const newHistory = [action.payload, ...state.history.filter((h) => h.id !== action.payload.id)];
      return { ...state, history: newHistory };
    }
    
    case 'DELETE_HISTORY_ITEM': {
      const newHistory = state.history.filter((h) => h.id !== action.payload);
      return { ...state, history: newHistory };
    }
    
    case 'CLEAR_HISTORY': {
      const tabId = action.payload;
      const newHistory = state.history.filter((h) => (h.tabId || 'default') !== tabId);
      return { ...state, history: newHistory };
    }
    
    case 'HYDRATE': {
      return { ...state, ...action.payload };
    }
    
    case 'RESET_SESSION': {
      return {
        ...state,
        messages: [],
        promptTitle: 'Nuevo Proyecto Prompt',
      };
    }
    
    default:
      return state;
  }
}

interface ChatStoreContextValue {
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
  // Convenience methods
  setMode: (mode: StudioMode) => void;
  setPromptTitle: (title: string) => void;
  setSelectedModel: (model: string) => void;
  setSelectedProvider: (provider: ProviderType) => void;
  setParameters: (params: SetterValue<ParameterConfig>) => void;
  setMessages: (messages: SetterValue<ChatMessage[]>) => void;
  setHistory: (history: SetterValue<HistorySession[]>) => void;
  setDownloadedModels: (models: SetterValue<DownloadedLocalModel[]>) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  setIsGenerating: (generating: boolean) => void;
  addDownloadedModel: (model: DownloadedLocalModel) => void;
  removeDownloadedModel: (modelId: string) => void;
  addToHistory: (item: HistorySession) => void;
  deleteHistoryItem: (id: string) => void;
  clearHistory: (tabId: string) => void;
  resetSession: (opts?: { projectPath?: string; sessionId?: string }) => void;
}

const ChatStoreContext = createContext<ChatStoreContextValue | null>(null);

export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialState, (saved) => {
    // Hydrate from localStorage on initial load
    runDefaultModelMigration();
    const savedModel = loadFromStorage('ai_studio_selected_model', DEFAULT_MODEL);
    const savedTitle = loadFromStorage('ai_studio_prompt_title', 'Mi Proyecto Commander AI Studio');
    const savedHistory = loadFromStorage('ai_studio_history_sessions', []);
    const savedModels = loadFromStorage('ai_studio_downloaded_models', initialState.downloadedModels);
    const savedParams = loadFromStorage('ai_studio_parameters', DEFAULT_PARAMETERS);
    
    return {
      ...saved,
      selectedModel: savedModel,
      promptTitle: savedTitle,
      parameters: { ...DEFAULT_PARAMETERS, ...savedParams },
      history: savedHistory,
      downloadedModels: savedModels,
    };
  });

  // Persist selected model
  useEffect(() => {
    saveToStorage('ai_studio_selected_model', state.selectedModel);
  }, [state.selectedModel]);

  // Persist prompt title
  useEffect(() => {
    saveToStorage('ai_studio_prompt_title', state.promptTitle);
  }, [state.promptTitle]);

  // Persist parameters
  useEffect(() => {
    saveToStorage('ai_studio_parameters', state.parameters);
  }, [state.parameters]);

  // Persist history
  useEffect(() => {
    saveToStorage('ai_studio_history_sessions', state.history);
  }, [state.history]);

  // Persist downloaded models
  useEffect(() => {
    saveToStorage('ai_studio_downloaded_models', state.downloadedModels);
  }, [state.downloadedModels]);

  // Auto-sync provider based on model
  useEffect(() => {
    const newProvider = detectProvider(state.selectedModel, state.selectedProvider, state.downloadedModels);
    if (newProvider !== state.selectedProvider) {
      dispatch({ type: 'SET_SELECTED_PROVIDER', payload: newProvider });
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedModel, state.downloadedModels]);
  const actions = {
    setMode: useCallback((mode: StudioMode) => dispatch({ type: 'SET_MODE', payload: mode }), []),
    setPromptTitle: useCallback((title: string) => dispatch({ type: 'SET_PROMPT_TITLE', payload: title }), []),
    setSelectedModel: useCallback((model: string) => dispatch({ type: 'SET_SELECTED_MODEL', payload: model }), []),
    setSelectedProvider: useCallback((provider: ProviderType) => dispatch({ type: 'SET_SELECTED_PROVIDER', payload: provider }), []),
    setParameters: useCallback((params: SetterValue<ParameterConfig>) => dispatch({ type: 'SET_PARAMETERS', payload: params }), []),
    setMessages: useCallback((messages: SetterValue<ChatMessage[]>) => dispatch({ type: 'SET_MESSAGES', payload: messages }), []),
    setHistory: useCallback((history: SetterValue<HistorySession[]>) => dispatch({ type: 'SET_HISTORY', payload: history }), []),
    setDownloadedModels: useCallback((models: SetterValue<DownloadedLocalModel[]>) => dispatch({ type: 'SET_DOWNLOADED_MODELS', payload: models }), []),
    addMessage: useCallback((message: ChatMessage) => dispatch({ type: 'ADD_MESSAGE', payload: message }), []),
    updateMessage: useCallback((id: string, updates: Partial<ChatMessage>) => dispatch({ type: 'UPDATE_MESSAGE', payload: { id, updates } }), []),
    setIsGenerating: useCallback((generating: boolean) => dispatch({ type: 'SET_IS_GENERATING', payload: generating }), []),
    addDownloadedModel: useCallback((model: DownloadedLocalModel) => dispatch({ type: 'ADD_DOWNLOADED_MODEL', payload: model }), []),
    removeDownloadedModel: useCallback((modelId: string) => dispatch({ type: 'REMOVE_DOWNLOADED_MODEL', payload: modelId }), []),
    addToHistory: useCallback((item: HistorySession) => dispatch({ type: 'ADD_HISTORY_ITEM', payload: item }), []),
    deleteHistoryItem: useCallback((id: string) => dispatch({ type: 'DELETE_HISTORY_ITEM', payload: id }), []),
    clearHistory: useCallback((tabId: string) => dispatch({ type: 'CLEAR_HISTORY', payload: tabId }), []),
    resetSession: useCallback((opts?: { projectPath?: string; sessionId?: string }) => dispatch({ type: 'RESET_SESSION', payload: opts }), []),
  };

  return (
    <ChatStoreContext.Provider value={{ state, dispatch, ...actions }}>
      {children}
    </ChatStoreContext.Provider>
  );
}

export function useChatStore() {
  const context = useContext(ChatStoreContext);
  if (!context) {
    throw new Error('useChatStore must be used within a ChatStoreProvider');
  }
  return context;
}

export function useChatState() {
  const { state } = useChatStore();
  return state;
}

export function useChatActions() {
  const actions = useChatStore();
  return actions;
}