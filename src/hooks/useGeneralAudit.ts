/**
 * «Auditoría General» dentro del chat normal.
 *
 * El botón tiene que hacer lo mismo que pedírtelo en la conversación: aparece el
 * mensaje del usuario, el agente lee e inspecciona el proyecto con herramientas
 * y la respuesta queda en el chat con sus pasos a la vista. El chat simple del
 * proveedor no tiene tools, así que la corrida va por el bucle del agente y sus
 * pasos se reflejan en el mensaje del modelo (`agentSteps`).
 *
 * La corrida se puede **detener** y **retomar**: el bucle del agente conserva
 * pasos y plan, así que parar no es perder lo leído ni empezar de cero.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentState, AgentStep as RunStep } from '../agent/types';
import type { AgentStep as ChatStep, ChatMessage, StudioMode } from '../types/studio';

export interface GeneralAuditOptions {
  state: AgentState;
  /** Arranca una corrida del agente y devuelve el id de la tarea. */
  startTask: (goal: string) => string;
  /** Detiene la corrida en curso (botón Detener). */
  stopTask?: () => void;
  /** Retoma la corrida detenida conservando pasos y plan. */
  resumeTask?: () => boolean;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setMode: (mode: StudioMode) => void;
  tabs: { updateTab: (patch: Record<string, unknown>) => void };
  setIsGenerating: (value: boolean) => void;
  lang: string;
}

/** Pasos de la corrida en el formato que pinta `AgentStepViewer` en el chat. */
export function toChatAgentSteps(steps: RunStep[] | undefined): ChatStep[] {
  return (steps || []).map((step) => ({
    id: step.id,
    type:
      step.type === 'tool_call'
        ? 'tool_call'
        : step.type === 'tool_result'
          ? 'tool_result'
          : step.type === 'subagent'
            ? 'tool_call'
            : 'thought',
    title: step.title,
    content: step.content,
    toolName: step.toolId,
    status: step.status === 'failed' ? 'error' : step.status === 'running' ? 'running' : 'completed',
    latencyMs: step.durationMs,
  }));
}

/**
 * Informe final: el bucle cierra con un pensamiento titulado «Finalizado» que
 * lleva la respuesta del modelo. Se usa el último por si hubo reintentos.
 */
export function auditReportFrom(state: AgentState): string {
  const steps = state.steps || [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === 'thought' && /finalizad/i.test(step.title) && step.content) return step.content;
  }
  return '';
}

const stamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function useGeneralAudit(opts: GeneralAuditOptions) {
  const { state, startTask, stopTask, resumeTask, setMessages, setMode, tabs, setIsGenerating, lang } = opts;
  // Corrida en curso: sólo se pinta el estado de SU tarea, no el de una corrida
  // anterior que quedó en el orquestador.
  const run = useRef<{ taskId: string; messageId: string } | null>(null);
  /** Última corrida, para poder retomarla después de detenerla. */
  const last = useRef<{ taskId: string; messageId: string } | null>(null);
  const stopped = useRef(false);
  const [canResume, setCanResume] = useState(false);

  const start = useCallback(
    (prompt: string) => {
      const id = `audit-${Date.now()}`;
      const hora = stamp();
      setMessages((prev) => [
        ...prev,
        { id: `${id}-user`, role: 'user', content: prompt, timestamp: hora },
        { id, role: 'model', content: '', timestamp: hora, agentSteps: [] },
      ]);
      setMode('chat');
      tabs.updateTab({ mode: 'chat' });
      setIsGenerating(true);
      stopped.current = false;
      setCanResume(false);
      const taskId = startTask(prompt);
      run.current = { taskId, messageId: id };
      last.current = { taskId, messageId: id };
    },
    [startTask, setMessages, setMode, tabs, setIsGenerating]
  );

  /** Corta la corrida sin borrar sus pasos: queda lista para continuar. */
  const stop = useCallback(() => {
    if (!run.current) return;
    stopped.current = true;
    stopTask?.();
  }, [stopTask]);

  /** Retoma la corrida detenida sobre el mismo mensaje del chat. */
  const resume = useCallback(() => {
    const prev = last.current;
    if (!prev) return;
    stopped.current = false;
    setCanResume(false);
    setIsGenerating(true);
    run.current = { ...prev };
    if (!(resumeTask?.() ?? false)) {
      run.current = null;
      setIsGenerating(false);
      setCanResume(true);
    }
  }, [resumeTask, setIsGenerating]);

  useEffect(() => {
    const active = run.current;
    if (!active) return;
    // El orquestador conserva la tarea anterior hasta que arranca la nueva.
    if (state.task?.id !== active.taskId) return;

    const agentSteps = toChatAgentSteps(state.steps);
    const report = auditReportFrom(state);
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === active.messageId
          ? { ...msg, content: report || msg.content, agentSteps }
          : msg
      )
    );

    if (state.running) return;
    run.current = null;
    setIsGenerating(false);

    if (stopped.current) {
      stopped.current = false;
      setCanResume(true);
      const detenido =
        lang === 'es'
          ? '⏹ Detenido. Pulsa «Continuar» para retomar la auditoría donde se quedó.'
          : lang === 'de'
            ? '⏹ Gestoppt. „Fortsetzen“ setzt die Prüfung dort fort, wo sie aufgehört hat.'
            : '⏹ Stopped. Press “Resume” to continue the audit where it left off.';
      setMessages((prev) =>
        prev.map((msg) => (msg.id === active.messageId ? { ...msg, content: report || detenido } : msg))
      );
      return;
    }

    if (!report) {
      const sinRespuesta =
        lang === 'es'
          ? `La auditoría terminó sin respuesta del modelo.${state.error ? ` ${state.error}` : ''}`
          : lang === 'de'
            ? `Die Prüfung endete ohne Antwort des Modells.${state.error ? ` ${state.error}` : ''}`
            : `The audit finished without a model response.${state.error ? ` ${state.error}` : ''}`;
      setMessages((prev) =>
        prev.map((msg) => (msg.id === active.messageId ? { ...msg, content: sinRespuesta } : msg))
      );
    }
  }, [state, setMessages, setIsGenerating, lang]);

  return { start, stop, resume, canResume };
}
