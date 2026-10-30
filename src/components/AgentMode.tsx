import type { Language } from '../i18n/translations';
import React, { useMemo, useState, useEffect } from 'react';
import { Send, Play, Square, Terminal, ListTodo, Plug, Activity, X, RefreshCw, RotateCcw, Clock, Users, Check } from 'lucide-react';
import type { AgentState, AgentStep } from '../agent/types';
import { loadMCPServers, saveMCPServers, mcpListTools, type MCPServerConfig } from '../agent/mcp';
import { loadMetrics, metricsSummary } from '../agent/telemetry';
import { loadSessions, deleteSession, type AgentSession } from '../agent/sessions';
import { gitConflictState } from '../agent/tools/git';
import PlanEditor, { type PlanItem } from './PlanEditor';
import RollbackTimeline from './RollbackTimeline';
import SubAgentPanel from './SubAgentPanel';

interface AgentModeProps {
  cwd: string;
  onStartTask: (goal: string, plan?: Array<{ id: string; text: string; done: boolean }>) => void;
  onStop: () => void;
  state: AgentState;
  onRunTool: (toolId: string, input: unknown) => Promise<any>;
  onRestore?: (s: AgentSession) => void;
  /** Retoma una sesión interrumpida desde el plan y los pasos guardados. */
  onContinue?: (s: AgentSession) => void;
  onFork?: (s: AgentSession) => void;
  onRollbackRun?: () => Promise<{ ok: boolean; error?: string; restored?: number; deleted?: number; skipped?: number }>;
  onPlanChange?: (plan: Array<{ id: string; text: string; done: boolean }>) => void;
  lang: Language;
}

