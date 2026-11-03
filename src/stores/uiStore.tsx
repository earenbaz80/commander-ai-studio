/**
 * UI Store - Centralized state for UI elements
 * 
 * Manages: modals, sidebars, theme, language, tooltips, workbench, shortcuts, etc.
 */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect, useCallback, ReactNode } from 'react';
import type { Language } from '../i18n/translations';
import type { ChatCodeSnippet } from '../components/ChatLiveAppViewerModal';
import type { NonoStatusEvent } from '../components/FloatingAssistant';

/**
 * Valor o función actualizadora (estilo useState).
 * Permite `setX(v)` y `setX(prev => next)`.
 */
export type SetterValue<T> = T | ((prev: T) => T);

/** Claves de modales booleanos (campos que abre/cierra SET_MODAL). */
export type ModalKey = keyof Omit<UIState, 'liveViewerSnippets' | 'activeSnippetIndex' | 'batteryInfo' | 'projectToast' | 'nonoStatus' | 'isOffline' | 'defaultExportFolder' | 'isWorkbenchOpen' | 'isSidebarOpen' | 'theme' | 'lang' | 'showTooltips' | 'lowResourceMode' | 'powerSaverMode' | 'suggestionConfig'>;

export interface UIState {
  // Modals
  isCodeModalOpen: boolean;
  isLibraryModalOpen: boolean;
  isPreferencesModalOpen: boolean;
  isPaletteOpen: boolean;
  isAuthModalOpen: boolean;
  isGalleryModalOpen: boolean;
  isVersionHistoryModalOpen: boolean;
  isHelpModalOpen: boolean;
  isAboutModalOpen: boolean;
  isCompilerModalOpen: boolean;
  isShortcutsModalOpen: boolean;
  isBooting: boolean;
  isLiveViewerOpen: boolean;
  
  // Live viewer
  liveViewerSnippets: ChatCodeSnippet[];
  activeSnippetIndex: number;
  
  // Layout
  isWorkbenchOpen: boolean;
  isSidebarOpen: boolean;
  
  // Theme & Appearance
  theme: 'norton' | 'matrix' | 'amber' | 'dos' | 'light' | 'solarized';
  lang: Language;
  showTooltips: boolean;
  
  // Performance modes
  lowResourceMode: boolean;
  powerSaverMode: boolean;
  
  // Battery
  batteryInfo: { level: number; charging: boolean; autoTriggered?: boolean } | null;
  
  // Offline
  isOffline: boolean;
  
  // Export folder
  defaultExportFolder: string;
  
  // Toast notifications
  projectToast: { kind: 'ok' | 'err'; text: string } | null;
  
  // Nono status
  nonoStatus: NonoStatusEvent | null;
  
  // Sugerencias configuración
  suggestionConfig: {
    idleTimeMs?: number;
    maxSuggestions?: number;
    includeModeSpecific?: boolean;
    includeProjectSpecific?: boolean;
    includeTaskSpecific?: boolean;
  };
}

type UIAction =
  | { type: 'SET_MODAL'; payload: { modal: ModalKey; open: SetterValue<boolean> } }
  | { type: 'SET_LIVE_VIEWER'; payload: { snippets?: SetterValue<ChatCodeSnippet[]>; index?: SetterValue<number>; open?: SetterValue<boolean> } }
  | { type: 'TOGGLE_WORKBENCH' }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_THEME'; payload: SetterValue<'norton' | 'matrix' | 'amber' | 'dos' | 'light' | 'solarized'> }
  | { type: 'SET_LANG'; payload: SetterValue<Language> }
  | { type: 'TOGGLE_TOOLTIPS' }
  | { type: 'SET_TOOLTIPS'; payload: SetterValue<boolean> }
  | { type: 'SET_WORKBENCH_OPEN'; payload: SetterValue<boolean> }
  | { type: 'SET_SIDEBAR_OPEN'; payload: SetterValue<boolean> }
  | { type: 'SET_LOW_RESOURCE_MODE'; payload: SetterValue<boolean> }
  | { type: 'SET_POWER_SAVER_MODE'; payload: SetterValue<boolean> }
  | { type: 'SET_BATTERY_INFO'; payload: SetterValue<{ level: number; charging: boolean; autoTriggered?: boolean } | null> }
  | { type: 'SET_OFFLINE'; payload: SetterValue<boolean> }
  | { type: 'SET_EXPORT_FOLDER'; payload: SetterValue<string> }
  | { type: 'SET_PROJECT_TOAST'; payload: SetterValue<{ kind: 'ok' | 'err'; text: string } | null> }
  | { type: 'SET_NONO_STATUS'; payload: SetterValue<NonoStatusEvent | null> }
  | { type: 'HYDRATE'; payload: Partial<UIState> };

