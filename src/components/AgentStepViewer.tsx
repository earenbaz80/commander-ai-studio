import React, { useState } from 'react';
import { AgentStep } from '../types/studio';
import { 
  Brain, 
  Terminal, 
  Globe, 
  FileCode, 
  ChevronDown, 
  ChevronUp, 
  Clock, 
  Sparkles, 
  Copy, 
  Check, 
  Cpu
} from 'lucide-react';
import { Language } from '../i18n/translations';

interface AgentStepViewerProps {
  steps?: AgentStep[];
  environmentId?: string;
  lang?: Language;
}

export const AgentStepViewer: React.FC<AgentStepViewerProps> = ({
  steps = [],
  environmentId,
  lang = 'es',
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [openStepIds, setOpenStepIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!steps || steps.length === 0) return null;

  const toggleStep = (id: string) => {
    setOpenStepIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStepIcon = (step: AgentStep) => {
    if (step.type === 'thought') return <Brain className="w-3.5 h-3.5 text-[#ffff55]" />;
    if (step.toolName === 'google_search' || step.toolName === 'url_context') {
      return <Globe className="w-3.5 h-3.5 text-[#00ffff]" />;
    }
    if (step.toolName === 'code_execution') {
      return <Terminal className="w-3.5 h-3.5 text-[#55ff55]" />;
    }
    if (step.type === 'file_created') {
      return <FileCode className="w-3.5 h-3.5 text-[#ff88ff]" />;
    }
    return <Cpu className="w-3.5 h-3.5 text-[#00ffff]" />;
  };

  return (
    <div className="my-2 border-2 border-[#00ffff] bg-[#000055] font-mono text-xs select-none shadow-[2px_2px_0px_#000000]">
      {/* Header Banner */}
      <div 
        onClick={() => setIsExpanded((prev) => !prev)}
        className="bg-[#0000aa] border-b border-[#00ffff] px-2.5 py-1.5 flex items-center justify-between cursor-pointer hover:bg-[#000088] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#ffff55] animate-pulse" />
          <span className="font-bold text-[#ffff55] text-[11px] tracking-wide">
            {lang === 'es' ? '⚡ PROOF OF WORK — PASOS DEL AGENTE ANTIGRAVITY' : lang === 'de' ? '⚡ NACHWEIS DER ARBEIT — ANTIGRAVITY-AGENTENSCHRITTE' : '⚡ PROOF OF WORK — ANTIGRAVITY AGENT STEPS'}
          </span>
          <span className="bg-[#004400] text-[#55ff55] px-1.5 py-0.5 text-[9px] font-bold border border-[#55ff55]">
            {steps.length} {lang === 'es' ? 'ACCIONES' : lang === 'de' ? 'SCHRITTE' : 'STEPS'}
          </span>
          {environmentId && (
            <span className="hidden sm:inline-block bg-[#000080] text-[#00ffff] px-1.5 py-0.5 text-[9px] border border-[#00aaaa]">
              ENV: {environmentId.substring(0, 10)}...
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const allOpen: Record<string, boolean> = {};
              steps.forEach((s) => (allOpen[s.id] = true));
              setOpenStepIds(allOpen);
              setIsExpanded(true);
            }}
            className="text-[9px] text-[#00ffff] hover:text-white underline hidden sm:inline"
          >
            {lang === 'es' ? 'Expandir Todo' : lang === 'de' ? 'Alle aufklappen' : 'Expand All'}
          </button>
          {isExpanded ? <ChevronUp className="w-4 h-4 text-[#00ffff]" /> : <ChevronDown className="w-4 h-4 text-[#00ffff]" />}
        </div>
      </div>

      {/* Steps List */}
      {isExpanded && (
        <div className="p-2 space-y-1.5 bg-[#000033]">
          {steps.map((step, idx) => {
            const isOpen = openStepIds[step.id] ?? true;

            return (
              <div
                key={step.id || idx}
                className="border border-[#00aaaa] bg-[#000080] overflow-hidden"
              >
                {/* Step Item Header */}
                <div
                  onClick={() => toggleStep(step.id)}
                  className="px-2 py-1 bg-[#0000aa] flex items-center justify-between cursor-pointer hover:bg-[#000066] border-b border-black"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[#a8c7fa] text-[10px] font-bold shrink-0">#{idx + 1}</span>
                    {getStepIcon(step)}
                    <span className="font-bold text-[#ffffff] text-[11px] truncate">
                      {step.title || (step.type === 'thought' ? 'Razonamiento y Planificación' : `Llamada a ${step.toolName || 'Herramienta'}`)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {step.latencyMs !== undefined && (
                      <span className="text-[#ffff55] text-[9px] flex items-center gap-0.5">
                        <Clock className="w-3 h-3" />
                        <span>{step.latencyMs}ms</span>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(step.id, step.content);
                      }}
                      className="text-[#00ffff] hover:text-white p-0.5"
                      title="Copiar contenido del paso"
                    >
                      {copiedId === step.id ? <Check className="w-3 h-3 text-[#55ff55]" /> : <Copy className="w-3 h-3" />}
                    </button>
                    {isOpen ? <ChevronUp className="w-3 h-3 text-[#00ffff]" /> : <ChevronDown className="w-3 h-3 text-[#00ffff]" />}
                  </div>
                </div>

                {/* Step Item Content */}
                {isOpen && (
                  <div className="p-2 bg-[#000055] text-[11px] leading-relaxed text-[#00ffff] border-t border-[#0000aa] whitespace-pre-wrap font-mono break-all max-h-60 overflow-y-auto">
                    {step.content}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