export const AgentMode: React.FC<AgentModeProps> = ({
  cwd,
  onStartTask,
  onStop,
  state,
  onRunTool,
  onRestore,
  onContinue,
  onFork,
  onRollbackRun,
  onPlanChange,
  lang,
}) => {
  const [goal, setGoal] = useState('');
  const [toolId, setToolId] = useState('fs.read');
  const [toolInput, setToolInput] = useState('{"path":"README.md"}');
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>(() => loadMCPServers());
  const [mcpUrl, setMcpUrl] = useState('');
  const [mcpToken, setMcpToken] = useState('');
  const [mcpTools, setMcpTools] = useState<string>('');
  const [plugins, setPlugins] = useState<{ id: string; name: string; version: string }[]>([]);
  const [pluginId, setPluginId] = useState('');
  const [installingPlugin, setInstallingPlugin] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>(() => loadSessions());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const metrics = useMemo(() => metricsSummary(loadMetrics().slice(0, 100)), [state.steps.length]);

  // Agent Loop v2 state
  const [plan, setPlan] = useState<PlanItem[]>(state.plan.map(p => ({ id: p.id, text: p.text, done: p.done })));
  
  // Sincronizar plan local con el del orquestador (state.plan) cuando cambie externamente
  useEffect(() => {
    setPlan(state.plan.map(p => ({ id: p.id, text: p.text, done: p.done })));
  }, [state.plan]);

  const [checkpoints, setCheckpoints] = useState<Array<{id: string; timestamp: number; label: string; stepsCount: number; toolsUsed: string[]; gitStatus: 'clean' | 'dirty' | 'conflict'; size: number; description?: string}>>([]);
  const [currentCheckpointIndex, setCurrentCheckpointIndex] = useState(0);
  const [subAgents, setSubAgents] = useState<Array<{id: string; name: string; role: string; status: 'idle' | 'running' | 'completed' | 'failed' | 'paused'; progress: number; currentTask: string; tasksCompleted: number; tasksTotal: number; startTime: number; endTime?: number; tokensUsed: number; tokensBudget: number; currentTool?: string; logs: Array<{id: string; timestamp: number; type: 'info' | 'success' | 'error' | 'warning' | 'tool' | 'thought'; message: string; tool?: string; duration?: number}>; color: string}>>([]);
  const [activePanel, setActivePanel] = useState<'plan' | 'timeline' | 'subagents' | 'mcp' | 'plugins' | 'conflict' | 'metrics' | 'sessions'>('plan');
  // `state` viene del orquestador como prop de solo lectura, así que la salida
  // del conflicto de merge se mantiene como estado local de la vista.
  const [conflictOutput, setConflictOutput] = useState<string>('');
  const [conflictPath, setConflictPath] = useState<string>('');
  const [conflictMsg, setConflictMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [mergeInfo, setMergeInfo] = useState<{
    inMerge: boolean;
    total: number;
    files: Array<{ path: string; conflicts: number; ready: boolean; kind?: string; deletedBy?: string }>;
  } | null>(null);

  // Al abrir el panel, consultar el merge en curso en vez de esperar a que se
  // pegue la salida de `git merge`. Es sólo lectura: ni aprobación ni pasos.
  useEffect(() => {
    if (activePanel !== 'conflict') return;
    let cancelled = false;
    (async () => {
      const r = await gitConflictState();
      if (!cancelled) setMergeInfo(r?.ok ? r.data : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [activePanel]);

  useEffect(() => {
    const loadPlugins = async () => {
      try {
        const res = await fetch('/api/plugins');
        const data = await res.json();
        if (data.success) {
          setPlugins(data.plugins);
        }
      } catch (_e) {
        console.error('Failed to load plugins');
      }
    };
    loadPlugins();
  }, []);

  const canRun = useMemo(() => !state.running && goal.trim().length > 0, [state.running, goal]);

  const handleStart = () => {
    if (canRun) onStartTask(goal.trim(), plan);
  };

  const handleRunTool = async () => {
    try {
      const input = JSON.parse(toolInput || '{}');
      await onRunTool(toolId, input);
    } catch (_e) {
      alert(lang === 'es' ? 'JSON inválido para tool input' : lang === 'de' ? 'Ungültiges JSON für die Tool-Eingabe' : 'Invalid JSON for tool input');
    }
  };

  const handleInstallPlugin = async () => {
    if (!pluginId) return;
    setInstallingPlugin(pluginId);
    try {
      const res = await fetch('/api/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pluginId, name: pluginId, version: '0.1.0' })
      });
      const data = await res.json();
      if (data.success) {
        setPlugins(prev => [...prev, data.manifest]);
        setPluginId('');
      }
      setInstallingPlugin(null);
    } catch (e) {
      setInstallingPlugin(null);
      console.error('Failed to install plugin', e);
    }
  };

  const handleUninstallPlugin = async (id: string) => {
    try {
      const res = await fetch(`/api/plugins/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setPlugins(prev => prev.filter(p => p.id !== id));
      }
    } catch (e) {
      console.error('Failed to uninstall plugin', e);
    }
  };

  /** Relee el estado del merge (archivos, bloques, cuáles ya están listos). */
  const refreshMerge = async () => {
    const r = await gitConflictState();
    setMergeInfo(r?.ok ? r.data : null);
  };

  /**
   * Resuelve un archivo concreto sin pegar nada. En un modify/delete elige el
   * lado que conserva el archivo o el que lo borra; el servidor deja la
   * decisión preparada con `git add` / `git rm`.
   */
  const resolveConflictPath = async (path: string, side: 'ours' | 'theirs') => {
    setResolvingConflict(true);
    setConflictMsg(null);
    try {
      const r = await onRunTool('git.conflict', { path, resolve: side });
      if (r?.ok) {
        setConflictMsg({
          ok: true,
          text: r.data?.kept
            ? `${path}: lado ${side} conservado y preparado con git add`
            : `${path}: borrado aceptado y preparado con git rm`,
        });
      } else {
        setConflictMsg({ ok: false, text: String(r?.error || 'No se pudo resolver el conflicto') });
      }
      await refreshMerge();
    } catch (e: any) {
      setConflictMsg({ ok: false, text: String(e?.message || e) });
    } finally {
      setResolvingConflict(false);
    }
  };

  /** Cierra el merge con `git add` sobre los archivos que ya no tienen marcas. */
  const closeMerge = async () => {
    setResolvingConflict(true);
    setConflictMsg(null);
    try {
      const r = await onRunTool('git.conflict', { all: true, stage: true });
      if (r?.ok) {
        const staged = (r.data?.staged || []) as string[];
        const unstaged = (r.data?.unstaged || []) as Array<{ path: string; error: string }>;
        setConflictMsg({
          ok: true,
          text: `${staged.length} archivo(s) marcados con git add`
            + (unstaged.length ? `; pendientes: ${unstaged.map((s) => `${s.path} (${s.error})`).join(', ')}` : ''),
        });
      } else {
        setConflictMsg({ ok: false, text: String(r?.error || 'No se pudo cerrar el merge') });
      }
      await refreshMerge();
    } catch (e: any) {
      setConflictMsg({ ok: false, text: String(e?.message || e) });
    } finally {
      setResolvingConflict(false);
    }
  };

  /**
   * Completa el merge con el commit de fusión, una vez que todos los archivos
   * están preparados con git add. El servidor no hace `git add -A` aquí: sólo
   * entra lo ya preparado y usa el mensaje de merge que preparó git.
   */
  const commitMerge = async () => {
    setResolvingConflict(true);
    setConflictMsg(null);
    try {
      const r = await onRunTool('git.conflict', { all: true, commit: true });
      if (r?.ok) {
        setConflictMsg({ ok: true, text: `Merge completado en ${r.data?.hash || 'HEAD'}` });
      } else {
        setConflictMsg({ ok: false, text: String(r?.error || 'No se pudo completar el merge') });
      }
      await refreshMerge();
    } catch (e: any) {
      setConflictMsg({ ok: false, text: String(e?.message || e) });
    } finally {
      setResolvingConflict(false);
    }
  };

  /**
   * Deshace el merge en curso con `git merge --abort`: el árbol vuelve al
   * estado previo al intento. La herramienta pide aprobación antes de correr.
   */
  const abortMerge = async () => {
    setResolvingConflict(true);
    setConflictMsg(null);
    try {
      const r = await onRunTool('git.conflict', { all: true, abort: true });
      if (r?.ok) {
        setConflictMsg({ ok: true, text: 'Merge abortado: el árbol quedó como estaba antes del merge' });
        setConflictOutput('');
        setConflictPath('');
      } else {
        setConflictMsg({ ok: false, text: String(r?.error || 'No se pudo abortar el merge') });
      }
      await refreshMerge();
    } catch (e: any) {
      setConflictMsg({ ok: false, text: String(e?.message || e) });
    } finally {
      setResolvingConflict(false);
    }
  };

  /**
   * Aplica ours/theirs al archivo en conflicto. La tool escribe el archivo y
   * deja el resultado sin stagear; el servidor rechaza rutas fuera del proyecto.
   */
  const resolveConflict = async (side: 'ours' | 'theirs', all = false) => {
    setResolvingConflict(true);
    setConflictMsg(null);
    try {
      const r = await onRunTool(
        'git.conflict',
        all
          ? { all: true, resolve: side }
          : { output: conflictOutput, path: conflictPath.trim(), resolve: side },
      );
      if (r?.ok) {
        if (all) {
          const files = (r.data?.files || []) as Array<{ path: string }>;
          const skipped = (r.data?.skipped || []) as Array<{ path: string; error: string }>;
          setConflictMsg({
            ok: true,
            text: `${files.length} archivo(s) resueltos como ${side}`
              + (skipped.length ? `; omitidos: ${skipped.map((s) => s.path).join(', ')}` : '')
              + ' (sin stagear)',
          });
          setConflictOutput('');
          setConflictPath('');
        } else {
          setConflictMsg({
            ok: true,
            text: `${r.data?.resolved ?? 0} bloque(s) resueltos como ${side} en ${r.data?.path || conflictPath} (sin stagear)`,
          });
          setConflictOutput('');
          setConflictPath('');
        }
      } else {
        setConflictMsg({ ok: false, text: String(r?.error || 'No se pudo resolver el conflicto') });
      }
      await refreshMerge();
    } catch (e: any) {
      setConflictMsg({ ok: false, text: String(e?.message || e) });
    } finally {
      setResolvingConflict(false);
    }
  };

  // Agent Loop v2 handlers
  const handlePlanChange = (newPlan: Array<{id: string; text: string; done: boolean}>) => {
    setPlan(newPlan);
    onPlanChange?.(newPlan);
  };

  const handleRollbackTo = async (index: number) => {
    if (onRollbackRun) {
      await onRollbackRun();
      setCurrentCheckpointIndex(index);
    }
  };

  const handleCompare = (fromIndex: number, toIndex: number) => {
    console.log('Compare checkpoints:', fromIndex, toIndex);
  };

  const handleExport = (checkpoints: any[]) => {
    const data = JSON.stringify(checkpoints, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timeline-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file: File) => {
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      setCheckpoints(data);
    } catch (e) {
      console.error('Failed to import timeline:', e);
    }
  };

  const handleAgentAction = (agentId: string, action: 'pause' | 'resume' | 'stop' | 'restart') => {
    console.log('Agent action:', agentId, action);
  };

  const handleCreateAgent = (config: Partial<{id: string; name: string; role: string; status: 'idle' | 'running' | 'completed' | 'failed' | 'paused'; progress: number; currentTask: string; tasksCompleted: number; tasksTotal: number; startTime: number; endTime?: number; tokensUsed: number; tokensBudget: number; currentTool?: string; logs: Array<{id: string; timestamp: number; type: 'info' | 'success' | 'error' | 'warning' | 'tool' | 'thought'; message: string; tool?: string; duration?: number}>; color: string}>) => {
    const newAgent = {
      id: `agent_${Date.now()}`,
      name: config.name || `agent-${Date.now()}`,
      role: config.role || 'researcher',
      status: 'idle' as const,
      progress: 0,
      currentTask: '',
      tasksCompleted: 0,
      tasksTotal: 0,
      startTime: Date.now(),
      tokensUsed: 0,
      tokensBudget: config.tokensBudget || 50000,
      currentTool: undefined,
      logs: [],
      color: '#00ffff',
      ...config,
    };
    setSubAgents(prev => [...prev, newAgent]);
  };

  const handleDeleteAgent = (agentId: string) => {
    setSubAgents(prev => prev.filter(a => a.id !== agentId));
  };

  const handleViewLogs = (agentId: string) => {
    console.log('View logs for agent:', agentId);
  };

  return (
    <div className="flex-1 min-w-0 min-h-0 h-full flex flex-col overflow-hidden nc-container font-mono">
      <div className="p-2 sm:p-3 border-b-2 border-[#00ffff] flex items-center justify-between nc-panel shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span className="text-[#ffff55] font-bold text-xs sm:text-sm">
            {lang === 'es' ? 'MODO AGENTE' : lang === 'de' ? 'AGENTENMODUS' : 'AGENT MODE'}
          </span>
          <span className="text-[#00ffff] text-[10px] hidden sm:inline">cwd: {cwd}</span>
        </div>
        <div className="flex items-center gap-2">
          {state.running ? (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border-2 font-bold text-xs bg-red-600 text-white hover:bg-red-500 border-white"
            >
              <Square className="w-3.5 h-3.5" />
              <span>{lang === 'es' ? 'DETENER' : lang === 'de' ? 'STOPP' : 'STOP'}</span>
            </button>
          ) : (
            <React.Fragment>
              <button
                type="button"
                onClick={handleStart}
                disabled={!canRun}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded border-2 font-bold text-xs bg-[#00ffff] text-black hover:bg-white border-white disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-black" />
                <span>{lang === 'es' ? 'INICIAR TAREA' : lang === 'de' ? 'AUFGABE STARTEN' : 'START TASK'}</span>
              </button>
              {typeof state.runCheckpointId === 'string' && !state.running && (
                <button
                  type="button"
                  onClick={async () => {
                    await onRollbackRun!();
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded border-2 font-bold text-xs bg-[#00ff00] text-black hover:bg-[#00cc00] border-white"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{lang === 'es' ? 'DESHACER EJECUCIÓN' : lang === 'de' ? 'LAUF RÜCKGÄNGIG' : 'UNDO RUN'}</span>
                </button>
              )}
            </React.Fragment>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 w-full flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden border-r-2 border-[#00ffff]/10">
          <div className="p-3 border-b-2 border-[#00ffff]/20 bg-[#000028] shrink-0">
            <div className="flex flex-col gap-2">
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder={lang === 'es' ? 'Describe la tarea para el agente...' : lang === 'de' ? 'Beschreibe die Agentenaufgabe...' : 'Describe the agent task...'}
                className="w-full bg-[#000045] text-white p-2 border-2 border-[#00ffff] text-xs font-mono outline-none min-h-[60px] resize-y"
                disabled={state.running}
              />
              <div className="flex items-center gap-2">
                <input
                  value={toolId}
                  onChange={(e) => setToolId(e.target.value)}
                  className="bg-[#000045] text-[#00ffff] border border-[#00ffff] px-2 py-1 text-xs font-mono w-40"
                  list="agent-tools"
                  disabled={state.running}
                />
                <datalist id="agent-tools">
                  <option value="fs.read" />
                  <option value="fs.write" />
                  <option value="fs.edit" />
                  <option value="fs.glob" />
                  <option value="fs.grep" />
                  <option value="shell.run" />
                  <option value="read_diagnostics" />
                  <option value="git.status" />
                  <option value="git.diff" />
                  <option value="git.log" />
                  <option value="git.commit" />
                  <option value="web.fetch" />
                  <option value="web.search" />
                  <option value="code.run" />
                  <option value="mcp.call" />
                  <option value="mcp.list" />
                </datalist>
                <input
                  value={toolInput}
                  onChange={(e) => setToolInput(e.target.value)}
                  className="flex-1 bg-[#000045] text-white border border-[#00ffff] px-2 py-1 text-xs font-mono"
                  placeholder='{"path":"README.md"}'
                  disabled={state.running}
                />
                <button
                  type="button"
                  onClick={handleRunTool}
                  disabled={state.running}
                  className="nc-button text-xs py-1 px-2 flex items-center gap-1"
                >
                  <Send className="w-3 h-3" />
                  <span>Run Tool</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 bg-[#000033]">
            {state.steps.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-[#00ffff]/70">
                <Terminal className="w-12 h-12 mb-2" />
                <p className="text-xs">
                  {lang === 'es'
                    ? 'El agente aún no ha ejecutado pasos. Inicia una tarea o ejecuta una tool manualmente.'
                    : lang === 'de' ? 'Noch keine Schritte. Starte eine Aufgabe oder führe ein Tool manuell aus.' : 'No steps yet. Start a task or run a tool manually.'}
                </p>
              </div>
            ) : (
              state.steps.map((step) => (
                <StepCard key={step.id} step={step} lang={lang} />
              ))
            )}
          </div>
        </div>

        <div className="w-full lg:w-[380px] shrink-0 border-t-2 lg:border-t-0 lg:border-l-2 border-[#00ffff] bg-[#000030] flex flex-col min-w-0 h-full overflow-hidden">
          {/* Panel Tabs */}
          <div className="p-2 bg-[#000088] border-b-2 border-[#00ffff] flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => setActivePanel('plan')}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-bold rounded transition-colors ${
                activePanel === 'plan'
                  ? 'bg-[#00ffff] text-black'
                  : 'text-[#ffff55] hover:text-[#ffff55]/80 hover:bg-[#00ffff]/10'
              }`}
            >
              <ListTodo className="w-3.5 h-3.5" />
              <span>{lang === 'es' ? 'PLAN' : lang === 'de' ? 'PLAN' : 'PLAN'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePanel('timeline')}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-bold rounded transition-colors ${
                activePanel === 'timeline'
                  ? 'bg-[#ffff55] text-black'
                  : 'text-[#ffff55] hover:text-[#ffff55]/80 hover:bg-[#ffff55]/10'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{lang === 'es' ? 'LÍNEA TIEMPO' : lang === 'de' ? 'ZEITLEISTE' : 'TIMELINE'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePanel('subagents')}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-bold rounded transition-colors ${
                activePanel === 'subagents'
                  ? 'bg-[#ffff55] text-black'
                  : 'text-[#ffff55] hover:text-[#ffff55]/80 hover:bg-[#ffff55]/10'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>{lang === 'es' ? 'SUB-AGENTES' : lang === 'de' ? 'UNTERAGENTEN' : 'SUB-AGENTS'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePanel('mcp')}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-bold rounded transition-colors ${
                activePanel === 'mcp'
                  ? 'bg-[#00ffff] text-black'
                  : 'text-[#ffff55] hover:text-[#ffff55]/80 hover:bg-[#00ffff]/10'
              }`}
            >
              <Plug className="w-3.5 h-3.5" />
              <span>{lang === 'es' ? 'MCP' : lang === 'de' ? 'MCP' : 'MCP'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePanel('plugins')}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-bold rounded transition-colors ${
                activePanel === 'plugins'
                  ? 'bg-[#00ffff] text-black'
                  : 'text-[#ffff55] hover:text-[#ffff55]/80 hover:bg-[#00ffff]/10'
              }`}
            >
              <Plug className="w-3.5 h-3.5" />
              <span>{lang === 'es' ? 'PLUGINS' : lang === 'de' ? 'PLUGINS' : 'PLUGINS'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePanel('conflict')}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-bold rounded transition-colors ${
                activePanel === 'conflict'
                  ? 'bg-[#ffff55] text-black'
                  : 'text-[#ffff55] hover:text-[#ffff55]/80 hover:bg-[#ffff55]/10'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{lang === 'es' ? 'CONFLICTO' : lang === 'de' ? 'KONFLIKT' : 'CONFLICT'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePanel('metrics')}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-bold rounded transition-colors ${
                activePanel === 'metrics'
                  ? 'bg-[#ffff55] text-black'
                  : 'text-[#ffff55] hover:text-[#ffff55]/80 hover:bg-[#ffff55]/10'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{lang === 'es' ? 'MÉTRICAS' : lang === 'de' ? 'METRIKEN' : 'METRICS'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePanel('sessions')}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-bold rounded transition-colors ${
                activePanel === 'sessions'
                  ? 'bg-[#ffff55] text-black'
                  : 'text-[#ffff55] hover:text-[#ffff55]/80 hover:bg-[#ffff55]/10'
              }`}
            >
              <ListTodo className="w-3.5 h-3.5" />
              <span>{lang === 'es' ? 'SESESIONES' : lang === 'de' ? 'SITZUNGEN' : 'SESSIONS'}</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {activePanel === 'plan' && (
              <PlanEditor
                plan={plan}
                onPlanChange={handlePlanChange}
                isRunning={state.running}
                lang={lang}
              />
            )}

            {activePanel === 'timeline' && (
              <RollbackTimeline
                checkpoints={checkpoints}
                currentIndex={currentCheckpointIndex}
                onRollbackTo={handleRollbackTo}
                onCompare={handleCompare}
                onExport={handleExport}
                onImport={handleImport}
                isRollingBack={false}
                lang={lang}
              />
            )}

            {activePanel === 'subagents' && (
              <SubAgentPanel
                subAgents={subAgents}
                onAgentAction={handleAgentAction}
                onCreateAgent={handleCreateAgent}
                onDeleteAgent={handleDeleteAgent}
                onViewLogs={handleViewLogs}
                isRunning={state.running}
                lang={lang}
              />
            )}

            {activePanel === 'mcp' && (
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-[#ffff55] font-bold text-[11px]">
                  <Plug className="w-3.5 h-3.5" />
                  <span>MCP SERVERS ({mcpServers.filter((s) => s.enabled).length}/{mcpServers.length})</span>
                </div>
                <div className="flex gap-1.5">
                  <input
                    value={mcpUrl}
                    onChange={(e) => setMcpUrl(e.target.value)}
                    placeholder="https://mcp-server/mcp"
                    className="flex-1 bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-1 text-[10px] font-mono outline-none"
                  />
                  <input
                    value={mcpToken}
                    onChange={(e) => setMcpToken(e.target.value)}
                    placeholder="token?"
                    type="password"
                    className="w-20 bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-1 text-[10px] font-mono outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const url = mcpUrl.trim();
                      if (!url) return;
                      const next = [...mcpServers, { id: `mcp_${Date.now()}`, name: url, url, enabled: true, token: mcpToken.trim() || undefined }];
                      setMcpServers(next);
                      saveMCPServers(next);
                      setMcpUrl('');
                      setMcpToken('');
                    }}
                    className="nc-button text-[10px] px-2 py-1"
                  >
                    +
                  </button>
                </div>
                {mcpServers.map((s) => (
                  <div key={s.id} className="flex items-center gap-1.5 bg-[#0000aa]/40 border border-[#00ffff]/20 px-1.5 py-1">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={() => {
                        const next = mcpServers.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x));
                        setMcpServers(next);
                        saveMCPServers(next);
                      }}
                    />
                    <span className="flex-1 text-[10px] text-white truncate" title={s.url}>{s.url}</span>
                    <button
                      type="button"
                      title="Listar tools"
                      onClick={async () => {
                        try {
                          const tools = await mcpListTools(s.url, s.token);
                          setMcpTools(`${s.url}: ${(tools.map((t) => t.name).join(', ') || 'sin tools').slice(0, 200)}`);
                        } catch (e: any) {
                          setMcpTools(`Error ${s.url}: ${e.message}`);
                        }
                      }}
                      className="text-[#00ffff] text-[10px] px-1"
                    >
                      list
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = mcpServers.filter((x) => x.id !== s.id);
                        setMcpServers(next);
                        saveMCPServers(next);
                      }}
                      className="text-red-400 text-[10px] px-1"
                      title="Quitar servidor MCP"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {mcpTools && <div className="text-[10px] text-[#00ffff]/80 break-all">{mcpTools}</div>}
              </div>
            )}

            {activePanel === 'plugins' && (
              <div className="space-y-3">
                <div className="border-t-2 border-[#00ffff] p-2.5 space-y-2 shrink-0 max-h-[30%] overflow-y-auto">
                  <div className="flex items-center gap-1.5 text-[#ffff55] font-bold text-[11px]">
                    <Plug className="w-3.5 h-3.5" />
                    <span>PLUGINS ({plugins.length})</span>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <input
                    value={pluginId}
                    onChange={(e) => setPluginId(e.target.value)}
                    className="flex-1 bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-1 text-[10px] font-mono outline-none"
                    placeholder="Plugin ID"
                  />
                  <button
                    type="button"
                    onClick={handleInstallPlugin}
                    className="nc-button text-[10px] px-2 py-1"
                    disabled={!!installingPlugin}
                  >
                    <Send className="w-3 h-3" />
                    <span>Install</span>
                  </button>
                </div>
                {plugins.length === 0 ? (
                  <div className="text-[10px] text-[#00ffff]/50">No hay plugins instalados.</div>
                ) : (
                  plugins.slice(0, 5).map((p) => (
                    <div key={p.id} className="bg-[#0000aa]/40 border border-[#00ffff]/20 px-1.5 py-1">
                      <div className="text-[10px] text-white truncate" title={p.name}>{p.name}</div>
                      <div className="text-[9px] text-white/50">{p.version}</div>
                      <button
                        type="button"
                        onClick={() => handleUninstallPlugin(p.id)}
                        className="text-red-400 text-[10px] px-1"
                        title="Quitar">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {activePanel === 'conflict' && (
              <div className="p-3 space-y-3">
                <div className="flex items-center gap-1.5 text-[#ffff55] font-bold text-[10px]">
                  <RotateCcw className="w-3 h-3" />
                  <span>RESOLUCIÓN DE CONFLICTOS</span>
                </div>

                <div className="flex gap-2 flex-wrap items-center">
                  <span className="text-[10px] text-[#00ffff]/60">
                    {lang === 'es' ? 'Todo el merge:' : lang === 'de' ? 'Ganzer Merge:' : 'Whole merge:'}
                  </span>
                  <button
                    type="button"
                    disabled={resolvingConflict}
                    onClick={() => resolveConflict('ours', true)}
                    className="nc-button text-[10px] px-2 py-1 bg-[#00aa00] text-black disabled:opacity-50"
                  >
                    Ours
                  </button>
                  <button
                    type="button"
                    disabled={resolvingConflict}
                    onClick={() => resolveConflict('theirs', true)}
                    className="nc-button text-[10px] px-2 py-1 bg-[#0055aa] text-white disabled:opacity-50"
                  >
                    Them
                  </button>
                </div>

                {mergeInfo && mergeInfo.files.length > 0 && (
                  <div className="space-y-1 bg-black/30 border border-[#ffff55]/20 rounded p-2">
                    <p className="text-[10px] text-[#ffff55]">
                      {(mergeInfo.inMerge ? (lang === 'es' ? 'Merge en curso: ' : lang === 'de' ? 'Merge läuft: ' : 'Merge in progress: ')
                        : (lang === 'es' ? 'Conflictos sin fusionar: ' : 'Unmerged: ')) + `${mergeInfo.total} archivo(s)`}
                    </p>
                    <ul className="text-[10px] text-white/70 font-mono space-y-0.5">
                      {mergeInfo.files.slice(0, 6).map((f) => (
                        <li key={f.path} className="flex items-center gap-1" title={f.path}>
                          <span className="truncate flex-1">
                            {f.kind === 'modify-delete'
                              ? (f.deletedBy === 'ours'
                                ? (lang === 'es' ? 'borrado por nosotros · ' : lang === 'de' ? 'von uns gelöscht · ' : 'deleted by us · ')
                                : (lang === 'es' ? 'borrado por ellos · ' : lang === 'de' ? 'von ihnen gelöscht · ' : 'deleted by them · '))
                              : f.kind === 'both-deleted'
                                ? (lang === 'es' ? 'borrado en ambos lados · ' : lang === 'de' ? 'auf beiden Seiten gelöscht · ' : 'deleted on both sides · ')
                                : f.ready ? '✓ ' : `${f.conflicts} bloque(s) · `}
                            {f.path}
                          </span>
                          {(f.kind === 'modify-delete' || f.kind === 'both-deleted') && (
                            <span className="flex gap-1 shrink-0">
                              <button
                                type="button"
                                disabled={resolvingConflict}
                                onClick={() => resolveConflictPath(f.path, 'ours')}
                                className="nc-button text-[9px] px-1 py-0.5 bg-[#00aa00] text-black disabled:opacity-50"
                              >
                                Ours
                              </button>
                              <button
                                type="button"
                                disabled={resolvingConflict}
                                onClick={() => resolveConflictPath(f.path, 'theirs')}
                                className="nc-button text-[9px] px-1 py-0.5 bg-[#0055aa] text-white disabled:opacity-50"
                              >
                                Them
                              </button>
                            </span>
                          )}
                        </li>
                      ))}
                      {mergeInfo.files.length > 6 && <li>…</li>}
                    </ul>
                    {mergeInfo.files.some((f) => f.ready) && (
                      <button
                        type="button"
                        disabled={resolvingConflict}
                        onClick={closeMerge}
                        className="nc-button text-[10px] px-2 py-1 bg-[#ffff55] text-black disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" />{' '}
                        {lang === 'es' ? 'Cerrar merge (git add)' : lang === 'de' ? 'Merge schließen (git add)' : 'Close merge (git add)'}
                      </button>
                    )}
                  </div>
                )}

                {mergeInfo?.inMerge && mergeInfo.files.length === 0 && (
                  <div className="space-y-1 bg-black/30 border border-[#00ff00]/30 rounded p-2">
                    <p className="text-[10px] text-[#00ff00]">
                      {lang === 'es'
                        ? 'Todo preparado con git add: falta el commit de merge.'
                        : lang === 'de'
                          ? 'Alles mit git add vorbereitet: fehlt der Merge-Commit.'
                          : 'Everything staged with git add: the merge commit is left.'}
                    </p>
                    <button
                      type="button"
                      disabled={resolvingConflict}
                      onClick={commitMerge}
                      className="nc-button text-[10px] px-2 py-1 bg-[#00aa00] text-black disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" />{' '}
                      {lang === 'es' ? 'Commit del merge' : lang === 'de' ? 'Merge committen' : 'Commit merge'}
                    </button>
                  </div>
                )}

                {mergeInfo?.inMerge && (
                  <button
                    type="button"
                    disabled={resolvingConflict}
                    onClick={abortMerge}
                    className="nc-button text-[10px] px-2 py-1 bg-[#aa0000] text-white disabled:opacity-50"
                    title={lang === 'es'
                      ? 'Deshace el merge: descarta las resoluciones y restaura el árbol previo'
                      : lang === 'de'
                        ? 'Bricht den Merge ab: verwirft die Auflösungen und stellt den vorherigen Stand wieder her'
                        : 'Undo the merge: drops the resolutions and restores the previous tree'}
                  >
                    <X className="w-3 h-3" />{' '}
                    {lang === 'es' ? 'Abortar merge' : lang === 'de' ? 'Merge abbrechen' : 'Abort merge'}
                  </button>
                )}

                <textarea
                  value={conflictOutput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setConflictOutput(v);
                    setConflictMsg(null);
                    // `git merge` nombra el archivo: prefill para no teclearlo.
                    if (!conflictPath) {
                      const m = v.match(/Merge conflict in (\S+)\s*$/m) || v.match(/both modified:\s+(\S+)\s*$/m);
                      if (m) setConflictPath(m[1]);
                    }
                  }}
                  placeholder={lang === 'es'
                    ? 'Pega aquí la salida del merge en conflicto...'
                    : lang === 'de' ? 'Füge hier die fehlgeschlagene Merge-Ausgabe ein...' : 'Paste the failing merge output here...'}
                  className="w-full h-32 bg-black/40 text-white border border-[#ffff55]/40 p-2 rounded text-[10px] font-mono outline-none focus:border-[#ffff55]"
                  spellCheck={false}
                />

                <input
                  value={conflictPath}
                  onChange={(e) => setConflictPath(e.target.value)}
                  placeholder={lang === 'es'
                    ? 'Archivo en conflicto (p. ej. src/x.ts)'
                    : lang === 'de' ? 'Konfliktdatei (z. B. src/x.ts)' : 'Conflicted file (e.g. src/x.ts)'}
                  className="w-full bg-black/40 text-white border border-[#ffff55]/40 px-2 py-1 rounded text-[10px] font-mono outline-none focus:border-[#ffff55]"
                  spellCheck={false}
                />

                {conflictOutput.trim().length === 0 ? (
                  <p className="text-[10px] text-[#00ffff]/50">
                    {lang === 'es'
                      ? 'Pega la salida de `git merge` para resolver ours/theirs.'
                      : lang === 'de' ? 'Füge die Ausgabe von `git merge` ein, um ours/theirs aufzulösen.' : 'Paste the `git merge` output to resolve ours/theirs.'}
                  </p>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={resolvingConflict}
                      onClick={async () => {
                        await resolveConflict('ours');
                      }}
                      className="nc-button text-[10px] px-2 py-1 bg-[#00aa00] text-black disabled:opacity-50"
                    >
                      <Send className="w-3 h-3" /> Ours
                    </button>
                    <button
                      type="button"
                      disabled={resolvingConflict}
                      onClick={async () => {
                        await resolveConflict('theirs');
                      }}
                      className="nc-button text-[10px] px-2 py-1 bg-[#0055aa] text-white disabled:opacity-50"
                    >
                      <Send className="w-3 h-3" /> Them
                    </button>
                    <button
                      type="button"
                      disabled={resolvingConflict}
                      onClick={() => setConflictOutput('')}
                      className="nc-button text-[10px] px-2 py-1 bg-[#555555] text-white disabled:opacity-50"
                    >
                      <X className="w-3 h-3" /> {lang === 'es' ? 'Limpiar' : lang === 'de' ? 'Leeren' : 'Clear'}
                    </button>
                  </div>
                )}

                {conflictMsg && (
                  <p className={`text-[10px] ${conflictMsg.ok ? 'text-[#00ff00]' : 'text-red-400'}`}>
                    {conflictMsg.text}
                  </p>
                )}
              </div>
            )}

            {activePanel === 'metrics' && (
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-[#ffff55] font-bold text-[11px] pt-1">
                  <Activity className="w-3.5 h-3.5" />
                  <span>TOOL METRICS</span>
                </div>
                {Object.keys(metrics).length === 0 ? (
                  <div className="text-[10px] text-[#00ffff]/50">Sin métricas aún.</div>
                ) : (
                  Object.entries(metrics).slice(0, 8).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-[10px] text-white/80 font-mono">
                      <span className="text-[#00ffff]">{k}</span>
                      <span>{v.calls} calls • {v.fails} fail • {v.avgMs}ms</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activePanel === 'sessions' && (
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-[#ffff55] font-bold text-[11px] pt-1">
                  <ListTodo className="w-3.5 h-3.5" />
                  <span>SESSIONS ({sessions.length})</span>
                  <button type="button" onClick={() => setSessions(loadSessions())} className="ml-auto text-[#00ffff] text-[10px]" title="Refrescar sesiones"><RefreshCw className="w-3.5 h-3.5" /></button>
                </div>
                {sessions.length === 0 ? (
                  <div className="text-[10px] text-[#00ffff]/50">Sin sesiones guardadas.</div>
                ) : (
                  sessions.slice(0, 10).map((s) => (
                    <div key={s.id} className="bg-[#0000aa]/40 border border-[#00ffff]/20 px-1.5 py-1 space-y-1">
                      <div className="text-[10px] text-white truncate" title={s.goal}>{s.goal}</div>
                      <div className="text-[9px] text-white/50">
                        {new Date(s.ts).toLocaleString()} • {s.state.steps.length} steps
                        {/* `running` guardado en disco = la corrida murió sin llegar a pararse. */}
                        {s.state.running && <span className="ml-1 text-[#ffff55] font-bold">• interrumpida</span>}
                      </div>
                      <div className="flex gap-1">
                        {onContinue && s.state.task && (
                          <button type="button" onClick={() => onContinue(s)} className="text-[10px] px-1.5 py-0.5 border border-[#00ff66] text-[#00ff66] font-bold" title="Retomar desde el último paso guardado">Continuar</button>
                        )}
                        {onRestore && <button type="button" onClick={() => onRestore(s)} className="text-[10px] px-1.5 py-0.5 bg-[#00ffff] text-black font-bold">Restore</button>}
                        {onFork && <button type="button" onClick={() => onFork(s)} className="text-[10px] px-1.5 py-0.5 border border-[#ffff55] text-[#ffff55]">Fork</button>}
                        <button type="button" onClick={() => { deleteSession(s.id); setSessions(loadSessions()); }} className="text-[10px] px-1 text-red-400" title="Eliminar sesión"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const StepCard: React.FC<{ step: AgentStep; lang: Language }> = ({ step }) => {
  return (
    <div className="bg-[#000045] border-2 border-[#00ffff]/40 rounded p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-[#ffff55] uppercase">{step.type}</span>
          {step.toolId && <span className="text-[10px] text-[#00ffff]">{step.toolId}</span>}
        </div>
        <span className="text-[10px] text-white/60">
          {new Date(step.ts).toLocaleTimeString() + (step.durationMs ? ` • ${step.durationMs}ms` : '')}
        </span>
      </div>
      {step.title && <div className="text-[11px] text-white font-bold">{step.title}</div>}
      {step.content && <div className="text-[11px] text-white/90 whitespace-pre-wrap break-all">{step.content}</div>}
      {step.input != null && (
        <details className="text-[10px]">
          <summary className="cursor-pointer text-[#00ffff]">input</summary>
          <pre className="mt-1 bg-black/40 p-1.5 overflow-x-auto text-white/80">
            {String(JSON.stringify(step.input, null, 2))}
          </pre>
        </details>
      )}
      {step.output != null && (
        <details className="text-[10px]">
          <summary className="cursor-pointer text-[#00ffff]">output</summary>
          <pre className="mt-1 bg-black/40 p-1.5 overflow-x-auto text-white/80">
            {String(JSON.stringify(step.output, null, 2))}
          </pre>
        </details>
      )}
    </div>
  );
};

export default AgentMode;