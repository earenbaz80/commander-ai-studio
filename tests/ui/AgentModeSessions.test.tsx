/**
 * Sesiones interrumpidas en el panel del agente.
 *
 * Una corrida que murió a media (recarga, cierre de la app, servidor caído)
 * queda guardada con `running: true`; el panel debe marcarla como interrumpida
 * y ofrecer retomarla desde el último paso guardado.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentMode } from '../../src/components/AgentMode';

const emptyState = { task: null, plan: [], steps: [], thinking: false, running: false };

const interrupted = {
  id: 'sess-1',
  goal: 'seguir con la tarea',
  ts: 1_700_000_000_000,
  state: {
    task: { id: 'sess-1', goal: 'seguir con la tarea', cwd: '.', maxSteps: 40 },
    plan: [{ id: 'p1', text: 'leer package.json', done: false }],
    steps: [{ id: 'st1', type: 'thought', title: 'Inicio', content: 'objetivo', status: 'completed', ts: 1 }],
    thinking: true,
    running: true,
  },
};

const baseProps = () => ({
  cwd: '.',
  onStartTask: vi.fn(),
  onStop: vi.fn(),
  state: emptyState as any,
  onRunTool: vi.fn(async () => ({ ok: true })),
  lang: 'es' as const,
});

describe('AgentMode · sesiones interrumpidas', () => {
  beforeEach(() => {
    localStorage.clear();
    // El panel consulta el servidor al montar; aquí sólo importa lo local.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('marca la sesión cortada y ofrece Continuar', () => {
    localStorage.setItem('commander_agent_sessions_v1', JSON.stringify([interrupted]));
    const onContinue = vi.fn();

    render(<AgentMode {...baseProps()} onContinue={onContinue} />);
    fireEvent.click(screen.getByText('SESIONES'));

    expect(screen.getByText(/interrumpida/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Continuar'));
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ id: 'sess-1' }));
  });

  test('sin onContinue no se ofrece continuar', () => {
    localStorage.setItem('commander_agent_sessions_v1', JSON.stringify([interrupted]));

    render(<AgentMode {...baseProps()} />);
    fireEvent.click(screen.getByText('SESIONES'));

    expect(screen.queryByText('Continuar')).toBeNull();
  });

  test('en alemán los textos del panel salen del diccionario', () => {
    localStorage.setItem('commander_agent_sessions_v1', JSON.stringify([interrupted]));

    render(
      <AgentMode
        {...baseProps()}
        lang="de"
        onContinue={vi.fn()}
        onRestore={vi.fn()}
        onFork={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('SITZUNGEN'));

    // Antes estas cadenas se quedaban en castellano con la UI en alemán.
    expect(screen.getByText(/unterbrochen/)).toBeInTheDocument();
    expect(screen.getByText('Fortsetzen')).toBeInTheDocument();
    expect(screen.getByTitle('Sitzungen aktualisieren')).toBeInTheDocument();
    expect(screen.getByTitle('Sitzung löschen')).toBeInTheDocument();
    expect(screen.getByTitle('Ab dem zuletzt gespeicherten Schritt fortsetzen')).toBeInTheDocument();
    // Y los botones que seguían en inglés.
    expect(screen.getByText('Wiederherstellen')).toBeInTheDocument();
    expect(screen.getByText('Abzweigen')).toBeInTheDocument();

    fireEvent.click(screen.getByText('METRIKEN'));
    expect(screen.getByText('TOOL-METRIKEN')).toBeInTheDocument();

    fireEvent.click(screen.getByText('MCP'));
    expect(screen.getByText(/MCP-SERVER \(\d+\/\d+\)/)).toBeInTheDocument();
  });

  test('una sesión cerrada no se marca como interrumpida', () => {
    const done = {
      ...interrupted,
      state: { ...interrupted.state, running: false, thinking: false },
    };
    localStorage.setItem('commander_agent_sessions_v1', JSON.stringify([done]));

    render(<AgentMode {...baseProps()} onContinue={vi.fn()} />);
    fireEvent.click(screen.getByText('SESIONES'));

    expect(screen.queryByText(/interrumpida/)).toBeNull();
    expect(screen.getByText('Continuar')).toBeInTheDocument();
  });
});
