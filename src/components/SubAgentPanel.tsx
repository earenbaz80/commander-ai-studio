import type { Language } from '../i18n/translations';
import React, { useState } from 'react';
import {
  Users,
  Activity,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Zap,
  Brain,
  Terminal,
  Plus,
  Settings,
  Trash2,
  Play,
  Pause,
  Square,
  RotateCcw,
  MessageSquare,
  Search,
  ListTodo,
  ChevronDown,
  X,
} from 'lucide-react';

export interface SubAgent {
  id: string;
  name: string;
  role: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'paused';
  progress: number;
  currentTask: string;
  tasksCompleted: number;
  tasksTotal: number;
  startTime: number;
  endTime?: number;
  tokensUsed: number;
  tokensBudget: number;
  currentTool?: string;
  logs: SubAgentLog[];
  color: string;
}

export interface SubAgentLog {
  id: string;
  timestamp: number;
  type: 'info' | 'success' | 'error' | 'warning' | 'tool' | 'thought';
  message: string;
  tool?: string;
  duration?: number;
}

interface SubAgentPanelProps {
  subAgents: SubAgent[];
  onAgentAction: (agentId: string, action: 'pause' | 'resume' | 'stop' | 'restart') => void;
  onCreateAgent: (config: Partial<SubAgent>) => void;
  onDeleteAgent: (agentId: string) => void;
  onViewLogs: (agentId: string) => void;
  isRunning: boolean;
  lang: Language;
}

