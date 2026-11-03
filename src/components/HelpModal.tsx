import { deText } from '../i18n/de';
import React, { useMemo, useState } from 'react';
import {
  X,
  BookOpen,
  Terminal,
  Code,
  Cpu,
  HelpCircle,
  Layers,
  Keyboard,
  Bot,
  PanelRight,
  Search,
  FileCode,
  Radio,
  Columns,
  Hammer,
  Smartphone,
  Files,
  Globe,
  MessageSquare,
  FileText,
  Code2,
  BarChart3,
  SlidersHorizontal,
  Sparkles,
  MousePointer2,
  Activity,
  History,
} from 'lucide-react';
import { Language, TRANSLATIONS } from '../i18n/translations';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
}

type HelpTab = 'overview' | 'modes' | 'workbench' | 'hf' | 'export' | 'shortcuts';

/** Una tarjeta del manual: sirve igual para pintar la sección y para buscar. */
interface HelpCard {
  icon: React.ReactNode;
  title: string;
  desc: string;
}

/**
 * Manual de ayuda.
 *
 * El contenido vive en listas (tarjetas, atajos y novedades) en vez de estar
 * escrito dentro del JSX: así una sola barra de búsqueda recorre todo el manual
 * —no sólo la pestaña abierta— y añadir una sección no obliga a tocar el
 * renderizado. Los textos siguen pasando por `L`, que resuelve es/de/en.
 */
