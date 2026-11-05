import { describe, expect, test } from 'vitest';
import type { AIModel } from '../../src/types/studio';
import type { ModelGroup } from '../../src/components/chat/modelGroups';
import { countModels, filterModelGroups } from '../../src/components/chat/modelSearch';

const model = (id: string, name: string, provider: AIModel['provider'], extra: Partial<AIModel> = {}): AIModel => ({
  id,
  name,
  provider,
  description: '',
  contextWindow: '128K',
  ...extra,
});

const GROUPS: ModelGroup[] = [
  {
    id: 'google',
    label: 'Google Gemini',
    models: [
      model('gemini-3.5-flash', 'Gemini 3.5 Flash', 'google', { badge: 'Flash 2026' }),
      model('gemini-3.1-pro', 'Gemini 3.1 Pro', 'google', { badge: 'Pro 2026' }),
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    models: [
      model('ollama/llama3.2', 'Llama 3.2', 'ollama', { badge: 'Gratis Local' }),
      model('ollama/qwen2.5-coder', 'Qwen 2.5 Coder', 'ollama', { badge: 'Gratis Coder' }),
    ],
  },
];

const ids = (groups: ReturnType<typeof filterModelGroups>) => groups.flatMap((group) => group.models.map((m) => m.id));

describe('filterModelGroups', () => {
  test('sin texto devuelve el catálogo completo', () => {
    expect(countModels(filterModelGroups(GROUPS, ''))).toBe(4);
    expect(countModels(filterModelGroups(GROUPS, '   '))).toBe(4);
  });

  test('busca por nombre de modelo', () => {
    expect(ids(filterModelGroups(GROUPS, 'qwen'))).toEqual(['ollama/qwen2.5-coder']);
  });

  test('busca por proveedor y lista todo su grupo', () => {
    expect(ids(filterModelGroups(GROUPS, 'ollama'))).toEqual(['ollama/llama3.2', 'ollama/qwen2.5-coder']);
  });

  test('combina proveedor y modelo en varias palabras', () => {
    expect(ids(filterModelGroups(GROUPS, 'google pro'))).toEqual(['gemini-3.1-pro']);
  });

  test('ignora acentos y mayúsculas', () => {
    expect(ids(filterModelGroups(GROUPS, 'GEMINI'))).toEqual(['gemini-3.5-flash', 'gemini-3.1-pro']);
  });

  test('el filtro de proveedor recorta antes de buscar', () => {
    expect(ids(filterModelGroups(GROUPS, 'flash', 'google'))).toEqual(['gemini-3.5-flash']);
    expect(filterModelGroups(GROUPS, 'flash', 'ollama')).toEqual([]);
  });

  test('sin coincidencias devuelve lista vacía', () => {
    expect(filterModelGroups(GROUPS, 'zzz')).toEqual([]);
    expect(countModels(filterModelGroups(GROUPS, 'zzz'))).toBe(0);
  });
});
