/**
 * Autoguardado de sesiones del agente.
 *
 * Antes sólo se guardaba al pulsar «parar», así que recargar o cerrar la app a
 * media corrida se llevaba todo el trabajo. Ahora cada paso persiste el estado,
 * agrupado en una escritura por segundo.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveSessionThrottled, loadSessions, type AgentSession } from '../../src/agent/sessions';

function session(id: string, steps: number): AgentSession {
  return {
    id,
    goal: `objetivo ${id}`,
    ts: 1,
    state: {
      task: { id, goal: `objetivo ${id}`, cwd: '.', maxSteps: 40 },
      plan: [],
      steps: Array.from({ length: steps }, (_, i) => ({
        id: `s${i}`,
        type: 'thought',
        title: 'paso',
        content: '',
        status: 'completed',
        ts: i,
      })),
      thinking: true,
      running: true,
    },
  };
}

describe('autoguardado de sesiones', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('varios pasos seguidos se agrupan en una sola escritura', () => {
    saveSessionThrottled(session('a', 1));
    saveSessionThrottled(session('a', 2));
    saveSessionThrottled(session('a', 3));

    // Nada escrito todavía: la escritura está agrupada.
    expect(loadSessions()).toHaveLength(0);

    vi.advanceTimersByTime(1100);

    const saved = loadSessions();
    expect(saved).toHaveLength(1);
    expect(saved[0].state.steps).toHaveLength(3); // queda el último estado
  });

  test('una ráfaga nueva después del margen vuelve a escribir', () => {
    saveSessionThrottled(session('a', 1));
    vi.advanceTimersByTime(1100);
    expect(loadSessions()[0].state.steps).toHaveLength(1);

    saveSessionThrottled(session('a', 5));
    vi.advanceTimersByTime(1100);

    expect(loadSessions()).toHaveLength(1);
    expect(loadSessions()[0].state.steps).toHaveLength(5);
  });
});