export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose, lang }) => {
  const [activeTab, setActiveTab] = useState<HelpTab>('overview');
  const [query, setQuery] = useState('');

  const t = TRANSLATIONS[lang];
  const L = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);

  const tabs: Array<{ id: HelpTab; label: string; icon: React.ElementType }> = [
    { id: 'overview', label: L('1. Visión General', '1. Overview'), icon: BookOpen },
    { id: 'modes', label: L('2. Modos de Trabajo', '2. Playground Modes'), icon: Layers },
    { id: 'workbench', label: L('3. Workbench & Editor', '3. Workbench & Editor'), icon: Terminal },
    { id: 'hf', label: L('4. HuggingFace & WebGPU', '4. HuggingFace & WebGPU'), icon: Cpu },
    { id: 'export', label: L('5. Exportación Nativa', '5. Native Export'), icon: Code },
    { id: 'shortcuts', label: L('6. Atajos de Teclado', '6. Shortcuts'), icon: Keyboard },
  ];

  const modes: HelpCard[] = [
    {
      icon: <MessageSquare className="w-4 h-4" />,
      title: L('Chat multimodal (Build / Plan)', 'Multimodal Chat (Build / Plan)'),
      desc: L(
        'Conversación multi-turno con historial, adjuntos, menciones @ con archivos del proyecto y conmutador Build/Plan/Read-only para alternar entre ejecutar, planificar y sólo leer.',
        'Multi-turn chat with history, attachments, @ mentions backed by project files and a Build/Plan/Read-only switch to alternate between acting, planning and read-only.'
      ),
    },
    {
      icon: <FileText className="w-4 h-4" />,
      title: L('Libre (texto libre)', 'Freeform (free text)'),
      desc: L(
        'Entorno de una sola ejecución para diseñar prompts, plantillas y afinar parámetros, con botón «Mejorar prompt» que reescribe tu texto antes de ejecutarlo.',
        'Single-shot playground to craft prompts, templates and refine parameters, with an “Enhance prompt” button that rewrites your text before running it.'
      ),
    },
    {
      icon: <Code className="w-4 h-4" />,
      title: L('JSON Estructurado', 'Structured JSON'),
      desc: L(
        'Fuerza respuestas en JSON válido alineadas con un esquema personalizado (JSON Schema) y señala los campos que no cumplen.',
        'Enforces valid JSON output aligned to a custom schema (JSON Schema) and flags the fields that do not comply.'
      ),
    },
    {
      icon: <Code2 className="w-4 h-4" />,
      title: L('Commander Composer', 'Commander Composer'),
      desc: L(
        'Agente de código multi-archivo con diffs interactivos y Live Sandbox para probar el resultado antes de aplicarlo.',
        'Multi-file coding agent with interactive diffs and a Live Sandbox to try the result before applying it.'
      ),
    },
    {
      icon: <Columns className="w-4 h-4" />,
      title: L('Comparador de Modelos', 'Model Comparison'),
      desc: L(
        'Ejecuta el mismo prompt en varios modelos a la vez y compara precisión, latencia y formato lado a lado.',
        'Run the same prompt across multiple models and compare accuracy, latency and format side by side.'
      ),
    },
    {
      icon: <Bot className="w-4 h-4" />,
      title: L('Agente autónomo', 'Autonomous Agent'),
      desc: L(
        'Agente con herramientas de sistema de archivos (fs.read / fs.write / fs.edit) y shell para trabajar sobre el proyecto real. Los comandos largos corren en segundo plano y su log se sigue en vivo.',
        'Agent with filesystem tools (fs.read / fs.write / fs.edit) and shell access to work on the real project. Long commands run in the background and their log is streamed live.'
      ),
    },
    {
      icon: <Radio className="w-4 h-4" />,
      title: L('Voz en vivo (Gemini Live)', 'Live Voice (Gemini Live)'),
      desc: L(
        'Streaming de audio bidireccional con micrófono y síntesis de voz en tiempo real.',
        'Bidirectional audio streaming with microphone and real-time speech synthesis.'
      ),
    },
    {
      icon: <Cpu className="w-4 h-4" />,
      title: L('Modelos locales (Hugging Face)', 'Local models (Hugging Face)'),
      desc: L(
        'Descarga y ejecuta modelos ONNX / Transformers.js 100% en el navegador (privado), o usa la Inference API con tu token.',
        'Download and run ONNX / Transformers.js models 100% in the browser (private), or use the Inference API with your token.'
      ),
    },
    {
      icon: <Hammer className="w-4 h-4" />,
      title: L('Compilar / Exportar proyecto', 'Compile / Export project'),
      desc: L(
        'Compila y empaqueta el proyecto para Windows, Android, Linux, macOS, Electron y Tauri.',
        'Compile and package the project for Windows, Android, Linux, macOS, Electron and Tauri.'
      ),
    },
    {
      icon: <BarChart3 className="w-4 h-4" />,
      title: L('Telemetría & Rendimiento', 'Telemetry & Performance'),
      desc: L(
        'Métricas de latencia, conteo de tokens y tasa de errores por modelo.',
        'Latency metrics, token counts and error rates per model.'
      ),
    },
  ];

  const workbenchCards: HelpCard[] = [
    {
      icon: <Files className="w-4 h-4" />,
      title: L('Archivos', 'Files'),
      desc: L(
        'Árbol del proyecto activo con previsualización de sólo lectura. Sin proyecto abierto muestra un aviso en lugar de un panel vacío.',
        'Tree of the active project with read-only preview. With no project open it shows a notice instead of an empty panel.'
      ),
    },
    {
      icon: <FileCode className="w-4 h-4" />,
      title: L('Editor de texto', 'Text Editor'),
      desc: L(
        'Editor integrado que abre y guarda archivos reales (fs.read / fs.write). Funciona sin proyecto como bloc de notas: «Abrir local» carga un archivo de tu disco y «Guardar local» lo descarga. «Guardar como» (Ctrl+Shift+S) crea un archivo nuevo y recuerda el último abierto. Ctrl+S guarda y Tab inserta 2 espacios.',
        'Integrated editor that opens and saves real files (fs.read / fs.write). It also works without a project as a scratchpad: “Open local” loads a file from disk and “Save local” downloads it. “Save as” (Ctrl+Shift+S) creates a new file and remembers the last one opened. Ctrl+S saves, Tab inserts 2 spaces.'
      ),
    },
    {
      icon: <Layers className="w-4 h-4" />,
      title: L('Pestañas', 'Tabs'),
      desc: L(
        'Sesiones del workspace: crear, renombrar, seleccionar y cerrar, cada una con su proyecto y su historial.',
        'Workspace sessions: create, rename, select and close, each with its own project and history.'
      ),
    },
    {
      icon: <Terminal className="w-4 h-4" />,
      title: L('Terminal', 'Terminal'),
      desc: L(
        'Shell real vía la tool shell.run, con historial (↑/↓) y comandos rápidos. Abre el panel directamente en esta pestaña con Ctrl+`.',
        'Real shell via the shell.run tool, with history (↑/↓) and quick commands. Open the panel straight on this tab with Ctrl+`.'
      ),
    },
    {
      icon: <Globe className="w-4 h-4" />,
      title: L('Navegador', 'Browser'),
      desc: L(
        'Iframe de URLs o vista previa de HTML local del proyecto.',
        'URL iframe or local HTML preview from the project.'
      ),
    },
    {
      icon: <Activity className="w-4 h-4" />,
      title: L('Trabajos en segundo plano', 'Background jobs'),
      desc: L(
        'Cuando un comando se lanza en segundo plano, su paso en el chat muestra un log que se refresca solo (últimas 200 líneas) mientras el resto de la sesión sigue libre.',
        'When a command is launched in the background, its step in the chat shows a log that refreshes itself (last 200 lines) while the rest of the session stays free.'
      ),
    },
    {
      icon: <MousePointer2 className="w-4 h-4" />,
      title: L('Paneles a tu medida', 'Panels your size'),
      desc: L(
        'Arrastra el borde del Workbench o de Nono para cambiar su ancho; doble clic en el asa lo devuelve al valor por defecto. El ancho se recuerda entre sesiones.',
        'Drag the Workbench or Nono edge to change its width; double-click the handle to reset it. The width is remembered across sessions.'
      ),
    },
    {
      icon: <History className="w-4 h-4" />,
      title: L('Historial unificado', 'Unified history'),
      desc: L(
        'La barra lateral mezcla las ejecuciones locales con las sesiones guardadas en el servidor: al elegir una del servidor se reanuda tal cual, con su proyecto y sus pasos.',
        'The sidebar mixes local runs with sessions stored on the server: pick a server session and it resumes as-is, with its project and steps.'
      ),
    },
  ];

  const exportCards: HelpCard[] = [
    {
      icon: <Code className="w-4 h-4" />,
      title: L('Exportación ZIP', 'ZIP export'),
      desc: L(
        'Paquete completo del proyecto con manifiestos y configuración de build.',
        'Full project bundle with manifests and build config.'
      ),
    },
    {
      icon: <Smartphone className="w-4 h-4" />,
      title: L('Multiplataforma', 'Cross-platform'),
      desc: L(
        'Windows, macOS, Linux, Android e iOS desde un mismo flujo.',
        'Windows, macOS, Linux, Android and iOS from a single flow.'
      ),
    },
  ];

  const overviewCards: HelpCard[] = [
    {
      icon: <Cpu className="w-4 h-4" />,
      title: L('Multi-modelo', 'Multi-model engine'),
      desc: L(
        'Gemini, OpenRouter, Ollama y modelos locales de Hugging Face. La barra superior de cualquier modo de prueba muestra el modelo activo y abre sus ajustes.',
        'Gemini, OpenRouter, Ollama and local Hugging Face models. The top bar of every test mode shows the active model and opens its settings.'
      ),
    },
    {
      icon: <Radio className="w-4 h-4" />,
      title: L('Multimodal & Voz en vivo', 'Multimodal & Live Voice'),
      desc: L(
        'Adjunta imágenes y audio, cuenta tokens en vivo y usa síntesis/reconocimiento de voz en tiempo real.',
        'Attach images and audio, count live tokens, and use real-time speech synthesis/recognition.'
      ),
    },
    {
      icon: <Bot className="w-4 h-4" />,
      title: L('Nono, tu asistente', 'Nono, your assistant'),
      desc: L(
        'La cabecita robótica flotante saluda, sigue el cursor con la mirada y ofrece preguntas contextuales. Puede acoplarse como panel derecho y arrastrar su ancho.',
        'The floating robot head greets you, follows your cursor with its eyes and offers contextual questions. It can dock as a right panel with a draggable width.'
      ),
    },
    {
      icon: <Search className="w-4 h-4" />,
      title: L('Paleta de comandos (Ctrl+K)', 'Command Palette (Ctrl+K)'),
      desc: L(
        'Accede a cualquier modo, herramienta o vista escribiendo: búsqueda tolerante a acentos con navegación ↑/↓ y Enter. Ctrl+Shift+P la abre igual, como en VS Code.',
        'Reach any mode, tool or view by typing: accent-tolerant search with ↑/↓ navigation and Enter. Ctrl+Shift+P opens it too, as in VS Code.'
      ),
    },
    {
      icon: <Layers className="w-4 h-4" />,
      title: L('Una barra para los seis playgrounds', 'One bar for all six playgrounds'),
      desc: L(
        'Chat, Libre, Estructurado, Composer, Comparar y HF local comparten una barra de pestañas: cambias de pantalla sin volver a la barra lateral y siempre ves el modelo activo.',
        'Chat, Freeform, Structured, Composer, Compare and local HF share one tab bar: switch screens without going back to the sidebar and always see the active model.'
      ),
    },
    {
      icon: <SlidersHorizontal className="w-4 h-4" />,
      title: L('Paneles a tu medida', 'Panels your size'),
      desc: L(
        'Workbench y Nono se redimensionan arrastrando su borde y se recuerdan entre sesiones; doble clic en el asa vuelve al ancho por defecto.',
        'The Workbench and Nono resize by dragging their edge and are remembered across sessions; double-click the handle to return to the default width.'
      ),
    },
  ];

  const whatsNew: string[] = [
    L(
      'Una sola barra para los seis playgrounds, con el modelo activo siempre a la vista.',
      'A single bar for all six playgrounds, with the active model always visible.'
    ),
    L(
      'Workbench y Nono se redimensionan arrastrando el borde y recuerdan su ancho.',
      'The Workbench and Nono resize by dragging their edge and remember their width.'
    ),
    L(
      'Los comandos en segundo plano muestran su log en vivo dentro del paso del chat.',
      'Background commands show their live log inside the chat step.'
    ),
    L(
      'El historial de la barra lateral reúne las ejecuciones locales y las sesiones del servidor, y reanuda estas últimas.',
      'The sidebar history gathers local runs and server sessions, and resumes the latter.'
    ),
    L(
      'Ctrl+Shift+P abre la paleta y Ctrl+` deja el Workbench en la terminal.',
      'Ctrl+Shift+P opens the palette and Ctrl+` parks the Workbench on the terminal.'
    ),
    L(
      'Los paneles sin contenido explican qué falta en vez de quedarse en blanco.',
      'Panels with nothing to show explain what is missing instead of going blank.'
    ),
    L(
      'Menú hamburguesa con Apariencia (tema, idioma, tamaño de texto, tooltips), Ajustes, Cuenta y Ayuda.',
      'Hamburger menu with Appearance (theme, language, text size, tooltips), Settings, Account and Help.'
    ),
  ];

  const shortcuts: Array<{ keys: string; mac: string; action: string }> = [
    { keys: 'Ctrl + K', mac: '⌘ + K', action: L('Abrir la Paleta de Comandos', 'Open the Command Palette') },
    { keys: 'Ctrl + Shift + P', mac: '⌘ + ⇧ + P', action: L('Abrir la Paleta de Comandos (alternativo)', 'Open the Command Palette (alternate)') },
    { keys: 'Ctrl + /', mac: '⌘ + /', action: L('Mostrar / ocultar los atajos', 'Show / hide shortcuts') },
    { keys: 'Ctrl + B', mac: '⌘ + B', action: L('Mostrar / ocultar la barra lateral', 'Toggle the sidebar') },
    { keys: 'Ctrl + Alt + B', mac: '⌘ + ⌥ + B', action: L('Mostrar / ocultar el Workbench', 'Toggle the Workbench') },
    { keys: 'Ctrl + `', mac: '⌘ + `', action: L('Abrir el Workbench en la terminal', 'Open the Workbench on the terminal') },
    { keys: 'Ctrl + ,', mac: '⌘ + ,', action: L('Abrir / cerrar Parámetros (inspector)', 'Toggle Settings (inspector)') },
    { keys: 'Ctrl + Alt + N', mac: '⌘ + ⌥ + N', action: L('Nuevo chat (nueva sesión)', 'New chat (new session)') },
    { keys: 'Ctrl + S', mac: '⌘ + S', action: L('Guardar versión del prompt actual', 'Save the current prompt version') },
    { keys: 'Ctrl + Shift + S', mac: '⌘ + ⇧ + S', action: L('Guardar como archivo nuevo del proyecto (editor)', 'Save as a new project file (editor)') },
    { keys: 'Ctrl + Alt + C', mac: '⌘ + ⌥ + C', action: L('Abrir el Compilador nativo', 'Open the Native Compiler') },
    { keys: 'Ctrl + T', mac: '⌘ + T', action: L('Nueva pestaña de sesión', 'New session tab') },
    { keys: 'Ctrl + P', mac: '⌘ + P', action: L('Ir a símbolo del workspace (LSP)', 'Go to symbol in workspace (LSP)') },
    { keys: 'Ctrl + W', mac: '⌘ + W', action: L('Cerrar la pestaña activa', 'Close the active tab') },
    { keys: 'Ctrl + Shift + G', mac: '⌘ + ⇧ + G', action: L('Ejecutar auditoría general del proyecto', 'Run a general project audit') },
    { keys: 'Alt + M', mac: '⌥ + M', action: L('Alternar modo del chat: Build → Plan → Sólo lectura', 'Cycle chat mode: Build → Plan → Read-only') },
    { keys: 'Enter', mac: 'Enter', action: L('Enviar el mensaje en el chat (Shift+Enter = salto de línea)', 'Send the chat message (Shift+Enter = newline)') },
    { keys: 'Esc', mac: 'Esc', action: L('Cerrar cualquier ventana o menú', 'Close any modal or menu') },
  ];

  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const q = normalize(query.trim());

  // Índice de búsqueda: todo el manual en una lista, con la sección de origen.
  const searchIndex = useMemo(() => {
    const section = (label: string) => label;
    const entries: Array<{ section: string; title: string; desc: string }> = [
      ...overviewCards.map((c) => ({ section: section(L('Visión general', 'Overview')), title: c.title, desc: c.desc })),
      ...modes.map((c) => ({ section: section(L('Modos', 'Modes')), title: c.title, desc: c.desc })),
      ...workbenchCards.map((c) => ({ section: section(L('Workbench', 'Workbench')), title: c.title, desc: c.desc })),
      ...exportCards.map((c) => ({ section: section(L('Exportación', 'Export')), title: c.title, desc: c.desc })),
      ...shortcuts.map((s) => ({
        section: section(L('Atajos', 'Shortcuts')),
        title: s.action,
        desc: `${s.keys} · ${s.mac}`,
      })),
    ];
    if (!q) return entries;
    return entries.filter((e) => normalize(e.title).includes(q) || normalize(e.desc).includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, lang]);

  if (!isOpen) return null;

  const Card: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({
    icon,
    title,
    children,
  }) => (
    <div className="bg-[#0000aa] border border-[#00ffff] p-3 space-y-1">
      <span className="font-bold text-[#ffff55] flex items-center gap-1.5">
        <span className="text-[#00ffff]">{icon}</span>
        {title}
      </span>
      <div className="text-[11px] text-[#00ffff]/90 space-y-0.5">{children}</div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 sm:p-4 font-mono select-none cursor-pointer"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="nc-panel w-full max-w-4xl max-h-[88vh] flex flex-col bg-[#000080] border-2 border-[#00ffff] shadow-[10px_10px_0px_#000055] cursor-default text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="nc-header p-2 flex items-center justify-between border-b-2 border-black gap-2">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-black" />
            <span className="font-bold text-black text-xs sm:text-sm tracking-wider">{t.helpTitle}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-1.5 top-1/2 -translate-y-1/2 text-black/60 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={L('Buscar en el manual…', 'Search the manual…')}
                aria-label={L('Buscar en el manual', 'Search the manual')}
                className="w-40 sm:w-56 bg-white/90 text-black text-[11px] pl-6 pr-1.5 py-0.5 border border-black outline-none placeholder:text-black/40"
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="nc-button !px-2 !py-0.5 text-xs bg-red-600 text-white hover:bg-red-500 font-bold"
              aria-label={L('Cerrar manual', 'Close manual')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className={`bg-[#0000aa] border-b-2 border-[#00ffff] p-1.5 flex flex-wrap gap-1 text-xs ${q ? 'opacity-60' : ''}`}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = !q && activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setQuery('');
                  setActiveTab(tab.id);
                }}
                aria-pressed={isActive}
                className={`px-3 py-1 font-bold text-[11px] flex items-center gap-1.5 border ${
                  isActive
                    ? 'bg-[#ffff55] text-black border-white'
                    : 'bg-[#000080] text-[#00ffff] border-[#00aaaa] hover:bg-[#00aaaa] hover:text-black'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Help Content Area */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4 text-[#00ffff] leading-relaxed">
          {q ? (
            <div className="space-y-2" data-testid="help-search-results">
              <p className="text-[11px] text-[#ffff55] font-bold">
                {searchIndex.length === 0
                  ? L('Sin resultados para esta búsqueda.', 'No results for this search.')
                  : L(
                      `${searchIndex.length} resultado(s) en todo el manual`,
                      `${searchIndex.length} result(s) across the whole manual`
                    )}
              </p>
              {searchIndex.map((entry) => (
                <div key={`${entry.section}-${entry.title}`} className="bg-[#0000aa] border border-[#00ffff] p-2 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase tracking-wider text-black bg-[#00aaaa] px-1">{entry.section}</span>
                    <span className="font-bold text-[#ffff55] text-[11px]">{entry.title}</span>
                  </div>
                  <p className="text-[11px] text-[#00ffff]/90">{entry.desc}</p>
                </div>
              ))}
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <div className="space-y-3">
                  <div className="bg-[#0000aa] border-2 border-[#00ffff] p-3 space-y-2">
                    <h3 className="font-bold text-[#ffff55] text-sm uppercase flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      {L('¿Qué es Commander AI Studio?', 'What is Commander AI Studio?')}
                    </h3>
                    <p>
                      {L(
                        'Commander AI Studio es un entorno profesional de ingeniería de prompts, pruebas multimodales y exportación nativa para Windows, Android, iOS, macOS y Linux. Su interfaz reinterpreta la mítica consola retro Norton Commander (DOS) con una estética azul marino, cian y amarillo.',
                        'Commander AI Studio is an enterprise-grade prompt engineering, multimodal testing, and native code export environment for Windows, Android, iOS, macOS and Linux. Its UI reimagines the legendary Norton Commander DOS console with a navy, cyan and yellow aesthetic.'
                      )}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {overviewCards.map((card) => (
                      <Card key={card.title} icon={card.icon} title={card.title}>
                        <p>{card.desc}</p>
                      </Card>
                    ))}
                  </div>

                  <div className="bg-[#0000aa] border border-[#ffff55] p-3 space-y-1">
                    <span className="font-bold text-[#ffff55] uppercase text-[11px]">
                      {L('Novedades recientes', 'What’s new')}
                    </span>
                    <ul className="text-[11px] space-y-0.5 list-none">
                      {whatsNew.map((item) => (
                        <li key={item} className="flex items-start gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#ffff55]" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {activeTab === 'modes' && (
                <div className="space-y-3">
                  <div className="bg-[#0000aa] border-2 border-[#00ffff] p-3 space-y-1">
                    <h3 className="font-bold text-[#ffff55] text-sm uppercase flex items-center gap-2">
                      <Layers className="w-4 h-4" /> {L('Una barra, seis pantallas', 'One bar, six screens')}
                    </h3>
                    <p className="text-[11px]">
                      {L(
                        'Chat, Libre, Estructurado, Composer, Comparar y HF local se cambian desde la barra superior del área central, sin volver a la barra lateral. A la derecha de esa barra ves el modelo activo y el botón que abre sus ajustes.',
                        'Chat, Freeform, Structured, Composer, Compare and local HF are switched from the top bar of the central area, without going back to the sidebar. On the right of that bar you see the active model and the button that opens its settings.'
                      )}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {modes.map((m) => (
                      <Card key={m.title} icon={m.icon} title={m.title}>
                        <p>{m.desc}</p>
                      </Card>
                    ))}
                  </div>
                  <div className="bg-[#0000aa] border border-[#00ffff] p-3 space-y-1">
                    <span className="font-bold text-[#ffff55] flex items-center gap-1.5">
                      <SlidersHorizontal className="w-4 h-4" /> {L('Conmutador Build / Plan', 'Build / Plan switch')}
                    </span>
                    <p className="text-[11px]">
                      {L(
                        'En la barra inferior del chat puedes alternar entre «Build» (ejecuta y responde directamente), «Plan» (el modelo razona y propone un plan antes de tocar código) y «Sólo lectura». La elección se recuerda entre sesiones y Alt+M la recorre sin ratón.',
                        'In the chat bottom bar you can switch between “Build” (acts and answers directly), “Plan” (the model reasons and proposes a plan before touching code) and “Read-only”. Your choice is remembered across sessions and Alt+M cycles it without the mouse.'
                      )}
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'workbench' && (
                <div className="space-y-3">
                  <div className="bg-[#0000aa] border-2 border-[#00ffff] p-3 space-y-2">
                    <h3 className="font-bold text-[#ffff55] text-sm uppercase flex items-center gap-2">
                      <PanelRight className="w-4 h-4" />
                      {L('Panel Workbench (derecha)', 'Workbench panel (right)')}
                    </h3>
                    <p className="text-[11px]">
                      {L(
                        'Un panel lateral plegable, redimensionable y con el mismo motor que usan los modelos: lo que la IA puede hacer con tus archivos, tú también. Ábrelo con el botón del encabezado, con Ctrl+Alt+B o directamente en la terminal con Ctrl+`.',
                        'A collapsible, resizable side panel powered by the same engine the models use: whatever the AI can do with your files, you can too. Open it from the header button, with Ctrl+Alt+B or straight on the terminal with Ctrl+`.'
                      )}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {workbenchCards.map((card) => (
                      <Card key={card.title} icon={card.icon} title={card.title}>
                        <p>{card.desc}</p>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'hf' && (
                <div className="space-y-3">
                  <div className="bg-[#0000aa] border-2 border-[#00ffff] p-3 space-y-2">
                    <h3 className="font-bold text-[#ffff55] text-sm uppercase flex items-center gap-2">
                      <Cpu className="w-4 h-4" />
                      {L('Modelos locales con WebGPU', 'Local models with WebGPU')}
                    </h3>
                    <p className="text-[11px]">
                      {L(
                        'Busca, descarga y ejecuta modelos de lenguaje (DeepSeek-R1 Distill, Llama 3.2, Qwen 2.5) directamente en el navegador con aceleración WebGPU/WASM, o mediante la Inference API con tu token personal de Hugging Face. 100% privado cuando corre en local.',
                        'Search, download and run language models (DeepSeek-R1 Distill, Llama 3.2, Qwen 2.5) directly in the browser with WebGPU/WASM acceleration, or via the Inference API with your personal Hugging Face token. 100% private when running locally.'
                      )}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Card icon={<Cpu className="w-4 h-4" />} title={L('Descarga en el navegador', 'In-browser download')}>
                      <p>
                        {L(
                          'El modelo se guarda en la caché del navegador: la segunda vez arranca sin red. Los modelos descargados aparecen junto a los de la nube en el selector.',
                          'The model is stored in the browser cache: the second run starts without the network. Downloaded models appear next to the cloud ones in the selector.'
                        )}
                      </p>
                    </Card>
                    <Card icon={<SlidersHorizontal className="w-4 h-4" />} title={L('Cómo se elige el motor', 'How the engine is chosen')}>
                      <p>
                        {L(
                          'La app prueba WebGPU y cae a WASM si el navegador no la expone. El chip del modelo activo en la barra de playgrounds te dice con cuál estás trabajando.',
                          'The app tries WebGPU and falls back to WASM when the browser does not expose it. The active model chip in the playground bar tells you which one you are using.'
                        )}
                      </p>
                    </Card>
                  </div>
                </div>
              )}

              {activeTab === 'export' && (
                <div className="space-y-3">
                  <div className="bg-[#0000aa] border-2 border-[#00ffff] p-3 space-y-2">
                    <h3 className="font-bold text-[#ffff55] text-sm uppercase flex items-center gap-2">
                      <Hammer className="w-4 h-4" />
                      {L('Compilar y exportar', 'Compile & export')}
                    </h3>
                    <p className="text-[11px]">
                      {L(
                        'Desde «Compilar Proyecto» (barra lateral izquierda, grupo Salida) o el Compilador nativo, genera el proyecto listo para empaquetar como ejecutable .exe (Windows), .apk (Android/Kotlin), .app (macOS) o .AppImage (Linux), comprimido en un .ZIP descargable. También puedes usar «Ver Código» para copiar el código de integración.',
                        'From “Compile Project” (left sidebar, Output group) or the Native Compiler, generate the project ready to package as .exe (Windows), .apk (Android/Kotlin), .app (macOS) or .AppImage (Linux), bundled into a downloadable .ZIP. You can also use “View Code” to copy the integration code.'
                      )}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {exportCards.map((card) => (
                      <Card key={card.title} icon={card.icon} title={card.title}>
                        <p>{card.desc}</p>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'shortcuts' && (
                <div className="bg-[#0000aa] border-2 border-[#00ffff] p-3 space-y-2">
                  <h3 className="font-bold text-[#ffff55] text-sm uppercase flex items-center gap-2">
                    <Keyboard className="w-4 h-4" />
                    {L('Atajos de teclado', 'Keyboard shortcuts')}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    {shortcuts.map((s) => (
                      <div
                        key={s.keys}
                        className="bg-[#000080] p-2 border border-[#00ffff] flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{s.action}</span>
                        <kbd className="shrink-0 font-bold text-[#ffff55] bg-[#000055] border border-[#00ffff]/50 px-1.5 py-0.5 text-[10px] rounded-sm whitespace-nowrap">
                          {s.keys}
                        </kbd>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#00ffff]/60 pt-1">
                    {L(
                      'En macOS, sustituye Ctrl por Cmd y Alt por ⌥.',
                      'On macOS, replace Ctrl with Cmd and Alt with ⌥.'
                    )}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-[#00aaaa] p-2 flex items-center justify-between gap-2 border-t-2 border-black">
          <span className="text-[10px] text-black/70 font-bold">
            {q
              ? L('Mostrando resultados de búsqueda', 'Showing search results')
              : L('Sección ' + (tabs.findIndex((tab) => tab.id === activeTab) + 1) + ' de ' + tabs.length, 'Section ' + (tabs.findIndex((tab) => tab.id === activeTab) + 1) + ' of ' + tabs.length)}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="nc-button bg-red-600 text-white hover:bg-red-500 font-bold text-xs px-4 py-1"
          >
            {t.close} [ESC]
          </button>
        </div>
      </div>
    </div>
  );
};

export default HelpModal;
