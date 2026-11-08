import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LmStudioLoadingNotice } from '../../src/components/LmStudioLoadingNotice';

const realFetch = globalThis.fetch;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('LmStudioLoadingNotice', () => {
  test('muestra el aviso y el modelo cuando el servidor confirma la carga', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        success: true,
        loading: true,
        model: 'qwen/qwen2.5-coder-14b',
        contextLength: 32_768,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <LmStudioLoadingNotice
        selectedModel="lmstudio/qwen/qwen2.5-coder-14b"
        busy
        lang="es"
      />
    );

    const aviso = await screen.findByTestId('lmstudio-loading');
    expect(aviso).toHaveTextContent('Cargando modelo…');
    expect(aviso).toHaveTextContent('qwen/qwen2.5-coder-14b');
    expect(aviso).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('lmstudio-loading-context')).toHaveTextContent('Contexto 32K');
    expect(screen.getByTestId('lmstudio-loading-context')).toHaveAttribute(
      'title',
      '32768 tokens'
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lmstudio/loading?model=qwen%2Fqwen2.5-coder-14b',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  test('muestra «Contexto auto» cuando el servidor no informa la ventana', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        success: true,
        loading: true,
        model: 'qwen/qwen2.5-coder-14b',
        startedAt: Date.now(),
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <LmStudioLoadingNotice
        selectedModel="lmstudio/qwen/qwen2.5-coder-14b"
        busy
        lang="es"
      />
    );

    const context = await screen.findByTestId('lmstudio-loading-context');
    expect(context).toHaveTextContent('Contexto auto');
    expect(context).not.toHaveAttribute('title');
  });

  test('muestra el tiempo transcurrido y lo actualiza cada segundo', async () => {
    const startedAt = Date.now() - 5_000;
    const fetchMock = vi.fn(async () =>
      json({
        success: true,
        loading: true,
        model: 'qwen/qwen2.5-coder-14b',
        startedAt,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <LmStudioLoadingNotice
        selectedModel="lmstudio/qwen/qwen2.5-coder-14b"
        busy
        lang="es"
      />
    );

    await screen.findByTestId('lmstudio-loading');
    const first = screen.getByTestId('lmstudio-loading-elapsed').textContent || '';
    // Usa el startedAt del servidor, no el momento en que llegó la respuesta.
    expect(first).toMatch(/Esperando [1-9]\d*s/);

    await waitFor(
      () =>
        expect(screen.getByTestId('lmstudio-loading-elapsed').textContent).not.toBe(first),
      { timeout: 2500 }
    );
  });

  test('no muestra nada cuando la carga ya terminó', async () => {
    const fetchMock = vi.fn(async () => json({ success: true, loading: false }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <LmStudioLoadingNotice selectedModel="lmstudio/qwen2.5-7b" busy lang="es" />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('lmstudio-loading')).toBeNull();
  });

  test('el aviso desaparece cuando el servidor confirma que la carga terminó', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      // Primera consulta: la carga está en curso. La siguiente: ya terminó.
      return calls === 1
        ? json({
            success: true,
            loading: true,
            model: 'qwen2.5-7b',
            startedAt: Date.now(),
          })
        : json({ success: true, loading: false, model: 'qwen2.5-7b' });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<LmStudioLoadingNotice selectedModel="lmstudio/qwen2.5-7b" busy lang="es" />);

    const aviso = await screen.findByTestId('lmstudio-loading');
    expect(aviso).toHaveTextContent('Cargando modelo…');
    expect(aviso).toHaveTextContent('qwen2.5-7b');

    // El sondeo retira el aviso al ver `loading: false`; no hace falta que
    // cambie `busy` ni que la ejecución completa haya terminado.
    await waitFor(
      () => expect(screen.queryByTestId('lmstudio-loading')).toBeNull(),
      { timeout: 3000 }
    );
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('lmstudio-loading-error')).toBeNull();
  });

  test('muestra el error de carga y abre la configuración del proveedor', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      // Primero la carga en curso; al terminar, el servidor conserva el fallo.
      return calls === 1
        ? json({
            success: true,
            loading: true,
            model: 'qwen/qwen2.5-coder-14b',
            startedAt: Date.now(),
          })
        : json({
            success: true,
            loading: false,
            model: 'qwen/qwen2.5-coder-14b',
            error:
              'No se pudo cargar el modelo "qwen/qwen2.5-coder-14b" en LM Studio: not enough VRAM',
            failedAt: Date.now(),
          });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const onOpenProviderSettings = vi.fn();

    const { rerender } = render(
      <LmStudioLoadingNotice
        selectedModel="lmstudio/qwen/qwen2.5-coder-14b"
        busy
        lang="es"
        onOpenProviderSettings={onOpenProviderSettings}
      />
    );

    await screen.findByTestId('lmstudio-loading');

    rerender(
      <LmStudioLoadingNotice
        selectedModel="lmstudio/qwen/qwen2.5-coder-14b"
        busy={false}
        lang="es"
        onOpenProviderSettings={onOpenProviderSettings}
      />
    );

    const alerta = await screen.findByTestId('lmstudio-loading-error');
    expect(alerta).toHaveAttribute('role', 'alert');
    expect(alerta).toHaveTextContent('No se pudo cargar el modelo');
    expect(screen.getByTestId('lmstudio-loading-error-message')).toHaveTextContent(
      'not enough VRAM'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Configurar proveedor' }));
    expect(onOpenProviderSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('lmstudio-loading-error')).toBeNull();
  });

  test('permite descartar el error sin abrir la configuración', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        success: true,
        loading: false,
        model: 'qwen2.5-7b',
        error: 'No se pudo cargar el modelo "qwen2.5-7b" en LM Studio: not enough VRAM',
        failedAt: Date.now(),
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<LmStudioLoadingNotice selectedModel="lmstudio/qwen2.5-7b" busy lang="es" />);

    await screen.findByTestId('lmstudio-loading-error');
    fireEvent.click(screen.getByRole('button', { name: 'Descartar aviso' }));

    expect(screen.queryByTestId('lmstudio-loading-error')).toBeNull();
  });

  test('no consulta si el modelo no es de LM Studio o no hay ejecución', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { rerender } = render(
      <LmStudioLoadingNotice selectedModel="gemini-3.5-flash" busy lang="es" />
    );
    expect(fetchMock).not.toHaveBeenCalled();

    rerender(
      <LmStudioLoadingNotice selectedModel="lmstudio/qwen2.5-7b" busy={false} lang="es" />
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
