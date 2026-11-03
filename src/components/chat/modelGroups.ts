/**
 * Catálogo de modelos agrupado por proveedor para el selector del compositor.
 *
 * Antes vivía dentro del cuerpo de `ChatPlayground`, lo que lo recreaba en
 * cada render. Al ser datos constantes, va a nivel de módulo.
 */
import type { AIModel } from '../../types/studio';
import { PROVIDER_CONFIGS } from '../../lib/aiProviders';
import {
  GEMINI_MODELS,
  HUGGINGFACE_MODELS,
  OLLAMA_MODELS,
  OPENROUTER_FREE_MODELS,
  CUSTOM_MODELS,
  ALL_MODELS,
} from '../../data/models';

export interface ModelGroup {
  /** Id de proveedor: el selector sólo pinta los que están configurados. */
  id: string;
  label: string;
  models: AIModel[];
}

export const MODEL_GROUPS: ModelGroup[] = [
  { id: 'google', label: 'Google Gemini', models: GEMINI_MODELS },
  { id: 'huggingface', label: 'HuggingFace (Local)', models: HUGGINGFACE_MODELS },
  { id: 'ollama', label: 'Ollama (Local)', models: OLLAMA_MODELS },
  { id: 'openrouter', label: 'OpenRouter', models: OPENROUTER_FREE_MODELS },
  { id: 'custom', label: 'OpenAI-compatible', models: CUSTOM_MODELS },
];

/** Orden estable de los grupos; los proveedores nuevos caen al final. */
const GROUP_ORDER = ['google', 'openai', 'anthropic', 'nvidia', 'xai', 'openrouter', 'huggingface', 'ollama', 'lmstudio', 'custom', 'freebuff', 'local'];

/**
 * Agrupa cualquier catálogo (incluido el vivo) por proveedor.
 *
 * El selector del compositor usaba sólo `MODEL_GROUPS`, así que un proveedor
 * configurado después de arrancar —OpenAI, NVIDIA o LM Studio— no aparecía
 * aunque sus modelos ya estuvieran en `/api/models/live`.
 */
export function buildModelGroups(models: AIModel[]): ModelGroup[] {
  const byProvider = new Map<string, ModelGroup>();
  for (const model of models) {
    const provider = model.provider;
    if (!provider) continue;
    let group = byProvider.get(provider);
    if (!group) {
      // Se conservan las etiquetas históricas del selector (p. ej.
      // «HuggingFace (Local)») y se usa el nombre del proveedor para los nuevos.
      const known = MODEL_GROUPS.find((g) => g.id === provider);
      group = {
        id: provider,
        label: known?.label || PROVIDER_CONFIGS[provider]?.name || provider,
        models: [],
      };
      byProvider.set(provider, group);
    }
    group.models.push(model);
  }
  return [...byProvider.values()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a.id);
    const ib = GROUP_ORDER.indexOf(b.id);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.label.localeCompare(b.label);
  });
}

/** Modelo activo en el catálogo global (puede ser `undefined` si es descargado). */
export const findModel = (id: string): AIModel | undefined =>
  ALL_MODELS.find((m) => m.id === id);

/** `true` si el id corresponde a un servidor local (Ollama / LM Studio). */
export const isLocalModelId = (id: string): boolean =>
  id.startsWith('ollama/') || id.startsWith('lmstudio/');