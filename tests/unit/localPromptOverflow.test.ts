import { describe, expect, test } from 'vitest';
import {
  fetchChatWithOverflowRetry,
  isContextOverflow,
  shrinkLocalMessages,
  type LocalChatMessage,
} from '../../src/lib/localPromptOverflow';

const overflowBody = JSON.stringify({
  error: { code: 400, message: 'the request exceeds the available context size, try increasing it' },
});

const message = (role: string, length: number, fill = 'x'): LocalChatMessage => ({
  role,
  content: fill.repeat(length),
});

describe('isContextOverflow', () => {
  test('acepta el 400 de ventana de contexto', () => {
    expect(isContextOverflow(400, overflowBody)).toBe(true);
    expect(isContextOverflow(400, '{"error":"n_ctx is too small"}')).toBe(true);
  });

  test('ignora otros 400 y otros estados', () => {
    expect(isContextOverflow(400, 'invalid sampling parameters: temp must be >= 0')).toBe(false);
    expect(isContextOverflow(500, overflowBody)).toBe(false);
    expect(isContextOverflow(400, '')).toBe(false);
  });
});

describe('shrinkLocalMessages', () => {
  test('recorta del medio y conserva system y último turno', () => {
    const messages = [
      message('system', 300, 's'),
      message('user', 4_000, 'a'),
      message('assistant', 4_000, 'b'),
      message('user', 80, 'c'),
    ];
    const shrunk = shrinkLocalMessages(messages);

    expect(shrunk).not.toBeNull();
    expect(shrunk!.messages[0].role).toBe('system');
    expect(shrunk!.messages[0].content).toHaveLength(300);
    expect(shrunk!.messages.at(-1)?.content).toBe('c'.repeat(80));
    const middle = shrunk!.messages[1].content;
    expect(middle.length).toBeLessThan(1_400);
    expect(middle).toMatch(/caracteres omitidos/);
  });

  test('descarta turnos viejos hasta entrar en el presupuesto', () => {
    const messages = [message('system', 100, 's')];
    for (let index = 0; index < 20; index += 1) {
      messages.push(message(index % 2 === 0 ? 'user' : 'assistant', 1_200));
    }
    messages.push(message('user', 100, 'z'));

    const shrunk = shrinkLocalMessages(messages, { budgetChars: 4_000 });

    expect(shrunk).not.toBeNull();
    expect(shrunk!.dropped).toBeGreaterThan(0);
    const total = shrunk!.messages.reduce((sum, item) => sum + item.content.length, 0);
    expect(total).toBeLessThanOrEqual(4_000);
    expect(shrunk!.messages[0].content).toBe('s'.repeat(100));
    expect(shrunk!.messages.at(-1)?.content).toBe('z'.repeat(100));
  });

  test('devuelve null si no hay nada que recortar', () => {
    expect(shrinkLocalMessages([message('system', 100, 's'), message('user', 200, 'u')])).toBeNull();
  });
});

describe('fetchChatWithOverflowRetry', () => {
  test('reintenta una vez con el historial recortado', async () => {
    const bodies: any[] = [];
    const fetchImpl = (async (_url: string, init: any) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (bodies.length === 1) {
        return new Response(overflowBody, { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await fetchChatWithOverflowRetry(
      'http://127.0.0.1:1/chat/completions',
      {
        messages: [message('system', 300, 's'), message('user', 5_000, 'a'), message('user', 50, 'u')],
      },
      { fetchImpl }
    );

    expect(result.response.status).toBe(200);
    expect(result.trimmed).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].messages[1].content.length).toBeLessThan(bodies[0].messages[1].content.length);
    expect(bodies[1].messages.at(-1).content).toBe('u'.repeat(50));
  });

  test('no reintenta un 400 que no es de contexto', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('{"error":"invalid sampling parameters"}', { status: 400 });
    }) as unknown as typeof fetch;

    const result = await fetchChatWithOverflowRetry(
      'http://127.0.0.1:1/chat/completions',
      { messages: [message('user', 5_000, 'a')] },
      { fetchImpl }
    );

    expect(result.response.status).toBe(400);
    expect(result.trimmed).toBe(false);
    expect(calls).toBe(1);
  });
});
