/**
 * Tests de integración de App.tsx.
 * Cubren el flujo completo: arranque → chat → envío → respuesta (streaming),
 * errores y las notificaciones nativas que se disparan al terminar.
 *
 * Firebase y las notificaciones se mockean: el test valida la ORQUESTACIÓN
 * de App (endpoint, payload, estado, notificaciones), no los servicios reales.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';

// --- Mocks (hoisted por vitest) ---

vi.mock('../../src/lib/firebase', () => ({
  auth: {
    currentUser: null,
    onAuthStateChanged: (_auth: any, cb: any) => { cb(null); return () => {}; },
  },
  db: {},
  savePromptVersion: vi.fn().mockResolvedValue({}),
  fetchPromptVersions: vi.fn().mockResolvedValue([]),
  fetchPublicProjects: vi.fn().mockResolvedValue([]),
  fetchUserProjects: vi.fn().mockResolvedValue([]),
  toggleProjectLike: vi.fn().mockResolvedValue(undefined),
  checkIsLiked: vi.fn().mockResolvedValue(false),
  logoutUser: vi.fn().mockResolvedValue(undefined),
  linkGitHubAccount: vi.fn().mockResolvedValue(null),
  linkGoogleAccount: vi.fn().mockResolvedValue(null),
  linkEmailPasswordAccount: vi.fn().mockResolvedValue(null),
  unlinkAccountProvider: vi.fn().mockResolvedValue(null),
  subscribeArchivedProjects: vi.fn(() => () => {}),
  saveArchivedProjects: vi.fn().mockResolvedValue(undefined),
  setProjectArchivedRemote: vi.fn().mockResolvedValue(undefined),
}));

// App usa onAuthStateChanged directamente de firebase/auth
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: any, cb: any) => { cb(null); return () => {}; },
}));

// `useAppTelemetry` importa firestore directo, sin pasar por src/lib/firebase, así
// que el mock de arriba no lo tapa: en jsdom acaba abriendo un canal gRPC real
// que revienta más tarde con «process is not defined» y tumba la corrida.
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  addDoc: vi.fn().mockResolvedValue({}),
  serverTimestamp: vi.fn(() => new Date(0)),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
}));

// Espías de notificaciones: comprobamos que se emitan al completar
export const notificationSpies = {
  sendBrowserNotification: vi.fn(),
  playRetroSuccessSound: vi.fn(),
  requestNotificationPermission: vi.fn().mockResolvedValue(false),
};

vi.mock('../../src/utils/browserNotifications', () => ({
  sendBrowserNotification: (...args: any[]) => notificationSpies.sendBrowserNotification(...args),
  playRetroSuccessSound: () => notificationSpies.playRetroSuccessSound(),
  requestNotificationPermission: () => notificationSpies.requestNotificationPermission(),
}));

import App from '../../src/App';
import { ChatStoreProvider } from '../../src/stores/chatStore';
import { UIStoreProvider } from '../../src/stores/uiStore';

/** Respuesta SSE simulada: misma forma que /api/gemini/stream. */
const makeStreamResponse = (chunks: any[]) => ({
  ok: true,
  body: {
    getReader: () => {
      let i = 0;
      return {
        read: async () => {
          if (i < chunks.length) {
            const payload = `data: ${JSON.stringify(chunks[i])}\n\n`;
            i += 1;
            return { done: false, value: new TextEncoder().encode(payload) };
          }
          return { done: true, value: undefined };
        },
      };
    },
  },
});

const CHUNKS_OK = [
  { type: 'chunk', text: 'Hola ' },
  { type: 'chunk', text: 'mundo' },
  { type: 'done', fullText: 'Hola mundo', groundingSources: [], metrics: { totalTokens: 7, latencyMs: 120 } },
];

/** Monta la app con los mismos providers que usa `main.tsx` en producción. */
const renderApp = () =>
  render(
    <ChatStoreProvider>
      <UIStoreProvider>
        <App />
      </UIStoreProvider>
    </ChatStoreProvider>
  );

