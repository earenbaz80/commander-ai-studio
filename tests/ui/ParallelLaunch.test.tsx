import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ParallelLaunch, MAX_PARALELOS } from '../../src/components/ParallelLaunch';
import { setSubAgentsSession } from '../../src/agent/subAgentsStream';

/**
 * El lanzador rellena la misma petición que haría el modelo: registra la sesión
 * padre, abre su stream y llama a `spawn_agents`. Se prueba el contrato con el
 * servidor porque es lo único que la UI puede romper: el panel de abajo pinta lo
 * que llegue por SSE, y eso ya está cubierto en `ServerSubAgents.test.tsx`.
 */

vi.mock('../../src/agent/subAgentsStream', () => ({
  setSubAgentsSession: vi.fn(),
}));

interface Llamada {
  url: string;
  body: any;
}

function stubFetch(rutas: Record<string, { status?: number; body: any }>): Llamada[] {
  const llamadas: Llamada[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: any) => {
      llamadas.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const clave = Object.keys(rutas).find((k) => String(url).includes(k));
      const r = clave ? rutas[clave] : { status: 404, body: {} };
      const status = r.status ?? 200;
      return { ok: status < 400, status, json: async () => r.body } as any;
    }),
  );
  return llamadas;
}

const rellenar = (valores: string[]) => {
  valores.forEach((valor, i) => {
    fireEvent.change(screen.getByTestId(`parallel-goal-${i}`), { target: { value: valor } });
  });
};

beforeEach(() => {
  vi.mocked(setSubAgentsSession).mockClear();
});

describe('ParallelLaunch', () => {
  test('empieza con dos filas vacías', () => {
    render(<ParallelLaunch cwd="/tmp/proyecto" />);
    expect(screen.getByTestId('parallel-goal-0')).toBeInTheDocument();
    expect(screen.getByTestId('parallel-goal-1')).toBeInTheDocument();
    expect(screen.queryByTestId('parallel-goal-2')).toBeNull();
  });

  test('registra la sesión padre, abre su stream y lanza los objetivos', async () => {
    const llamadas = stubFetch({
      '/api/agent/sessions': { body: { success: true, session: { id: 'sess-9' } } },
      '/api/agent/run-tool': { body: { ok: true, data: { spawned: 2, capped: false } } },
    });
    render(<ParallelLaunch cwd="/tmp/proyecto" />);
    rellenar(['revisar el diff', 'buscar el bug']);

    fireEvent.click(screen.getByTestId('parallel-run'));

    await waitFor(() => expect(screen.getByTestId('parallel-status')).toBeInTheDocument());
    expect(llamadas[0].url).toBe('/api/agent/sessions');
    expect(llamadas[0].body.cwd).toBe('/tmp/proyecto');
    expect(setSubAgentsSession).toHaveBeenCalledWith('sess-9');

    const spawn = llamadas.find((c) => c.url === '/api/agent/run-tool')!;
    expect(spawn.body.toolId).toBe('spawn_agents');
    expect(spawn.body.input.parentSessionId).toBe('sess-9');
    expect(spawn.body.input.agents).toEqual([
      { goal: 'revisar el diff', mode: 'build' },
      { goal: 'buscar el bug', mode: 'build' },
    ]);
  });

  test('manda el modo elegido en cada fila', async () => {
    const llamadas = stubFetch({
      '/api/agent/sessions': { body: { session: { id: 'sess-1' } } },
      '/api/agent/run-tool': { body: { ok: true, data: { spawned: 2 } } },
    });
    render(<ParallelLaunch cwd="/tmp/proyecto" />);
    rellenar(['leer', 'escribir']);
    fireEvent.change(screen.getByTestId('parallel-mode-1'), { target: { value: 'plan' } });

    fireEvent.click(screen.getByTestId('parallel-run'));

    await waitFor(() => expect(screen.getByTestId('parallel-status')).toBeInTheDocument());
    const spawn = llamadas.find((c) => c.url === '/api/agent/run-tool')!;
    expect(spawn.body.input.agents.map((a: any) => a.mode)).toEqual(['build', 'plan']);
  });

  test('con un solo objetivo no llama al servidor', () => {
    const llamadas = stubFetch({});
    render(<ParallelLaunch cwd="/tmp/proyecto" />);
    rellenar(['sólo uno']);

    fireEvent.click(screen.getByTestId('parallel-run'));

    expect(screen.getByTestId('parallel-error').textContent).toContain('al menos dos');
    expect(llamadas).toHaveLength(0);
    expect(setSubAgentsSession).not.toHaveBeenCalled();
  });

  test('no pasa de seis filas y mantiene el mínimo de dos', () => {
    render(<ParallelLaunch cwd="/tmp/proyecto" />);
    for (let i = 0; i < MAX_PARALELOS; i++) fireEvent.click(screen.getByTestId('parallel-add'));
    expect(screen.queryByTestId(`parallel-goal-${MAX_PARALELOS}`)).toBeNull();
    expect(screen.getByTestId('parallel-add')).toBeDisabled();

    // Con más de dos, quitar sigue permitido; con dos, no.
    fireEvent.click(screen.getByTestId('parallel-remove-0'));
    expect(screen.queryByTestId('parallel-goal-5')).toBeNull();
  });

  test('si el servidor no registra la sesión padre, lo dice y no lanza nada', async () => {
    const llamadas = stubFetch({ '/api/agent/sessions': { status: 400, body: { error: 'cwd fuera de los proyectos' } } });
    render(<ParallelLaunch cwd="/tmp/proyecto" />);
    rellenar(['uno', 'dos']);

    fireEvent.click(screen.getByTestId('parallel-run'));

    await waitFor(() => expect(screen.getByTestId('parallel-error').textContent).toContain('cwd fuera'));
    expect(llamadas.some((c) => c.url === '/api/agent/run-tool')).toBe(false);
    expect(setSubAgentsSession).not.toHaveBeenCalled();
  });

  test('con una tarea en curso el lanzador está bloqueado y lo explica', () => {
    render(<ParallelLaunch cwd="/tmp/proyecto" running />);
    rellenar(['uno', 'dos']);
    expect(screen.getByTestId('parallel-run')).toBeDisabled();
    expect(screen.getByTestId('parallel-blocked')).toBeInTheDocument();
  });
});
