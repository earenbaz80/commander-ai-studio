import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useDictation } from '../../src/hooks/useDictation';

vi.mock('../../src/lib/dictation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/dictation')>()),
  blobToWav: vi.fn(async () => new Blob([new Uint8Array(400)], { type: 'audio/wav' })),
}));

class FakeMediaRecorder {
  static isTypeSupported = () => true;

  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({
      data: new Blob([new Uint8Array(512)], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}

function Harness() {
  const dictation = useDictation({ lang: 'es', onText: () => {} });
  return <button onClick={dictation.toggle}>{dictation.state}</button>;
}

describe('useDictation · diagnóstico de fallo', () => {
  const mediaDevices = navigator.mediaDevices;

  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }],
        })),
      },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: mediaDevices,
    });
  });

  const startAndStop = async () => {
    const button = screen.getByRole('button');
    fireEvent.click(button);
    await waitFor(() => expect(button.textContent).toBe('recording'));
    fireEvent.click(button);
  };

  test('registra MIME, tamaño y un extracto aunque la respuesta no sea JSON', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      text: async () => '<html>Bad Gateway</html>',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<Harness />);
    await startAndStop();

    await waitFor(() => expect(consoleWarn).toHaveBeenCalledTimes(1));

    const [message, payload] = consoleWarn.mock.calls[0] as [string, string];
    expect(message).toBe('[dictation] fallo /api/transcribe');
    expect(JSON.parse(payload)).toEqual({
      mimeType: 'audio/webm',
      bytes: 512,
      status: 502,
      body: '<html>Bad Gateway</html>',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('el 400 original seguido de un WAV correcto deja un solo fallo y un solo reintento', async () => {
    let request = 0;
    const fetchMock = vi.fn(async () => {
      request += 1;
      if (request === 1) {
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({ success: false, error: 'invalid audio', retryWithWav: true }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, text: 'hola' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});

    render(<Harness />);
    await startAndStop();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(consoleInfo).toHaveBeenCalledTimes(1));

    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn.mock.calls[0][0]).toBe('[dictation] fallo /api/transcribe');
    const diagnostic = JSON.parse(String(consoleWarn.mock.calls[0][1]));
    expect(diagnostic).toMatchObject({ mimeType: 'audio/webm', bytes: 512, status: 400 });
    expect(consoleInfo.mock.calls[0][0]).toBe('[dictation] reintento WAV');
  });

  test('el fallo del WAV no duplica el log', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({ success: false, error: 'invalid audio', retryWithWav: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});

    render(<Harness />);
    await startAndStop();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(consoleInfo).toHaveBeenCalledTimes(1));

    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn.mock.calls[0][0]).toBe('[dictation] fallo /api/transcribe');
    expect(consoleInfo.mock.calls[0][0]).toBe('[dictation] reintento WAV');
  });

  test('recorta un cuerpo enorme a 200 caracteres', async () => {
    const huge = `<html>${'x'.repeat(5000)}</html>`;
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => huge,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<Harness />);
    await startAndStop();

    await waitFor(() => expect(consoleWarn).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(String(consoleWarn.mock.calls[0][1]));
    expect(payload.body).toHaveLength(200);
    expect(payload.body.startsWith('<html>xxx')).toBe(true);
  });
});
