/**
 * «Auditoría General» dentro del chat normal.
 *
 * El botón tiene que hacer lo mismo que pedírtelo en la conversación: aparece el
 * mensaje del usuario, el agente lee e inspecciona el proyecto con herramientas
 * y la respuesta queda en el chat con sus pasos a la vista. El chat simple del
 * proveedor no tiene tools, así que la corrida va por el bucle del agente y sus
 * pasos se reflejan en el mensaje del modelo (`agentSteps`).
 */
import { useCallback, useEffect, useRef } from 'react';
import type { AgentState, AgentStep as RunStep } from '../agent/types';
import type { AgentStep as ChatStep, ChatMessage, StudioMode } from '../types/studio';

export interface GeneralAuditOptions {
  state: AgentState;
  /** Arranca una corrida del agente y devuelve el id de la tarea. */
  startTask: (goal: string) => string;
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
  const { state, startTask, setMessages, setMode, tabs, setIsGenerating, lang } = opts;
  // Corrida en curso: sólo se pinta el estado de SU tarea, no el de una corrida
  // anterior que quedó en el orquestador.
  const run = useRef<{ taskId: string; messageId: string } | null>(null);

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
      run.current = { taskId: startTask(prompt), messageId: id };
    },
    [startTask, setMessages, setMode, tabs, setIsGenerating]
  );

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

  return { start };
}
