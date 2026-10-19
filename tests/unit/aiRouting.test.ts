import { describe, it, expect } from 'vitest';
import { resolveChatRoute } from '../../src/lib/aiRouting';

/**
 * Semántica de enrutado de modelos.
 *
 * Regresión principal: los modelos descargados en runtime (`local/<file>`) se
 * ruteaban a `/api/hf/generate` en Freeform y Structured porque esas copias del
 * ternary no comprobaban `isLocal` antes de la heurística `includes('/')`.
 */
describe('resolveChatRoute', () => {
  describe('precedencia de prefijos', () => {
    it.each([
      ['custom/gpt-4', '/api/custom/generate'],
      ['local/mistral', '/api/local-models/generate'],
      ['openrouter/llama-3', '/api/openrouter/generate'],
      ['pollinations/pi', '/api/pollinations/generate'],
      ['ollama/llama3', '/api/ollama/generate'],
    ])('no confunde el prefijo %s con HuggingFace', (modelId, expected) => {
      const route = resolveChatRoute({ modelId });
      expect(route.isHf).toBe(false);
      expect(route.endpoint).toBe(expected);
    });

    it('detecta HuggingFace por id estilo org/repo', () => {
      const route = resolveChatRoute({ modelId: 'meta-llama/Llama-3-8B' });
      expect(route.isHf).toBe(true);
      expect(route.endpoint).toBe('/api/hf/generate');
    });
  });

  describe('modelo local descargado (regresión)', () => {
    const downloaded = [{ id: 'local/mistral.bin', hfRepoId: 'local/mistral.bin' }];

    it('no cae en HuggingFace aunque el id tenga barra', () => {
      const route = resolveChatRoute({
        modelId: 'local/mistral.bin',
        downloadedModels: downloaded,
      });
      expect(route.isLocal).toBe(true);
      expect(route.isHf).toBe(false);
      expect(route.endpoint).toBe('/api/local-models/generate');
    });

    it('reconoce el modelo descargado por hfRepoId sin prefijo local/', () => {
      const route = resolveChatRoute({
        modelId: 'tinyllama-1.1b',
        downloadedModels: [{ id: 'llama-1', hfRepoId: 'tinyllama-1.1b' }],
      });
      expect(route.isHf).toBe(true);
      expect(route.endpoint).toBe('/api/hf/generate');
    });
  });

  describe('proveedor explícito', () => {
    it('el proveedor gana sobre el prefijo del id', () => {
      const route = resolveChatRoute({ modelId: 'local/llama', provider: 'openrouter' });
      expect(route.endpoint).toBe('/api/openrouter/generate');
    });

    it('provider local sin prefijo en el id', () => {
      const route = resolveChatRoute({ modelId: 'qwen', provider: 'local' });
      expect(route.isLocal).toBe(true);
      expect(route.endpoint).toBe('/api/local-models/generate');
    });
  });

  describe('anthropic', () => {
    it('detecta por prefijo claude y fija ambos endpoints', () => {
      const route = resolveChatRoute({ modelId: 'claude-sonnet-4' });
      expect(route.isAnthropic).toBe(true);
      expect(route.endpoint).toBe('/api/anthropic/generate');
      expect(route.streamEndpoint).toBe('/api/anthropic/stream');
    });

    it('detecta por provider aunque el id no diga claude', () => {
      const route = resolveChatRoute({ modelId: 'my-tuned-model', provider: 'anthropic' });
      expect(route.endpoint).toBe('/api/anthropic/generate');
    });

    it('el resto usa el stream de gemini', () => {
      expect(resolveChatRoute({ modelId: 'gemini-2.5-flash' }).streamEndpoint).toBe(
        '/api/gemini/stream'
      );
    });
  });

  describe('gemini por defecto', () => {
    it('cae a gemini sin prefijo ni provider', () => {
      const route = resolveChatRoute({ modelId: 'gemini-3.8-flash' });
      expect(route.isAnthropic).toBe(false);
      expect(route.isHf).toBe(false);
      expect(route.endpoint).toBe('/api/gemini/generate');
    });

    it('isFreeProvider cubre ollama, openrouter y pollinations', () => {
      expect(resolveChatRoute({ modelId: 'ollama/llama3' }).isFreeProvider).toBe(true);
      expect(resolveChatRoute({ modelId: 'x', provider: 'openrouter' }).isFreeProvider).toBe(true);
      expect(resolveChatRoute({ modelId: 'x', provider: 'pollinations' }).isFreeProvider).toBe(true);
      expect(resolveChatRoute({ modelId: 'gemini-3.8-flash' }).isFreeProvider).toBe(false);
    });
  });
});