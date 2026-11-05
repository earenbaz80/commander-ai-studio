import { describe, expect, test } from 'vitest';
import {
  compatibleModelId,
  isCompatibleModelId,
  parseCompatibleModelId,
  slugifyProviderId,
} from '../../src/lib/openaiCompatibleProviders';
import { buildProviderList, customProviderSpecs, parseModelsDev } from '../../src/providers/registry';

describe('ids de proveedores añadidos', () => {
  test('genera y separa el prefijo conservando barras del modelo', () => {
    const id = compatibleModelId('groq', 'meta-llama/llama-3.3-70b');
    expect(id).toBe('openai-compatible/groq/meta-llama/llama-3.3-70b');
    expect(parseCompatibleModelId(id)).toEqual({
      providerId: 'groq',
      modelId: 'meta-llama/llama-3.3-70b',
    });
    expect(isCompatibleModelId('openai-compatible/groq/x')).toBe(true);
    expect(isCompatibleModelId('groq/llama')).toBe(false);
    expect(parseCompatibleModelId('openai-compatible/groq/')).toBeNull();
  });

  test('convierte nombres en ids estables', () => {
    expect(slugifyProviderId('Groq')).toBe('groq');
    expect(slugifyProviderId('Z.AI / GLM')).toBe('z-ai-glm');
    expect(slugifyProviderId('  ¡Nuevo!  ')).toBe('nuevo');
    expect(slugifyProviderId('***')).toBe('');
  });
});

describe('proveedores añadidos en el registro', () => {
  const config = {
    openaiCompatible: {
      groq: {
        name: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        models: ['llama-3.3-70b', 'mixtral-8x7b'],
      },
    },
  };

  test('aparecen como spec configurada con sus modelos', () => {
    expect(customProviderSpecs(config)).toEqual([
      expect.objectContaining({ id: 'groq', name: 'Groq', custom: true }),
    ]);

    const list = buildProviderList(config, new Set(), []);
    const groq = list.find((provider) => provider.id === 'groq');
    expect(groq?.configured).toBe(true);
    expect(groq?.modelCount).toBe(2);
    expect(groq?.allModels).toHaveLength(2);
    expect(groq?.models.map((model) => model.id)).toEqual([
      'openai-compatible/groq/llama-3.3-70b',
      'openai-compatible/groq/mixtral-8x7b',
    ]);
  });

  test('respetan las listas de modelos del proveedor', () => {
    const list = buildProviderList(
      { openaiCompatible: { groq: { ...config.openaiCompatible.groq, blacklist: ['openai-compatible/groq/mixtral-8x7b'] } } },
      new Set(),
      []
    );
    const filtered = list.find((provider) => provider.id === 'groq');
    expect(filtered?.models.map((model) => model.id)).toEqual([
      'openai-compatible/groq/llama-3.3-70b',
    ]);
    // El apagado sigue viajando en `allModels` para poder reactivarlo en Ajustes.
    expect(filtered?.allModels).toHaveLength(2);
  });

  test('el catálogo de models.dev conserva la URL base y los ids retirados se omiten', () => {
    const [provider] = parseModelsDev({
      deepseek: {
        name: 'DeepSeek',
        api: 'https://api.deepseek.com',
        doc: 'https://api-docs.deepseek.com',
        env: ['DEEPSEEK_API_KEY'],
        models: {
          'deepseek-chat': { name: 'DeepSeek Chat' },
          'deepseek-old': { name: 'Old', deprecated: true },
        },
      },
    });
    expect(provider.api).toBe('https://api.deepseek.com');
    expect(provider.doc).toBe('https://api-docs.deepseek.com');
    expect(provider.models.map((model) => model.id)).toEqual(['deepseek-chat']);
  });
});
