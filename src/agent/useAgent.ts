import { useMemo, useRef, useState, useEffect } from 'react';
import { AgentOrchestrator } from './orchestrator';
import { AgentLoop } from './loop';
import { uid } from './id';
import { saveSession, saveSessionThrottled, type AgentSession } from './sessions';
import { clearActiveSession, rememberTask } from './activeSession';
import { recordMetric } from './telemetry';
import { getActiveProjectRoot } from './activeProject';
import { persistVerificationArtifactFromRun } from '../artifacts/fromAgentRun';
import type { AgentState, ApprovalRequest, ApprovalResult } from './types';

export function useAgent(cwd: string, model?: string) {
  const [state, setState] = useState<AgentState>({
    task: null, plan: [], steps: [], thinking: false, running: false,
  });
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const resolver = useRef<((v: ApprovalResult) => void) | null>(null);
  const orchestratorRef = useRef<AgentOrchestrator | null>(null);
  /** true entre el primer estado `running` y el cierre de esa corrida. */
  const runWasRunning = useRef(false);
  /** Proyecto activo al arrancar: el usuario puede cambiar de pestaña después. */
  const runProjectPath = useRef('');

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
      onStateChange: (s) => {
        if (s.running) {
          runWasRunning.current = true;
        } else if (runWasRunning.current) {
          runWasRunning.current = false;
          const projectPath =
            runProjectPath.current || getActiveProjectRoot() || s.task?.cwd || cwd;
          void persistVerificationArtifactFromRun({
            state: s,
            projectPath,
          }).catch((e) => {
            // Un artifact no debe tumbar la corrida; queda el aviso en consola.
            console.warn('No se pudo guardar el artifact de verificación:', e);
          });
        }
        setState(s);
        autosave(s);
      },
      approve: async (req) => {
        // Las preguntas de `ask_user` viajan por este canal aunque no sean
        // peligrosas: es el único punto donde el bucle espera al usuario.
        const isQuestion = (req.meta as any)?.kind === 'question';
        if (!req.danger && !isQuestion) return { approved: true };
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

  /** Arranca una corrida y devuelve el id de la tarea (para seguirla desde la UI). */
  const startTask = (
    goal: string,
    plan?: Array<{ id: string; text: string; done: boolean }>,
    opts?: { persistThread?: boolean }
  ): string => {
    // Deja anotada la tarea para que `spawn_agents` pueda registrar después su
    // sesión padre (objetivo, cwd, modelo). Sin red aquí: la sesión se crea en
    // el primer uso y no arranca el bucle del LLM.
    const taskId = uid('task');
    runProjectPath.current = getActiveProjectRoot() || cwd;
    rememberTask({ taskId, goal, cwd, model });
    // maxSteps cuenta micro-steps (thought/call/result); 40 ≈ 6-8 turnos LLM
    loop.start({ id: taskId, goal, cwd, maxSteps: 40, plan, ...(opts?.persistThread === false ? { persistThread: false } : {}) });
    return taskId;
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
    runProjectPath.current = getActiveProjectRoot() || task.cwd || cwd;
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
  /**
   * Retoma la corrida que quedó parada (el usuario pulsó Detener) sin perder
   * pasos ni plan: es `loop.resume` sobre la tarea que ya está en el orquestador.
   */
  const resumeTask = (): boolean => {
    const task = orchestrator.getState().task;
    if (!task) return false;
    runProjectPath.current = getActiveProjectRoot() || task.cwd || cwd;
    rememberTask({ taskId: task.id, goal: task.goal, cwd: task.cwd || cwd, model });
    setState({ ...orchestrator.getState() });
    void loop.resume({ ...task, cwd: task.cwd || cwd });
    return true;
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
  const resolveApproval = (
    ok: boolean,
    override?: { toolId: string; input: unknown },
    diff?: string,
    answer?: string
  ) =>
    resolver.current?.({
      approved: ok,
      override,
      ...(diff ? { diff } : {}),
      ...(answer ? { answer } : {}),
    });
  const rollbackRun = async () => {
    const r = await orchestrator.rollbackRun();
    setState({ ...orchestrator.getState() });
    return r;
  };

  const undoStep = async () => {
    const r = await orchestrator.undoStep();
    setState({ ...orchestrator.getState() });
    return r;
  };
  const redoStep = async () => {
    const r = await orchestrator.redoStep();
    setState({ ...orchestrator.getState() });
    return r;
  };

  /** Llama a orchestrator.setPlan y refresca el estado local. */
  const setPlan = (newPlan: Array<{ id: string; text: string; done: boolean }>) => {
    orchestrator.setPlan(newPlan);
    setState({ ...orchestrator.getState() });
  };

  return { state, startTask, stop, resumeTask, runTool, pendingApproval, resolveApproval, rollbackRun, undoStep, redoStep, restoreSession, continueSession, forkSession, setPlan };
}
