/**
 * Catálogo de modelos agrupado por proveedor para el selector del compositor.
 *
 * Antes vivía dentro del cuerpo de `ChatPlayground`, lo que lo recreaba en
 * cada render. Al ser datos constantes, va a nivel de módulo.
 */
import type { AIModel } from '../../types/studio';
import {
  GEMINI_MODELS,
  HUGGINGFACE_MODELS,
  OLLAMA_MODELS,
  OPENROUTER_FREE_MODELS,
  CUSTOM_MODELS,
  ALL_MODELS,
} from '../../data/models';

export interface ModelGroup {
  label: string;
  models: AIModel[];
}

export const MODEL_GROUPS: ModelGroup[] = [
  { label: 'Google Gemini', models: GEMINI_MODELS },
  { label: 'HuggingFace (Local)', models: HUGGINGFACE_MODELS },
  { label: 'Ollama (Local)', models: OLLAMA_MODELS },
  { label: 'OpenRouter', models: OPENROUTER_FREE_MODELS },
  { label: 'Personalizado', models: CUSTOM_MODELS },
];

/** Modelo activo en el catálogo global (puede ser `undefined` si es descargado). */
export const findModel = (id: string): AIModel | undefined =>
  ALL_MODELS.find((m) => m.id === id);

/** `true` si el id corresponde a un servidor local (Ollama / OpenAI-compatible). */
export const isLocalModelId = (id: string): boolean =>
  id.startsWith('ollama/') || id.startsWith('openai/');