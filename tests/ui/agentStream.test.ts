/**
 * Tests del streaming SSE del bucle headless (`runAgent`).
 *
 * Simulamos `fetch` para verificar que:
 *  • Los `data: {type:'chunk'}` se emiten como eventos `chunk`.
 *  • Los `functionCalls` del evento `done` disparan la tool.
 *  • La respuesta final sin tools termina el bucle.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { runAgent } from '../../src/cli/agentClient';

/**
 * Construye una `Response` falsa con cuerpo SSE.
 *
 * No usamos `ReadableStream` (jsdom no lo expone con `getReader`): en su lugar
 * devolvemos el mínimo que consume `agentClient` (`body.getReader().read()`).
 */
function sseResponse(events: unknown[]): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  const reader = {
    read: async () =>
      sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes }),
  };
  return { ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runAgent (streaming)', () => {
  test('consume SSE, ejecuta tools y devuelve la respuesta final', async () => {
    const fetchMock = vi
      .fn()
      // 1ª vuelta del modelo: streaming + una tool.
      .mockResolvedValueOnce(
        sseResponse([
          { type: 'chunk', text: 'Analizo ' },
          { type: 'chunk', text: 'el repo.' },
          {
            type: 'done',
            fullText: 'Analizo el repo.',
            functionCalls: [{ name: 'read_file', args: { path: 'a.ts' } }],
          },
        ])
      )
      // Ejecución de la tool en el servidor.
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, content: 'x' }) })
      // 2ª vuelta: respuesta final sin tools.
      .mockResolvedValueOnce(
        sseResponse([
          { type: 'chunk', text: 'Todo ' },
          { type: 'chunk', text: 'listo.' },
          { type: 'done', fullText: 'Todo listo.', functionCalls: [] },
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

    const types: string[] = [];
    const chunks: string[] = [];
    const result = await runAgent({
      serverUrl: 'http://127.0.0.1:3280',
      task: 'demo',
      cwd: '.',
      model: 'gemini-2.5-flash',
      stream: true,
      maxSteps: 5,
      onEvent: (e) => {
        types.push(e.type);
        if (e.type === 'chunk') chunks.push(e.text);
      },
    });

    expect(result.answer).toBe('Todo listo.');
    expect(result.steps).toBe(2);
    expect(types).toContain('chunk');
    expect(types).toContain('tool_call');
    expect(types).toContain('answer');
    expect(chunks.join('')).toBe('Analizo el repo.Todo listo.');
    // Con streaming, el `thought` completo no se reemite (ya llegó por chunks).
    expect(types).not.toContain('thought');
  });

  test('sin stream usa el endpoint no-SSE', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'Hola', functionCalls: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const types: string[] = [];
    const result = await runAgent({
      serverUrl: 'http://127.0.0.1:3280',
      task: 'demo',
      cwd: '.',
      model: 'gemini-2.5-flash',
      stream: false,
      maxSteps: 5,
      onEvent: (e) => types.push(e.type),
    });

    expect(result.answer).toBe('Hola');
    expect(types).toContain('thought');
    expect(types).not.toContain('chunk');
  });
});
