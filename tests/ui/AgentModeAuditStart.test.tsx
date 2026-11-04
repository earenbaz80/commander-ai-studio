/**
 * «Auditoría General» arranca la corrida por sí sola: el prompt del pedido trae
 * `autoStart` y el panel tiene que llamar a `onStartTask` (bucle con tools), no
 * quedarse esperando a que el usuario pulse INICIAR.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { AgentMode } from '../../src/components/AgentMode';

const emptyState = { task: null, plan: [], steps: [], thinking: false, running: false };

const baseProps = (over: any = {}) => ({
  cwd: '.',
  onStartTask: vi.fn(),
  onStop: vi.fn(),
  state: emptyState as any,
  onRunTool: vi.fn(async () => ({ ok: true })),
  lang: 'es' as const,
  ...over,
});

describe('AgentMode · objetivo con autoStart', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('arranca la corrida con el objetivo recibido', () => {
    const props = baseProps({
      goalRequest: { text: 'Realiza una AUDITORÍA GENERAL del proyecto', nonce: 1, autoStart: true },
    });

    render(<AgentMode {...props} />);

    expect(props.onStartTask).toHaveBeenCalledTimes(1);
    expect(props.onStartTask.mock.calls[0][0]).toContain('AUDITORÍA GENERAL');
  });

  test('con una corrida viva no lanza otra: sólo prepara el objetivo', () => {
    const props = baseProps({
      state: { ...emptyState, running: true },
      goalRequest: { text: 'Realiza una AUDITORÍA GENERAL del proyecto', nonce: 2, autoStart: true },
    });

    render(<AgentMode {...props} />);

    expect(props.onStartTask).not.toHaveBeenCalled();
  });

  test('sin autoStart (paleta) no arranca nada', () => {
    const props = baseProps({
      goalRequest: { text: 'Usa la herramienta fs.read para ', nonce: 3 },
    });

    render(<AgentMode {...props} />);

    expect(props.onStartTask).not.toHaveBeenCalled();
  });
});
