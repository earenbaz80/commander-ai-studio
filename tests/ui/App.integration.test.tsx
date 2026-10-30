/**
 * Tests de integración de App.tsx.
 * Cubren el flujo completo: arranque → chat → envío → respuesta (streaming),
 * errores y las notificaciones nativas que se disparan al terminar.
 *
 * Firebase y las notificaciones se mockean: el test valida la ORQUESTACIÓN
 * de App (endpoint, payload, estado, notificaciones), no los servicios reales.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

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
}));

// App usa onAuthStateChanged directamente de firebase/auth
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: any, cb: any) => { cb(null); return () => {}; },
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
    localStorage.setItem('ai_studio_tabs_v1', JSON.stringify([{ id: 'tab-gemini', title: 'Sesión 1', selectedModel: 'gemini-3.5-flash' }]));
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
});
