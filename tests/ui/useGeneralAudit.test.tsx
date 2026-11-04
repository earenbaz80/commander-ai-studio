/**
 * «Auditoría General» se comporta como pedírselo al agente en el chat: mensaje
 * del usuario, corrida con herramientas y los pasos dentro del mensaje del
 * modelo. Aquí se fija ese contrato con un orquestador simulado.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { auditReportFrom, toChatAgentSteps, useGeneralAudit } from '../../src/hooks/useGeneralAudit';
import type { AgentState, AgentStep } from '../../src/agent/types';
import type { ChatMessage } from '../../src/types/studio';

const emptyState: AgentState = { task: null, plan: [], steps: [], thinking: false, running: false };

const thought = (id: string, title: string, content: string): AgentStep => ({
  id,
  type: 'thought',
  title,
  content,
  status: 'completed',
  ts: 1,
});

const taskState = (over: Partial<AgentState> = {}): AgentState => ({
  ...emptyState,
  task: { id: 'task-1', goal: 'auditar', cwd: '.', maxSteps: 40 },
  ...over,
});

const Probe = ({ audit }: { audit: any }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const { start } = useGeneralAudit({ ...audit, setMessages });
  return (
    <div>
      <button onClick={() => start('Realiza una AUDITORÍA GENERAL')}>auditar</button>
      {messages.map((m) => (
        <p key={m.id} data-testid={`msg-${m.role}`}>
          {`${m.role}|${m.content}|${(m.agentSteps || []).length}`}
        </p>
      ))}
    </div>
  );
};

const baseAudit = () => ({
  state: emptyState,
  startTask: vi.fn(() => 'task-1'),
  setMode: vi.fn(),
  tabs: { updateTab: vi.fn() },
  setIsGenerating: vi.fn(),
  lang: 'es',
});

describe('useGeneralAudit', () => {
  test('abre el chat, deja el mensaje del usuario y arranca la corrida', () => {
    const audit = baseAudit();
    const { getByText, getByTestId } = render(<Probe audit={audit} />);

    fireEvent.click(getByText('auditar'));

    // `persistThread: false`: la auditoría no abre una sesión nueva en el
    // historial, la conversación es la de la pestaña.
    expect(audit.startTask).toHaveBeenCalledWith('Realiza una AUDITORÍA GENERAL', undefined, { persistThread: false });
    expect(audit.setMode).toHaveBeenCalledWith('chat');
    expect(audit.tabs.updateTab).toHaveBeenCalledWith({ mode: 'chat' });
    expect(audit.setIsGenerating).toHaveBeenCalledWith(true);
    expect(getByTestId('msg-user').textContent).toContain('AUDITORÍA GENERAL');
    // El mensaje del modelo nace vacío: los pasos llegan con la corrida.
    expect(getByTestId('msg-model').textContent).toBe('model||0');
  });

  test('pinta los pasos mientras corre y deja el informe al terminar', () => {
    const audit = baseAudit();
    const { getByText, getByTestId, rerender } = render(<Probe audit={audit} />);
    fireEvent.click(getByText('auditar'));

    rerender(
      <Probe
        audit={{
          ...audit,
          state: taskState({ running: true, steps: [thought('s1', 'Leyendo', 'abriendo README')] }),
        }}
      />
    );
    expect(getByTestId('msg-model').textContent).toBe('model||1');

    rerender(
      <Probe
        audit={{
          ...audit,
          state: taskState({
            running: false,
            steps: [
              thought('s1', 'Leyendo', 'abriendo README'),
              thought('s2', 'Finalizado', 'INFORME FINAL: 2 hallazgos'),
            ],
          }),
        }}
      />
    );

    const model = getByTestId('msg-model').textContent || '';
    expect(model).toContain('INFORME FINAL');
    expect(model).toContain('|2');
    expect(audit.setIsGenerating).toHaveBeenLastCalledWith(false);
  });

  test('ignora el estado de una corrida anterior', () => {
    const audit = baseAudit();
    const { getByText, getByTestId, rerender } = render(<Probe audit={audit} />);
    fireEvent.click(getByText('auditar'));

    rerender(
      <Probe
        audit={{
          ...audit,
          state: {
            ...emptyState,
            task: { id: 'otra-tarea', goal: 'otra', cwd: '.', maxSteps: 40 },
            running: true,
            steps: [thought('x1', 'Finalizado', 'informe ajeno')],
          },
        }}
      />
    );

    expect(getByTestId('msg-model').textContent).toBe('model||0');
  });

  test('sin informe avisa que no hubo respuesta', () => {
    const audit = baseAudit();
    const { getByText, getByTestId, rerender } = render(<Probe audit={audit} />);
    fireEvent.click(getByText('auditar'));

    rerender(<Probe audit={{ ...audit, state: taskState({ running: false, steps: [] }) }} />);

    expect(getByTestId('msg-model').textContent).toContain('sin respuesta');
  });

  test('las piezas puras traducen pasos e informe', () => {
    const mapped = toChatAgentSteps([
      { ...thought('s1', 'Llamada', 'x'), type: 'tool_call', toolId: 'fs.read', status: 'failed' } as AgentStep,
    ]);
    expect(mapped[0]).toMatchObject({ type: 'tool_call', toolName: 'fs.read', status: 'error' });

    expect(
      auditReportFrom(taskState({ steps: [thought('a', 'Finalizado', 'uno'), thought('b', 'Finalizado', 'dos')] }))
    ).toBe('dos');
    expect(auditReportFrom(taskState())).toBe('');
  });
});