/** Salta la pantalla de BIOS retro (~3.4s de timers). */
const bootApp = async () => {
  vi.useFakeTimers();
  renderApp();
  await act(async () => {
    vi.advanceTimersByTime(4000);
  });
  vi.useRealTimers();
};

const getChatInput = () =>
  screen.getAllByPlaceholderText('Escribe tu mensaje...')[0] as HTMLTextAreaElement;

// Montar la app entera en jsdom cuesta segundos y, con la suite completa en
// paralelo, el límite por defecto de 5 s se queda corto: el fallo se veía como un
// `Test timed out`, no como un error de comportamiento. El margen es sólo para este
// bloque, no es un sleep, y un cuelgue real sigue fallando.
describe('App (integración)', { timeout: 20_000 }, () => {
  beforeEach(() => {
    localStorage.clear();
    // Onboarding ya visto: sin esto aparece el modal de bienvenida
    localStorage.setItem('ai_studio_onboarding_seen', '1');
    // Estos tests cubren la ruta de Gemini; la migración se marca vista para no tocar el modelo de la pestaña.
    localStorage.setItem('ai_studio_tabs_v1', JSON.stringify([{ id: 'tab-gemini', title: 'Sesión 1', selectedModel: 'gemini-3.5-flash', projectPath: 'C:/proj' }]));
    localStorage.setItem('ai_studio_active_tab', 'tab-gemini');
    localStorage.setItem('ai_studio_default_model_v3', '1');
    notificationSpies.sendBrowserNotification.mockClear();
    notificationSpies.playRetroSuccessSound.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('arranca mostrando el estudio tras la pantalla de BIOS', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ roots: [] }) });
    await bootApp();

    // El chat está montado (campo de escritura visible)
    expect(getChatInput()).toBeInTheDocument();
    // Nono sigue presente
    expect(screen.getByLabelText('Nono')).toBeInTheDocument();
  });

  test('envía el mensaje al endpoint de streaming con el payload correcto', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/agent/')) {
        return Promise.resolve({ ok: true, json: async () => ({ roots: [] }) });
      }
      return Promise.resolve(makeStreamResponse(CHUNKS_OK));
    });
    global.fetch = fetchMock as any;

    await bootApp();

    fireEvent.change(getChatInput(), { target: { value: 'Hola IA' } });
    fireEvent.keyDown(getChatInput(), { key: 'Enter' });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/gemini/stream',
        expect.objectContaining({ method: 'POST' })
      );
    });

    const call = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/gemini/stream');
    const body = JSON.parse(call![1].body);
    // El formato de Gemini envía el texto en contents[]
    const texts = (body.contents || []).map((c: any) => c.text).filter(Boolean);
    expect(texts).toContain('Hola IA');
    expect(body.model).toBe('gemini-3.5-flash');
    expect(body.systemInstruction).toBeTruthy();
  });

  test('muestra la respuesta acumulada del stream y notifica al completar', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/agent/')) {
        return Promise.resolve({ ok: true, json: async () => ({ roots: [] }) });
      }
      return Promise.resolve(makeStreamResponse(CHUNKS_OK));
    });
    global.fetch = fetchMock as any;

    await bootApp();

    fireEvent.change(getChatInput(), { target: { value: 'Hola IA' } });
    fireEvent.keyDown(getChatInput(), { key: 'Enter' });

    // Respuesta renderizada en el chat
    await waitFor(() => {
      expect(screen.getByText('Hola mundo')).toBeInTheDocument();
    });

    // Notificación nativa + sonido retro al completar
    expect(notificationSpies.sendBrowserNotification).toHaveBeenCalledWith(
      expect.stringContaining('Respuesta Completada'),
      expect.any(String)
    );
    expect(notificationSpies.playRetroSuccessSound).toHaveBeenCalled();
  });

  test('un error de red muestra el mensaje de error y NO notifica éxito', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/agent/')) {
        return Promise.resolve({ ok: true, json: async () => ({ roots: [] }) });
      }
      return Promise.reject(new Error('Network down'));
    });
    global.fetch = fetchMock as any;

    await bootApp();

    fireEvent.change(getChatInput(), { target: { value: 'Hola IA' } });
    fireEvent.keyDown(getChatInput(), { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText(/Error al procesar consulta/)).toBeInTheDocument();
    });

    expect(notificationSpies.sendBrowserNotification).not.toHaveBeenCalledWith(
      expect.stringContaining('Respuesta Completada'),
      expect.anything()
    );
    expect(notificationSpies.playRetroSuccessSound).not.toHaveBeenCalled();
  });

  test('reintenta el último mensaje fallido sin duplicar el prompt', async () => {
    let streamCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/agent/')) {
        return Promise.resolve({ ok: true, json: async () => ({ roots: [] }) });
      }
      if (String(url) === '/api/gemini/stream') {
        streamCalls += 1;
        return streamCalls === 1
          ? Promise.reject(new Error('Network down'))
          : Promise.resolve(makeStreamResponse(CHUNKS_OK));
      }
      return Promise.reject(new Error('Network down'));
    });
    global.fetch = fetchMock as any;

    await bootApp();

    fireEvent.change(getChatInput(), { target: { value: 'Hola IA' } });
    fireEvent.keyDown(getChatInput(), { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText(/Error al procesar consulta/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => {
      expect(screen.getByText('Hola mundo')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Error al procesar consulta/)).toBeNull();
    expect(
      within(screen.getByTestId('chat-messages')).getAllByText('Hola IA')
    ).toHaveLength(1);
    expect(streamCalls).toBe(2);
  });

  test('un chunk de error en el stream cancela con mensaje de error', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/agent/')) {
        return Promise.resolve({ ok: true, json: async () => ({ roots: [] }) });
      }
      return Promise.resolve(makeStreamResponse([{ type: 'error', error: 'Cuota agotada' }]));
    });
    global.fetch = fetchMock as any;

    await bootApp();

    fireEvent.change(getChatInput(), { target: { value: 'Hola IA' } });
    fireEvent.keyDown(getChatInput(), { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText(/Error al procesar consulta/)).toBeInTheDocument();
    });
    expect(notificationSpies.sendBrowserNotification).not.toHaveBeenCalled();
  });

  test('el atajo Ctrl+Alt+N inicia una nueva sesión y notifica', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: async () => ({ roots: [] }) })
    );

    await bootApp();
    notificationSpies.sendBrowserNotification.mockClear();

    fireEvent.keyDown(window, { key: 'n', ctrlKey: true, altKey: true });

    expect(notificationSpies.sendBrowserNotification).toHaveBeenCalledWith(
      expect.stringContaining('Nuevo Proyecto'),
      expect.any(String)
    );
  });

  test('el atajo Ctrl+B alterna la barra lateral', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ roots: [] }) });
    await bootApp();

    const before = document.querySelectorAll('aside').length;
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    // El toggle provoca un re-render con el sidebar cambiado
    await waitFor(() => {
      const after = document.querySelectorAll('aside').length;
      expect(after).not.toBe(before);
    });
  });

  test('el atajo Ctrl+K abre la paleta y Escape la cierra', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ roots: [] }) });
    await bootApp();

    expect(document.querySelector('[data-command-palette]')).toBeNull();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.querySelector('[data-command-palette]')).toBeTruthy();

    const input = screen.getByLabelText('Paleta de comandos');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.querySelector('[data-command-palette]')).toBeNull();
  });

  test('Ctrl+P abre la búsqueda de símbolos del workspace', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ roots: [] }) });
    await bootApp();

    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });

    expect(screen.getByLabelText('Buscar símbolo en el workspace')).toBeInTheDocument();
  });

  test('la paleta abre un archivo del proyecto en el Workbench', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u === '/api/threads') return Promise.resolve({ ok: true, json: async () => ({ threads: [] }) });
      if (u === '/api/agent/run-tool') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.toolId === 'fs.glob') {
          return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: { files: ['README.md', 'src/App.tsx'] } }) });
        }
        if (body.toolId === 'fs.read') {
          return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: { content: '# README de prueba' } }) });
        }
      }
      return Promise.resolve({ ok: true, json: async () => ({ roots: [] }) });
    });
    global.fetch = fetchMock as any;

    await bootApp();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByLabelText('Paleta de comandos');
    fireEvent.change(input, { target: { value: 'README.md' } });

    // Los archivos se cargan al abrir la paleta (fs.glob), no al arrancar.
    await screen.findByRole('option', { name: /README\.md/ });
    fireEvent.keyDown(input, { key: 'Enter' });

    // El evento llega al Workbench, que abre el Editor y hace fs.read.
    await waitFor(() => {
      const read = fetchMock.mock.calls.find((call) => {
        const body = JSON.parse(String((call[1] as RequestInit | undefined)?.body || '{}'));
        return body.toolId === 'fs.read';
      });
      expect(read).toBeTruthy();
    });
    const readCall = fetchMock.mock.calls.find((call) => {
      const body = JSON.parse(String((call[1] as RequestInit | undefined)?.body || '{}'));
      return body.toolId === 'fs.read';
    });
    expect(JSON.parse(String((readCall![1] as RequestInit).body))).toMatchObject({
      toolId: 'fs.read',
      input: { path: 'README.md', root: 'C:/proj' },
    });
    expect(screen.getByLabelText('Workbench')).toBeInTheDocument();
  });

  test('la paleta reanuda una sesión del servidor en una pestaña nueva', async () => {
    const thread = {
      id: 'sess-restore',
      title: 'Sesión guardada',
      project_path: 'C:/proj',
      status: 'active',
      model: 'gemini-3.5-flash',
      agent_mode: 'chat',
      execution_mode: 'build',
      turn_state: 'idle',
      created_at: 1,
      updated_at: 2,
      pinned: 0,
      project_id: null,
      state_json: null,
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('/api/threads/sess-restore/messages')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            messages: [
              {
                seq: 1,
                thread_id: 'sess-restore',
                role: 'user',
                parts_json: JSON.stringify({ text: 'Mensaje restaurado' }),
                ts: 2,
              },
            ],
          }),
        });
      }
      if (u === '/api/threads') {
        if ((init?.method || 'GET') === 'GET') {
          return Promise.resolve({ ok: true, json: async () => ({ threads: [thread] }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({ thread }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ roots: [] }) });
    });
    global.fetch = fetchMock as any;

    await bootApp();

    // La sesión llega del servidor y aparece en el historial antes de abrir la paleta.
    // Puede estar dos veces (pestaña restaurada + historial), así que no se usa
    // `findByText`, que falla ante duplicados legítimos.
    await screen.findAllByText('Sesión guardada');

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByLabelText('Paleta de comandos');
    fireEvent.change(input, { target: { value: 'Sesión guardada' } });

    const sessionGroup = await screen.findByRole('group', { name: 'Sesiones' });
    const option = sessionGroup.querySelector('[role="option"]') as HTMLElement;
    expect(option).toBeTruthy();
    fireEvent.click(option);

    await waitFor(() => expect(screen.getByText('Mensaje restaurado')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/threads/sess-restore/messages?limit=200');
  });

  test('la paleta lleva de Composer a agente al elegir un subagente', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ roots: [] }) });
    await bootApp();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    let input = screen.getByLabelText('Paleta de comandos');
    fireEvent.change(input, { target: { value: 'composer' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByTestId('playground-mode-composer')).toHaveAttribute('aria-pressed', 'true')
    );

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    input = screen.getByLabelText('Paleta de comandos');
    fireEvent.change(input, { target: { value: 'file explorer' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('MODO AGENTE')).toBeInTheDocument();
      expect(screen.getByDisplayValue(/Lanza el subagente file-explorer/)).toBeInTheDocument();
    }, { timeout: 5000 });
  });
});
