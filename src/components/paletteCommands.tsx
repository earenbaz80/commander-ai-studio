import type { CommandItem } from './CommandPalette';
import type { StudioMode } from '../types/studio';
import type { Language } from '../i18n/translations';
import { deText } from '../i18n/de';
import {
  MessageSquare,
  FileText,
  Code,
  Code2,
  Columns,
  Bot,
  Radio,
  Cpu,
  BarChart3,
  Plus,
  Library,
  Settings,
  Search,
  Palette,
  Server,
  Puzzle,
  Hammer,
  HelpCircle,
  Info,
  PanelRight,
  PanelLeft,
} from 'lucide-react';

export interface PaletteCommandsOptions {
  lang: Language;
  mode: StudioMode;
  setMode: (mode: StudioMode) => void;
  handleNewChat: () => void;
  setIsGalleryModalOpen: (v: boolean) => void;
  setIsLibraryModalOpen: (v: boolean) => void;
  setIsInspectorOpen: (v: boolean) => void;
  setIsSymbolSearchOpen: (v: boolean) => void;
  setIsPreferencesModalOpen: (v: boolean) => void;
  setIsLocalLlmModalOpen: (v: boolean) => void;
  setIsExtensionsOpen: (v: boolean) => void;
  setIsCompilerModalOpen: (v: boolean) => void;
  setIsHelpModalOpen: (v: boolean) => void;
  setIsAboutModalOpen: (v: boolean) => void;
  setIsWorkbenchOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setIsSidebarOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
}