// SubAgentCard as a separate component to avoid parser issues
const SubAgentCard: React.FC<{
  agent: SubAgent;
  index: number;
  color: string;
  isExpanded: boolean;
  isRunning: boolean;
  onToggleExpand: () => void;
  onAction: (agentId: string, action: 'pause' | 'resume' | 'stop' | 'restart') => void;
  onDelete: () => void;
  onViewLogs: () => void;
  lang: Language;
}> = ({
  agent,
  index,
  color,
  isExpanded,
  isRunning,
  onToggleExpand,
  onAction,
  onDelete,
  onViewLogs,
  lang,
}) => {
  const t = {
    pause: lang === 'es' ? 'Pausar' : lang === 'de' ? 'Pause' : 'Pause',
    resume: lang === 'es' ? 'Reanudar' : lang === 'de' ? 'Fortsetzen' : 'Resume',
    stop: lang === 'es' ? 'Detener' : lang === 'de' ? 'Stopp' : 'Stop',
    restart: lang === 'es' ? 'Reiniciar' : lang === 'de' ? 'Neu starten' : 'Restart',
    delete: lang === 'es' ? 'Eliminar' : lang === 'de' ? 'Löschen' : 'Delete',
    viewLogs: lang === 'es' ? 'Ver Logs' : lang === 'de' ? 'Protokolle anzeigen' : 'View Logs',
    progress: lang === 'es' ? 'Progreso' : lang === 'de' ? 'Fortschritt' : 'Progress',
    tokens: lang === 'es' ? 'Tokens' : lang === 'de' ? 'Token' : 'Tokens',
    logs: lang === 'es' ? 'Logs' : lang === 'de' ? 'Protokolle' : 'Logs',
    currentTask: lang === 'es' ? 'Tarea actual' : lang === 'de' ? 'Aktuelle Aufgabe' : 'Current task',
    tasksCompleted: lang === 'es' ? 'Tareas completadas' : lang === 'de' ? 'Abgeschlossene Aufgaben' : 'Tasks completed',
    tokensUsed: lang === 'es' ? 'Tokens usados' : lang === 'de' ? 'Verwendete Token' : 'Tokens used',
    role: lang === 'es' ? 'Rol' : lang === 'de' ? 'Rolle' : 'Role',
  };

  const statusConfig = {
    running: { color: '#00ffff', label: 'Running', icon: Activity },
    completed: { color: '#88ff88', label: 'Completed', icon: CheckCircle },
    failed: { color: '#ff5555', label: 'Failed', icon: XCircle },
    paused: { color: '#ffff55', label: 'Paused', icon: Pause },
    idle: { color: '#888888', label: 'Idle', icon: Square },
  };

  const status = statusConfig[agent.status] || statusConfig.idle;
  const elapsed = Date.now() - agent.startTime;

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const formatTokens = (used: number, budget: number) => {
    return `${(used / 1000).toFixed(1)}k / ${(budget / 1000).toFixed(1)}k`;
  };

  // Render actions based on status
  const renderActions = () => {
    const status = agent.status;
    
    if (status === 'running') {
      return (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onAction(agent.id, 'pause')}
            className="flex-1 nc-button text-[10px] py-1 flex items-center justify-center gap-1"
            disabled={!isRunning}
          >
            <Pause className="w-3.5 h-3.5" />
            <span>{t.pause}</span>
          </button>
          <button
            type="button"
            onClick={() => onAction(agent.id, 'stop')}
            className="nc-button text-[10px] px-2 py-1 text-red-400 flex items-center justify-center gap-1"
            disabled={!isRunning}
          >
            <Square className="w-3.5 h-3.5" />
            <span>{t.stop}</span>
          </button>
        </div>
      );
    }
    
    if (status === 'paused') {
      return (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onAction(agent.id, 'resume')}
            className="flex-1 nc-button text-[10px] py-1 flex items-center justify-center gap-1 bg-[#00ffff] text-black"
            disabled={!isRunning}
          >
            <Play className="w-3.5 h-3.5" />
            <span>{t.resume}</span>
          </button>
          <button
            type="button"
            onClick={() => onAction(agent.id, 'stop')}
            className="nc-button text-[10px] px-2 py-1 text-red-400 flex items-center justify-center gap-1"
            disabled={!isRunning}
          >
            <Square className="w-3.5 h-3.5" />
            <span>{t.stop}</span>
          </button>
        </div>
      );
    }
    
    if (status === 'idle') {
      return (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onAction(agent.id, 'restart')}
            className="flex-1 nc-button text-[10px] py-1 flex items-center justify-center gap-1 bg-[#00ffff] text-black"
            disabled={!isRunning}
          >
            <Play className="w-3.5 h-3.5" />
            <span>{t.restart}</span>
          </button>
          <button
            type="button"
            onClick={() => onAction(agent.id, 'restart')}
            className="nc-button text-[10px] px-2 py-1"
            disabled={!isRunning}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t.restart}</span>
          </button>
        </div>
      );
    }
    
    // completed, failed
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onAction(agent.id, 'restart')}
          className="flex-1 nc-button text-[10px] py-1 flex items-center justify-center gap-1 bg-[#ffff55] text-black"
          disabled={!isRunning}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{t.restart}</span>
        </button>
        <button
          type="button"
          onClick={() => onAction(agent.id, 'stop')}
          className="nc-button text-[10px] px-2 py-1 text-red-400"
          disabled={!isRunning}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  return (
    <div className={`group relative bg-[#000040] border rounded-lg overflow-hidden transition-all duration-200 ${
      agent.status === 'running' ? 'border-[#00ffff] bg-[#000080]/20' : 
      agent.status === 'failed' ? 'border-[#ff5555] bg-[#ff0000]/10' :
      agent.status === 'completed' ? 'border-[#88ff88] bg-[#008800]/10' :
      agent.status === 'paused' ? 'border-[#ffff55] bg-[#ffff00]/10' :
      'border-[#00ffff]/20 hover:border-[#00ffff]/40'
    }`}>
      {/* Header */}
      <div className="p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div 
            className="w-8 h-8 rounded-full flex items-center justify-center text-black font-bold text-xs"
            style={{ backgroundColor: color }}
          >
            {String.fromCharCode(65 + (agent.id.charCodeAt(0) % 26))}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono text-[#00ffff]/50">#{index + 1}</span>
              <span className="text-xs font-bold text-white truncate">{agent.name}</span>
              <span className="text-[9px] text-white/50 px-1.5 py-0.5 rounded bg-[#000040]">{agent.role}</span>
            </div>
            <div className="flex items-center gap-1 text-[9px] text-white/60">
              <span className="flex items-center gap-0.5">
                <span style={{ color: status.color }}>{statusConfig[agent.status].label}</span>
              </span>
              <span className="text-[#00ffff]/60 font-mono">{agent.tasksCompleted}/{agent.tasksTotal}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleExpand}
            className="p-1 text-[#00ffff]/60 hover:text-[#00ffff] rounded"
            title={isExpanded ? 'Contraer' : 'Expandir'}
            aria-expanded={isExpanded}
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => onViewLogs()}
            className="p-1 text-[#00ffff]/60 hover:text-[#00ffff] rounded"
            title="Ver logs"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {}}
            className="p-1 text-[#ffff55]/60 hover:text-[#ffff55] rounded"
            title="Configurar"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete()}
            className="p-1 text-red-400/60 hover:text-red-400 rounded"
            title="Eliminar"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="px-3 pb-2">
        <div className="flex items-center justify-between text-[9px] mb-1">
          <span className="text-white/60">{Math.round(agent.progress)}%</span>
          <span className="text-[#00ffff]/60 font-mono">{agent.progress}%</span>
        </div>
        <div className="h-1.5 bg-[#000020] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${agent.progress}%`,
              backgroundColor: agent.status === 'failed' ? '#ff5555' : 
                             agent.status === 'completed' ? '#88ff88' : '#00ffff',
            }}
          />
        </div>
      </div>

      {/* Current Task */}
      <div className="px-3 pb-2 border-t border-[#00ffff]/10">
        <div className="flex items-center gap-1 text-[9px] mb-1">
          <Zap className="w-3 h-3 text-[#ffff55]" />
          <span className="text-[#ffff55] font-bold text-[9px]">Current task:</span>
        </div>
        <p className="text-[10px] text-white/80 truncate ml-4">
          {agent.currentTask || 'Waiting for task...'}
        </p>
      </div>

      {/* Stats Row */}
      <div className="px-3 pb-2 flex items-center justify-between text-[9px] text-white/60 border-t border-[#00ffff]/10">
        <div className="flex items-center gap-1">
          <span className="text-[#ffff55]">Tokens:</span>
          <span className="font-mono text-white/80 ml-1">{formatTokens(agent.tokensUsed, agent.tokensBudget)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3" style={{border: '1px solid #ffff55', borderRadius: '50%'}} />
          <span className="font-mono">{formatTime(elapsed)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="px-3 pt-2 pb-3 flex items-center gap-1 border-t border-[#00ffff]/10">
        {renderActions()}
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-[#00ffff]/20 bg-[#000020] p-3 space-y-3 animate-slide-down">
          {/* Current Tool */}
          {agent.currentTool && (
            <div className="flex items-center gap-2 p-2 bg-[#000040] rounded text-[10px]">
              <Terminal className="w-3.5 h-3.5 text-[#00ffff]" />
              <span className="text-white/60">Current tool:</span>
              <span className="font-mono text-[#00ffff] ml-auto">{agent.currentTool}</span>
            </div>
          )}

          {/* Token Usage Bar */}
          <div>
            <div className="flex justify-between text-[9px] mb-1">
              <span className="text-white/60">Tokens:</span>
              <span className="font-mono text-[#00ffff]">{agent.tokensUsed.toLocaleString()} / {agent.tokensBudget.toLocaleString()}</span>
            </div>
            <div className="h-1.5 bg-[#000020] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (agent.tokensUsed / agent.tokensBudget) * 100)}%`,
                  backgroundColor: agent.tokensUsed > agent.tokensBudget * 0.9 ? '#ff5555' : '#00ffff',
                }}
              />
            </div>
          </div>

          {/* Logs Preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-[#ffff55] font-bold">Recent Logs</span>
              <button
                type="button"
                onClick={() => {}}
                className="text-[10px] text-[#00ffff]/60 hover:text-[#00ffff]"
              >
                View all
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto bg-[#000020] rounded p-2 space-y-1 font-mono text-[9px]">
              {agent.logs.slice(-5).map((log) => (
                <div key={log.id} className="flex items-start gap-1 text-white/70">
                  <span className="text-[#00ffff]/60 font-mono">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`text-[9px] ${getLogColor(log.type)}`}>
                    [{log.type.toUpperCase()}]
                  </span>
                  <span className="flex-1 truncate">{log.message}</span>
                  {log.tool && (
                    <span className="text-[#00ffff]/60 font-mono ml-1">[{log.tool}]</span>
                  )}
                  {log.duration && (
                    <span className="text-[#ffff55]/60 font-mono ml-1">{log.duration}ms</span>
                  )}
                </div>
              ))}
              {agent.logs.length > 5 && (
                <p className="text-[9px] text-[#00ffff]/60 text-center mt-1">... and {agent.logs.length - 5} more</p>
              )}
            </div>
          </div>

          {/* Token Budget Alert */}
          {agent.tokensUsed > agent.tokensBudget * 0.8 && (
            <div className="p-2 bg-[#ff5555]/20 border border-[#ff5555]/40 rounded text-[10px]">
              <div className="flex items-center gap-1 text-[#ff5555]">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Token budget at {Math.round((agent.tokensUsed / agent.tokensBudget) * 100)}%</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const SubAgentPanel: React.FC<SubAgentPanelProps> = ({
  subAgents,
  onAgentAction,
  onCreateAgent,
  onDeleteAgent,
  onViewLogs,
  isRunning,
  lang,
}) => {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAgentConfig, setNewAgentConfig] = useState({
    name: '',
    role: 'researcher',
    tokensBudget: 50000,
  });

  const t = {
    subAgents: lang === 'es' ? 'Sub-Agentes' : lang === 'de' ? 'Unteragenten' : 'Sub-Agents',
    createAgent: lang === 'es' ? 'Crear Agente' : lang === 'de' ? 'Agent erstellen' : 'Create Agent',
    name: lang === 'es' ? 'Nombre' : lang === 'de' ? 'Name' : 'Name',
    role: lang === 'es' ? 'Rol' : lang === 'de' ? 'Rolle' : 'Role',
    tokensBudget: lang === 'es' ? 'Presupuesto de Tokens' : lang === 'de' ? 'Token-Budget' : 'Token Budget',
    create: lang === 'es' ? 'Crear' : lang === 'de' ? 'Erstellen' : 'Create',
    cancel: lang === 'es' ? 'Cancelar' : lang === 'de' ? 'Abbrechen' : 'Cancel',
    pause: lang === 'es' ? 'Pausar' : lang === 'de' ? 'Pause' : 'Pause',
    resume: lang === 'es' ? 'Reanudar' : lang === 'de' ? 'Fortsetzen' : 'Resume',
    stop: lang === 'es' ? 'Detener' : lang === 'de' ? 'Stopp' : 'Stop',
    restart: lang === 'es' ? 'Reiniciar' : lang === 'de' ? 'Neu starten' : 'Restart',
    delete: lang === 'es' ? 'Eliminar' : lang === 'de' ? 'Löschen' : 'Delete',
    viewLogs: lang === 'es' ? 'Ver Logs' : lang === 'de' ? 'Protokolle anzeigen' : 'View Logs',
    noAgents: lang === 'es' ? 'No hay sub-agentes activos' : lang === 'de' ? 'Keine aktiven Unteragenten' : 'No active sub-agents',
    addFirst: lang === 'es' ? 'Agregar primer sub-agente' : lang === 'de' ? 'Ersten Unteragenten hinzufügen' : 'Add first sub-agent',
    running: lang === 'es' ? 'Ejecutando' : lang === 'de' ? 'Läuft' : 'Running',
    completed: lang === 'es' ? 'Completado' : lang === 'de' ? 'Abgeschlossen' : 'Completed',
    failed: lang === 'es' ? 'Fallido' : lang === 'de' ? 'Fehlgeschlagen' : 'Failed',
    paused: lang === 'es' ? 'Pausado' : lang === 'de' ? 'Pausiert' : 'Paused',
    idle: lang === 'es' ? 'Inactivo' : lang === 'de' ? 'Inaktiv' : 'Idle',
    progress: lang === 'es' ? 'Progreso' : lang === 'de' ? 'Fortschritt' : 'Progress',
    tokens: lang === 'es' ? 'Tokens' : lang === 'de' ? 'Token' : 'Tokens',
    logs: lang === 'es' ? 'Logs' : lang === 'de' ? 'Protokolle' : 'Logs',
    currentTask: lang === 'es' ? 'Tarea actual' : lang === 'de' ? 'Aktuelle Aufgabe' : 'Current task',
    tasksCompleted: lang === 'es' ? 'Tareas completadas' : lang === 'de' ? 'Abgeschlossene Aufgaben' : 'Tasks completed',
    tokensUsed: lang === 'es' ? 'Tokens usados' : lang === 'de' ? 'Verwendete Token' : 'Tokens used',
    researcher: lang === 'es' ? 'Investigador' : lang === 'de' ? 'Rechercheur' : 'Researcher',
    coder: lang === 'es' ? 'Programador' : lang === 'de' ? 'Programmierer' : 'Coder',
    reviewer: lang === 'es' ? 'Revisor' : lang === 'de' ? 'Prüfer' : 'Reviewer',
    planner: lang === 'es' ? 'Planificador' : lang === 'de' ? 'Planer' : 'Planner',
    custom: lang === 'es' ? 'Personalizado' : lang === 'de' ? 'Benutzerdefiniert' : 'Custom',
  };

  const roles = [
    { value: 'researcher', label: t.researcher, icon: Brain },
    { value: 'coder', label: t.coder, icon: Terminal },
    { value: 'reviewer', label: t.reviewer, icon: Search },
    { value: 'planner', label: t.planner, icon: ListTodo },
    { value: 'custom', label: t.custom, icon: Settings },
  ];

  const agentColors = [
    '#00ffff', '#ff5555', '#ffff55', '#88ff88',
    '#ff88ff', '#55ffff', '#ffaa00', '#aa00ff'
  ];

  const handleCreateAgent = () => {
    if (!newAgentConfig.name.trim()) return;

    onCreateAgent({
      ...newAgentConfig,
      color: agentColors[subAgents.length % agentColors.length],
    });
    setShowCreateModal(false);
    setNewAgentConfig({ name: '', role: 'researcher', tokensBudget: 50000 });
  };

  const handleDelete = (agentId: string) => {
    if (window.confirm('Delete this sub-agent?')) {
      onDeleteAgent(agentId);
    }
  };

  const toggleExpand = (agentId: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#000030] border-l-2 border-[#00ffff]/20 overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b-2 border-[#00ffff]/20 bg-[#000040] shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#ffff55]" />
            <span className="text-[#ffff55] font-bold text-sm">{t.subAgents}</span>
            <span className="text-[#00ffff] text-xs px-2 py-0.5 bg-[#000040] rounded">
              {subAgents.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="nc-button text-xs px-2 py-1 flex items-center gap-1"
            disabled={isRunning}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.createAgent}</span>
          </button>
        </div>

        {/* Stats bar */}
        <div className="flex flex-wrap gap-4 text-[10px]">
          <span className="flex items-center gap-1 text-[#00ffff]/60">
            <Activity className="w-3.5 h-3.5" />
            <span>{subAgents.filter(a => a.status === 'running').length} {t.running}</span>
          </span>
          <span className="flex items-center gap-1 text-[#88ff88]">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>{subAgents.filter(a => a.status === 'completed').length} {t.completed}</span>
          </span>
          <span className="flex items-center gap-1 text-[#ff5555]">
            <XCircle className="w-3.5 h-3.5" />
            <span>{subAgents.filter(a => a.status === 'failed').length} {t.failed}</span>
          </span>
          <span className="flex items-center gap-1 text-[#ffff55]">
            <Pause className="w-3.5 h-3.5" />
            <span>{subAgents.filter(a => a.status === 'paused').length} {t.paused}</span>
          </span>
        </div>
      </div>

      {/* Create Agent Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-[#000040] border-2 border-[#00ffff] rounded-lg p-4 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[#ffff55] font-bold">{t.createAgent}</span>
              <button onClick={() => setShowCreateModal(false)} className="text-[#00ffff]/60 hover:text-[#00ffff]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-[#00ffff]/60 mb-1">{t.name}</label>
                <input
                  type="text"
                  value={newAgentConfig.name}
                  onChange={(e) => setNewAgentConfig({...newAgentConfig, name: e.target.value})}
                  className="w-full bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-1 text-xs font-mono outline-none"
                  placeholder="agent-1"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#00ffff]/60 mb-1">{t.role}</label>
                <select
                  value={newAgentConfig.role}
                  onChange={(e) => setNewAgentConfig({...newAgentConfig, role: e.target.value})}
                  className="w-full bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-1 text-xs font-mono outline-none"
                >
                  {roles.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-[#00ffff]/60 mb-1">{t.tokensBudget}</label>
                <input
                  type="number"
                  value={newAgentConfig.tokensBudget}
                  onChange={(e) => setNewAgentConfig({...newAgentConfig, tokensBudget: parseInt(e.target.value)})}
                  className="w-full bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-1 text-xs font-mono outline-none"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => setShowCreateModal(false)} className="nc-button text-xs px-3 py-1">{t.cancel}</button>
                <button onClick={handleCreateAgent} className="nc-button text-xs px-3 py-1 bg-[#00ffff] text-black">{t.create}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Agents List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {subAgents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-[#00ffff]/50">
            <Users className="w-12 h-12 mb-2 text-[#00ffff]/30" />
            <p className="text-xs">{t.noAgents}</p>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="mt-4 nc-button text-xs px-3 py-1.5 flex items-center gap-1.5"
              disabled={isRunning}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.addFirst}</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {subAgents.map((agent, index) => (
              <SubAgentCard
                key={agent.id}
                agent={agent}
                index={index}
                color={agent.color || ['#00ffff', '#ff5555', '#ffff55', '#88ff88', '#ff88ff', '#55ffff', '#ffaa00', '#aa00ff'][index % 8]}
                isExpanded={expandedAgents.has(agent.id)}
                isRunning={isRunning}
                onToggleExpand={() => toggleExpand(agent.id)}
                onAction={onAgentAction}
                onDelete={() => handleDelete(agent.id)}
                onViewLogs={() => onViewLogs(agent.id)}
                lang={lang}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function getLogColor(type: string): string {
  switch (type) {
    case 'success': return 'text-[#88ff88]';
    case 'error': return 'text-[#ff5555]';
    case 'warning': return 'text-[#ffff55]';
    case 'tool': return 'text-[#00ffff]';
    case 'thought': return 'text-[#ffff55]';
    default: return 'text-white/70';
  }
}

export default SubAgentPanel;