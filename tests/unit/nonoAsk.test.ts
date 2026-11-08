/**
 * Nono con el proveedor activo: antes sólo llamaba a Gemini y con LM Studio u
 * Ollama configurados seguía contestando plantillas. Estos tests fijan el
 * endpoint elegido, el historial que viaja y la distinción fallo / sin clave.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { askNonoDetailed } from '../../src/utils/nonoAsk';
import { resetApiKeyConfigured } from '../../src/lib/apiKeyFlags';

const json = (payload: unknown) =>
  ({ ok: true, status: 200, json: async () => payload }) as unknown as Response;

let calls: { url: string; body: any }[] = [];
let geminiKey = '';

beforeEach(() => {
  calls = [];
  geminiKey = '';
  resetApiKeyConfigured();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init?: any) => {
      const target = String(url);
      if (target.startsWith('/api/keys/')) return json({ success: true, value: geminiKey });
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url: target, body });
      return json({ success: true, text: 'Hola desde local' });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('askNonoDetailed', () => {
  it('usa el endpoint del proveedor activo y le quita el prefijo al modelo', async () => {
    const result = await askNonoDetailed('¿qué tal?', {
      selectedProvider: 'lmstudio',
      selectedModel: 'lmstudio/qwen2.5-coder-7b',
    });

    expect(result.text).toBe('Hola desde local');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/lmstudio/generate');
    expect(calls[0].body.model).toBe('qwen2.5-coder-7b');
    expect(calls[0].body.apiKey).toBeUndefined();
  });

  it('manda los turnos anteriores dentro del prompt', async () => {
    await askNonoDetailed('y ahora?', {
      selectedProvider: 'ollama',
      selectedModel: 'llama3.2',
      history: [
        { fromUser: true, text: 'hola' },
        { fromUser: false, text: '¡Hey! ¿qué necesitas?' },
      ],
    });

    expect(calls[0].url).toBe('/api/ollama/generate');
    expect(calls[0].body.prompt).toContain('Usuario: hola');
    expect(calls[0].body.prompt).toContain('Nono: ¡Hey!');
    expect(calls[0].body.prompt.trim().endsWith('Usuario: y ahora?')).toBe(true);
  });

  it('sin clave de Gemini no llama al modelo ni lo trata como error', async () => {
    const result = await askNonoDetailed('hola', { selectedProvider: 'google' });
    expect(result).toEqual({ text: null });
    expect(calls).toHaveLength(0);
  });

  it('propaga el motivo cuando el proveedor configurado no responde', async () => {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init?: any) => {
        const target = String(url);
        if (target.startsWith('/api/keys/')) return json({ success: true, value: '' });
        calls.push({ url: target, body: init?.body ? JSON.parse(String(init.body)) : null });
        return json({ ok: false, error: 'LM Studio HTTP 500' });
      })
    );

    const result = await askNonoDetailed('hola', {
      selectedProvider: 'lmstudio',
      selectedModel: 'qwen',
    });
    expect(result.text).toBeNull();
    expect(result.error).toBe('LM Studio HTTP 500');
    expect(calls[0].url).toBe('/api/lmstudio/generate');
  });
});
