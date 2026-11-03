import { describe, expect, test } from 'vitest';
import { buildModelGroups } from '../../src/components/chat/modelGroups';
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
