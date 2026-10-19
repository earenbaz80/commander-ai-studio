/**
 * Vista de pestañas del Workbench: lista las sesiones del workspace
 * (las mismas que la barra de pestañas del header) con acceso rápido
 * para cambiar, cerrar y crear.
 */
import React from 'react';
import { MessageSquare, FileText, Table2, Code2, Bot, Cpu, Copy, Plus, X, Mic, LineChart, Folder } from 'lucide-react';
import { StudioMode } from '../../types/studio';
import type { WorkspaceTab } from '../../hooks/useTabs';

const MODE_ICONS: Record<string, React.ReactNode> = {
  chat: <MessageSquare className="w-3.5 h-3.5" />,
  freeform: <FileText className="w-3.5 h-3.5" />,
  structured: <Table2 className="w-3.5 h-3.5" />,
  composer: <Code2 className="w-3.5 h-3.5" />,
  agent: <Bot className="w-3.5 h-3.5" />,
  huggingface: <Cpu className="w-3.5 h-3.5" />,
  compare: <Copy className="w-3.5 h-3.5" />,
  live_voice: <Mic className="w-3.5 h-3.5" />,
  telemetry: <LineChart className="w-3.5 h-3.5" />,
};

const modeLabel = (mode: StudioMode): string => {
  const labels: Record<string, string> = {
    chat: 'Chat', freeform: 'Freeform', structured: 'Estructurado', composer: 'Composer',
    agent: 'Agente', huggingface: 'Local HF', compare: 'Comparar',
  };
  return labels[mode] || mode;
};

interface TabsViewProps {
  tabs: WorkspaceTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onRename?: (id: string, title: string) => void;
}

export const TabsView: React.FC<TabsViewProps> = ({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  onRename,
}) => {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-2 py-1 border-b border-[#004466] bg-[#00243e] shrink-0">
        <span className="text-[10px] font-mono text-[#00ffff]/70">
          {tabs.length} {tabs.length === 1 ? 'pestaña' : 'pestañas'}
        </span>
        <button
          onClick={onNew}
          className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 bg-[#000080] text-[#00ffff] border border-[#00ffff]/40 rounded hover:bg-[#0000aa]"
          title="Nueva pestaña (Ctrl+T)"
        >
          <Plus className="w-3 h-3" /> Nueva
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-2 px-2 py-1.5 mx-1 mb-0.5 rounded border cursor-pointer ${
                active
                  ? 'bg-[#0000aa] border-[#00ffff]'
                  : 'border-transparent hover:bg-[#000066] hover:border-[#004466]'
              }`}
              onClick={() => onSelect(tab.id)}
            >
              <span className={active ? 'text-[#ffff55]' : 'text-[#00ffff]/70'}>
                {MODE_ICONS[tab.mode] || <MessageSquare className="w-3.5 h-3.5" />}
              </span>
              <div className="flex-1 min-w-0">
                <input
                  value={tab.title}
                  onChange={(e) => onRename?.(tab.id, e.target.value)}
                  className={`w-full bg-transparent text-[11px] font-mono outline-none truncate ${
                    active ? 'text-[#ffff55]' : 'text-[#00ffff]'
                  }`}
                  title={tab.title}
                />
                <div className="flex items-center gap-1.5 text-[9.5px] font-mono text-[#00ffff]/50">
                  <span>{modeLabel(tab.mode)}</span>
                  <span>·</span>
                  <span>{tab.messages.length} msg</span>
                  {tab.projectPath && (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-0.5 truncate" title={tab.projectPath}>
                        <Folder className="w-2.5 h-2.5 shrink-0" />
                        {tab.projectPath.split(/[\\/]/).pop()}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                  className="p-0.5 rounded text-[#00ffff]/40 hover:text-[#ff5555] hover:bg-[#330000] opacity-0 group-hover:opacity-100"
                  title="Cerrar pestaña"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TabsView;
