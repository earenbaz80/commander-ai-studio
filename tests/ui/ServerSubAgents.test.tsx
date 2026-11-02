import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor, within } from '@testing-library/react';
import { ServerSubAgents } from '../../src/components/ServerSubAgents';
import {
  closeSubAgentsSession,
  setSubAgentsSession,
} from '../../src/agent/subAgentsStream';
import { ATASCO_KEY, PREFERENCIAS_EVENT } from '../../src/components/ServerSubAgents';

/**
 * El panel ya no sondea: pinta lo que llega por el stream de la sesión padre.
 * Se prueba con un `EventSource` falso, así que estos casos cubren el cableado
 * (abrir, recibir, cerrar) y el render del estado y del resultado.
 */

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  readyState = 0;
  private listeners = new Map<string, ((ev: MessageEvent) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (ev: MessageEvent) => void) {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
  }
  close() { this.closed = true; this.readyState = 2; }
  emit(name: string, payload: unknown) {
    for (const fn of this.listeners.get(name) ?? []) fn({ data: JSON.stringify(payload) } as MessageEvent);
  }
  open() {
    this.readyState = 1;
    for (const fn of this.listeners.get('open') ?? []) fn({} as MessageEvent);
  }
  fail(readyState: 0 | 2) {
    this.readyState = readyState;
    for (const fn of this.listeners.get('error') ?? []) fn({} as MessageEvent);
  }
}

const fila = (id: string, goal: string, status: 'running' | 'completed' | 'failed' | 'cancelled', extra: Record<string, unknown> = {}) => ({
  id, parentSessionId: 'sess-1', goal, model: 'm', status, startedAt: 1, endedAt: 2, steps: 0, ...extra,
});

beforeEach(() => {
  closeSubAgentsSession();
  FakeEventSource.instances = [];
  (globalThis as any).EventSource = FakeEventSource;
});

afterEach(() => {
  closeSubAgentsSession();
});

