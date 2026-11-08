/**
 * El sondeo de carga de LM Studio no debe quedar vivo después de que el
 * servidor confirme que el modelo ya terminó de cargar.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLmStudioLoading } from '../../src/hooks/useLmStudioLoading';

const realFetch = globalThis.fetch;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** Deja correr las microtareas del fetch y de `response.json()`. */
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
};

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe('useLmStudioLoading', () => {
  test('deja de sondear cuando la carga termina y no hace peticiones de más', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          success: true,
          loading: true,
          model: 'qwen2.5-7b',
          startedAt: Date.now(),
        })
      )
      .mockResolvedValueOnce(
        json({ success: true, loading: false, model: 'qwen2.5-7b' })
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useLmStudioLoading('lmstudio/qwen2.5-7b', true)
    );

    // Primer sondeo inmediato: la carga está en curso.
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);

    // Segundo sondeo, un segundo después: el servidor ya no está cargando.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(false);

    // Si el temporizador siguiera vivo, este salto dispararía una tercera
    // petición. El sondeo debe haber terminado en la respuesta anterior.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
