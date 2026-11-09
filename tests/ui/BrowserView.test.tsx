import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { BrowserView } from '../../src/components/panel/BrowserView';
import { LiveConsole, NetworkMonitor } from '../../src/components/WorkbenchPreview';
import { clearArtifacts, listArtifacts } from '../../src/artifacts/store';
import { isBrowserRecordingArtifact } from '../../src/artifacts/types';
import type { BrowserFrame, BrowserSessionInfo } from '../../src/utils/browserSessionApi';

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  url: string;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: any) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, payload: unknown) {
    const event = { data: JSON.stringify(payload) } as MessageEvent;
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

const session: BrowserSessionInfo = {
  id: 'b1',
  root: 'C:/tmp/x',
  status: 'ready',
  createdAt: 1,
  page: { url: 'https://app.test/', title: 'App', canGoBack: false, canGoForward: false },
  viewport: { width: 1280, height: 800 },
  lastSeq: 0,
  oldestSeq: 0,
  lastActor: 'agent',
};

const otherSession: BrowserSessionInfo = {
  ...session,
  id: 'b2',
  createdAt: 2,
  page: { url: 'https://docs.test/', title: 'Docs', canGoBack: false, canGoForward: false },
};

const frame: BrowserFrame = {
  seq: 1,
  ts: 1,
  mimeType: 'image/jpeg',
  data: 'aGVsbG8=',
  width: 1280,
  height: 800,
  url: 'https://app.test/',
  title: 'App',
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function installFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/browser/sessions')) {
      return jsonResponse({ success: true, sessions: [otherSession, session] });
    }
    if (url.includes('/screenshot')) {
      return jsonResponse({
        success: true,
        screenshot: {
          mimeType: 'image/png',
          data: 'aGVsbG8=',
          url: 'https://app.test/',
          title: 'App',
          width: 1280,
          height: 800,
          fullPage: false,
        },
      });
    }
    if (url.includes('/api/browser/session/b2')) {
      return jsonResponse({ success: true, session: otherSession });
    }
    if (url.includes('/api/browser/session') && init?.method === 'POST') {
      return jsonResponse({ success: true, session });
    }
    if (url.includes('/input')) {
      return jsonResponse({
        success: true,
        session: { ...session, page: { ...session.page, url: 'http://ejemplo.com/' } },
      });
    }
    if (url.includes('/logs')) {
      return jsonResponse({ success: true, console: [], network: [], lastSeq: 0, oldestSeq: 0 });
    }
    return jsonResponse({ success: true, session });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('BrowserView real', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('conecta con la sesión y pinta el frame de Playwright', async () => {
    installFetch();
    render(<BrowserView projectPath="C:/tmp/x" />);

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() => {
      FakeEventSource.instances[0].emit('snapshot', { session });
      FakeEventSource.instances[0].emit('frame', { type: 'frame', seq: 1, frame });
    });

    expect(await screen.findByAltText('Navegador Playwright')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://app.test/')).toBeInTheDocument();
    expect(FakeEventSource.instances[0].url).toBe('/api/browser/session/b1/stream');
  });

  test('el selector lista sesiones reales y cambia de stream', async () => {
    installFetch();
    render(<BrowserView projectPath="C:/tmp/x" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const select = screen.getByRole('combobox', { name: 'Sesión del navegador' });
    await waitFor(() => expect(select).toHaveValue('b1'));
    expect(screen.getByRole('option', { name: /b2/ })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'b2' } });

    await waitFor(() => expect(
      FakeEventSource.instances.some((source) => source.url === '/api/browser/session/b2/stream'),
    ).toBe(true));
  });

  test('deshabilita atrás/adelante sin historial y los activa con estado real', async () => {
    const fetchMock = installFetch();
    render(<BrowserView projectPath="C:/tmp/x" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const back = screen.getByTitle('Atrás');
    const forward = screen.getByTitle('Adelante');
    expect(back).toBeDisabled();
    expect(forward).toBeDisabled();

    act(() => {
      FakeEventSource.instances[0].emit('navigation', {
        type: 'navigation',
        seq: 2,
        state: { ...session.page, canGoBack: true, canGoForward: true },
      });
    });
    expect(back).toBeEnabled();
    expect(forward).toBeEnabled();

    fireEvent.click(back);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/input'));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]?.body))).toMatchObject({ action: 'back' });
    });
  });

  test('Alt+← pide volver atrás en el historial', async () => {
    const fetchMock = installFetch();
    render(<BrowserView projectPath="C:/tmp/x" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => {
      FakeEventSource.instances[0].emit('navigation', {
        type: 'navigation',
        seq: 2,
        state: { ...session.page, canGoBack: true, canGoForward: false },
      });
    });

    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/input'));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]?.body))).toMatchObject({ action: 'back' });
    });
  });

  test('Alt+→ pide avanzar en el historial', async () => {
    const fetchMock = installFetch();
    render(<BrowserView projectPath="C:/tmp/x" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => {
      FakeEventSource.instances[0].emit('navigation', {
        type: 'navigation',
        seq: 2,
        state: { ...session.page, canGoBack: false, canGoForward: true },
      });
    });

    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/input'));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]?.body))).toMatchObject({ action: 'forward' });
    });
  });

  test('Alt+← no navega mientras se escribe en la barra de URL', async () => {
    const fetchMock = installFetch();
    render(<BrowserView projectPath="C:/tmp/x" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => {
      FakeEventSource.instances[0].emit('navigation', {
        type: 'navigation',
        seq: 2,
        state: { ...session.page, canGoBack: true, canGoForward: true },
      });
    });

    fireEvent.keyDown(screen.getByLabelText('URL del navegador'), {
      key: 'ArrowLeft',
      altKey: true,
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/input'))).toBe(false);
  });

  test('el botón de captura descarga un PNG de la sesión activa', async () => {
    const fetchMock = installFetch();
    const NativeURL = globalThis.URL;
    class TestURL extends NativeURL {}
    const createObjectURL = vi.fn(() => 'blob:captura');
    Object.assign(TestURL, { createObjectURL, revokeObjectURL: vi.fn() });
    vi.stubGlobal('URL', TestURL);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<BrowserView projectPath="C:/tmp/x" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    fireEvent.click(screen.getByTitle('Capturar pantalla'));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(click).toHaveBeenCalled();
    const screenshotCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/screenshot'));
    expect(screenshotCall).toBeTruthy();
    expect(JSON.parse(String(screenshotCall![1]?.body))).toEqual({ fullPage: false });
  });

  test('la captura de página completa pide fullPage y lo marca en el nombre', async () => {
    const fetchMock = installFetch();
    const NativeURL = globalThis.URL;
    class TestURL extends NativeURL {}
    const createObjectURL = vi.fn(() => 'blob:completa');
    Object.assign(TestURL, { createObjectURL, revokeObjectURL: vi.fn() });
    vi.stubGlobal('URL', TestURL);
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    render(<BrowserView projectPath="C:/tmp/x" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    fireEvent.change(screen.getByLabelText('Área de captura'), { target: { value: 'full' } });
    fireEvent.click(screen.getByTitle('Capturar pantalla'));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const screenshotCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/screenshot'));
    expect(screenshotCall).toBeTruthy();
    expect(JSON.parse(String(screenshotCall![1]?.body))).toEqual({ fullPage: true });
    expect(downloads[0]).toMatch(/-completa\.png$/);
  });

  test('graba los frames reales y los guarda como artifact', async () => {
    await clearArtifacts();
    installFetch();
    render(<BrowserView projectPath="C:/tmp/x" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => {
      FakeEventSource.instances[0].emit('snapshot', { session });
      FakeEventSource.instances[0].emit('frame', { type: 'frame', seq: 1, frame });
    });

    fireEvent.click(await screen.findByTestId('browser-record'));
    act(() => {
      FakeEventSource.instances[0].emit('frame', {
        type: 'frame',
        seq: 2,
        frame: { ...frame, seq: 2, ts: 701 },
      });
    });

    expect(await screen.findByTestId('browser-recording-status')).toHaveTextContent(/REC/);
    fireEvent.click(screen.getByLabelText('Detener grabación'));

    await waitFor(async () => {
      const artifacts = await listArtifacts('C:/tmp/x');
      expect(artifacts).toHaveLength(1);
      const recording = artifacts[0];
      expect(
        recording && isBrowserRecordingArtifact(recording)
          ? recording.frames.map((item) => item.seq)
          : []
      ).toEqual([1, 2]);
      expect(recording?.title).toBe('App');
    });
    expect(await screen.findByText(/Grabación guardada/)).toBeInTheDocument();
  });

  test('el botón de frame descarga el JPEG que ya muestra el panel', async () => {
    const fetchMock = installFetch();
    const NativeURL = globalThis.URL;
    class TestURL extends NativeURL {}
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:frame';
    });
    Object.assign(TestURL, { createObjectURL, revokeObjectURL: vi.fn() });
    vi.stubGlobal('URL', TestURL);
    const downloads: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    render(<BrowserView projectPath="C:/tmp/x" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() => {
      FakeEventSource.instances[0].emit('snapshot', { session });
      FakeEventSource.instances[0].emit('frame', { type: 'frame', seq: 1, frame });
    });

    fireEvent.click(await screen.findByTitle('Descargar frame actual'));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(blobs[0]?.type).toBe('image/jpeg');
    expect(downloads).toEqual(['navegador-b1-frame-1.jpg']);
    expect(click).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/screenshot'))).toBe(false);
  });

  test('Enter en la barra envía una navegación a la sesión', async () => {
    const fetchMock = installFetch();
    render(<BrowserView projectPath="C:/tmp/x" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const bar = screen.getByPlaceholderText('https://…');
    fireEvent.change(bar, { target: { value: 'ejemplo.com' } });
    fireEvent.keyDown(bar, { key: 'Enter' });

    await waitFor(() => {
      const inputCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/input'));
      expect(inputCall).toBeTruthy();
      const body = JSON.parse(String(inputCall![1]?.body));
      expect(body).toMatchObject({ action: 'navigate', url: 'http://ejemplo.com' });
    });
  });
});

