/**
 * Pantalla PWA de sesión `/pair/session` (F3): turnos y plan de sólo lectura,
 * chat firmado con el `seq` del lease, aprobaciones que se resuelven de verdad
 * con `resolveApproval`, y el 409 del lease pintado tal cual.
 *
 * Se mockea `fetch` con las rutas reales del host y se usa el cliente del lease
 * de verdad: lo que se prueba es el contrato entre la pantalla y el cliente.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PairSessionScreen } from '../../src/features/pair/PairSessionScreen';
import type { PairLease } from '../../src/pair/pairLease';

interface Call {
  url: string;
  method: string;
  body: any;
  credentials?: RequestCredentials;
}

function lease(overrides: Partial<PairLease> = {}): PairLease {
  return {
    sessionId: 'sess_f3',
    deviceId: 'desktop',
    seq: 0,
    acquiredAt: 1_000,
    renewedAt: 1_000,
    expiresAt: null,
    pending: null,
    ...overrides,
  };
}

function stubNet(handler: (url: string, method: string, body: any) => { status?: number; body: any }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init?: any) => {
      const method = String(init?.method ?? 'GET');
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: String(url), method, body, credentials: init?.credentials });
      const result = handler(String(url), method, body);
      const status = result.status ?? 200;
      return { ok: status < 400, status, json: async () => result.body } as any;
    })
  );
  return calls;
}

const device = { body: { success: true, device: { id: 'dev_me' } } };

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('pantalla /pair/session', () => {
  test('muestra turnos y plan, y el chat se firma con el seq del lease', async () => {
    const turns = [
      { role: 'user', text: 'hola', ts: 1 },
      { role: 'assistant', text: 'listo', ts: 2 },
    ];
    const plan = [
      { id: 'p1', text: 'leer el repo', status: 'done', done: true, files: ['src/a.ts'] },
      { id: 'p2', text: 'escribir el fix', status: 'in_progress', done: false },
    ];
    const calls = stubNet((url, method, body) => {
      if (url.endsWith('/api/pair/device')) return device;
      if (url.includes('/api/pair/lease?')) {
        return { body: { success: true, lease: lease(), mine: false, renewMs: 30_000 } };
      }
      if (url.endsWith('/api/pair/lease') && method === 'POST') {
        return {
          body: {
            success: true,
            lease: lease({ deviceId: 'dev_me', seq: 2, expiresAt: 61_000 }),
            mine: true,
            renewMs: 30_000,
          },
        };
      }
      if (url.endsWith('/api/agent/sessions/sess_f3') && method === 'GET') {
        return {
          body: {
            success: true,
            running: true,
            state: { id: 'sess_f3', status: 'running', turns, plan, pendingApproval: null },
          },
        };
      }
      if (url.endsWith('/api/agent/sessions/sess_f3/message') && method === 'POST') {
        turns.push({ role: 'user', text: body.text, ts: 3 });
        return { status: 202, body: { success: true, state: { id: 'sess_f3', turns } } };
      }
      return { status: 404, body: {} };
    });

    render(<PairSessionScreen sessionId="sess_f3" pollMs={0} />);

    await waitFor(() => expect(screen.getByText('leer el repo')).toBeInTheDocument());
    expect(screen.getByTestId('pair-session-status').textContent).toContain('running · sess_f3');
    expect(screen.getAllByTestId('pair-session-turn-user')[0].textContent).toContain('hola');
    expect(screen.getByTestId('pair-session-turn-assistant').textContent).toContain('listo');
    expect(screen.getByTestId('pair-session-plan-p1').textContent).toContain('done');
    expect(screen.getByTestId('pair-session-plan-p1').textContent).toContain('src/a.ts');
    expect(screen.getByTestId('pair-session-plan-p2').textContent).toContain('in_progress');

    // Sin control no se escribe: el compositor está desactivado.
    expect(screen.getByTestId('pair-session-send')).toBeDisabled();

    // El estado de la sesión llega antes que el lease: reclamar necesita que el
    // cliente ya exista y haya leído el control.
    await waitFor(() =>
      expect(screen.getByTestId('pair-session-lease').textContent).toContain('Sólo lectura')
    );
    fireEvent.click(screen.getByTestId('pair-session-claim'));
    await waitFor(() => expect(screen.getByTestId('pair-session-lease').textContent).toContain('Escribís'));

    fireEvent.change(screen.getByTestId('pair-session-reply'), { target: { value: 'seguí' } });
    fireEvent.click(screen.getByTestId('pair-session-send'));

    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.url.endsWith('/api/agent/sessions/sess_f3/message') && call.method === 'POST'
        )
      ).toBe(true)
    );
    const sent = calls.find((call) => call.url.endsWith('/api/agent/sessions/sess_f3/message'))!;
    expect(sent.body).toEqual({ text: 'seguí', seq: 2 });
    expect(sent.credentials).toBe('same-origin');
    await waitFor(() =>
      expect(screen.getAllByTestId('pair-session-turn-user').at(-1)?.textContent).toContain('seguí')
    );
  });

  test('aprobar desde la pantalla resuelve la aprobación con el seq del lease', async () => {
    let resolved = false;
    const approval = {
      id: 'apr_9',
      sessionId: 'sess_f3',
      tool: 'fs.write',
      input: { path: 'src/nuevo.ts' },
      diff: '--- /dev/null\n+++ b/src/nuevo.ts\n+hola\n',
      createdAt: 1_000,
      expiresAt: 61_000,
    };
    const calls = stubNet((url, method) => {
      if (url.endsWith('/api/pair/device')) return device;
      if (url.includes('/api/pair/lease?')) {
        return { body: { success: true, lease: lease({ seq: 3 }), mine: true, renewMs: 30_000 } };
      }
      if (url.endsWith('/api/pair/lease') && method === 'POST') {
        return {
          body: {
            success: true,
            lease: lease({ deviceId: 'dev_me', seq: 3, expiresAt: 61_000 }),
            mine: true,
            renewMs: 30_000,
          },
        };
      }
      if (url.endsWith('/api/agent/sessions/sess_f3') && method === 'GET') {
        return {
          body: {
            success: true,
            running: true,
            state: {
              id: 'sess_f3',
              status: 'running',
              turns: [{ role: 'user', text: 'creá el archivo', ts: 1 }],
              plan: [],
              pendingApproval: resolved ? null : approval,
              pendingApprovals: resolved ? [] : [approval],
            },
          },
        };
      }
      if (url.endsWith('/api/agent/sessions/sess_f3/approvals/apr_9') && method === 'POST') {
        resolved = true;
        return { body: { success: true, decision: 'allow', state: { id: 'sess_f3' } } };
      }
      return { status: 404, body: {} };
    });

    render(<PairSessionScreen sessionId="sess_f3" pollMs={0} />);

    await waitFor(() => expect(screen.getByTestId('pair-session-approval-apr_9')).toBeInTheDocument());
    expect(screen.getByTestId('pair-session-approval-apr_9').textContent).toContain('fs.write · src/nuevo.ts');
    expect(screen.getByTestId('pair-session-approval-diff-apr_9').textContent).toContain('+hola');
    expect(screen.getByTestId('pair-session-allow-apr_9')).toBeDisabled();

    await waitFor(() =>
      expect(screen.getByTestId('pair-session-lease').textContent).not.toContain('Leyendo')
    );
    fireEvent.click(screen.getByTestId('pair-session-claim'));
    await waitFor(() => expect(screen.getByTestId('pair-session-allow-apr_9')).toBeEnabled());

    fireEvent.click(screen.getByTestId('pair-session-allow-apr_9'));

    await waitFor(() => expect(resolved).toBe(true));
    const post = calls.find((call) => call.url.endsWith('/approvals/apr_9'))!;
    expect(post.body).toEqual({ decision: 'allow', seq: 3 });
    await waitFor(() => expect(screen.queryByTestId('pair-session-approval-apr_9')).toBeNull());
    expect(screen.getByTestId('pair-session-note').textContent).toContain('Aprobaste fs.write');
  });

  test('el 409 del lease se pinta tal cual y la pantalla sigue en sólo lectura', async () => {
    stubNet((url, method) => {
      if (url.endsWith('/api/pair/device')) return device;
      if (url.includes('/api/pair/lease?')) {
        return {
          body: {
            success: true,
            lease: lease({ deviceId: 'dev_otro', seq: 5, expiresAt: 61_000 }),
            mine: false,
            renewMs: 30_000,
          },
        };
      }
      if (url.endsWith('/api/pair/lease') && method === 'POST') {
        return {
          status: 409,
          body: {
            success: false,
            code: 'LEASE_HELD',
            error: 'la sesión la escribe otro dispositivo: pedí el traspaso',
          },
        };
      }
      return {
        body: {
          success: true,
          running: true,
          state: { id: 'sess_f3', status: 'running', turns: [], plan: [], pendingApproval: null },
        },
      };
    });

    render(<PairSessionScreen sessionId="sess_f3" pollMs={0} />);
    await waitFor(() =>
      expect(screen.getByTestId('pair-session-lease').textContent).toContain('Sólo lectura')
    );

    fireEvent.click(screen.getByTestId('pair-session-claim'));

    await waitFor(() =>
      expect(screen.getByTestId('pair-session-lease-error').textContent).toContain(
        'LEASE_HELD · la sesión la escribe otro dispositivo: pedí el traspaso'
      )
    );
    expect(screen.getByTestId('pair-session-send')).toBeDisabled();
    expect(screen.getByTestId('pair-session-lease').textContent).toContain('dev_otro');
    expect(screen.getByTestId('pair-session-plan-empty').textContent).toContain('todavía no tiene plan');
  });
});
