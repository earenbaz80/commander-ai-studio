import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchStrataModelIds,
  generateStrataChat,
  normalizeStrataBaseUrl,
} from '../../src/providers/strata';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Strata adapter', () => {
  it('normaliza el host y lee el catálogo OpenAI desde /models', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ object: 'list', data: [{ id: 'iq3_s' }, { id: 'iq3_siq3_s' }] });
    }));

    await expect(fetchStrataModelIds({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1/',
    })).resolves.toEqual(['iq3_s', 'iq3_siq3_s']);

    expect(calls[0].url).toBe('https://example.test/v1/models');
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer test-key' });
  });

  it('usa /health como fallback del catálogo cuando /models no existe', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return String(url).endsWith('/models')
        ? jsonResponse({ error: 'No route' }, 404)
        : jsonResponse({ key: { allowed_models: ['gpt-5.4'] } });
    }));

    await expect(fetchStrataModelIds({
      apiKey: 'test-key',
      baseUrl: 'https://hosted.test/v1',
    })).resolves.toEqual(['gpt-5.4']);

    expect(calls).toEqual([
      'https://hosted.test/v1/models',
      'https://hosted.test/v1/health',
    ]);
  });

  it('envía system + user al contrato OpenAI y devuelve content', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'pong' } }],
        model: 'iq3_s',
        usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
      });
    }));

    const result = await generateStrataChat({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      prompt: 'ping',
      systemInstruction: 'Sé breve',
      model: 'strata/iq3_s',
    });

    expect(result).toMatchObject({ content: 'pong', model: 'iq3_s' });
    expect(calls[0].url).toBe('https://example.test/v1/chat/completions');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      model: 'iq3_s',
      messages: [
        { role: 'system', content: 'Sé breve' },
        { role: 'user', content: 'ping' },
      ],
      stream: false,
    });
  });

  it('cae al contrato /chat del Strata alojado si chat/completions no existe', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return String(url).endsWith('/chat/completions')
        ? jsonResponse({ error: 'No route' }, 404)
        : jsonResponse({ content: 'pong', model: 'gpt-5.4' });
    }));

    const result = await generateStrataChat({
      apiKey: 'test-key',
      baseUrl: 'https://hosted.test/v1',
      prompt: 'ping',
      model: 'strata/gpt-5.4',
    });

    expect(result).toMatchObject({ content: 'pong', model: 'gpt-5.4' });
    expect(calls).toEqual([
      'https://hosted.test/v1/chat/completions',
      'https://hosted.test/v1/chat',
    ]);
  });

  it('normaliza la base por defecto', () => {
    expect(normalizeStrataBaseUrl('')).toBe('https://app.strata.kronisys.com/v1');
    expect(normalizeStrataBaseUrl('https://tenant.example/v1/')).toBe('https://tenant.example/v1');
  });
});