describe('ServerSubAgents', () => {
  test('sin subagentes lo dice', () => {
    render(<ServerSubAgents />);
    expect(screen.getByText('Sin subagentes todavía…')).toBeInTheDocument();
  });

  test('muestra estado y respuesta final de lo que llega por el stream', () => {
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    expect(FakeEventSource.instances[0].url).toBe('/api/agent/sessions/sess-1/events');

    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'revisar el diff', 'running', { steps: 3 }),
        fila('s2', 'buscar el bug', 'completed', { answer: 'encontrado en x.ts', steps: 5 }),
      ],
    }));

    expect(screen.getByText('revisar el diff')).toBeInTheDocument();
    expect(screen.getByText('buscar el bug')).toBeInTheDocument();
    expect(screen.getByText('completo')).toBeInTheDocument();
    expect(screen.getByText('encontrado en x.ts')).toBeInTheDocument();
    expect(screen.getByText('1 corriendo · 1/2 terminados · 50 %')).toBeInTheDocument();
  });

  test('muestra cuántos terminaron del total y el porcentaje de avance', () => {
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'a', 'completed', { startedAt: 100, endedAt: 200 }),
        fila('s2', 'b', 'failed', { startedAt: 300, endedAt: 400 }),
        fila('s3', 'c', 'running', { startedAt: 500 }),
        fila('s4', 'd', 'running', { startedAt: 600 }),
      ],
    }));

    expect(screen.getByTestId('subagents-progress')).toHaveTextContent('2 corriendo · 2/4 terminados · 50 %');

    // Al terminar el último, el avance llega a 100 y desaparece el «corriendo».
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'a', 'completed', { startedAt: 100, endedAt: 200 }),
        fila('s2', 'b', 'failed', { startedAt: 300, endedAt: 400 }),
        fila('s3', 'c', 'completed', { startedAt: 500, endedAt: 900 }),
        fila('s4', 'd', 'completed', { startedAt: 600, endedAt: 950 }),
      ],
    }));

    expect(screen.getByTestId('subagents-progress')).toHaveTextContent('4/4 terminados · 100 %');
  });

  test('al montarse pinta lo último recibido, aunque el panel estuviera cerrado', () => {
    // El stream vive atado a la sesión, no al panel: el estado llega antes.
    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [fila('s1', 'falla', 'failed', { error: 'sin cuota' })],
    }));

    render(<ServerSubAgents />);

    expect(screen.getByText('falla')).toBeInTheDocument();
    expect(screen.getByText('falló')).toBeInTheDocument();
    expect(screen.getByText('sin cuota')).toBeInTheDocument();
  });

  test('de cada terminado muestra tiempo, pasos y respuesta', () => {
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'revisar el diff', 'completed', {
          startedAt: 1_000,
          endedAt: 3_500, // 2.5 s
          steps: 5,
          answer: 'encontrado en x.ts',
        }),
        fila('s2', 'buscar el bug', 'failed', {
          startedAt: 10_000,
          endedAt: 71_000, // 1 m 1 s
          steps: 1,
          error: 'sin cuota',
        }),
        fila('s3', 'redacción', 'completed', { startedAt: 1_000, endedAt: 1_250, steps: 0 }),
      ],
    }));

    expect(screen.getByText('2.5 s · 5 pasos')).toBeInTheDocument();
    expect(screen.getByText('encontrado en x.ts')).toBeInTheDocument();
    expect(screen.getByText('1 m 1 s · 1 paso')).toBeInTheDocument();
    expect(screen.getByText('sin cuota')).toBeInTheDocument();
    // Sin pasos no queda un «·» suelto.
    expect(screen.getByText('250 ms')).toBeInTheDocument();
  });

  test('los que corren van primero y el más reciente queda a la vista al abrir', () => {
    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'viejo corriendo', 'running', { startedAt: 100 }),
        fila('s2', 'antiguo', 'completed', { startedAt: 200, endedAt: 300 }),
        fila('s3', 'reciente', 'completed', { startedAt: 900, endedAt: 1_000, answer: 'listo' }),
      ],
    }));

    // El setup de jsdom deja `scrollIntoView` como mock; aquí se sustituye para
    // saber a qué fila se ancló el panel al montarse.
    const original = Element.prototype.scrollIntoView;
    let anclado: Element | null = null;
    (Element.prototype as any).scrollIntoView = function (this: Element) { anclado = this; };

    try {
      render(<ServerSubAgents />);

      const filas = screen.getAllByRole('listitem');
      expect(filas[0]).toHaveTextContent('viejo corriendo');
      expect(filas[1]).toHaveTextContent('reciente');
      expect(filas[2]).toHaveTextContent('antiguo');
      // No es la primera fila, así que sin anclar el panel abriría mirando a otro.
      expect(anclado).toBe(filas[1]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  test('la fila del más reciente se queda pegada arriba de la lista', () => {
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'viejo corriendo', 'running', { startedAt: 100 }),
        fila('s2', 'reciente', 'completed', { startedAt: 900, endedAt: 1_000 }),
      ],
    }));

    const filas = screen.getAllByRole('listitem');
    expect(filas[1]).toHaveAttribute('data-pinned', 'true');
    expect(filas[1].className).toContain('sticky');
    expect(filas[0]).not.toHaveAttribute('data-pinned');
    // La lista scrollea sola, así que la fila pegada no se va con la página.
    expect(filas[0].parentElement?.className).toContain('overflow-y-auto');
  });

  test('permite plegar la respuesta de un subagente y volver a abrirla', () => {
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'revisar el diff', 'completed', { answer: 'encontrado en x.ts' }),
        fila('s2', 'buscar el bug', 'completed', { answer: 'era un off-by-one' }),
      ],
    }));

    const [primera, segunda] = screen.getAllByRole('listitem');
    // Abiertas de entrada: el resultado no se esconde solo.
    expect(within(primera).getByText('encontrado en x.ts')).toBeInTheDocument();

    const boton = within(primera).getByTestId('subagent-answer-toggle');
    expect(boton).toHaveAttribute('aria-expanded', 'true');

    act(() => boton.click());

    // Sólo se pliega la suya; la otra fila conserva su texto.
    expect(within(primera).queryByText('encontrado en x.ts')).not.toBeInTheDocument();
    expect(within(segunda).getByText('era un off-by-one')).toBeInTheDocument();
    expect(within(primera).getByText('ver respuesta')).toBeInTheDocument();

    act(() => within(primera).getByTestId('subagent-answer-toggle').click());

    expect(within(primera).getByText('encontrado en x.ts')).toBeInTheDocument();
    expect(within(primera).getByTestId('subagent-answer-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  test('recuerda entre montajes del panel qué respuestas quedaron plegadas', () => {
    const { unmount } = render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [fila('s1', 'revisar el diff', 'completed', { answer: 'encontrado en x.ts' })],
    }));

    act(() => screen.getByTestId('subagent-answer-toggle').click());
    expect(screen.queryByText('encontrado en x.ts')).not.toBeInTheDocument();

    // Cerrar y volver a abrir el panel: no debería desplegarse sola otra vez.
    unmount();
    render(<ServerSubAgents />);

    expect(screen.getByText('revisar el diff')).toBeInTheDocument();
    expect(screen.queryByText('encontrado en x.ts')).not.toBeInTheDocument();
    expect(screen.getByText('ver respuesta')).toBeInTheDocument();

    // Y sigue pudiéndose abrir a mano.
    act(() => screen.getByTestId('subagent-answer-toggle').click());
    expect(screen.getByText('encontrado en x.ts')).toBeInTheDocument();
  });

  test('con un almacenamiento corrupto empieza sin nada plegado', () => {
    localStorage.setItem('commander_subagents_collapsed_v1', '{no es json');

    render(<ServerSubAgents />);
    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [fila('s1', 'revisar', 'completed', { answer: 'listo' })],
    }));

    expect(screen.getByText('listo')).toBeInTheDocument();
  });

  test('la fila pegada resume cuántos corren y desde cuándo, y el tiempo avanza', () => {
    const t0 = 1_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);
    try {
      render(<ServerSubAgents />);
      act(() => setSubAgentsSession('sess-1'));
      act(() => FakeEventSource.instances[0].emit('subagents', {
        subagents: [
          fila('s1', 'viejo corriendo', 'running', { startedAt: t0 - 40_000 }),
          fila('s2', 'nuevo corriendo', 'running', { startedAt: t0 - 5_000 }),
          fila('s3', 'reciente', 'completed', { startedAt: t0 - 1_000, endedAt: t0 - 500 }),
        ],
      }));

      const resumen = screen.getByTestId('subagent-pinned-summary');
      // El resumen vive en la fila pegada, que es la del último lanzado.
      expect(within(resumen.closest('li') as HTMLElement).getByText('reciente')).toBeInTheDocument();
      expect(resumen).toHaveTextContent('2 corriendo · el más antiguo hace 40 s');

      // Sin reloj vivo el número se quedaría congelado en el del último evento.
      act(() => { vi.advanceTimersByTime(5_000); });
      expect(screen.getByTestId('subagent-pinned-summary')).toHaveTextContent(
        '2 corriendo · el más antiguo hace 45 s'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test('con uno solo el resumen dice «1 corriendo», y desaparece al terminar', () => {
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [fila('s1', 'revisar', 'running', { startedAt: Date.now() - 3_000 })],
    }));

    expect(screen.getByTestId('subagent-pinned-summary')).toHaveTextContent(/^1 corriendo · hace \d+ s$/);

    // Terminado: ya no hay nada corriendo que resumir.
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [fila('s1', 'revisar', 'completed', { startedAt: Date.now() - 3_000, endedAt: Date.now(), answer: 'listo' })],
    }));

    expect(screen.queryByTestId('subagent-pinned-summary')).not.toBeInTheDocument();
  });

  test('recorta las respuestas largas y deja ver el resto', () => {
    const larga = 'a'.repeat(600) + 'FINAL';
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'revisar el diff', 'completed', { answer: larga }),
        fila('s2', 'corto', 'completed', { answer: 'listo' }),
      ],
    }));

    const [primera, segunda] = screen.getAllByRole('listitem');
    // Recortada: 400 caracteres más la elipsis, sin llegar al final.
    expect(within(primera).getByTestId('subagent-answer').textContent).toBe('a'.repeat(400) + '…');

    const mas = within(primera).getByTestId('subagent-answer-more');
    // 605 caracteres: 600 de relleno + 'FINAL'.
    expect(mas).toHaveTextContent('ver el resto (205 caracteres más)');

    act(() => mas.click());

    expect(within(primera).getByTestId('subagent-answer').textContent).toBe(larga);
    act(() => within(primera).getByTestId('subagent-answer-more').click());
    expect(within(primera).getByTestId('subagent-answer').textContent).toBe('a'.repeat(400) + '…');

    // Una respuesta corta no lleva botón ni elipsis añadida.
    expect(within(segunda).queryByTestId('subagent-answer-more')).not.toBeInTheDocument();
    expect(within(segunda).getByText('listo')).toBeInTheDocument();
  });

  test('resalta el que lleva demasiado tiempo corriendo, sin recargar nada', () => {
    const t0 = 2_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);
    try {
      render(<ServerSubAgents />);
      act(() => setSubAgentsSession('sess-1'));
      act(() => FakeEventSource.instances[0].emit('subagents', {
        subagents: [
          // 4 m 59 s: justo por debajo del umbral de 5 minutos.
          fila('s1', 'lento', 'running', { startedAt: t0 - (5 * 60_000 - 1_000) }),
          fila('s2', 'normal', 'running', { startedAt: t0 - 10_000 }),
        ],
      }));

      // El más reciente va primero, así que «lento» es la segunda fila.
      const filaDe = (goal: string) => screen.getByText(goal).closest('li') as HTMLElement;
      expect(filaDe('lento')).not.toHaveAttribute('data-stuck');
      expect(within(filaDe('normal')).queryByTestId('subagent-stuck')).not.toBeInTheDocument();

      // Un segundo después cruza el umbral: el aviso sale con el reloj vivo.
      act(() => { vi.advanceTimersByTime(1_000); });

      expect(filaDe('lento')).toHaveAttribute('data-stuck', 'true');
      // El aviso dice el umbral vigente, para no tener que ir a Preferencias.
      expect(within(filaDe('lento')).getByTestId('subagent-stuck')).toHaveTextContent('posible atasco (> 5 min)');
      expect(within(filaDe('normal')).queryByTestId('subagent-stuck')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test('la barra de progreso sigue al mismo porcentaje que el texto', () => {
    const { container } = render(<ServerSubAgents />);

    // Sin filas no hay barra que pintar.
    expect(screen.queryByTestId('subagents-progress-bar')).not.toBeInTheDocument();

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'a', 'completed', { startedAt: 100, endedAt: 200 }),
        fila('s2', 'b', 'running', { startedAt: 300 }),
        fila('s3', 'c', 'running', { startedAt: 400 }),
      ],
    }));

    const barra = screen.getByRole('progressbar');
    expect(barra).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getByTestId('subagents-progress')).toHaveTextContent('2 corriendo · 1/3 terminados · 33 %');
    expect(screen.getByTestId('subagents-progress-fill')).toHaveStyle({ width: '33%' });

    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'a', 'completed', { startedAt: 100, endedAt: 200 }),
        fila('s2', 'b', 'completed', { startedAt: 300, endedAt: 500 }),
        fila('s3', 'c', 'failed', { startedAt: 400, endedAt: 600, error: 'sin cuota' }),
      ],
    }));

    expect(screen.getByTestId('subagents-progress-fill')).toHaveStyle({ width: '100%' });
    expect(container.firstChild).toContainElement(screen.getByTestId('subagents-progress-bar'));
  });

  test('el umbral de atasco sale de las preferencias y se actualiza en vivo', () => {
    const t0 = 3_000_000;
    // Guardado: 10 min. Un subagente de 2 min no es atasco con ese umbral.
    localStorage.setItem(ATASCO_KEY, '10');
    vi.useFakeTimers();
    vi.setSystemTime(t0);
    try {
      render(<ServerSubAgents />);
      act(() => setSubAgentsSession('sess-1'));
      act(() => FakeEventSource.instances[0].emit('subagents', {
        subagents: [fila('s1', 'revisar', 'running', { startedAt: t0 - 2 * 60_000 })],
      }));

      const filaDe = () => screen.getByText('revisar').closest('li') as HTMLElement;
      expect(filaDe()).not.toHaveAttribute('data-stuck');

      // Bajar el umbral a 1 minuto desde Preferencias: el aviso sale sin recargar.
      act(() => {
        localStorage.setItem(ATASCO_KEY, '1');
        window.dispatchEvent(new Event(PREFERENCIAS_EVENT));
      });

      expect(filaDe()).toHaveAttribute('data-stuck', 'true');
      // Y el texto refleja el umbral nuevo, no el de cuando se montó el panel.
      expect(within(filaDe()).getByTestId('subagent-stuck')).toHaveTextContent('posible atasco (> 1 min)');

      // Y subirlo otra vez lo retira.
      act(() => {
        localStorage.setItem(ATASCO_KEY, '30');
        window.dispatchEvent(new Event(PREFERENCIAS_EVENT));
      });

      expect(filaDe()).not.toHaveAttribute('data-stuck');
    } finally {
      vi.useRealTimers();
    }
  });

  test('un umbral guardado inválido cae al valor por defecto', () => {
    const t0 = 4_000_000;
    localStorage.setItem(ATASCO_KEY, 'no-es-un-numero');
    vi.useFakeTimers();
    vi.setSystemTime(t0);
    try {
      render(<ServerSubAgents />);
      act(() => setSubAgentsSession('sess-1'));
      act(() => FakeEventSource.instances[0].emit('subagents', {
        // 6 minutos: por encima del defecto de 5, por debajo de cualquier locura.
        subagents: [fila('s1', 'revisar', 'running', { startedAt: t0 - 6 * 60_000 })],
      }));

      expect(screen.getByText('revisar').closest('li')).toHaveAttribute('data-stuck', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  test('la barra se tiñe cuando algún subagente falló', () => {
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'a', 'completed', { startedAt: 100, endedAt: 200 }),
        fila('s2', 'b', 'running', { startedAt: 300 }),
      ],
    }));

    const relleno = screen.getByTestId('subagents-progress-fill');
    expect(relleno).toHaveClass('bg-[#00ffff]');
    expect(relleno).not.toHaveAttribute('data-failed');

    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'a', 'completed', { startedAt: 100, endedAt: 200 }),
        fila('s2', 'b', 'failed', { startedAt: 300, endedAt: 400, error: 'sin cuota' }),
      ],
    }));

    const teñido = screen.getByTestId('subagents-progress-fill');
    expect(teñido).toHaveClass('bg-red-400');
    expect(teñido).toHaveAttribute('data-failed', 'true');
    // El porcentaje no cambia: un fallo también cuenta como terminado.
    expect(screen.getByTestId('subagents-progress-fill')).toHaveStyle({ width: '100%' });
  });

  test('filtra para ver sólo los fallidos, y vuelve a todos', () => {
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'revisar el diff', 'completed', { startedAt: 100, endedAt: 200 }),
        fila('s2', 'buscar el bug', 'failed', { startedAt: 300, endedAt: 400, error: 'sin cuota' }),
        fila('s3', 'redactar', 'running', { startedAt: 500 }),
      ],
    }));

    const filtro = screen.getByTestId('subagents-filter-failed');
    expect(filtro).toHaveTextContent('sólo fallidos (1)');
    expect(filtro).toHaveAttribute('aria-pressed', 'false');

    act(() => filtro.click());

    expect(screen.getByText('buscar el bug')).toBeInTheDocument();
    expect(screen.queryByText('revisar el diff')).not.toBeInTheDocument();
    expect(screen.queryByText('redactar')).not.toBeInTheDocument();
    expect(screen.getByTestId('subagents-filter-failed')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('subagents-filter-failed')).toHaveTextContent('ver todos');

    act(() => screen.getByTestId('subagents-filter-failed').click());

    expect(screen.getByText('revisar el diff')).toBeInTheDocument();
    expect(screen.getByText('redactar')).toBeInTheDocument();
  });

  test('recuerda el filtro de fallidos entre montajes del panel', () => {
    const { unmount } = render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'revisar el diff', 'completed', { startedAt: 100, endedAt: 200 }),
        fila('s2', 'buscar el bug', 'failed', { startedAt: 300, endedAt: 400, error: 'sin cuota' }),
      ],
    }));

    act(() => screen.getByTestId('subagents-filter-failed').click());
    expect(screen.queryByText('revisar el diff')).not.toBeInTheDocument();

    unmount();
    render(<ServerSubAgents />);

    // Sigue en la vista de fallos al reabrir, sin tener que volver a pulsar.
    expect(screen.getByText('buscar el bug')).toBeInTheDocument();
    expect(screen.queryByText('revisar el diff')).not.toBeInTheDocument();
    expect(screen.getByTestId('subagents-filter-failed')).toHaveAttribute('aria-pressed', 'true');

    // Y se puede salir con el mismo botón.
    act(() => screen.getByTestId('subagents-filter-failed').click());
    expect(screen.getByText('revisar el diff')).toBeInTheDocument();
  });

  test('sin fallos no aparece el filtro', () => {
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [fila('s1', 'revisar', 'completed', { answer: 'listo' })],
    }));

    expect(screen.queryByTestId('subagents-filter-failed')).not.toBeInTheDocument();
  });

  test('en inglés los textos del panel salen en inglés', () => {
    const t0 = 5_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);
    try {
      render(<ServerSubAgents lang="en" />);
      act(() => setSubAgentsSession('sess-1'));
      act(() => FakeEventSource.instances[0].open());
      act(() => FakeEventSource.instances[0].emit('subagents', {
        subagents: [
          fila('s1', 'revisar', 'running', { startedAt: t0 - 40_000 }),
          fila('s2', 'buscar', 'completed', { startedAt: 1_000, endedAt: 3_500, steps: 5, answer: 'found' }),
        ],
      }));

      expect(screen.getByText('Server subagents')).toBeInTheDocument();
      expect(screen.getByText('● live')).toBeInTheDocument();
      expect(screen.getByTestId('subagents-progress')).toHaveTextContent('1 running · 1/2 finished · 50 %');
      expect(screen.getByText('running')).toBeInTheDocument();
      expect(screen.getByText('done')).toBeInTheDocument();
      // El resumen llevaba la preposición dentro de la frase: en inglés va detrás.
      expect(screen.getByTestId('subagent-pinned-summary')).toHaveTextContent('1 running · 40 s ago');
      expect(screen.getByTestId('subagent-meta')).toHaveTextContent('2.5 s · 5 steps');
      expect(screen.getByText('hide answer')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test('en alemán usa el diccionario, con inglés de reserva', () => {
    render(<ServerSubAgents lang="de" />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [
        fila('s1', 'revisar', 'completed', { answer: 'listo' }),
        fila('s2', 'buscar', 'failed', { error: 'sin cuota' }),
      ],
    }));

    expect(screen.getByText('Server-Unteragenten')).toBeInTheDocument();
    expect(screen.getByText('fertig')).toBeInTheDocument();
    expect(screen.getByText('fehlgeschlagen')).toBeInTheDocument();
    expect(screen.getByText('Antwort ausblenden')).toBeInTheDocument();
    expect(screen.getByTestId('subagents-filter-failed')).toHaveTextContent('nur fehlgeschlagene (1)');
  });

  test('muestra si el stream está en vivo', () => {
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].open());

    expect(screen.getByText('● en vivo')).toBeInTheDocument();
    expect(screen.queryByTestId('subagents-stale')).not.toBeInTheDocument();
  });

  test('al caerse el stream avisa de que el estado puede estar desfasado', () => {
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].open());
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [fila('s1', 'revisar', 'running')],
    }));

    // Corte corriente: el navegador reintenta, pero la lista ya no es fiable.
    act(() => FakeEventSource.instances[0].fail(0));

    expect(screen.getByText('● reconectando…')).toBeInTheDocument();
    expect(screen.getByTestId('subagents-stale')).toBeInTheDocument();
    expect(screen.getByText('revisar')).toBeInTheDocument();
  });

  test('al volver la red reconecta y vuelve a mostrar el estado en vivo', () => {
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].open());
    act(() => FakeEventSource.instances[0].fail(0));

    act(() => { window.dispatchEvent(new Event('online')); });

    expect(FakeEventSource.instances.length).toBe(2);

    act(() => FakeEventSource.instances[1].open());
    act(() => FakeEventSource.instances[1].emit('subagents', {
      subagents: [fila('s1', 'revisar', 'completed', { answer: 'listo' })],
    }));

    expect(screen.getByText('● en vivo')).toBeInTheDocument();
    expect(screen.queryByTestId('subagents-stale')).not.toBeInTheDocument();
    expect(screen.getByText('listo')).toBeInTheDocument();
  });

  test('si la sesión del servidor ya no existe lo dice y no reintenta', async () => {
    const fetchOriginal = globalThis.fetch;
    let llamadas = 0;
    (globalThis as any).fetch = async () => {
      llamadas += 1;
      return { status: 404, ok: false } as Response;
    };

    try {
      render(<ServerSubAgents />);
      act(() => setSubAgentsSession('sess-1'));
      act(() => FakeEventSource.instances[0].open());
      act(() => FakeEventSource.instances[0].fail(2));

      await waitFor(() => expect(screen.getByText('● sesión cerrada')).toBeInTheDocument());
      expect(llamadas).toBe(1);
      expect(screen.getByText(/La sesión del servidor ya no existe/)).toBeInTheDocument();
      expect(FakeEventSource.instances.length).toBe(1);
    } finally {
      (globalThis as any).fetch = fetchOriginal;
    }
  });

  test('un subagente cancelado se ve como cancelado, no como fallo', () => {
    render(<ServerSubAgents />);

    act(() => setSubAgentsSession('sess-1'));
    act(() => FakeEventSource.instances[0].emit('subagents', {
      subagents: [fila('s1', 'probar', 'cancelled', { error: 'Cancelado por el usuario' })],
    }));

    const li = screen.getByText('probar').closest('li') as HTMLElement;
    expect(li.getAttribute('data-status')).toBe('cancelled');
    expect(within(li).getByText('cancelado')).toBeInTheDocument();
    expect(within(li).queryByText('falló')).not.toBeInTheDocument();
    // Cuenta como terminado para el progreso: ya no corre, pero tampoco falló.
    expect(screen.getByTestId('subagents-progress')).toHaveTextContent('1/1');
  });
});
