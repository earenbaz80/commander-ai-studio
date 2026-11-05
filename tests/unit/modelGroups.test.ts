import { describe, expect, test } from 'vitest';
import { buildModelGroups, modelGroupStatus } from '../../src/components/chat/modelGroups';
import type { AIModel } from '../../src/types/studio';

const model = (id: string, provider: AIModel['provider']): AIModel => ({
  id,
  name: id,
  provider,
  description: '',
  contextWindow: '128K tokens',
});

describe('buildModelGroups', () => {
  test('agrupa el catálogo vivo por proveedor, incluidos OpenAI, NVIDIA y LM Studio', () => {
    const groups = buildModelGroups([
      model('gpt-4.1', 'openai'),
      model('nvidia/meta/llama-3.3-70b-instruct', 'nvidia'),
      model('lmstudio/qwen2.5-7b', 'lmstudio'),
      model('gemini-3.5-flash', 'google'),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['google', 'openai', 'nvidia', 'lmstudio']);
    expect(groups.find((g) => g.id === 'nvidia')!.label).toBe('NVIDIA NIM');
  });

  test('marca cada grupo como conectado, guardado, caído o desactivado', () => {
    const groups = buildModelGroups(
      [model('ollama/llama3.2', 'ollama'), model('lmstudio/qwen', 'lmstudio'), model('gpt-4.1', 'openai')],
      {
        ollama: { available: true, configured: true },
        lmstudio: { available: true, configured: true, cached: true },
        openai: { available: false, configured: true },
      }
    );

    expect(groups.find((g) => g.id === 'ollama')!.status).toBe('connected');
    // Guardado: LM Studio apagado con la última lista detectada.
    expect(groups.find((g) => g.id === 'lmstudio')!.status).toBe('saved');
    expect(groups.find((g) => g.id === 'openai')!.status).toBe('offline');
    // Sin datos del proveedor no se inventa un estado.
    expect(buildModelGroups([model('x', 'custom')])[0].status).toBeUndefined();
  });

  test('modelGroupStatus prioriza la caché y distingue sin configurar', () => {
    expect(modelGroupStatus(undefined)).toBeUndefined();
    expect(modelGroupStatus({ available: true, configured: false })).toBe('disabled');
    expect(modelGroupStatus({ available: true, configured: true, cached: true })).toBe('saved');
    expect(modelGroupStatus({ available: false, configured: false })).toBe('disabled');
  });

  test('conserva la etiqueta histórica de HuggingFace y no duplica grupos', () => {
    const groups = buildModelGroups([
      model('org/repo-a', 'huggingface'),
      model('org/repo-b', 'huggingface'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('HuggingFace (Local)');
    expect(groups[0].models).toHaveLength(2);
  });
});