describe('Consola y red reales', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('LiveConsole muestra un console.error de Playwright', async () => {
    installFetch();
    render(<LiveConsole projectPath="C:/tmp/x" selectedModel="demo" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => {
      FakeEventSource.instances[0].emit('snapshot', { session });
      FakeEventSource.instances[0].emit('console', {
        type: 'console',
        seq: 2,
        entry: {
          seq: 2,
          type: 'error',
          text: 'boom desde la página',
          ts: Date.now(),
          url: 'https://app.test/app.js',
          line: 12,
        },
      });
    });

    expect(await screen.findByText('boom desde la página')).toBeInTheDocument();
    expect(screen.getByText(/app\.js:12/)).toBeInTheDocument();
  });

  test('NetworkMonitor muestra una petición 404 real', async () => {
    installFetch();
    render(<NetworkMonitor projectPath="C:/tmp/x" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => {
      FakeEventSource.instances[0].emit('snapshot', { session });
      FakeEventSource.instances[0].emit('network', {
        type: 'network',
        seq: 3,
        entry: {
          seq: 3,
          requestId: 'r1',
          kind: 'http',
          method: 'GET',
          url: 'https://app.test/api/missing',
          status: 404,
          ts: Date.now(),
          durationMs: 23,
          resourceType: 'fetch',
        },
      });
    });

    expect(await screen.findByText('404')).toBeInTheDocument();
    expect(screen.getByText('https://app.test/api/missing')).toBeInTheDocument();
    expect(screen.getByText('23ms')).toBeInTheDocument();
  });
});
