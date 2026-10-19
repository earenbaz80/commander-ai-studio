/**
 * Enrutado de peticiones de modelos hacia los endpoints del backend.
 *
 * Antes esto estaba inline en tres handlers de `App.tsx` (Chat, Freeform y
 * Structured). Las tres copias NO eran idénticas: solo Chat conocía el
 * proveedor `local` (modelos descargados en runtime desde HuggingFacePlayground,
 * con id `local/<file>`). Al no comprobar `isLocal`, la heurística
 * `modelId.includes('/')` de HuggingFace se activaba y los modelos locales
 * acababan en `/api/hf/generate` en Freeform y Structured.
 *
 * Este módulo fija una sola semántica —la de Chat, que era la correcta— para
 * que los tres modos resuelvan siempre el mismo endpoint.
 */
import { HUGGINGFACE_MODELS } from '../data/models';

/** Modelo descargado en runtime, registrado por HuggingFacePlayground. */
export interface DownloadedModelRef {
  id: string;
  hfRepoId?: string;
}

/** Proveedores que sirven un modelo local sin pasar por la nube. */
const FREE_PROVIDERS = ['ollama', 'openrouter', 'pollinations'] as const;
const FREE_MODEL_PREFIXES = ['ollama/', 'openrouter/', 'pollinations/'] as const;

export interface RouteInput {
  /** Id del modelo activo, p. ej. `gemini-2.5-flash`, `ollama/llama3`, `local/mistral`. */
  modelId: string;
  /** Proveedor elegido explícitamente en la UI (gana sobre el prefijo del id). */
  provider?: string;
  /** Modelos descargados en esta sesión (HF local / WASM). */
  downloadedModels?: DownloadedModelRef[];
}

export interface ResolvedRoute {
  /** Endpoint de generación no-streaming. */
  endpoint: string;
  /** Endpoint de streaming, cuando el proveedor lo expone. */
  streamEndpoint: string;
  isAnthropic: boolean;
  isFreeProvider: boolean;
  isCustom: boolean;
  isLocal: boolean;
  isHf: boolean;
}

const startsWithAny = (value: string, prefixes: readonly string[]) =>
  prefixes.some((p) => value.startsWith(p));

/**
 * Resuelve el endpoint para un modelo.
 *
 * Orden de precedencia (el orden importa: `local/` y `custom/` contienen `/`,
 * así que un check genérico de HuggingFace después los capturaría):
 *   anthropic → huggingface → custom → local → openrouter → pollinations → ollama → gemini
 */
export function resolveChatRoute({
  modelId,
  provider,
  downloadedModels = [],
}: RouteInput): ResolvedRoute {
  const isAnthropic = provider === 'anthropic' || modelId.startsWith('claude');

  const isCustom = provider === 'custom' || modelId.startsWith('custom/');

  const isLocal = provider === 'local' || modelId.startsWith('local/');

  const isFreeProvider =
    FREE_PROVIDERS.includes(provider as (typeof FREE_PROVIDERS)[number]) ||
    startsWithAny(modelId, FREE_MODEL_PREFIXES);

  // HuggingFace sólo si nada más reclamó el modelo. El `includes('/')` es una
  // heurística amplia para ids estilo `org/repo`, por eso va después de los
  // checks explícitos de prefijo y no puede applies a `local/` ni `custom/`.
  const isHf =
    !isFreeProvider &&
    !isLocal &&
    !isAnthropic &&
    !isCustom &&
    (provider === 'huggingface' ||
      modelId.includes('/') ||
      HUGGINGFACE_MODELS.some((m) => m.id === modelId) ||
      downloadedModels.some((m) => m.hfRepoId === modelId || m.id === modelId));

  let endpoint: string;

  if (isAnthropic) {
    endpoint = '/api/anthropic/generate';
  } else if (isHf) {
    endpoint = '/api/hf/generate';
  } else if (isFreeProvider || isCustom || isLocal) {
    // Orden heredado del handler de Chat. `local` va último a propósito: un
    // proveedor explícito (p. ej. openrouter) gana sobre el prefijo `local/`
    // del id, porque el id conserva el prefijo del origen del modelo.
    if (isCustom) {
      endpoint = '/api/custom/generate';
    } else if (provider === 'openrouter' || modelId.startsWith('openrouter/')) {
      endpoint = '/api/openrouter/generate';
    } else if (provider === 'pollinations' || modelId.startsWith('pollinations/')) {
      endpoint = '/api/pollinations/generate';
    } else if (isLocal) {
      endpoint = '/api/local-models/generate';
    } else {
      endpoint = '/api/ollama/generate';
    }
  } else {
    endpoint = '/api/gemini/generate';
  }

  return {
    endpoint,
    streamEndpoint: isAnthropic ? '/api/anthropic/stream' : '/api/gemini/stream',
    isAnthropic,
    isFreeProvider,
    isCustom,
    isLocal,
    isHf,
  };
}