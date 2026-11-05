import React, { useEffect } from 'react';

/**
 * Hook que registra los atajos de teclado globales de la aplicación.
 *
 * Se extrajo de App.tsx para reducir el tamaño del componente principal.
 * Toda la lógica de atajos (Ctrl+/ , Ctrl+B, Ctrl+S, etc.) vive aquí;
 * App.tsx solo pasa los setters/handlers que necesita.
 */

export interface KeyboardShortcutsOptions {
  lang: string;
  promptTitle: string;
  parameters: any;
  tabs: {
    newTab: () => void;
    closeTab: (id: string) => void;
    tabs: { length: number };
    activeId: string;
  };
  setIsShortcutsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsPreferencesModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsWorkbenchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsCompilerModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSymbolSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleNewChat: () => void;
  handleSaveVersion: (title: string, note?: string) => void | Promise<void>;
  handleGeneralAudit: () => void;
  sendBrowserNotification: (title: string, body: string) => void;
}

export function useKeyboardShortcuts(opts: KeyboardShortcutsOptions): void {
  const {
    lang,
    promptTitle,
    parameters,
    tabs,
    setIsShortcutsModalOpen,
    setIsPreferencesModalOpen,
    setIsSidebarOpen,
    setIsWorkbenchOpen,
    setIsCompilerModalOpen,
    setIsSymbolSearchOpen,
    setIsPaletteOpen,
    handleNewChat,
    handleSaveVersion,
    handleGeneralAudit,
    sendBrowserNotification,
  } = opts;

  useEffect(() => {
    const isTypingTarget = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable ||
        !!el.closest('.cm-editor')
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isMetaOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // 1. Ctrl+/ or Cmd+/ to toggle shortcuts modal
      if (isMetaOrCtrl && e.key === '/') {
        e.preventDefault();
        setIsShortcutsModalOpen((prev) => !prev);
      }

      // 1b. Ctrl+, or Cmd+, abre la única ventana de configuración.
      if (isMetaOrCtrl && e.key === ',' && !e.shiftKey && !e.altKey) {
        if (!isTypingTarget()) {
          e.preventDefault();
          setIsPreferencesModalOpen(true);
        }
      }

      // 2. Ctrl+B or Cmd+B to toggle sidebar
      if (isMetaOrCtrl && e.key.toLowerCase() === 'b') {
        if (!isTypingTarget()) {
          e.preventDefault();
          setIsSidebarOpen((prev) => !prev);
        }
      }

      // 3. Ctrl+Alt+N or Cmd+Alt+N to trigger a new prompt / reset session
      if (isMetaOrCtrl && e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleNewChat();
        sendBrowserNotification(
          lang === 'es' ? '🆕 Nuevo Proyecto' : lang === 'de' ? '🆕 Neues Projekt' : '🆕 New Project',
          lang === 'es' ? 'Se ha iniciado una nueva sesión de prompt.' : lang === 'de' ? 'Eine neue Prompt-Sitzung wurde gestartet.' : 'A new prompt session has been initialized.'
        );
      }

      // 3b. Ctrl+Alt+B or Cmd+Alt+B to toggle the Workbench panel
      if (isMetaOrCtrl && e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsWorkbenchOpen((prev) => !prev);
      }

      // 4. Ctrl+S or Cmd+S to save a version
      if (isMetaOrCtrl && e.key.toLowerCase() === 's') {
        if (!isTypingTarget()) {
          e.preventDefault();
          const note = prompt(
            lang === 'es'
              ? 'Ingresa una etiqueta o nota descriptiva para esta versión:'
              : lang === 'de' ? 'Gib eine beschreibende Markierung oder Notiz für diese Version ein:' : 'Enter a descriptive tag or note for this version:',
            lang === 'es' ? 'Guardado por atajo rápido' : lang === 'de' ? 'Per Tastenkürzel gespeichert' : 'Saved via shortcut'
          );
          if (note !== null) {
            handleSaveVersion(note || (lang === 'es' ? 'Atajo Rápido' : lang === 'de' ? 'Tastenkürzel' : 'Shortcut'), lang === 'es' ? 'Autoguardado por teclado' : lang === 'de' ? 'Automatisch speichern (Tastatur)' : 'Keyboard auto-save');
          }
        }
      }

      // 5. Ctrl+Alt+C or Cmd+Alt+C to open native compiler modal
      if (isMetaOrCtrl && e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setIsCompilerModalOpen(true);
      }

      // 6. Ctrl+T or Cmd+T to open a new tab
      if (isMetaOrCtrl && !e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        tabs.newTab();
      }

      // 7. Ctrl+W or Cmd+W to close the active tab
      if (isMetaOrCtrl && !e.altKey && e.key.toLowerCase() === 'w' && tabs.tabs.length > 1) {
        e.preventDefault();
        tabs.closeTab(tabs.activeId);
      }

      // 8. Ctrl+Shift+G or Cmd+Shift+G to run the general audit
      if (isMetaOrCtrl && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        handleGeneralAudit();
      }

      // 9. Ctrl+P or Cmd+P → ir a símbolo del workspace (LSP workspace/symbol)
      if (isMetaOrCtrl && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsSymbolSearchOpen(true);
      }

      // 10. Ctrl+Shift+P or Cmd+Shift+P → paleta de comandos (como VS Code)
      if (isMetaOrCtrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsPaletteOpen(true);
      }

      // 11. Ctrl+` or Cmd+` → Workbench abierto en la terminal
      // El panel decide su propia pestaña, así que se le avisa por evento.
      if (isMetaOrCtrl && !e.altKey && !e.shiftKey && e.key === '`') {
        e.preventDefault();
        setIsWorkbenchOpen(true);
        window.dispatchEvent(
          new CustomEvent('commander:open-workbench-tab', { detail: { tab: 'terminal' } })
        );
      }

      // 12. Ctrl+Alt+M or Cmd+Alt+M → plegar/desplegar la barra de contexto.
      // La barra escucha el evento: así el atajo funciona aunque el chat no
      // tenga el foco y el estado sigue viviendo en su componente.
      if (isMetaOrCtrl && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        window.dispatchEvent(new Event('commander:toggle-context-meter'));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lang, promptTitle, parameters, tabs, setIsShortcutsModalOpen, setIsPreferencesModalOpen, setIsSidebarOpen, setIsWorkbenchOpen, setIsCompilerModalOpen, setIsSymbolSearchOpen, setIsPaletteOpen, handleNewChat, handleSaveVersion, handleGeneralAudit, sendBrowserNotification]);
}