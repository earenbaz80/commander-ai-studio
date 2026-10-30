import { describe, test, expect, beforeEach } from 'vitest';
import { DEFAULT_MODEL, runDefaultModelMigration } from '../../src/utils/defaultModel';

const MIGRATION_KEY = 'ai_studio_default_model_v3';

describe('migración del modelo por defecto', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('el default es Gemini 3.5 Flash', () => {
    expect(DEFAULT_MODEL).toBe('gemini-3.5-flash');
  });

  test('usuario existente con un default antiguo de Gemini pasa al default actual (global y pestañas)', () => {
    localStorage.setItem('ai_studio_selected_model', 'gemini-2.5-flash');
    localStorage.setItem('ai_studio_tabs_v1', JSON.stringify([
      { id: 'a', selectedModel: 'gemini-2.0-flash' },
      { id: 'b', selectedModel: 'gemini-2.5-flash' },
    ]));

    runDefaultModelMigration();

    expect(localStorage.getItem('ai_studio_selected_model')).toBe(DEFAULT_MODEL);
    const tabs = JSON.parse(localStorage.getItem('ai_studio_tabs_v1') || '[]');
    expect(tabs.map((t: { selectedModel: string }) => t.selectedModel)).toEqual([DEFAULT_MODEL, DEFAULT_MODEL]);
  });

  test('usuario sin modelo guardado recibe el default', () => {
    runDefaultModelMigration();
    expect(localStorage.getItem('ai_studio_selected_model')).toBe(DEFAULT_MODEL);
  });

  test('usuario que quedó en Pollinations (respondía 404) pasa al default actual', () => {
    localStorage.setItem('ai_studio_selected_model', 'pollinations/openai');
    localStorage.setItem('ai_studio_tabs_v1', JSON.stringify([{ id: 'a', selectedModel: 'pollinations/openai' }]));

    runDefaultModelMigration();

    expect(localStorage.getItem('ai_studio_selected_model')).toBe(DEFAULT_MODEL);
    const tabs = JSON.parse(localStorage.getItem('ai_studio_tabs_v1') || '[]');
    expect(tabs[0].selectedModel).toBe(DEFAULT_MODEL);
  });

  test('conserva un modelo elegido que no es un default antiguo', () => {
    localStorage.setItem('ai_studio_selected_model', 'gemini-3.8-flash');
    localStorage.setItem('ai_studio_tabs_v1', JSON.stringify([{ id: 'a', selectedModel: 'ollama/llama3.2' }]));

    runDefaultModelMigration();

    expect(localStorage.getItem('ai_studio_selected_model')).toBe('gemini-3.8-flash');
    const tabs = JSON.parse(localStorage.getItem('ai_studio_tabs_v1') || '[]');
    expect(tabs[0].selectedModel).toBe('ollama/llama3.2');
  });

  test('es idempotente: una segunda ejecución no vuelve a tocar los datos', () => {
    localStorage.setItem('ai_studio_selected_model', 'gemini-2.5-flash');
    runDefaultModelMigration();
    expect(localStorage.getItem(MIGRATION_KEY)).toBe('1');

    // Tras la migración el usuario elige Gemini a propósito: no debe revertirse.
    localStorage.setItem('ai_studio_selected_model', 'gemini-2.5-flash');
    runDefaultModelMigration();
    expect(localStorage.getItem('ai_studio_selected_model')).toBe('gemini-2.5-flash');
  });

  test('JSON de pestañas corrupto no rompe la carga', () => {
    localStorage.setItem('ai_studio_tabs_v1', '{no es json');
    expect(() => runDefaultModelMigration()).not.toThrow();
  });
});
