import { describe, expect, test, vi } from 'vitest';
import {
  classifyStrataFailure,
  fetchStrataWithRetry,
  isStrataIntegrationError,
  parseRetryAfter,
  strataErrorPayload,
} from '../../src/lib/strataErrors';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

describe('errores tipificados de Strata', () => {
  test('distingue clave inválida, modelo no cargado, contexto, cola y timeout', () => {
    const auth = classifyStrataFailure({
      status: 401,
      payload: { error: { message: 'Invalid API key' } },
    });
    expect(auth.code).toBe('STRATA_INVALID_API_KEY');
    expect(auth.httpStatus).toBe(401);
    expect(auth.retryable).toBe(false);

    const model = classifyStrataFailure({
      status: 503,
      payload: { error: { message: 'Model not loaded' } },
    });
    expect(model.code).toBe('STRATA_MODEL_NOT_LOADED');
    expect(model.retryable).toBe(false);

    const context = classifyStrataFailure({
      status: 400,
      payload: { error: { message: 'context length exceeded: 131072 > 32768' } },
    });
    expect(context.code).toBe('STRATA_CONTEXT_EXCEEDED');
    expect(context.retryable).toBe(false);

    const queue = classifyStrataFailure({
      status: 429,
      payload: { error: { message: 'queue is full' } },
      retryAfterMs: 1_500,
    });
    expect(queue.code).toBe('STRATA_QUEUE_BUSY');
    expect(queue.retryable).toBe(true);
    expect(queue.retryAfterMs).toBe(1_500);

    const timeout = classifyStrataFailure({
      status: 504,
      payload: { error: { message: 'request timeout' } },
    });
    expect(timeout.code).toBe('STRATA_TIMEOUT');
    expect(timeout.retryable).toBe(true);
  });

  test('un cuerpo con modelo no cargado gana a un 400 genérico', () => {
    expect(
      classifyStrataFailure({
        status: 400,
        payload: { error: { message: 'model is not loaded yet' } },
      }).code
    ).toBe('STRATA_MODEL_NOT_LOADED');
  });

  test('no clasifica una cancelación del usuario como timeout', () => {
    const cancelled = classifyStrataFailure({
      aborted: true,
      message: 'Generación cancelada',
    });
    expect(cancelled.code).toBe('STRATA_CANCELLED');
    expect(cancelled.retryable).toBe(false);
  });

  test('el payload conserva código, pista y reintento', () => {
    const error = classifyStrataFailure({
      status: 429,
      payload: { error: { message: 'queue busy' } },
    });
    expect(strataErrorPayload(error)).toMatchObject({
      ok: false,
      success: false,
      code: 'STRATA_QUEUE_BUSY',
      retryable: true,
      error: 'queue busy',
    });
    expect(strataErrorPayload(error).hint).toBeTruthy();
  });

  test('redacta la API key conocida y cualquier Bearer en el mensaje', () => {
    const secret = 'strata-clave-que-no-debe-salir';
    const error = classifyStrataFailure({
      status: 500,
      payload: {
        error: { message: `falló con Bearer ${secret} y api_key=${secret}` },
      },
      secret,
    });

    expect(error.message).not.toContain(secret);
    expect(error.message).toContain('[redacted]');
    expect(strataErrorPayload(error).error).not.toContain(secret);
  });

  test('parsea Retry-After en segundos y en fecha HTTP', () => {
    expect(parseRetryAfter('2', 0)).toBe(2_000);
    expect(parseRetryAfter('0', 0)).toBe(0);
    expect(parseRetryAfter(new Date(5_000).toUTCString(), 1_000)).toBe(4_000);
    expect(parseRetryAfter('no-es-fecha')).toBeUndefined();
  });
});

describe('reintento seguro de Strata', () => {
  test('reintenta una cola ocupada y devuelve sólo la respuesta final', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { message: 'queue full' } }, 429, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(json({ choices: [{ message: { content: 'ok' } }] }));
    const sleep = vi.fn(async () => {});

    const response = await fetchStrataWithRetry(fetcher as any, '/chat/completions', {}, { sleep });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(await response.json()).toEqual({ choices: [{ message: { content: 'ok' } }] });
  });

  test('reintenta un timeout y no devuelve la respuesta fallida', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { message: 'timeout' } }, 504))
      .mockResolvedValueOnce(json({ choices: [{ message: { content: 'ok' } }] }));
    const sleep = vi.fn(async () => {});

    const response = await fetchStrataWithRetry(fetcher as any, '/chat/completions', {}, { sleep });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await response.json()).toEqual({ choices: [{ message: { content: 'ok' } }] });
  });

  test('no reintenta clave inválida ni modelo no cargado', async () => {
    const auth = vi.fn().mockResolvedValueOnce(json({ error: { message: 'Invalid API key' } }, 401));
    await expect(fetchStrataWithRetry(auth as any, '/chat/completions', {})).rejects.toMatchObject({
      code: 'STRATA_INVALID_API_KEY',
      retryable: false,
    });
    expect(auth).toHaveBeenCalledTimes(1);

    const model = vi.fn().mockResolvedValueOnce(json({ error: { message: 'Model not loaded' } }, 503));
    await expect(fetchStrataWithRetry(model as any, '/chat/completions', {})).rejects.toMatchObject({
      code: 'STRATA_MODEL_NOT_LOADED',
      retryable: false,
    });
    expect(model).toHaveBeenCalledTimes(1);
  });

  test('redacta la clave en los errores del transporte y del upstream', async () => {
    const secret = 'clave-de-transporte-abcdef';
    const network = vi.fn().mockRejectedValueOnce(new Error(`connect failed Authorization: Bearer ${secret}`));
    const networkError = await fetchStrataWithRetry(
      network as any,
      '/chat/completions',
      {},
      { secret, maxAttempts: 1 }
    ).catch((error) => error);
    expect(networkError.message).not.toContain(secret);

    const upstream = vi.fn().mockResolvedValueOnce(json({ error: { message: `api_key=${secret}` } }, 500));
    const upstreamError = await fetchStrataWithRetry(
      upstream as any,
      '/chat/completions',
      {},
      { secret, maxAttempts: 1 }
    ).catch((error) => error);
    expect(upstreamError.message).not.toContain(secret);
  });

  test('no reintenta una petición cancelada', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Generación cancelada'));
    const fetcher = vi.fn();

    await expect(
      fetchStrataWithRetry(fetcher as any, '/chat/completions', { signal: controller.signal })
    ).rejects.toMatchObject({
      code: 'STRATA_CANCELLED',
      retryable: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('sólo hace un reintento y devuelve el error tipificado del segundo fallo', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ error: { message: 'queue full' } }, 429));

    await expect(fetchStrataWithRetry(fetcher as any, '/chat/completions', {})).rejects.toMatchObject({
      code: 'STRATA_QUEUE_BUSY',
      retryable: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      isStrataIntegrationError(
        await fetchStrataWithRetry(fetcher as any, '/chat/completions', {}).catch((error) => error)
      )
    ).toBe(true);
  });
});
