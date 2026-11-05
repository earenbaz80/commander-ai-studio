import React from 'react';
import { X, Keyboard, Sidebar, Save, Plus, Hammer, HelpCircle, Search, PanelRight, SlidersHorizontal, Layers, Activity, Send, ShieldCheck, TerminalSquare } from 'lucide-react';
import { Language } from '../i18n/translations';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: Language;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
  lang = 'es',
}) => {
  if (!isOpen) return null;

  const shortcuts = [
    {
      keys: ['Ctrl', '/'],
      cmdKeys: ['⌘', '/'],
      action: lang === 'es' ? 'Mostrar / ocultar este menú de atajos' : lang === 'de' ? 'Dieses Tastenkürzel-Menü umschalten' : 'Toggle this keyboard shortcuts menu',
      icon: <Keyboard className="w-4 h-4 text-[var(--nc-text)]" />,
    },
    {
      keys: ['Ctrl', 'K'],
      cmdKeys: ['⌘', 'K'],
      action: lang === 'es' ? 'Abrir la Paleta de Comandos' : lang === 'de' ? 'Befehlspalette öffnen' : 'Open the Command Palette',
      icon: <Search className="w-4 h-4 text-[var(--nc-text-accent)]" />,
    },
    {
      keys: ['Ctrl', 'Shift', 'P'],
      cmdKeys: ['⌘', '⇧', 'P'],
      action: lang === 'es' ? 'Abrir la Paleta de Comandos (atajo alternativo)' : lang === 'de' ? 'Befehlspalette öffnen (Alternativtasten)' : 'Open the Command Palette (alternate binding)',
      icon: <Search className="w-4 h-4 text-[var(--nc-text-accent)]" />,
    },
    {
      keys: ['Ctrl', 'P'],
      cmdKeys: ['⌘', 'P'],
      action: lang === 'es' ? 'Ir a símbolo del workspace (LSP)' : lang === 'de' ? 'Zu Symbol im Workspace springen (LSP)' : 'Go to symbol in workspace (LSP)',
      icon: <Layers className="w-4 h-4 text-[#7dff9e]" />,
    },
    {
      keys: ['Ctrl', 'B'],
      cmdKeys: ['⌘', 'B'],
      action: lang === 'es' ? 'Mostrar / ocultar barra lateral' : lang === 'de' ? 'Seitenleiste umschalten' : 'Toggle Sidebar panel',
      icon: <Sidebar className="w-4 h-4 text-[var(--nc-text-accent)]" />,
    },
    {
      keys: ['Ctrl', 'Alt', 'B'],
      cmdKeys: ['⌘', '⌥', 'B'],
      action: lang === 'es' ? 'Mostrar / ocultar el Workbench' : lang === 'de' ? 'Workbench-Panel umschalten' : 'Toggle the Workbench panel',
      icon: <PanelRight className="w-4 h-4 text-[var(--nc-text)]" />,
    },
    {
      keys: ['Ctrl', 'Alt', 'M'],
      cmdKeys: ['⌘', '⌥', 'M'],
      action: lang === 'es' ? 'Mostrar / ocultar la barra de contexto del chat' : lang === 'de' ? 'Kontextleiste des Chats umschalten' : 'Toggle the chat context bar',
      icon: <Activity className="w-4 h-4 text-[var(--nc-text-accent)]" />,
    },
    {
      keys: ['Ctrl', '`'],
      cmdKeys: ['⌘', '`'],
      action: lang === 'es' ? 'Abrir el Workbench en la terminal' : lang === 'de' ? 'Workbench im Terminal öffnen' : 'Open the Workbench on the terminal',
      icon: <TerminalSquare className="w-4 h-4 text-[#7dff9e]" />,
    },
    {
      keys: ['Ctrl', ','],
      cmdKeys: ['⌘', ','],
      action: lang === 'es' ? 'Abrir / cerrar Parámetros (inspector)' : lang === 'de' ? 'Einstellungen umschalten (Inspektor)' : 'Toggle Settings (inspector)',
      icon: <SlidersHorizontal className="w-4 h-4 text-[#ff55ff]" />,
    },
    {
      keys: ['Ctrl', 'Alt', 'N'],
      cmdKeys: ['⌘', '⌥', 'N'],
      action: lang === 'es' ? 'Nuevo chat (nueva sesión)' : lang === 'de' ? 'Neuer Chat (neue Sitzung)' : 'New chat (new session)',
      icon: <Plus className="w-4 h-4 text-green-400" />,
    },
    {
      keys: ['Ctrl', 'S'],
      cmdKeys: ['⌘', 'S'],
      action: lang === 'es' ? 'Guardar versión del prompt actual' : lang === 'de' ? 'Version des aktuellen Prompts speichern' : 'Save Version of current prompt',
      icon: <Save className="w-4 h-4 text-[#ff55ff]" />,
    },
    {
      keys: ['Ctrl', 'Alt', 'C'],
      cmdKeys: ['⌘', '⌥', 'C'],
      action: lang === 'es' ? 'Abrir el Compilador nativo' : lang === 'de' ? 'Nativen Compiler öffnen' : 'Open the Native Compiler',
      icon: <Hammer className="w-4 h-4 text-[var(--nc-text-accent)]" />,
    },
    {
      keys: ['Ctrl', 'T'],
      cmdKeys: ['⌘', 'T'],
      action: lang === 'es' ? 'Nueva pestaña de sesión' : lang === 'de' ? 'Neuer Sitzungs-Tab' : 'New session tab',
      icon: <Layers className="w-4 h-4 text-[var(--nc-text)]" />,
    },
    {
      keys: ['Ctrl', 'W'],
      cmdKeys: ['⌘', 'W'],
      action: lang === 'es' ? 'Cerrar la pestaña activa' : lang === 'de' ? 'Aktiven Tab schließen' : 'Close the active tab',
      icon: <X className="w-4 h-4 text-red-400" />,
    },
    {
      keys: ['Ctrl', 'Shift', 'G'],
      cmdKeys: ['⌘', '⇧', 'G'],
      action: lang === 'es' ? 'Ejecutar auditoría general del proyecto' : lang === 'de' ? 'Allgemeine Projektprüfung ausführen' : 'Run a general project audit',
      icon: <ShieldCheck className="w-4 h-4 text-[var(--nc-success)]" />,
    },
    {
      keys: ['Enter'],
      cmdKeys: ['Enter'],
      action: lang === 'es' ? 'Enviar el mensaje en el chat' : lang === 'de' ? 'Nachricht im Chat senden' : 'Send the message in chat',
      icon: <Send className="w-4 h-4 text-amber-400" />,
    },
    {
      keys: ['Esc'],
      cmdKeys: ['Esc'],
      action: lang === 'es' ? 'Cerrar cualquier ventana flotante' : lang === 'de' ? 'Jedes offene Modalfenster schließen' : 'Close any open modal window',
      icon: <X className="w-4 h-4 text-red-400" />,
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 font-mono select-none">
      <div className="w-full max-w-lg nc-panel border-2 border-[var(--nc-border-light)] p-6 relative shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        
        {/* Border corner accents */}
        <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-[var(--nc-text-accent)] -mt-0.5 -ml-0.5" />
        <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-[var(--nc-text-accent)] -mt-0.5 -mr-0.5" />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-[var(--nc-text-accent)] -mb-0.5 -ml-0.5" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-[var(--nc-text-accent)] -mb-0.5 -mr-0.5" />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b-2 border-[var(--nc-border-light)] pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-[var(--nc-text-accent)] animate-bounce" />
            <span className="text-sm font-bold text-white uppercase tracking-wider">
              {lang === 'es' ? '── ATAJOS DE TECLADO POWER USER ──' : lang === 'de' ? '── TASTENKÜRZEL FÜR POWER-NUTZER ──' : '── POWER USER KEYBOARD SHORTCUTS ──'}
            </span>
          </div>
          <button 
            onClick={onClose} 
            className="text-red-400 hover:text-white border border-red-500 hover:bg-red-600 px-1.5 py-0.5 text-xs font-bold transition-all"
          >
            [X]
          </button>
        </div>

        {/* Modal Info Tip */}
        <div className="bg-[var(--nc-bg-panel)] border border-[var(--nc-border-light)]/40 p-2 text-[10px] text-[var(--nc-text)] mb-4 flex items-start gap-2">
          <HelpCircle className="w-4 h-4 text-[var(--nc-text-accent)] shrink-0" />
          <p className="leading-tight">
            {lang === 'es' 
              ? 'Atajos globales diseñados para maximizar tu productividad. Puedes presionar Ctrl+/ (o Cmd+/) en cualquier momento para invocar o cerrar esta guía de referencia.'
              : lang === 'de' ? 'Globale Tastenkürzel für maximale Produktivität. Drücke jederzeit Strg+/ (bzw. Cmd+/), um diese Übersicht ein- oder auszublenden.' : 'Global keyboard shortcuts designed to maximize your development output. Press Ctrl+/ (or Cmd+/) anytime to show or hide this reference guide.'}
          </p>
        </div>

        {/* Shortcuts List */}
        <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
          {shortcuts.map((shortcut, idx) => (
            <div 
              key={idx} 
              className="flex items-center justify-between p-2 bg-[var(--nc-bg-main)] border border-[var(--nc-border-mid)]/30 hover:border-[var(--nc-text-accent)]/50 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="shrink-0">{shortcut.icon}</span>
                <span className="text-[11px] text-white font-semibold truncate leading-tight">
                  {shortcut.action}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0 pl-3">
                {/* Check platform: If Mac, show Command key, otherwise Ctrl key */}
                {navigator.platform.toUpperCase().indexOf('MAC') >= 0 
                  ? shortcut.cmdKeys.map((key, keyIdx) => (
                      <kbd 
                        key={keyIdx} 
                        className="bg-[var(--nc-bg-panel)] text-[var(--nc-text)] border border-[var(--nc-border-light)] px-1.5 py-0.5 text-[9px] font-bold rounded shadow font-mono"
                      >
                        {key}
                      </kbd>
                    ))
                  : shortcut.keys.map((key, keyIdx) => (
                      <kbd 
                        key={keyIdx} 
                        className="bg-[var(--nc-bg-panel)] text-[var(--nc-text)] border border-[var(--nc-border-light)] px-1.5 py-0.5 text-[9px] font-bold rounded shadow font-mono"
                      >
                        {key}
                      </kbd>
                    ))
                }
              </div>
            </div>
          ))}
        </div>

        {/* Footer info */}
        <div className="text-center mt-5 text-[9px] text-[var(--nc-text-dim)] uppercase font-mono tracking-wider pt-2 border-t border-[var(--nc-border-dark)]">
          {lang === 'es' ? 'COMMANDER AI STUDIO - MODO CONSOLA' : lang === 'de' ? 'COMMANDER AI STUDIO - KONSOLENMODUS' : 'COMMANDER AI STUDIO - CONSOLE MODE'}
        </div>
      </div>
    </div>
  );
};
