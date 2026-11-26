/**
 * Pantalla PWA de sesión `/pair/session` (F3): turnos y plan de sólo lectura,
 * chat firmado con el `seq` del lease, aprobaciones que se resuelven de verdad
 * con `resolveApproval`, y el 409 del lease pintado tal cual.
 *
 * El estado sigue al stream SSE de la sesión, no a un `setInterval`. Se mockea
 * `fetch` con las rutas reales del host (incluido el stream, servido por un
 * lector falso) y se usa el cliente del lease de verdad: lo que se prueba es el
 * contrato entre la pantalla, el cliente del lease y el stream.
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
  headers: Record<string, string>;
}

interface StubResult {
  status?: number;
  body?: any;
  /** Respuesta SSE ya armada; sustituye a `body`. */
  stream?: any;
}

type Handler = (url: string, method: string, body: any, headers: Record<string, string>) => StubResult;

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

function stubNet(handler: Handler) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init?: any) => {
      const method = String(init?.method ?? 'GET');
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), method, body, credentials: init?.credentials, headers });
      const result = handler(String(url), method, body, headers);
      if (result.stream) return result.stream;
      const status = result.status ?? 200;
      return { ok: status < 400, status, json: async () => result.body } as any;
    })
  );
  return calls;
}

/** Stream finito: entrega los bloques y termina (dispara la reconexión). */
function finiteStream(chunks: string[]) {
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: new TextEncoder().encode(chunks[index++]) }
            : { done: true, value: undefined },
        cancel: async () => {},
      }),
    },
  } as any;
}

/** Stream vivo: los bloques se empujan desde el test. */
function liveStream() {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  const response = {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => {
          if (queue.length) return { done: false, value: new TextEncoder().encode(queue.shift()!) };
          await new Promise<void>((resolve) => { wake = resolve; });
          return { done: false, value: new Uint8Array() };
        },
        cancel: async () => {},
      }),
    },
  } as any;
  return {
    response,
    push(frame: string) {
      queue.push(frame);
      const notify = wake;
      wake = null;
      notify?.();
    },
  };
}

