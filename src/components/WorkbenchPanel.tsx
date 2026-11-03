import type { Language } from '../i18n/translations';
/**
 * Workbench — panel lateral derecho plegable.
 *
 * Un botón del header lo abre/cierra; dentro, un menú permite elegir qué ver:
 *   • Archivos   → árbol del proyecto actual
 *   • Editor     → editor de texto integrado (fs.read / fs.write)
 *   • Pestañas   → sesiones del workspace
 *   • Terminal   → shell real vía la tool `shell.run` (la misma de los modelos)
 *   • Navegador  → iframe de URLs o vista previa de HTML local
 */
import React, { useEffect, useState } from 'react';
import {
  X,
  Files,
  Layers,
  TerminalSquare,
  Globe,
  Code2,
  FileCode,
  History,
  Search,
  AlertCircle,
  Activity,
} from 'lucide-react';
import { FileTreeView } from './panel/FileTreeView';
import { LivePreview, LiveConsole, NetworkMonitor } from './RightPanel';
import { EditorView } from './panel/EditorView';
import { ProviderHealthView } from './panel/ProviderHealthView';
import { TabsView } from './panel/TabsView';
import { TerminalView } from './panel/TerminalView';
import { BrowserView } from './panel/BrowserView';
import { CheckpointsView } from './panel/CheckpointsView';
import { CodeSearchView } from './panel/CodeSearchView';
import { ProblemsView } from './panel/ProblemsView';
import { useLspProblemCounts } from '../utils/lspProblems';
import type { WorkspaceTab } from '../hooks/useTabs';
import { ParameterConfig } from '../types/studio';
import { ResizableSplit } from './ResizableSplit';

// Terminal PTY real (xterm.js) bajo demanda: no pesa en el bundle inicial.
const XTerminal = React.lazy(() =>
  import('./panel/XTerminal').then((m) => ({ default: m.XTerminal }))
);
export type WorkbenchTab =
  | 'files'
  | 'editor'
  | 'tabs'
  | 'terminal'
  | 'browser'
  | 'checkpoints'
  | 'search'
  | 'problems'
  | 'preview'
  | 'providers';

interface WorkbenchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: Language;
  projectPath: string;
  tabs: WorkspaceTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onRenameTab?: (id: string, title: string) => void;
  selectedModel?: string;
  parameters?: ParameterConfig;
}

const TABS: Array<{
  id: WorkbenchTab;
  icon: React.ReactNode;
  label: string;
  labelEn: string;
  labelDe: string;
  tip: string;
  tipEn: string;
  tipDe: string;
}> = [
  {
    id: 'files', icon: <Files className="w-4 h-4" />,
    label: 'Archivos', labelEn: 'Files', labelDe: 'Dateien',
    tip: 'Árbol de archivos del proyecto', tipEn: 'Project file tree', tipDe: 'Dateibaum des Projekts',
  },
  {
    id: 'editor', icon: <FileCode className="w-4 h-4" />,
    label: 'Editor', labelEn: 'Editor', labelDe: 'Editor',
    tip: 'Editor de texto integrado (leer y guardar)', tipEn: 'Integrated text editor (read & save)', tipDe: 'Integrierter Texteditor (lesen & speichern)',
  },
  {
    id: 'tabs', icon: <Layers className="w-4 h-4" />,
    label: 'Pestañas', labelEn: 'Tabs', labelDe: 'Tabs',
    tip: 'Sesiones del workspace', tipEn: 'Workspace sessions', tipDe: 'Workspace-Sitzungen',
  },
  {
    id: 'terminal', icon: <TerminalSquare className="w-4 h-4" />,
    label: 'Terminal', labelEn: 'Terminal', labelDe: 'Terminal',
    tip: 'Terminal integrada (comandos reales)', tipEn: 'Integrated terminal (real commands)', tipDe: 'Integriertes Terminal (echte Befehle)',
  },
  {
    id: 'browser', icon: <Globe className="w-4 h-4" />,
    label: 'Navegador', labelEn: 'Browser', labelDe: 'Browser',
    tip: 'Navegador integrado', tipEn: 'Integrated browser', tipDe: 'Integrierter Browser',
  },
  {
    id: 'checkpoints', icon: <History className="w-4 h-4" />,
    label: 'Checkpoints', labelEn: 'Checkpoints', labelDe: 'Checkpoints',
    tip: 'Puntos de control del workspace (undo)', tipEn: 'Workspace checkpoints (undo)', tipDe: 'Workspace-Checkpoints (Rückgängig)',
  },
  {
    id: 'search', icon: <Search className="w-4 h-4" />,
    label: 'Buscar', labelEn: 'Search', labelDe: 'Suchen',
    tip: 'Buscar en el código del proyecto', tipEn: 'Search project code', tipDe: 'Projektcode durchsuchen',
  },
  {
    id: 'problems', icon: <AlertCircle className="w-4 h-4" />,
    label: 'Problemas', labelEn: 'Problems', labelDe: 'Probleme',
    tip: 'Diagnósticos del language server (errores y avisos)', tipEn: 'Language server diagnostics (errors & warnings)', tipDe: 'Language-Server-Diagnosen (Fehler & Warnungen)',
  },
  {
    id: 'preview', icon: <Code2 className="w-4 h-4" />,
    label: 'Visor', labelEn: 'Live Viewer', labelDe: 'Live-Ansicht',
    tip: 'Visor en vivo (preview/consola/red)', tipEn: 'Live viewer (preview/console/network)', tipDe: 'Live-Ansicht (Vorschau/Konsole/Netzwerk)',
  },
  {
    id: 'providers', icon: <Activity className="w-4 h-4" />,
    label: 'Proveedores', labelEn: 'Providers', labelDe: 'Anbieter',
    tip: 'Salud y métricas de proveedores', tipEn: 'Provider health & metrics', tipDe: 'Anbieter-Gesundheit & Metriken',
  },
];

