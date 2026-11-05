import { describe, expect, test } from 'vitest';
import { lmStudioHostScope, normalizeLmStudioHost, parseLmStudioModels } from '../../src/lib/lmStudio';

describe('normalizeLmStudioHost', () => {
  test('añade /v1 cuando el host remoto se escribe sin la base de la API', () => {
    expect(normalizeLmStudioHost('http://192.168.1.20:1234')).toBe('http://192.168.1.20:1234/v1');
    expect(normalizeLmStudioHost('192.168.1.20:1234')).toBe('http://192.168.1.20:1234/v1');
  });

  test('respeta /v1 existente y quita barras finales', () => {
    expect(normalizeLmStudioHost('http://localhost:1234/v1/')).toBe('http://localhost:1234/v1');
    expect(normalizeLmStudioHost('https://studio.local/v1')).toBe('https://studio.local/v1');
  });

  test('usa el puerto local por defecto si el host está vacío', () => {
    expect(normalizeLmStudioHost('')).toBe('http://localhost:1234/v1');
  });
});

describe('lmStudioHostScope', () => {
  test('nombra local al host de este equipo y remoto al de la red', () => {
    expect(lmStudioHostScope('http://localhost:1234/v1')).toBe('local');
    expect(lmStudioHostScope('127.0.0.1:1234')).toBe('local');
    expect(lmStudioHostScope('http://[::1]:1234/v1')).toBe('local');
    expect(lmStudioHostScope('http://192.168.178.77:1234/v1')).toBe('remoto');
    expect(lmStudioHostScope('')).toBe('local');
  });
});

describe('parseLmStudioModels', () => {
  test('lee la respuesta OpenAI y la nativa', () => {
    expect(parseLmStudioModels({ data: [{ id: 'qwen2.5-7b' }] })).toEqual(['qwen2.5-7b']);
    expect(parseLmStudioModels({ models: ['llama-3.2'] })).toEqual(['llama-3.2']);
  });

  test('descarta entradas vacías y duplicados', () => {
    expect(parseLmStudioModels({ data: [{ id: 'a' }, { id: 'a' }, {}, null] })).toEqual(['a']);
    expect(parseLmStudioModels(null)).toEqual([]);
  });
});
