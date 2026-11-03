/**
 * Salida en vivo de un `shell.run` en segundo plano.
 *
 * El paso del agente trae el id del trabajo; el panel lo consulta con
 * `shell.job`, muestra el log y deja de sondear cuando el trabajo termina.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ShellJobLog } from '../../src/components/ShellJobLog';

function jsonResponse(data: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ ok: true, data }) } as any;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ShellJobLog', () => {
  test('muestra el log y deja de sondear cuando el trabajo termina', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ id: 'job-1', status: 'running', content: 'primera línea' })
        : jsonResponse({ id: 'job-1', status: 'exited', content: 'primera línea\nlisto', exitCode: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ShellJobLog jobId="job-1" command="npm run build" lang="es" />);
    // Primera lectura al montar.
    await act(async () => {
      await Promise.resolve();
    });

    const log = screen.getByLabelText('Salida del comando');
    expect(log.textContent).toContain('primera línea');
    expect(screen.getByText('EN MARCHA')).toBeTruthy();

    // A los 1000 ms llega la lectura con el trabajo ya terminado.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(log.textContent).toContain('listo');
    expect(screen.getByText('SALIÓ 0')).toBeTruthy();
    expect(screen.queryByTitle('Parar el trabajo')).toBeNull();

    // Sondear de más gastaría peticiones para un log que ya no cambia.
    const after = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchMock.mock.calls.length).toBe(after);
  });

  test('el botón de parar pide shell.job stop para su propio id', async () => {
    const inputs: any[] = [];
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      inputs.push(body);
      return body.input.action === 'stop'
        ? jsonResponse({ id: 'job-1', stopped: true, status: 'stopped' })
        : jsonResponse({ id: 'job-1', status: 'running', content: 'sigue vivo' });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ShellJobLog jobId="job-1" lang="es" />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle('Parar el trabajo'));
      await Promise.resolve();
    });

    expect(inputs.some((b) => b.toolId === 'shell.job' && b.input.action === 'stop' && b.input.id === 'job-1')).toBe(true);
    expect(screen.getByText('DETENIDO')).toBeTruthy();
  });
});
