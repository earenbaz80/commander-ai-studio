/**
 * Pantalla `/pair` (F3): el 409 LEASE_HELD se ve tal cual, la renovación sólo
 * corre con el control confirmado y el traspaso muestra el `ack` antes de dar
 * la escritura por buena.
 *
 * Se mockea `fetch` con las rutas reales del host; el cliente del lease corre
 * de verdad, así que lo que se prueba es el contrato entre la UI y el cliente,
 * no una copia de la lógica.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PairControlScreen } from '../../src/features/pair/PairControlScreen';
import type { PairLease } from '../../src/pair/pairLease';

interface Call {
  url: string;
  method: string;
  body: any;
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
      calls.push({ url: String(url), method, body });
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

describe('pantalla /pair', () => {
  test('muestra el 409 LEASE_HELD al reclamar y no habilita la escritura', async () => {
    stubNet((url, method) => {
      if (url.endsWith('/api/pair/device')) return device;
      if (url.includes('/api/pair/lease?')) {
        return {
          body: {
            success: true,
            lease: lease({ deviceId: 'dev_otro', seq: 2, expiresAt: 61_000 }),
            mine: false,
            renewMs: 30_000,
          },
        };
      }
      if (url.endsWith('/api/pair/lease') && method === 'POST') {
        return {
          status: 409,
          body: { success: false, code: 'LEASE_HELD', error: 'la sesión la escribe otro dispositivo: pedí el traspaso' },
        };
      }
      return { status: 404, body: {} };
    });

    render(<PairControlScreen sessionId="sess_f3" />);
    await waitFor(() => expect(screen.getByTestId('pair-status').textContent).toContain('Sólo lectura'));

    fireEvent.click(screen.getByTestId('pair-claim'));

    await waitFor(() => expect(screen.getByTestId('pair-error').textContent).toContain('LEASE_HELD'));
    expect(screen.getByTestId('pair-error').textContent).toContain('pedí el traspaso');
    expect(screen.getByTestId('pair-status').textContent).toContain('Sólo lectura');
    expect(screen.queryByTestId('pair-release')).toBeNull();
    expect(screen.getByTestId('pair-renewal').textContent).toContain('detenida');
  });

  test('al reclamar enciende la escritura y arranca la renovación', async () => {
    stubNet((url, method) => {
      if (url.endsWith('/api/pair/device')) return device;
      if (url.includes('/api/pair/lease?')) {
        return { body: { success: true, lease: lease(), mine: false, renewMs: 30_000 } };
      }
      if (url.endsWith('/api/pair/lease') && method === 'POST') {
        return {
          body: {
            success: true,
            lease: lease({ deviceId: 'dev_me', seq: 1, expiresAt: 61_000 }),
            mine: true,
            renewMs: 30_000,
          },
        };
      }
      return { status: 404, body: {} };
    });

    render(<PairControlScreen sessionId="sess_f3" />);
    await waitFor(() => expect(screen.getByTestId('pair-status').textContent).toContain('Sólo lectura'));

    fireEvent.click(screen.getByTestId('pair-claim'));

    await waitFor(() => expect(screen.getByTestId('pair-status').textContent).toContain('Tenés el control'));
    expect(screen.getByTestId('pair-renewal').textContent).toContain('Renovación activa');
    expect(screen.getByTestId('pair-owner').textContent).toContain('dev_me');
    expect(screen.getByTestId('pair-release')).toBeInTheDocument();
  });

  test('aceptar el traspaso muestra el ack y deja la escritura en el nuevo dueño', async () => {
    stubNet((url, method) => {
      if (url.endsWith('/api/pair/device')) return device;
      if (url.includes('/api/pair/lease?')) {
        return {
          body: {
            success: true,
            lease: lease({
              deviceId: 'dev_me',
              seq: 5,
              expiresAt: 61_000,
              pending: { deviceId: 'dev_otro', requestedAt: 2_000 },
            }),
            mine: true,
            renewMs: 30_000,
          },
        };
      }
      if (url.endsWith('/api/pair/lease') && method === 'POST') {
        return {
          body: {
            success: true,
            lease: lease({
              deviceId: 'dev_me',
              seq: 6,
              expiresAt: 61_000,
              pending: { deviceId: 'dev_otro', requestedAt: 2_000 },
            }),
            mine: true,
            renewMs: 30_000,
          },
        };
      }
      if (url.endsWith('/api/pair/lease/transfer')) {
        return {
          body: {
            success: true,
            lease: lease({ deviceId: 'dev_otro', seq: 7, expiresAt: 61_000 }),
            ack: { deviceId: 'dev_otro', seq: 7, at: 7_000 },
          },
        };
      }
      return { status: 404, body: {} };
    });

    render(<PairControlScreen sessionId="sess_f3" />);
    await waitFor(() => expect(screen.getByTestId('pair-status').textContent).toContain('falta confirmarlo'));
    expect(screen.getByTestId('pair-pending').textContent).toContain('Traspaso pedido por dev_otro');

    fireEvent.click(screen.getByTestId('pair-claim'));
    await waitFor(() => expect(screen.getByTestId('pair-accept')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('pair-accept'));

    await waitFor(() => expect(screen.getByTestId('pair-ack')).toBeInTheDocument());
    expect(screen.getByTestId('pair-ack').textContent).toContain('dev_otro');
    expect(screen.getByTestId('pair-ack').textContent).toContain('seq 7');
    expect(screen.getByTestId('pair-status').textContent).toContain('Sólo lectura');
    expect(screen.getByTestId('pair-renewal').textContent).toContain('detenida');
    expect(screen.queryByTestId('pair-release')).toBeNull();
  });

  test('pedir el traspaso deja la solicitud visible y desactiva el botón', async () => {
    let requested = false;
    stubNet((url) => {
      if (url.endsWith('/api/pair/device')) return device;
      if (url.includes('/api/pair/lease?')) {
        return {
          body: {
            success: true,
            lease: lease({ deviceId: 'dev_otro', seq: 3, expiresAt: 61_000 }),
            mine: false,
            renewMs: 30_000,
          },
        };
      }
      if (url.endsWith('/api/pair/lease/request')) {
        requested = true;
        return {
          body: {
            success: true,
            lease: lease({
              deviceId: 'dev_otro',
              seq: 3,
              expiresAt: 61_000,
              pending: { deviceId: 'dev_me', requestedAt: 9_000 },
            }),
          },
        };
      }
      return { status: 404, body: {} };
    });

    render(<PairControlScreen sessionId="sess_f3" />);
    await waitFor(() => expect(screen.getByTestId('pair-request')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('pair-request'));

    await waitFor(() => expect(requested).toBe(true));
    await waitFor(() =>
      expect(screen.getByTestId('pair-pending').textContent).toContain('Traspaso pedido por dev_me')
    );
    expect(screen.getByTestId('pair-pending').textContent).toContain('esperando que el dueño');
    expect(screen.getByTestId('pair-request')).toBeDisabled();
  });

  test('sin cookie de dispositivo lo avisa y aun así muestra el control', async () => {
    stubNet((url) => {
      if (url.endsWith('/api/pair/device')) {
        return { status: 401, body: { success: false, error: 'dispositivo no autorizado' } };
      }
      return { body: { success: true, lease: lease(), mine: false, renewMs: 30_000 } };
    });

    render(<PairControlScreen sessionId="sess_f3" />);

    await waitFor(() => expect(screen.getByTestId('pair-device-note').textContent).toContain('no está emparejado'));
    await waitFor(() => expect(screen.getByTestId('pair-status').textContent).toContain('Sólo lectura'));
  });

  test('un dispositivo emparejado aprueba desde la pantalla con el seq del lease', async () => {
    let resolved = false;
    const approval = {
      id: 'apr_1',
      sessionId: 'sess_f3',
      tool: 'fs.edit',
      input: { path: 'src/a.ts' },
      diff: '--- a/src/a.ts\n+++ b/src/a.ts\n',
      createdAt: 1_000,
      expiresAt: 61_000,
    };
    const calls = stubNet((url, method) => {
      if (url.endsWith('/api/pair/device')) return device;
      if (url.includes('/api/pair/lease?')) {
        return {
          body: {
            success: true,
            lease: lease({ deviceId: 'dev_me', seq: 4, expiresAt: 61_000 }),
            mine: false,
            renewMs: 30_000,
          },
        };
      }
      if (url.endsWith('/api/pair/lease') && method === 'POST') {
        return {
          body: {
            success: true,
            lease: lease({ deviceId: 'dev_me', seq: 5, expiresAt: 61_000 }),
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
              pendingApproval: resolved ? null : approval,
              pendingApprovals: resolved ? [] : [approval],
            },
          },
        };
      }
      if (url.endsWith('/api/agent/sessions/sess_f3/approvals/apr_1') && method === 'POST') {
        resolved = true;
        return { body: { success: true, approval: { id: 'apr_1', decision: 'allow' } } };
      }
      return { status: 404, body: {} };
    });

    render(<PairControlScreen sessionId="sess_f3" />);
    await waitFor(() => expect(screen.getByTestId('pair-approval-apr_1')).toBeInTheDocument());
    expect(screen.getByTestId('pair-approval-apr_1').textContent).toContain('fs.edit · src/a.ts');
    // Sin el control, aprobar aplicaría un diff desde un dispositivo de sólo lectura.
    expect(screen.getByTestId('pair-approval-allow-apr_1')).toBeDisabled();

    // El panel de aprobaciones se pinta antes que el lease: reclamar exige
    // esperar a que exista el control (si no, en un runner rápido no hay botón).
    await waitFor(() => expect(screen.getByTestId('pair-claim')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('pair-claim'));
    await waitFor(() => expect(screen.getByTestId('pair-approval-allow-apr_1')).toBeEnabled());

    fireEvent.click(screen.getByTestId('pair-approval-allow-apr_1'));

    await waitFor(() => expect(resolved).toBe(true));
    const post = calls.find((call) => call.url.endsWith('/approvals/apr_1') && call.method === 'POST');
    expect(post?.body).toEqual({ decision: 'allow', seq: 5 });
    await waitFor(() => expect(screen.queryByTestId('pair-approval-apr_1')).toBeNull());
    expect(screen.getByTestId('pair-approval-note').textContent).toContain('Aprobaste fs.edit');
  });

  test('conectar desde el formulario pide el lease de esa sesión', async () => {
    const calls = stubNet((url) => {
      if (url.endsWith('/api/pair/device')) return device;
      return { body: { success: true, lease: lease(), mine: false, renewMs: 30_000 } };
    });

    render(<PairControlScreen />);
    fireEvent.change(screen.getByTestId('pair-session'), { target: { value: 'sess_nueva' } });
    fireEvent.click(screen.getByTestId('pair-connect'));

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes('/api/pair/lease?sessionId=sess_nueva'))).toBe(true)
    );
    await waitFor(() => expect(screen.getByTestId('pair-status').textContent).toContain('Sólo lectura'));
  });
});
