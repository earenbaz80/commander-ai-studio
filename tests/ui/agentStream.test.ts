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

describe('runAgent con Freebuff', () => {
  test('va al proxy y ejecuta los toolCalls que devuelve', async () => {
    const fetchMock = vi
      .fn()
      // El proxy es quien habla con el proveedor: recibe y devuelve `toolCalls`.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'Leo el archivo', toolCalls: [{ name: 'read_file', args: { path: 'a.ts' } }] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, data: { content: 'x' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'Listo', toolCalls: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAgent({
      serverUrl: 'http://127.0.0.1:3280',
      task: 'demo',
      cwd: '.',
      model: 'freebuff/gpt-6-luna',
      // Freebuff no expone SSE: pedir stream no debe abrir una conexión inútil.
      stream: true,
      maxSteps: 5,
    });

    expect(result.answer).toBe('Listo');
    expect(result.steps).toBe(2);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe('http://127.0.0.1:3280/api/freebuff/generate');
    expect(urls[1]).toBe('http://127.0.0.1:3280/api/agent/run-tool');
    expect(urls.some((u) => u.includes('/stream'))).toBe(false);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.model).toBe('freebuff/gpt-6-luna');
    expect(body.tools[0].type).toBe('function');
  });

  test('sin tool-calls no sale a la red y dice por qué', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const errors: string[] = [];
    const result = await runAgent({
      serverUrl: 'http://127.0.0.1:3280',
      task: 'demo',
      cwd: '.',
      model: 'freebuff/qwen-chat-7b',
      maxSteps: 5,
      onEvent: (e) => {
        if (e.type === 'error') errors.push(e.text);
      },
    });

    expect(result.answer).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errors.join('\n')).toMatch(/no soporta function calling nativo/);
  });
});