function resyncFrame(id: number, state: unknown): string {
  return `id: ${id}\nevent: resync\ndata: ${JSON.stringify(state)}\n\n`;
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

    render(<PairSessionScreen sessionId="sess_f3" streamRetryMs={0} />);

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

    render(<PairSessionScreen sessionId="sess_f3" streamRetryMs={0} />);

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

    render(<PairSessionScreen sessionId="sess_f3" streamRetryMs={0} />);
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

describe('stream de la sesión', () => {
  test('el resync reemplaza el estado sin volver a leerlo por polling', async () => {
    const live = liveStream();
    let stateReads = 0;
    stubNet((url, method) => {
      if (url.endsWith('/api/pair/device')) return device;
      if (url.includes('/api/pair/lease?')) {
        return { body: { success: true, lease: lease(), mine: false, renewMs: 30_000 } };
      }
      if (url.endsWith('/api/agent/sessions/sess_f3/stream')) return { stream: live.response };
      if (url.endsWith('/api/agent/sessions/sess_f3') && method === 'GET') {
        stateReads += 1;
        return {
          body: {
            success: true,
            running: true,
            state: {
              id: 'sess_f3',
              status: 'running',
              turns: [{ role: 'user', text: 'inicial', ts: 1 }],
              plan: [],
              pendingApproval: null,
            },
          },
        };
      }
      return { status: 404, body: {} };
    });

    render(<PairSessionScreen sessionId="sess_f3" streamRetryMs={0} />);
    await waitFor(() => expect(screen.getByText('inicial')).toBeInTheDocument());
    expect(screen.getByTestId('pair-session-stream').textContent).toContain('En vivo');

    live.push(
      resyncFrame(4, {
        id: 'sess_f3',
        status: 'completed',
        turns: [{ role: 'assistant', text: 'desde el stream', ts: 2 }],
        plan: [],
        pendingApproval: null,
      })
    );

    await waitFor(() => expect(screen.getByText('desde el stream')).toBeInTheDocument());
    expect(screen.getByTestId('pair-session-status').textContent).toContain('completed · sess_f3');
    expect(screen.queryByText('inicial')).toBeNull();

    // Sin polling: pasado el margen de un refresco periódico sigue habiendo una
    // sola lectura del estado.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(stateReads).toBe(1);
  });

  test('al caer la red reconecta con Last-Event-ID y recupera el estado', async () => {
    const live = liveStream();
    const streamHeaders: Array<Record<string, string>> = [];
    stubNet((url, method) => {
      if (url.endsWith('/api/pair/device')) return device;
      if (url.includes('/api/pair/lease?')) {
        return { body: { success: true, lease: lease(), mine: false, renewMs: 30_000 } };
      }
      if (url.endsWith('/api/agent/sessions/sess_f3/stream')) {
        streamHeaders.push(...[]);
        // La primera conexión entrega un evento y se corta; la segunda queda viva.
        if (streamHeaders.length === 0) {
          streamHeaders.push({ placeholder: 'first' });
          return { stream: finiteStream(['id: 7\nevent: status\ndata: {"text":"paso"}\n\n']) };
        }
        return { stream: live.response };
      }
      if (url.endsWith('/api/agent/sessions/sess_f3') && method === 'GET') {
        return {
          body: {
            success: true,
            running: true,
            state: { id: 'sess_f3', status: 'running', turns: [], plan: [], pendingApproval: null },
          },
        };
      }
      return { status: 404, body: {} };
    });

    // Se captura la cabecera real de cada conexión con el handler de fetch.
    const original = globalThis.fetch as any;
    const calls: Array<Record<string, string>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init?: any) => {
        if (String(url).endsWith('/stream')) calls.push((init?.headers ?? {}) as Record<string, string>);
        return original(url, init);
      })
    );

    render(<PairSessionScreen sessionId="sess_f3" streamRetryMs={5} />);

    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1]['Last-Event-ID']).toBe('7');
    expect(screen.getByTestId('pair-session-stream').textContent).toBeTruthy();

    live.push(
      resyncFrame(8, {
        id: 'sess_f3',
        status: 'running',
        turns: [{ role: 'assistant', text: 'recuperado', ts: 3 }],
        plan: [],
        pendingApproval: null,
      })
    );
    await waitFor(() => expect(screen.getByText('recuperado')).toBeInTheDocument());
  });

  test('una aprobación ya aplicada no se vuelve a ofrecer con un resync atrasado', async () => {
    const live = liveStream();
    let resolved = false;
    let decisions = 0;
    const approval = {
      id: 'apr_9',
      sessionId: 'sess_f3',
      tool: 'fs.write',
      input: { path: 'src/nuevo.ts' },
      diff: '--- /dev/null\n+++ b/src/nuevo.ts\n+hola\n',
      createdAt: 1_000,
      expiresAt: 61_000,
    };
    stubNet((url, method) => {
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
      if (url.endsWith('/api/agent/sessions/sess_f3/stream')) return { stream: live.response };
      if (url.endsWith('/api/agent/sessions/sess_f3/approvals/apr_9') && method === 'POST') {
        decisions += 1;
        resolved = true;
        return { body: { success: true, decision: 'allow', state: { id: 'sess_f3' } } };
      }
      if (url.endsWith('/api/agent/sessions/sess_f3') && method === 'GET') {
        return {
          body: {
            success: true,
            running: true,
            state: {
              id: 'sess_f3',
              status: 'running',
              turns: [],
              plan: [],
              pendingApproval: resolved ? null : approval,
              pendingApprovals: resolved ? [] : [approval],
            },
          },
        };
      }
      return { status: 404, body: {} };
    });

    render(<PairSessionScreen sessionId="sess_f3" streamRetryMs={0} />);
    await waitFor(() => expect(screen.getByTestId('pair-session-approval-apr_9')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByTestId('pair-session-lease').textContent).not.toContain('Leyendo')
    );
    fireEvent.click(screen.getByTestId('pair-session-claim'));
    await waitFor(() => expect(screen.getByTestId('pair-session-allow-apr_9')).toBeEnabled());

    fireEvent.click(screen.getByTestId('pair-session-allow-apr_9'));
    await waitFor(() => expect(decisions).toBe(1));
    await waitFor(() => expect(screen.queryByTestId('pair-session-approval-apr_9')).toBeNull());

    // Snapshot atrasado: el servidor todavía la lista, la pantalla no la repite.
    live.push(
      resyncFrame(12, {
        id: 'sess_f3',
        status: 'running',
        turns: [],
        plan: [],
        pendingApproval: approval,
        pendingApprovals: [approval],
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(screen.queryByTestId('pair-session-approval-apr_9')).toBeNull();
    expect(decisions).toBe(1);
  });

  test('una aprobación que falla se cuenta en el chat y no como alerta del lease', async () => {
    const approval = {
      id: 'apr_404',
      sessionId: 'sess_f3',
      tool: 'fs.write',
      input: { path: 'src/nuevo.ts' },
      diff: '--- /dev/null\n+++ b/src/nuevo.ts\n+hola\n',
      createdAt: 1_000,
      expiresAt: 61_000,
    };
    stubNet((url, method) => {
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
      if (url.endsWith('/api/agent/sessions/sess_f3/approvals/apr_404') && method === 'POST') {
        return {
          status: 404,
          body: { success: false, code: 'APPROVAL_NOT_FOUND', error: 'aprobación no encontrada' },
        };
      }
      if (url.endsWith('/api/agent/sessions/sess_f3')) {
        return {
          body: {
            success: true,
            running: true,
            state: {
              id: 'sess_f3',
              status: 'running',
              turns: [],
              plan: [],
              pendingApproval: approval,
              pendingApprovals: [approval],
            },
          },
        };
      }
      return { status: 404, body: {} };
    });

    render(<PairSessionScreen sessionId="sess_f3" streamRetryMs={0} />);
    await waitFor(() => expect(screen.getByTestId('pair-session-approval-apr_404')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByTestId('pair-session-lease').textContent).not.toContain('Leyendo')
    );
    fireEvent.click(screen.getByTestId('pair-session-claim'));
    await waitFor(() => expect(screen.getByTestId('pair-session-allow-apr_404')).toBeEnabled());

    fireEvent.click(screen.getByTestId('pair-session-allow-apr_404'));

    // El fallo se cuenta una sola vez, en el chat.
    await waitFor(() =>
      expect(screen.getByTestId('pair-session-note').textContent).toContain('APPROVAL_NOT_FOUND')
    );
    expect(screen.queryByTestId('pair-session-lease-error')).toBeNull();
    // La decisión no se aplicó: la aprobación sigue pendiente y se puede reintentar.
    expect(screen.getByTestId('pair-session-approval-apr_404')).toBeInTheDocument();
  });
});
