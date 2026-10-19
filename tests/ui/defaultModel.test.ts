import { describe, test, expect, beforeEach } from 'vitest';
import { DEFAULT_MODEL, runDefaultModelMigration } from '../../src/utils/defaultModel';

const MIGRATION_KEY = 'ai_studio_default_model_v2';

describe('migración del modelo por defecto', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('el default nuevo es Pollinations', () => {
    expect(DEFAULT_MODEL).toBe('pollinations/openai');
  });

  test('usuario existente con Gemini por defecto pasa a Pollinations (global y pestañas)', () => {
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

  test('conserva un modelo elegido que no es un default antiguo', () => {
    localStorage.setItem('ai_studio_selected_model', 'claude-3-7-sonnet-20250219');
    localStorage.setItem('ai_studio_tabs_v1', JSON.stringify([{ id: 'a', selectedModel: 'ollama/llama3.2' }]));

    runDefaultModelMigration();

    expect(localStorage.getItem('ai_studio_selected_model')).toBe('claude-3-7-sonnet-20250219');
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