export function buildPaletteCommands(opts: PaletteCommandsOptions): CommandItem[] {
  const { lang, mode, setMode, handleNewChat } = opts;
  const L = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);
  const activeHint = (m: StudioMode) => (mode === m ? '●' : undefined);
  const ico = 'w-3.5 h-3.5';
  const {
    setIsGalleryModalOpen, setIsLibraryModalOpen, setIsInspectorOpen, setIsSymbolSearchOpen,
    setIsPreferencesModalOpen, setIsLocalLlmModalOpen, setIsExtensionsOpen,
    setIsCompilerModalOpen, setIsHelpModalOpen, setIsAboutModalOpen, setIsWorkbenchOpen, setIsSidebarOpen,
  } = opts;
  const paletteCommands: CommandItem[] = [
    // Modos
    { id: 'mode-chat', label: L('Chat conversacional', 'Conversational chat'), group: L('Modos', 'Modes'), hint: activeHint('chat'), keywords: 'chat conversacion dialog', icon: <MessageSquare className={ico} />, run: () => setMode('chat') },
    { id: 'mode-freeform', label: L('Texto libre', 'Freeform text'), group: L('Modos', 'Modes'), hint: activeHint('freeform'), keywords: 'texto libre freeform completar', icon: <FileText className={ico} />, run: () => setMode('freeform') },
    { id: 'mode-structured', label: L('Estructurado (JSON / Tabla)', 'Structured (JSON / Table)'), group: L('Modos', 'Modes'), hint: activeHint('structured'), keywords: 'json tabla esquema structured', icon: <Code className={ico} />, run: () => setMode('structured') },
    { id: 'mode-composer', label: L('Composer multi-archivo', 'Multi-file Composer'), group: L('Modos', 'Modes'), hint: activeHint('composer'), keywords: 'composer codigo diffs multiarchivo', icon: <Code2 className={ico} />, run: () => setMode('composer') },
    { id: 'mode-compare', label: L('Comparar modelos', 'Compare models'), group: L('Modos', 'Modes'), hint: activeHint('compare'), keywords: 'comparar modelos paralelo', icon: <Columns className={ico} />, run: () => setMode('compare') },
    { id: 'mode-agent', label: L('Agente autónomo', 'Autonomous agent'), group: L('Modos', 'Modes'), hint: activeHint('agent'), keywords: 'agente agent tools autonomo', icon: <Bot className={ico} />, run: () => setMode('agent') },
    { id: 'mode-voice', label: L('Voz en vivo', 'Live voice'), group: L('Modos', 'Modes'), hint: activeHint('live_voice'), keywords: 'voz voice audio live gemini', icon: <Radio className={ico} />, run: () => setMode('live_voice') },
    { id: 'mode-hf', label: L('Modelos locales (Hugging Face)', 'Local models (Hugging Face)'), group: L('Modos', 'Modes'), hint: activeHint('huggingface'), keywords: 'huggingface local onnx modelos', icon: <Cpu className={ico} />, run: () => setMode('huggingface') },
    { id: 'mode-telemetry', label: L('Telemetría y rendimiento', 'Telemetry & performance'), group: L('Modos', 'Modes'), hint: activeHint('telemetry'), keywords: 'telemetria metricas rendimiento tokens', icon: <BarChart3 className={ico} />, run: () => setMode('telemetry') },
    // Herramientas
    { id: 'tool-new-chat', label: L('Nuevo chat', 'New chat'), group: L('Herramientas', 'Tools'), keywords: 'nuevo sesion chat limpiar', icon: <Plus className={ico} />, run: () => handleNewChat() },
    { id: 'tool-gallery', label: L('Galería de proyectos', 'Project gallery'), group: L('Herramientas', 'Tools'), keywords: 'galeria comunidad proyectos', icon: <Library className={ico} />, run: () => setIsGalleryModalOpen(true) },
    { id: 'tool-library', label: L('Librería de prompts', 'Prompt library'), group: L('Herramientas', 'Tools'), keywords: 'libreria plantillas prompts', icon: <Library className={ico} />, run: () => setIsLibraryModalOpen(true) },
    { id: 'tool-config', label: L('Configuración / Parámetros', 'Settings / Parameters'), group: L('Herramientas', 'Tools'), keywords: 'ajustes parametros inspector config', icon: <Settings className={ico} />, run: () => setIsInspectorOpen(true) },
    { id: 'tool-symbol', label: L('Ir a símbolo del workspace', 'Go to symbol in workspace'), group: L('Herramientas', 'Tools'), keywords: 'simbolo symbol workspace buscar navegar lsp ctrl+p', icon: <Search className={ico} />, run: () => setIsSymbolSearchOpen(true) },
    { id: 'tool-preferences', label: L('Preferencias de la aplicación', 'App preferences'), group: L('Herramientas', 'Tools'), keywords: 'preferencias tema idioma energia bateria exportacion ajustes', icon: <Palette className={ico} />, run: () => setIsPreferencesModalOpen(true) },
    { id: 'tool-local-llm', label: L('Configurar LLM local', 'Configure local LLM'), group: L('Herramientas', 'Tools'), keywords: 'llm local ollama servidor huggingface endpoint openai-compatible', icon: <Server className={ico} />, run: () => setIsLocalLlmModalOpen(true) },
    { id: 'tool-extensions', label: lang === 'de' ? 'Erweiterungen (MCP, Skills, Plugins)' : L('Extensiones (MCP, Skills, Plugins)', 'Extensions (MCP, Skills, Plugins)'), group: L('Herramientas', 'Tools'), keywords: 'extensions mcp model context protocol servers servidores skills plugins integraciones importar instalar buscar', icon: <Puzzle className={ico} />, run: () => setIsExtensionsOpen(true) },
    { id: 'tool-compile', label: L('Compilar / Exportar proyecto', 'Compile / Export project'), group: L('Herramientas', 'Tools'), keywords: 'compilar build compilador exportar exe apk electron tauri', icon: <Hammer className={ico} />, run: () => setIsCompilerModalOpen(true) },
    { id: 'tool-help', label: L('Manual de ayuda', 'Help manual'), group: L('Herramientas', 'Tools'), keywords: 'ayuda help manual', icon: <HelpCircle className={ico} />, run: () => setIsHelpModalOpen(true) },
    { id: 'tool-about', label: L('Acerca de', 'About'), group: L('Herramientas', 'Tools'), keywords: 'acerca about info version', icon: <Info className={ico} />, run: () => setIsAboutModalOpen(true) },
    // Vista
    { id: 'view-workbench', label: L('Alternar Workbench', 'Toggle Workbench'), group: L('Vista', 'View'), keywords: 'workbench panel derecho terminal archivos', icon: <PanelRight className={ico} />, run: () => setIsWorkbenchOpen((v) => !v) },
    { id: 'view-sidebar', label: L('Alternar barra lateral', 'Toggle sidebar'), group: L('Vista', 'View'), keywords: 'sidebar barra lateral menu navegacion', icon: <PanelLeft className={ico} />, run: () => setIsSidebarOpen((v) => !v) },
  ];
  return paletteCommands;
}