const initialState: UIState = {
  // Modals
  isCodeModalOpen: false,
  isLibraryModalOpen: false,
  isPreferencesModalOpen: false,
  isPaletteOpen: false,
  isAuthModalOpen: false,
  isGalleryModalOpen: false,
  isVersionHistoryModalOpen: false,
  isHelpModalOpen: false,
  isAboutModalOpen: false,
  isCompilerModalOpen: false,
  isShortcutsModalOpen: false,
  isBooting: true,
  isLiveViewerOpen: false,
  
  // Live viewer
  liveViewerSnippets: [],
  activeSnippetIndex: 0,
  
  // Layout
  isWorkbenchOpen: false,
  isSidebarOpen: false,
  
  // Theme & Appearance
  theme: 'norton',
  lang: 'es',
  showTooltips: true,
  
  // Performance modes
  lowResourceMode: false,
  powerSaverMode: false,
  
  // Battery
  batteryInfo: null,
  
  // Offline
  isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  
  // Export folder
  defaultExportFolder: 'C:\\CommanderExports',
  
  // Toast
  projectToast: null,
  
  // Nono
  nonoStatus: null,
  
  // Sugerencias configuración
  suggestionConfig: {
    idleTimeMs: 8000,
    maxSuggestions: 3,
    includeModeSpecific: true,
    includeProjectSpecific: true,
    includeTaskSpecific: true,
  },
};

function loadFromStorage(key: string, fallback: any) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Ancho por debajo del cual el sidebar estorba más que ayuda: es el `sm` de
 * Tailwind (640px). En un teléfono se lleva un tercio de la pantalla y deja al
 * área de trabajo sin sitio, así que arranca colapsado; el botón del header
 * (`Alternar Barra Lateral`) y Ctrl+B lo siguen abriendo.
 */
function arrancaSinSidebar(): boolean {
  try {
    return window.matchMedia('(max-width: 639px)').matches;
  } catch {
    return false;
  }
}

