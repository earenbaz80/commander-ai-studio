import { useMemo, useRef, useState, useEffect } from 'react';
import { AgentOrchestrator } from './orchestrator';
import { AgentLoop } from './loop';
import { uid } from './id';
import { saveSession, saveSessionThrottled, type AgentSession } from './sessions';
import { clearActiveSession, rememberTask } from './activeSession';
import { recordMetric } from './telemetry';
import type { AgentState, ApprovalRequest, ApprovalResult } from './types';

export function useAgent(cwd: string, model?: string) {
  const [state, setState] = useState<AgentState>({
    task: null, plan: [], steps: [], thinking: false, running: false,
  });
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const resolver = useRef<((v: ApprovalResult) => void) | null>(null);
  const orchestratorRef = useRef<AgentOrchestrator | null>(null);

  /**
   * Autoguardado del avance.
   *
   * Antes sólo se guardaba al pulsar «parar», así que una recarga o un cierre
   * de la app a mitad de corrida se llevaba por delante todo el trabajo. Ahora
   * cada paso deja el estado en disco (limitado a una escritura por segundo).
   */
  const autosave = (s: AgentState) => {
    if (!s.task) return;
    saveSessionThrottled({ id: s.task.id, goal: s.task.goal, ts: Date.now(), state: s });
  };

  // Initialize orchestrator once using useRef pattern to avoid circular deps in useMemo
  if (!orchestratorRef.current) {
    orchestratorRef.current = new AgentOrchestrator({
      cwd,
      onStep: (step) => {
        const orch = orchestratorRef.current;
        if (orch) {
          setState({ ...orch.getState() });
          autosave(orch.getState());
          try {
            if (step.type === 'tool_result') {
              recordMetric({
                toolId: String(step.toolId || 'unknown'),
                ok: step.status === 'completed',
                durationMs: step.durationMs || 0,
                ts: Date.now(),
                taskId: orch.getState().task?.id,
              });
            }
          } catch { /* ignore */ }
        }
      },
      onPlanChange: () => {
        const orch = orchestratorRef.current;
        if (orch) {
          setState({ ...orch.getState() });
          autosave(orch.getState());
        }
      },
      onStateChange: (s) => { setState(s); autosave(s); },
      approve: async (req) => {
        if (!req.danger) return { approved: true };
        setPendingApproval(req);
        const result = await new Promise<ApprovalResult>((resolve) => { resolver.current = resolve; });
        setPendingApproval(null);
        resolver.current = null;
        return result.approved ? result : { approved: false, reason: 'denegado por usuario' };
      },
    });
  }

  // Update orchestrator cwd when it changes
  useEffect(() => {
    if (orchestratorRef.current) {
      orchestratorRef.current.setCwd(cwd);
    }
  }, [cwd]);

  const orchestrator = orchestratorRef.current!;

  const loop = useMemo(() => new AgentLoop(orchestrator, model), [orchestrator, model]);

  const startTask = (goal: string, plan?: Array<{ id: string; text: string; done: boolean }>) => {
    // Deja anotada la tarea para que `spawn_agents` pueda registrar después su
    // sesión padre (objetivo, cwd, modelo). Sin red aquí: la sesión se crea en
    // el primer uso y no arranca el bucle del LLM.
    const taskId = uid('task');
    rememberTask({ taskId, goal, cwd, model });
    // maxSteps cuenta micro-steps (thought/call/result); 40 ≈ 6-8 turnos LLM
    loop.start({ id: taskId, goal, cwd, maxSteps: 40, plan });
  };
  const restoreSession = (s: import('./sessions').AgentSession) => {
    orchestrator.restoreState(s.state);
    setState({ ...orchestrator.getState() });
    // El id de sesión del servidor se perdió con la recarga: se vuelve a anotar
    // la tarea para que `spawn_agents` la registre cuando la necesite.
    const task = s.state?.task;
    if (task?.id) rememberTask({ taskId: task.id, goal: task.goal, cwd: task.cwd || cwd, model });
  };
  /**
   * Continúa una sesión interrumpida: la restaura y vuelve a poner el bucle en
   * marcha desde el plan y los pasos que quedaron guardados.
   */
  const continueSession = (s: AgentSession) => {
    const task = s.state?.task;
    if (!task) return false;
    orchestrator.restoreState(s.state);
    setState({ ...orchestrator.getState() });
    // Continuar puede ocurrir sin restaurar antes: se anota igual (sin red).
    rememberTask({ taskId: task.id, goal: task.goal, cwd: task.cwd || cwd, model });
    void loop.resume({ ...task, cwd: task.cwd || cwd });
    return true;
  };
  const forkSession = (s: import('./sessions').AgentSession) => {
    const copy = JSON.parse(JSON.stringify(s.state)) as AgentState;
    copy.task = s.state.task ? { ...s.state.task, id: uid('task') } : null;
    copy.running = false;
    orchestrator.restoreState(copy);
    setState({ ...orchestrator.getState() });
  };
  const stop = () => {
    loop.stop();
    clearActiveSession();
    try {
      const s = orchestrator.getState();
      if (s.task) saveSession({ id: s.task.id, goal: s.task.goal, ts: Date.now(), state: s });
    } catch { /* ignore */ }
  };
  const runTool = (toolId: string, input: unknown) => orchestrator.runTool(toolId, input);
  const resolveApproval = (ok: boolean, override?: { toolId: string; input: unknown }) =>
    resolver.current?.({ approved: ok, override });
  const rollbackRun = async () => {
    const r = await orchestrator.rollbackRun();
    setState({ ...orchestrator.getState() });
    return r;
  };

  /** Llama a orchestrator.setPlan y refresca el estado local. */
  const setPlan = (newPlan: Array<{ id: string; text: string; done: boolean }>) => {
    orchestrator.setPlan(newPlan);
    setState({ ...orchestrator.getState() });
  };

  return { state, startTask, stop, runTool, pendingApproval, resolveApproval, rollbackRun, restoreSession, continueSession, forkSession, setPlan };
}
