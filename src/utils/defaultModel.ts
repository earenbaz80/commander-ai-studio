/**
 * Modelo por defecto y migración única para usuarios existentes.
 * Solo se reemplazan los defaults antiguos (Gemini retirados y Pollinations, que respondía 404):
 * cualquier otro modelo elegido se conserva.
 */

export const DEFAULT_MODEL = 'gemini-3.5-flash';

const SELECTED_MODEL_KEY = 'ai_studio_selected_model';
const TABS_KEY = 'ai_studio_tabs_v1';
const MIGRATION_KEY = 'ai_studio_default_model_v3';
const LEGACY_DEFAULTS = new Set(['gemini-2.0-flash', 'gemini-2.5-flash', 'pollinations/openai']);

/** Idempotente: se ejecuta una sola vez por navegador (flag en localStorage). */
export function runDefaultModelMigration(): void {
  try {
    if (localStorage.getItem(MIGRATION_KEY)) return;

    const saved = localStorage.getItem(SELECTED_MODEL_KEY);
    if (!saved || LEGACY_DEFAULTS.has(saved)) {
      localStorage.setItem(SELECTED_MODEL_KEY, DEFAULT_MODEL);
    }

    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const tabs = JSON.parse(raw);
      if (Array.isArray(tabs)) {
        for (const tab of tabs) {
          if (tab && LEGACY_DEFAULTS.has(tab.selectedModel)) tab.selectedModel = DEFAULT_MODEL;
        }
        localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
      }
    }

    localStorage.setItem(MIGRATION_KEY, '1');
  } catch {
    /* localStorage no disponible o JSON corrupto: se deja el estado tal cual */
  }
}