function saveToStorage(key: string, value: any) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Failed to save ${key} to localStorage`, e);
  }
}

function applyThemeToDOM(theme: string) {
  const root = document.documentElement;
  const body = document.body;
  const themeClass = theme === 'norton' ? '' : `theme-${theme}`;
  
  // Remove previous theme class
  ['theme-norton', 'theme-matrix', 'theme-amber', 'theme-dos', 'theme-light', 'theme-solarized'].forEach((cls) => {
    root.classList.remove(cls);
    body.classList.remove(cls);
  });
  
  if (themeClass) {
    root.classList.add(themeClass);
    body.classList.add(themeClass);
  }
}

function applyLowResourceMode(enabled: boolean) {
  const root = document.documentElement;
  if (enabled) {
    root.classList.add('low-resource-mode');
  } else {
    root.classList.remove('low-resource-mode');
  }
}

function applyPowerSaverMode(enabled: boolean) {
  const root = document.documentElement;
  if (enabled) {
    root.classList.add('power-saver-mode');
  } else {
    root.classList.remove('power-saver-mode');
  }
}

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SET_MODAL': {
      const key = action.payload.modal;
      const current = state[key];
      const open = typeof action.payload.open === 'function'
        ? (action.payload.open as (prev: boolean) => boolean)(current)
        : (action.payload.open as boolean);
      return { ...state, [key]: open };
    }
    
    case 'SET_LIVE_VIEWER': {
      const snippets = action.payload.snippets !== undefined
        ? (typeof action.payload.snippets === 'function'
            ? (action.payload.snippets as (prev: ChatCodeSnippet[]) => ChatCodeSnippet[])(state.liveViewerSnippets)
            : action.payload.snippets)
        : state.liveViewerSnippets;
      const index = action.payload.index !== undefined
        ? (typeof action.payload.index === 'function'
            ? (action.payload.index as (prev: number) => number)(state.activeSnippetIndex)
            : action.payload.index)
        : state.activeSnippetIndex;
      const isOpen = action.payload.open !== undefined
        ? (typeof action.payload.open === 'function'
            ? (action.payload.open as (prev: boolean) => boolean)(state.isLiveViewerOpen)
            : action.payload.open)
        : state.isLiveViewerOpen;
      return { 
        ...state, 
        isLiveViewerOpen: isOpen,
        liveViewerSnippets: snippets,
        activeSnippetIndex: index,
      };
    }
    
    case 'TOGGLE_WORKBENCH': {
      const newValue = !state.isWorkbenchOpen;
      saveToStorage('ai_studio_workbench_open', newValue);
      return { ...state, isWorkbenchOpen: newValue };
    }
    
    case 'TOGGLE_SIDEBAR': {
      const newValue = !state.isSidebarOpen;
      saveToStorage('ai_studio_sidebar_open', newValue);
      return { ...state, isSidebarOpen: newValue };
    }
    
    case 'SET_THEME': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.theme)
        : action.payload;
      applyThemeToDOM(next);
      saveToStorage('ai_studio_theme', next);
      return { ...state, theme: next };
    }
    
    case 'SET_LANG': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.lang)
        : action.payload;
      saveToStorage('ai_studio_lang', next);
      return { ...state, lang: next };
    }
    
    case 'TOGGLE_TOOLTIPS': {
      const newValue = !state.showTooltips;
      saveToStorage('ai_studio_tooltips', newValue);
      return { ...state, showTooltips: newValue };
    }

    case 'SET_TOOLTIPS': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.showTooltips)
        : action.payload;
      saveToStorage('ai_studio_tooltips', next);
      return { ...state, showTooltips: next };
    }

    case 'SET_WORKBENCH_OPEN': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.isWorkbenchOpen)
        : action.payload;
      saveToStorage('ai_studio_workbench_open', next);
      return { ...state, isWorkbenchOpen: next };
    }

    case 'SET_SIDEBAR_OPEN': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.isSidebarOpen)
        : action.payload;
      saveToStorage('ai_studio_sidebar_open', next);
      return { ...state, isSidebarOpen: next };
    }
    
    case 'SET_LOW_RESOURCE_MODE': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.lowResourceMode)
        : action.payload;
      applyLowResourceMode(next);
      saveToStorage('ai_studio_low_resource', next);
      return { ...state, lowResourceMode: next };
    }
    
    case 'SET_POWER_SAVER_MODE': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.powerSaverMode)
        : action.payload;
      applyPowerSaverMode(next);
      saveToStorage('ai_studio_power_saver', next);
      return { ...state, powerSaverMode: next };
    }
    
    case 'SET_BATTERY_INFO': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.batteryInfo)
        : action.payload;
      return { ...state, batteryInfo: next };
    }
    
    case 'SET_OFFLINE': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.isOffline)
        : action.payload;
      return { ...state, isOffline: next };
    }
    
    case 'SET_EXPORT_FOLDER': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.defaultExportFolder)
        : action.payload;
      saveToStorage('ai_studio_export_folder', next);
      return { ...state, defaultExportFolder: next };
    }
    
    case 'SET_PROJECT_TOAST': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.projectToast)
        : action.payload;
      return { ...state, projectToast: next };
    }
    
    case 'SET_NONO_STATUS': {
      const next = typeof action.payload === 'function'
        ? action.payload(state.nonoStatus)
        : action.payload;
      return { ...state, nonoStatus: next };
    }
    
    case 'HYDRATE': {
      return { ...state, ...action.payload };
    }
    
    default:
      return state;
  }
}

interface UIStoreContextValue {
  state: UIState;
  dispatch: React.Dispatch<UIAction>;
  // Convenience methods
  openModal: (modal: ModalKey) => void;
  closeModal: (modal: ModalKey) => void;
  toggleWorkbench: () => void;
  toggleSidebar: () => void;
  setTheme: (theme: SetterValue<'norton' | 'matrix' | 'amber' | 'dos' | 'light' | 'solarized'>) => void;
  setLang: (lang: SetterValue<Language>) => void;
  toggleTooltips: () => void;
  setShowTooltips: (show: SetterValue<boolean>) => void;
  setLowResourceMode: (enabled: SetterValue<boolean>) => void;
  setPowerSaverMode: (enabled: SetterValue<boolean>) => void;
  openLiveViewer: (snippets?: ChatCodeSnippet[], index?: number) => void;
  closeLiveViewer: () => void;
  showProjectToast: (kind: 'ok' | 'err', text: string) => void;
  hideProjectToast: () => void;
  setNonoStatus: (status: SetterValue<NonoStatusEvent | null>) => void;
  setBooting: (booting: SetterValue<boolean>) => void;
  // Named setters (drop-in replacements for useState in App.tsx)
  setIsCodeModalOpen: (open: SetterValue<boolean>) => void;
  setIsLibraryModalOpen: (open: SetterValue<boolean>) => void;
  setIsPreferencesModalOpen: (open: SetterValue<boolean>) => void;
  setIsPaletteOpen: (open: SetterValue<boolean>) => void;
  setIsAuthModalOpen: (open: SetterValue<boolean>) => void;
  setIsGalleryModalOpen: (open: SetterValue<boolean>) => void;
  setIsVersionHistoryModalOpen: (open: SetterValue<boolean>) => void;
  setIsHelpModalOpen: (open: SetterValue<boolean>) => void;
  setIsAboutModalOpen: (open: SetterValue<boolean>) => void;
  setIsCompilerModalOpen: (open: SetterValue<boolean>) => void;
  setIsShortcutsModalOpen: (open: SetterValue<boolean>) => void;
  setIsWorkbenchOpen: (open: SetterValue<boolean>) => void;
  setIsSidebarOpen: (open: SetterValue<boolean>) => void;
  setIsLiveViewerOpen: (open: SetterValue<boolean>) => void;
  setLiveViewerSnippets: (snippets: SetterValue<ChatCodeSnippet[]>) => void;
  setActiveSnippetIndex: (index: SetterValue<number>) => void;
  setDefaultExportFolder: (folder: SetterValue<string>) => void;
  setBatteryInfo: (info: SetterValue<{ level: number; charging: boolean; autoTriggered?: boolean } | null>) => void;
  setIsOffline: (offline: SetterValue<boolean>) => void;
  setProjectToast: (toast: SetterValue<{ kind: 'ok' | 'err'; text: string } | null>) => void;
}

const UIStoreContext = createContext<UIStoreContextValue | null>(null);

export function UIStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(uiReducer, initialState, (saved) => {
    // Hydrate from localStorage
    const savedTheme = loadFromStorage('ai_studio_theme', 'norton');
    const savedLang = loadFromStorage('ai_studio_lang', 'es');
    const savedTooltips = loadFromStorage('ai_studio_tooltips', true);
    const savedWorkbench = loadFromStorage('ai_studio_workbench_open', false);
    const savedSidebar = loadFromStorage('ai_studio_sidebar_open', !arrancaSinSidebar());
    const savedLowResource = loadFromStorage('ai_studio_low_resource', false);
    const savedPowerSaver = loadFromStorage('ai_studio_power_saver', false);
    const savedExportFolder = loadFromStorage('ai_studio_export_folder', 'C:\\CommanderExports');
    
    // Apply theme and modes to DOM immediately
    applyThemeToDOM(savedTheme);
    applyLowResourceMode(savedLowResource);
    applyPowerSaverMode(savedPowerSaver);
    
    return {
      ...saved,
      theme: savedTheme,
      lang: savedLang,
      showTooltips: savedTooltips,
      isWorkbenchOpen: savedWorkbench,
      isSidebarOpen: savedSidebar,
      lowResourceMode: savedLowResource,
      powerSaverMode: savedPowerSaver,
      defaultExportFolder: savedExportFolder,
      suggestionConfig: saved.suggestionConfig,
    };
  });

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => dispatch({ type: 'SET_OFFLINE', payload: false });
    const handleOffline = () => dispatch({ type: 'SET_OFFLINE', payload: true });
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Battery API listener
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        const updateBattery = () => {
          const levelPct = Math.round(battery.level * 100);
          const isUnplugged = !battery.charging;
          const isLowBattery = levelPct <= 20;
          const shouldAutoEnable = isUnplugged || isLowBattery;
          
          dispatch({ 
            type: 'SET_BATTERY_INFO', 
            payload: { level: levelPct, charging: battery.charging, autoTriggered: shouldAutoEnable } 
          });
          
          // Auto-enable Power Saver mode if battery drops <= 20% or device is unplugged
          if (shouldAutoEnable && !state.powerSaverMode) {
            dispatch({ type: 'SET_POWER_SAVER_MODE', payload: true });
          }
        };
        
        updateBattery();
        battery.addEventListener('levelchange', updateBattery);
        battery.addEventListener('chargingchange', updateBattery);
        
        return () => {
          try {
            battery.removeEventListener('levelchange', updateBattery);
            battery.removeEventListener('chargingchange', updateBattery);
          } catch {}
        };
      }).catch(() => {});
    }
  }, [state.powerSaverMode]);

  // Background polling reduction for power saver
  useEffect(() => {
    const pollingInterval = state.powerSaverMode ? 30000 : 5000;
    const interval = setInterval(() => {
      // Reduced frequency background health / telemetry check
    }, pollingInterval);
    
    return () => clearInterval(interval);
  }, [state.powerSaverMode]);

  // Notification permission on mount
  useEffect(() => {
    import('../utils/browserNotifications').then(({ requestNotificationPermission }) => {
      requestNotificationPermission();
    });
  }, []);

  const actions = {
    openModal: useCallback((modal: ModalKey) => dispatch({ type: 'SET_MODAL', payload: { modal, open: true } }), []),
    closeModal: useCallback((modal: ModalKey) => dispatch({ type: 'SET_MODAL', payload: { modal, open: false } }), []),
    toggleWorkbench: useCallback(() => dispatch({ type: 'TOGGLE_WORKBENCH' }), []),
    toggleSidebar: useCallback(() => dispatch({ type: 'TOGGLE_SIDEBAR' }), []),
    setTheme: useCallback((theme: SetterValue<'norton' | 'matrix' | 'amber' | 'dos' | 'light' | 'solarized'>) => dispatch({ type: 'SET_THEME', payload: theme }), []),
    setLang: useCallback((lang: SetterValue<Language>) => dispatch({ type: 'SET_LANG', payload: lang }), []),
    toggleTooltips: useCallback(() => dispatch({ type: 'TOGGLE_TOOLTIPS' }), []),
    setShowTooltips: useCallback((show: SetterValue<boolean>) => dispatch({ type: 'SET_TOOLTIPS', payload: show }), []),
    setLowResourceMode: useCallback((enabled: SetterValue<boolean>) => dispatch({ type: 'SET_LOW_RESOURCE_MODE', payload: enabled }), []),
    setPowerSaverMode: useCallback((enabled: SetterValue<boolean>) => dispatch({ type: 'SET_POWER_SAVER_MODE', payload: enabled }), []),
    openLiveViewer: useCallback((snippets?: ChatCodeSnippet[], index?: number) => 
      dispatch({ type: 'SET_LIVE_VIEWER', payload: { snippets, index, open: true } }), []),
    closeLiveViewer: useCallback(() => 
      dispatch({ type: 'SET_LIVE_VIEWER', payload: { open: false } }), []),
    showProjectToast: useCallback((kind: 'ok' | 'err', text: string) => 
      dispatch({ type: 'SET_PROJECT_TOAST', payload: { kind, text } }), []),
    hideProjectToast: useCallback(() => 
      dispatch({ type: 'SET_PROJECT_TOAST', payload: null }), []),
    setNonoStatus: useCallback((status: SetterValue<NonoStatusEvent | null>) => 
      dispatch({ type: 'SET_NONO_STATUS', payload: status }), []),
    setBooting: useCallback((booting: SetterValue<boolean>) => 
      dispatch({ type: 'SET_MODAL', payload: { modal: 'isBooting', open: booting } }), []),
    // Named setters (drop-in replacements for useState)
    setIsCodeModalOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_MODAL', payload: { modal: 'isCodeModalOpen', open } }), []),
    setIsLibraryModalOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_MODAL', payload: { modal: 'isLibraryModalOpen', open } }), []),
    setIsPreferencesModalOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_MODAL', payload: { modal: 'isPreferencesModalOpen', open } }), []),
    setIsPaletteOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_MODAL', payload: { modal: 'isPaletteOpen', open } }), []),
    setIsAuthModalOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_MODAL', payload: { modal: 'isAuthModalOpen', open } }), []),
    setIsGalleryModalOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_MODAL', payload: { modal: 'isGalleryModalOpen', open } }), []),
    setIsVersionHistoryModalOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_MODAL', payload: { modal: 'isVersionHistoryModalOpen', open } }), []),
    setIsHelpModalOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_MODAL', payload: { modal: 'isHelpModalOpen', open } }), []),
    setIsAboutModalOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_MODAL', payload: { modal: 'isAboutModalOpen', open } }), []),
    setIsCompilerModalOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_MODAL', payload: { modal: 'isCompilerModalOpen', open } }), []),
    setIsShortcutsModalOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_MODAL', payload: { modal: 'isShortcutsModalOpen', open } }), []),
    setIsWorkbenchOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_WORKBENCH_OPEN', payload: open }), []),
    setIsSidebarOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_SIDEBAR_OPEN', payload: open }), []),
    setIsLiveViewerOpen: useCallback((open: SetterValue<boolean>) => dispatch({ type: 'SET_LIVE_VIEWER', payload: { open } }), []),
    setLiveViewerSnippets: useCallback((snippets: SetterValue<ChatCodeSnippet[]>) => dispatch({ type: 'SET_LIVE_VIEWER', payload: { snippets } }), []),
    setActiveSnippetIndex: useCallback((index: SetterValue<number>) => dispatch({ type: 'SET_LIVE_VIEWER', payload: { index } }), []),
    setDefaultExportFolder: useCallback((folder: SetterValue<string>) => dispatch({ type: 'SET_EXPORT_FOLDER', payload: folder }), []),
    setBatteryInfo: useCallback((info: SetterValue<{ level: number; charging: boolean; autoTriggered?: boolean } | null>) => dispatch({ type: 'SET_BATTERY_INFO', payload: info }), []),
    setIsOffline: useCallback((offline: SetterValue<boolean>) => dispatch({ type: 'SET_OFFLINE', payload: offline }), []),
    setProjectToast: useCallback((toast: SetterValue<{ kind: 'ok' | 'err'; text: string } | null>) => dispatch({ type: 'SET_PROJECT_TOAST', payload: toast }), []),
  };

  return (
    <UIStoreContext.Provider value={{ state, dispatch, ...actions }}>
      {children}
    </UIStoreContext.Provider>
  );
}

export function useUIStore() {
  const context = useContext(UIStoreContext);
  if (!context) {
    throw new Error('useUIStore must be used within a UIStoreProvider');
  }
  return context;
}

export function useUIState() {
  const { state } = useUIStore();
  return state;
}

export function useUIActions() {
  const actions = useUIStore();
  return actions;
}