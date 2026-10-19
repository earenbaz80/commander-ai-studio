import { describe, it, expect } from 'vitest';
import { detectProvider, resolveEndpoint, resolveStreamEndpoint } from '../../src/lib/aiProviders';
import type { ProviderType } from '../../src/types/studio';

/**
 * Regresión: `detectProvider` chequeaba `modelId.includes('/')` (heurística de
 * HuggingFace) ANTES que los prefijos con barra. Como casi todos los providers
 * usan `prefixo/modelo`, todo ollama/, openrouter/, pollinations/, custom/ y
 * local/ se clasificaba como 'huggingface' y las ramas siguientes quedaban
 * inalcanzables.
 */
describe('detectProvider', () => {
  const P = (id: string): ProviderType => detectProvider(id, 'google', []);

  it('resuelve prefijos con barra antes que la heurística de HuggingFace', () => {
    expect(P('ollama/llama3.2')).toBe('ollama');
    expect(P('openrouter/deepseek/deepseek-chat')).toBe('openrouter');
    expect(P('pollinations/openai')).toBe('pollinations');
    expect(P('custom/mi-modelo')).toBe('custom');
    expect(P('local/qwen2.5-1.5b-instruct-q8_0.gguf')).toBe('local');
  });

  it('sigue detectando modelos HuggingFace org/repo', () => {
    expect(P('deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B')).toBe('huggingface');
  });

  it('detecta proveedores sin barra', () => {
    expect(P('gemini-2.5-flash')).toBe('google');
    expect(P('claude-3-5-sonnet-20241022')).toBe('anthropic');
    expect(P('grok-3')).toBe('xai');
    expect(P('antigravity-preview-09-2026')).toBe('google');
  });

  it('respeta el override explícito del provider seleccionado', () => {
    expect(detectProvider('gemini-2.5-flash', 'anthropic', [])).toBe('anthropic');
    expect(detectProvider('ollama/llama3.2', 'xai', [])).toBe('xai');
  });

  it('cae a google cuando no reconoce el id', () => {
    expect(P('modelo-desconocido')).toBe('google');
  });

  it('reconoce modelos descargados de HuggingFace', () => {
    const downloaded = [{ hfRepoId: 'user/repo-local', id: 'user/repo-local' }] as any;
    expect(detectProvider('user/repo-local', 'google', downloaded)).toBe('huggingface');
  });
});

describe('resolveEndpoint', () => {
  it('mapea cada provider a su endpoint por defecto', () => {
    expect(resolveEndpoint('gemini-2.5-flash')).toBe('/api/gemini/generate');
    expect(resolveEndpoint('claude-3-5-sonnet-20241022')).toBe('/api/anthropic/generate');
    expect(resolveEndpoint('ollama/llama3.2')).toBe('/api/ollama/generate');
    expect(resolveEndpoint('openrouter/foo/bar')).toBe('/api/openrouter/generate');
    expect(resolveEndpoint('pollinations/openai')).toBe('/api/pollinations/generate');
    expect(resolveEndpoint('custom/mi-modelo')).toBe('/api/custom/generate');
    expect(resolveEndpoint('local/modelo.gguf')).toBe('/api/local-models/generate');
    expect(resolveEndpoint('org/repo')).toBe('/api/hf/generate');
  });

  it('usa el endpoint de streaming solo donde existe', () => {
    expect(resolveEndpoint('gemini-2.5-flash', { streaming: true })).toBe('/api/gemini/stream');
    expect(resolveEndpoint('claude-3-5-sonnet', { streaming: true })).toBe('/api/anthropic/stream');
    // huggingface no expone stream: cae al endpoint normal en vez de romper.
    expect(resolveEndpoint('org/repo', { streaming: true })).toBe('/api/hf/generate');
    expect(resolveEndpoint('ollama/llama3.2', { streaming: true })).toBe('/api/ollama/generate');
  });

  it('permite cambiar el provider de fallback', () => {
    expect(resolveEndpoint('modelo-desconocido')).toBe('/api/gemini/generate');
    expect(resolveEndpoint('modelo-desconocido', { fallback: 'anthropic' })).toBe('/api/anthropic/generate');
  });
});

describe('resolveStreamEndpoint', () => {
  it('devuelve el stream solo donde el provider lo expone', () => {
    expect(resolveStreamEndpoint('gemini-2.5-flash')).toBe('/api/gemini/stream');
    expect(resolveStreamEndpoint('claude-3-5-sonnet')).toBe('/api/anthropic/stream');
  });

  it('devuelve null en vez de degradar, para no abrir conexiones inútiles', () => {
    expect(resolveStreamEndpoint('ollama/llama3.2')).toBeNull();
    expect(resolveStreamEndpoint('openrouter/foo/bar')).toBeNull();
    expect(resolveStreamEndpoint('custom/mi-modelo')).toBeNull();
    expect(resolveStreamEndpoint('org/repo')).toBeNull();
    expect(resolveStreamEndpoint('grok-3')).toBeNull();
  });
});