export const WorkbenchPanel: React.FC<WorkbenchPanelProps> = ({
  isOpen,
  onClose,
  lang = 'es',
  projectPath,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onRenameTab,
  selectedModel,
  parameters,
}) => {
    const [active, setActive] = useState<WorkbenchTab>('files');
  const [previewTab, setPreviewTab] = useState<'preview' | 'console' | 'network'>('preview');
  // Modo de la terminal: 'pty' (shell persistente real vía WebSocket) o
  // 'simple' (comando por comando vía shell.run, siempre disponible).
  const [terminalMode, setTerminalMode] = useState<'pty' | 'simple'>('pty');
  // Petición "abrir archivo y posicionar cursor" (click en Problemas/editor).
  const [openRequest, setOpenRequest] = useState<{
    path: string;
    line: number;
    character: number;
    nonce: number;
  } | null>(null);
  const problemCounts = useLspProblemCounts();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string; line?: number; character?: number }>).detail;
      if (!detail?.path) return;
      setActive('editor');
      setOpenRequest({
        path: detail.path,
        line: detail.line ?? 0,
        character: detail.character ?? 0,
        nonce: Date.now(),
      });
    };
    window.addEventListener('commander:open-location', handler);
    return () => window.removeEventListener('commander:open-location', handler);
  }, []);

  // Un atajo global puede pedir una pestaña concreta (Ctrl+` → terminal).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: WorkbenchTab }>).detail;
      if (detail?.tab) setActive(detail.tab);
    };
    window.addEventListener('commander:open-workbench-tab', handler);
    return () => window.removeEventListener('commander:open-workbench-tab', handler);
  }, []);

  if (!isOpen) return null;

  

  return (
    <ResizableSplit id="workbench" side="right" lang={lang}>
    <aside
      className="w-full h-full nc-panel border-l-2 border-[var(--nc-border-light)] flex flex-col min-h-0 overflow-hidden z-20 font-mono"
      aria-label={lang === 'es' ? 'Workbench' : lang === 'de' ? 'Workbench' : 'Workbench'}
    >
      {/* Menú de selección: con el panel estrecho las vistas no caben, así que
          la fila se desplaza en horizontal en vez de quedar recortada. */}
      <div className="flex items-center gap-0.5 px-1 py-1 bg-[var(--nc-header-bg)] border-b-2 border-[var(--nc-border-dark)] shrink-0 min-w-0 overflow-x-auto nc-x-scroll">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            title={lang === 'es' ? tab.tip : lang === 'de' ? tab.tipDe : tab.tipEn}
            className={`flex shrink-0 items-center gap-1.5 px-2 py-1 text-[11px] font-bold rounded-sm border whitespace-nowrap transition-colors ${
              active === tab.id
                ? 'bg-[var(--nc-bg-panel)] text-[var(--nc-text)] border-[var(--nc-border-light)]'
                : 'text-black hover:bg-black/10 border-transparent'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{lang === 'es' ? tab.label : lang === 'de' ? tab.labelDe : tab.labelEn}</span>
            {tab.id === 'problems' && problemCounts.total > 0 && (
              <span className="ml-0.5 px-1 rounded-sm bg-[#ff5555] text-black text-[9px] font-bold">
                {problemCounts.total}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={onClose}
          title={lang === 'es' ? 'Cerrar panel' : lang === 'de' ? 'Panel schließen' : 'Close panel'}
          className="ml-auto p-1 text-black hover:text-[var(--nc-danger)] rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Contenido de la vista activa */}
      <div className="flex-1 min-h-0 overflow-hidden">
          {active === 'files' && <FileTreeView projectPath={projectPath} />}
          {active === 'editor' && (
            <EditorView projectPath={projectPath} openRequest={openRequest} lang={lang} />
          )}
          {active === 'tabs' && (
            <TabsView
            tabs={tabs}
            activeId={activeTabId}
            onSelect={onSelectTab}
            onClose={onCloseTab}
            onNew={onNewTab}
            onRename={onRenameTab}
          />
        )}
        {active === 'terminal' && (
          <div className="flex flex-col h-full min-h-0">
            {/* Selector de modo de terminal */}
            <div className="flex items-center gap-1 px-2 pt-1 shrink-0">
              <button
                onClick={() => setTerminalMode('pty')}
                className={'px-1.5 py-0.5 text-[9px] font-bold border rounded ' + (terminalMode === 'pty' ? 'bg-[var(--nc-highlight-bg)] text-black border-[var(--nc-border-light)]' : 'text-[var(--nc-text)] border-[var(--nc-border-dark)] hover:border-[var(--nc-border-light)]')}
                title={lang === 'es' ? 'Shell persistente real (xterm.js + WebSocket)' : lang === 'de' ? 'Echte persistente Shell (xterm.js + WebSocket)' : 'Real persistent shell (xterm.js + WebSocket)'}
              >
                {lang === 'es' ? 'PTY' : 'PTY'}
              </button>
              <button
                onClick={() => setTerminalMode('simple')}
                className={'px-1.5 py-0.5 text-[9px] font-bold border rounded ' + (terminalMode === 'simple' ? 'bg-[var(--nc-highlight-bg)] text-black border-[var(--nc-border-light)]' : 'text-[var(--nc-text)] border-[var(--nc-border-dark)] hover:border-[var(--nc-border-light)]')}
                title={lang === 'es' ? 'Comando por comando (siempre disponible)' : lang === 'de' ? 'Ein Befehl nach dem anderen (immer verfügbar)' : 'One command at a time (always available)'}
              >
                {lang === 'es' ? 'Simple' : lang === 'de' ? 'Einfach' : 'Simple'}
              </button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              {terminalMode === 'pty' ? (
                <React.Suspense fallback={<div className="flex-1 flex items-center justify-center text-[var(--nc-text)] text-[10px] font-mono">{lang === 'es' ? 'CARGANDO TERMINAL...' : lang === 'de' ? 'TERMINAL WIRD GELADEN...' : 'LOADING TERMINAL...'}</div>}>
                  <XTerminal projectPath={projectPath} lang={lang} />
                </React.Suspense>
              ) : (
                <TerminalView projectPath={projectPath} />
              )}
            </div>
          </div>
        )}
        {active === 'browser' && <BrowserView projectPath={projectPath} />}
        {active === 'checkpoints' && <CheckpointsView projectPath={projectPath} />}
        {active === 'search' && <CodeSearchView projectPath={projectPath} />}
        {active === 'problems' && <ProblemsView projectPath={projectPath} lang={lang} />}
        {active === 'preview' && (
          <div className="flex flex-col h-full min-h-0">
            <div className="flex gap-0.5 px-2 py-1 border-b border-[var(--nc-border-light)]/30 bg-[var(--nc-header-bg)]">
              {(['preview','console','network'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setPreviewTab(tab)}
                  className={`px-2 py-0.5 text-[9px] font-bold rounded transition-colors ${previewTab === tab ? 'bg-[var(--nc-highlight-bg)] text-black' : 'bg-[var(--nc-bg-panel)] text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)]'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 p-2 overflow-auto">
              {previewTab === 'preview' && <LivePreview projectPath={projectPath} selectedModel={selectedModel || ''} parameters={parameters as any} />}
              {previewTab === 'console' && <LiveConsole projectPath={projectPath} selectedModel={selectedModel || ''} />}
              {previewTab === 'network' && <NetworkMonitor projectPath={projectPath} />}
            </div>
          </div>
        )}
        {active === 'providers' && <ProviderHealthView lang={lang} />}
      </div>
    </aside>
    </ResizableSplit>
  );
};

export default WorkbenchPanel;
