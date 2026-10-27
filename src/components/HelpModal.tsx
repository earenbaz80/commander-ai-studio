import { deText } from '../i18n/de';
import React, { useState } from 'react';
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
} from 'lucide-react';
import { Language, TRANSLATIONS } from '../i18n/translations';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
}

type HelpTab = 'overview' | 'modes' | 'workbench' | 'hf' | 'export' | 'shortcuts';

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose, lang }) => {
  const [activeTab, setActiveTab] = useState<HelpTab>('overview');

  if (!isOpen) return null;

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

  const modes: Array<{ icon: React.ReactNode; title: string; desc: string }> = [
    {
      icon: <MessageSquare className="w-4 h-4" />,
      title: L('Chat multimodal (Build / Plan)', 'Multimodal Chat (Build / Plan)'),
      desc: L(
        'Conversación multi-turno con historial, adjuntos, tokens en vivo y conmutador Build/Plan para alternar entre ejecutar y planificar.',
        'Multi-turn chat with history, attachments, live tokens and a Build/Plan switch to alternate between acting and planning.'
      ),
    },
    {
      icon: <FileText className="w-4 h-4" />,
      title: L('Freeform (texto libre)', 'Freeform (free text)'),
      desc: L(
        'Entorno de una sola ejecución para diseñar prompts, plantillas y refinado de parámetros.',
        'Single-shot playground to craft prompts, templates and refine parameters.'
      ),
    },
    {
      icon: <Code className="w-4 h-4" />,
      title: L('JSON Estructurado', 'Structured JSON'),
      desc: L(
        'Fuerza respuestas en JSON válido alineadas con un esquema personalizado (JSON Schema).',
        'Enforces valid JSON output aligned to a custom schema (JSON Schema).'
      ),
    },
    {
      icon: <Code2 className="w-4 h-4" />,
      title: L('Commander Composer', 'Commander Composer'),
      desc: L(
        'Agente de código multi-archivo con diffs interactivos y Live Sandbox para probar el resultado.',
        'Multi-file coding agent with interactive diffs and a Live Sandbox to run the result.'
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
        'Agente con herramientas de sistema de archivos (fs.read / fs.write / fs.edit) y shell para trabajar sobre el proyecto real.',
        'Agent with filesystem tools (fs.read / fs.write / fs.edit) and shell access to work on the real project.'
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
        'Descarga y ejecuta modelos ONNX / Transformers.js 100% en el navegador (privado).',
        'Download and run ONNX / Transformers.js models 100% in the browser (private).'
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

  const shortcuts: Array<{ keys: string; mac: string; action: string }> = [
    { keys: 'Ctrl + K', mac: '⌘ + K', action: L('Abrir la Paleta de Comandos', 'Open the Command Palette') },
    { keys: 'Ctrl + /', mac: '⌘ + /', action: L('Mostrar / ocultar los atajos', 'Show / hide shortcuts') },
    { keys: 'Ctrl + B', mac: '⌘ + B', action: L('Mostrar / ocultar la barra lateral', 'Toggle the sidebar') },
    { keys: 'Ctrl + Alt + B', mac: '⌘ + ⌥ + B', action: L('Mostrar / ocultar el Workbench', 'Toggle the Workbench') },
    { keys: 'Ctrl + ,', mac: '⌘ + ,', action: L('Abrir / cerrar Parámetros (inspector)', 'Toggle Settings (inspector)') },
    { keys: 'Ctrl + Alt + N', mac: '⌘ + ⌥ + N', action: L('Nuevo chat (nueva sesión)', 'New chat (new session)') },
    { keys: 'Ctrl + S', mac: '⌘ + S', action: L('Guardar versión del prompt actual', 'Save the current prompt version') },
    { keys: 'Ctrl + Shift + S', mac: '⌘ + ⇧ + S', action: L('Guardar como archivo nuevo del proyecto (editor)', 'Save as a new project file (editor)') },
    { keys: 'Ctrl + Alt + C', mac: '⌘ + ⌥ + C', action: L('Abrir el Compilador nativo', 'Open the Native Compiler') },
    { keys: 'Ctrl + T', mac: '⌘ + T', action: L('Nueva pestaña de sesión', 'New session tab') },
    { keys: 'Ctrl + P', mac: '⌘ + P', action: L('Ir a símbolo del workspace (LSP)', 'Go to symbol in workspace (LSP)') },
    { keys: 'Ctrl + W', mac: '⌘ + W', action: L('Cerrar la pestaña activa', 'Close the active tab') },
    { keys: 'Ctrl + Shift + G', mac: '⌘ + ⇧ + G', action: L('Ejecutar auditoría general del proyecto', 'Run a general project audit') },
    { keys: 'Enter', mac: 'Enter', action: L('Enviar el mensaje en el chat (Shift+Enter = salto de línea)', 'Send the chat message (Shift+Enter = newline)') },
    { keys: 'Esc', mac: 'Esc', action: L('Cerrar cualquier ventana o menú', 'Close any modal or menu') },
  ];

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
        <div className="nc-header p-2 flex items-center justify-between border-b-2 border-black">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-black" />
            <span className="font-bold text-black text-xs sm:text-sm tracking-wider">{t.helpTitle}</span>
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

        {/* Tab Navigation */}
        <div className="bg-[#0000aa] border-b-2 border-[#00ffff] p-1.5 flex flex-wrap gap-1 text-xs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
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
                <Card icon={<Cpu className="w-4 h-4" />} title={L('Multi-modelo', 'Multi-model engine')}>
                  <p>
                    {L(
                      'Gemini, Claude, xAI Grok y modelos locales de Hugging Face. Cambia de modelo desde el selector del chat.',
                      'Gemini, Claude, xAI Grok and local Hugging Face models. Switch models from the chat selector.'
                    )}
                  </p>
                </Card>
                <Card icon={<Radio className="w-4 h-4" />} title={L('Multimodal & Voz en vivo', 'Multimodal & Live Voice')}>
                  <p>
                    {L(
                      'Adjunta imágenes y audio, cuenta tokens en vivo y usa síntesis/reconocimiento de voz en tiempo real.',
                      'Attach images and audio, count live tokens, and use real-time speech synthesis/recognition.'
                    )}
                  </p>
                </Card>
                <Card icon={<Bot className="w-4 h-4" />} title={L('Nono, tu asistente', 'Nono, your assistant')}>
                  <p>
                    {L(
                      'La cabecita robótica flotante saluda, sigue el cursor con la mirada y te ofrece preguntas contextuales según tu usuario. Es la única voz del saludo inicial.',
                      'The floating robot head greets you, follows your cursor with its eyes and offers contextual questions based on your user name. It is the only source of the initial greeting.'
                    )}
                  </p>
                </Card>
                <Card icon={<Search className="w-4 h-4" />} title={L('Paleta de comandos (Ctrl+K)', 'Command Palette (Ctrl+K)')}>
                  <p>
                    {L(
                      'Accede a cualquier modo, herramienta o vista escribiendo: búsqueda tolerante a acentos con navegación ↑/↓ y Enter.',
                      'Reach any mode, tool or view by typing: accent-tolerant search with ↑/↓ navigation and Enter.'
                    )}
                  </p>
                </Card>
              </div>

              <div className="bg-[#0000aa] border border-[#ffff55] p-3 space-y-1">
                <span className="font-bold text-[#ffff55] uppercase text-[11px]">
                  {L('Novedades recientes', 'What’s new')}
                </span>
                <ul className="text-[11px] space-y-0.5 list-none">
                  <li className="flex items-start gap-1.5"><Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#ffff55]" />{L('Menú hamburguesa rediseñado: secciones Apariencia (tema, idioma, tamaño de texto, tooltips), Ajustes, Cuenta y Ayuda.', 'Redesigned hamburger menu: Appearance (theme, language, text size, tooltips), Settings, Account and Help sections.')}</li>
                  <li className="flex items-start gap-1.5"><Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#ffff55]" />{L('Barra lateral agrupada y colapsable (Crear / Agentes / Modelos / Salida / Sistema).', 'Grouped, collapsible sidebar (Create / Agents / Models / Output / System).')}</li>
                  <li className="flex items-start gap-1.5"><Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#ffff55]" />{L('“Compilar Proyecto” y “Librería de Prompts” viven ahora en la barra lateral izquierda.', '“Compile Project” and “Prompt Library” now live in the left sidebar.')}</li>
                  <li className="flex items-start gap-1.5"><Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#ffff55]" />{L('Editor de texto integrado en el Workbench y conmutador Build/Plan en el chat.', 'Integrated text editor in the Workbench and a Build/Plan switch in chat.')}</li>
                  <li className="flex items-start gap-1.5"><Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#ffff55]" />{L('Todos los iconos de la interfaz son vectoriales (SVG) y respetan “reducir movimiento”.', 'All interface icons are vector (SVG) and respect “reduce motion”.')}</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'modes' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {modes.map((m) => (
                <Card key={m.title} icon={m.icon} title={m.title}>
                  <p>{m.desc}</p>
                </Card>
              ))}
              <div className="md:col-span-2 bg-[#0000aa] border border-[#00ffff] p-3 space-y-1">
                <span className="font-bold text-[#ffff55] flex items-center gap-1.5">
                  <SlidersHorizontal className="w-4 h-4" /> {L('Conmutador Build / Plan', 'Build / Plan switch')}
                </span>
                <p className="text-[11px]">
                  {L(
                    'En la barra inferior del chat puedes alternar entre “Build” (ejecuta y responde directamente) y “Plan” (el modelo primero razona y propone un plan antes de tocar código). La elección se recuerda entre sesiones.',
                    'In the chat bottom bar you can switch between “Build” (acts and answers directly) and “Plan” (the model reasons and proposes a plan before touching code). Your choice is remembered across sessions.'
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
                    'Un panel lateral plegable con el mismo motor que usan los modelos: lo que la IA puede hacer con tus archivos, tú también. Ábrelo con el botón del encabezado o con Ctrl+Alt+B.',
                    'A collapsible side panel powered by the same engine the models use: whatever the AI can do with your files, you can too. Open it from the header button or with Ctrl+Alt+B.'
                  )}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Card icon={<Files className="w-4 h-4" />} title={L('Archivos', 'Files')}>
                  <p>{L('Árbol de archivos del proyecto activo con previsualización de solo lectura.', 'File tree of the active project with read-only preview.')}</p>
                </Card>
                <Card icon={<FileCode className="w-4 h-4" />} title={L('Editor de texto', 'Text Editor')}>
                  <p>
                    {L(
                      'Editor integrado que abre y guarda archivos reales (fs.read / fs.write). También funciona sin proyecto como bloc de notas: «Abrir local» carga un archivo de tu disco y «Guardar local» lo descarga (txt, html u otro). «Guardar como» (Ctrl+Shift+S) crea un archivo nuevo dentro del proyecto y recuerda el último archivo abierto entre sesiones. Atajos: Ctrl+S guarda y Tab inserta 2 espacios. Muestra líneas y estado “sin guardar / sincronizado”.',
                      'Integrated editor that opens and saves real files (fs.read / fs.write). It also works without a project as a scratchpad: “Open local” loads a file from disk and “Save local” downloads it (txt, html or other). “Save as” (Ctrl+Shift+S) creates a new file inside the project and remembers the last file opened across sessions. Shortcuts: Ctrl+S saves, Tab inserts 2 spaces. Shows line numbers and an “unsaved / in sync” status.'
                    )}
                  </p>
                </Card>
                <Card icon={<Layers className="w-4 h-4" />} title={L('Pestañas', 'Tabs')}>
                  <p>{L('Sesiones del workspace: crear, renombrar, seleccionar y cerrar.', 'Workspace sessions: create, rename, select and close.')}</p>
                </Card>
                <Card icon={<Terminal className="w-4 h-4" />} title={L('Terminal', 'Terminal')}>
                  <p>{L('Shell real vía la tool shell.run, con historial (↑/↓) y comandos rápidos.', 'Real shell via the shell.run tool, with history (↑/↓) and quick commands.')}</p>
                </Card>
                <Card icon={<Globe className="w-4 h-4" />} title={L('Navegador', 'Browser')}>
                  <p>{L('Iframe de URLs o vista previa de HTML local del proyecto.', 'URL iframe or local HTML preview from the project.')}</p>
                </Card>
                <Card icon={<Globe className="w-4 h-4" />} title={L('Proyecto activo', 'Active project')}>
                  <p>{L('Todas las vistas trabajan sobre el proyecto seleccionado en la barra de pestañas.', 'All views operate on the project selected in the tab bar.')}</p>
                </Card>
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
                    'Desde “Compilar Proyecto” (barra lateral izquierda, grupo Salida) o el Compilador nativo, genera el proyecto listo para empaquetar como ejecutable .exe (Windows), .apk (Android/Kotlin), .app (macOS) o .AppImage (Linux), comprimido en un .ZIP descargable. También puedes usar “Ver Código” para copiar el código de integración.',
                    'From “Compile Project” (left sidebar, Output group) or the Native Compiler, generate the project ready to package as .exe (Windows), .apk (Android/Kotlin), .app (macOS) or .AppImage (Linux), bundled into a downloadable .ZIP. You can also use “View Code” to copy the integration code.'
                  )}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Card icon={<Code className="w-4 h-4" />} title={L('Exportación ZIP', 'ZIP export')}>
                  <p>{L('Paquete completo del proyecto con manifiestos y configuración de build.', 'Full project bundle with manifests and build config.')}</p>
                </Card>
                <Card icon={<Smartphone className="w-4 h-4" />} title={L('Multiplataforma', 'Cross-platform')}>
                  <p>{L('Windows, macOS, Linux, Android e iOS desde un mismo flujo.', 'Windows, macOS, Linux, Android and iOS from a single flow.')}</p>
                </Card>
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
        </div>

        {/* Footer */}
        <div className="bg-[#00aaaa] p-2 flex justify-end border-t-2 border-black">
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
