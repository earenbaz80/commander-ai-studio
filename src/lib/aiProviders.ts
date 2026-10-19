/**
 * Centralized AI Provider Logic
 *
 * Single source of truth for:
 * - Provider detection from model ID
 * - Endpoint resolution (generation and streaming)
 */
import type { ProviderType, DownloadedLocalModel } from '../types/studio';
import { HUGGINGFACE_MODELS } from '../data/models';

export interface ProviderConfig {
  id: ProviderType;
  name: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsThinking: boolean;
  defaultEndpoint: string;
  streamEndpoint?: string;
}

/** Known provider configurations */
export const PROVIDER_CONFIGS: Record<ProviderType, ProviderConfig> = {
  google: {
    id: 'google',
    name: 'Google Gemini',
    supportsStreaming: true,
    supportsTools: true,
    supportsThinking: true,
    defaultEndpoint: '/api/gemini/generate',
    streamEndpoint: '/api/gemini/stream',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    supportsStreaming: true,
    supportsTools: true,
    supportsThinking: true,
    defaultEndpoint: '/api/anthropic/generate',
    streamEndpoint: '/api/anthropic/stream',
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    supportsStreaming: false,
    supportsTools: false,
    supportsThinking: true,
    defaultEndpoint: '/api/hf/generate',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    supportsStreaming: false,
    supportsTools: true,
    supportsThinking: true,
    defaultEndpoint: '/api/ollama/generate',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    supportsStreaming: false,
    supportsTools: true,
    supportsThinking: false,
    defaultEndpoint: '/api/openrouter/generate',
  },
  pollinations: {
    id: 'pollinations',
    name: 'Pollinations (Free)',
    supportsStreaming: false,
    supportsTools: false,
    supportsThinking: false,
    defaultEndpoint: '/api/pollinations/generate',
  },
  custom: {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    supportsStreaming: false,
    supportsTools: true,
    supportsThinking: false,
    defaultEndpoint: '/api/custom/generate',
  },
  xai: {
    id: 'xai',
    name: 'xAI Grok',
    supportsStreaming: false,
    supportsTools: false,
    supportsThinking: false,
    defaultEndpoint: '/api/xai/generate',
  },
  local: {
    id: 'local',
    name: 'Local (GGUF via llama.cpp)',
    supportsStreaming: false,
    supportsTools: false,
    supportsThinking: true,
    defaultEndpoint: '/api/local-models/generate',
  },
};

/**
 * Detect provider from model ID string
 */
export function detectProvider(
  modelId: string,
  selectedProvider: ProviderType,
  downloadedModels: DownloadedLocalModel[] = []
): ProviderType {
  // Explicit provider override takes precedence
  if (selectedProvider !== 'google') return selectedProvider;

  // Antigravity agent → Google
  if (modelId === 'antigravity-preview-09-2026') return 'google';

  // Anthropic models
  if (modelId.startsWith('claude')) return 'anthropic';

  // Google models
  if (modelId.startsWith('gemini') || modelId.startsWith('antigravity')) return 'google';

  // Prefijos explícitos PRIMERO. Cualquier id con '/' cae en HuggingFace, así que
  // los prefijos con barra (ollama/, openrouter/, custom/, local/…) tienen que
  // resolverse antes o nunca se alcanzan.
  if (modelId.startsWith('ollama/')) return 'ollama';
  if (modelId.startsWith('openrouter/')) return 'openrouter';
  if (modelId.startsWith('pollinations/')) return 'pollinations';
  if (modelId.startsWith('custom/')) return 'custom';
  if (modelId.startsWith('local/')) return 'local';

  // HuggingFace: id con barra del tipo org/repo, o coincidencia con el catálogo.
  const isHfModel =
    modelId.includes('/') ||
    HUGGINGFACE_MODELS.some((m) => m.id === modelId) ||
    downloadedModels.some((m) => m.hfRepoId === modelId || m.id === modelId);
  if (isHfModel) return 'huggingface';

  // xAI Grok
  if (modelId.startsWith('grok')) return 'xai';

  // Default to Google
  return 'google';
}

/**
 * Resuelve el endpoint HTTP para un id de modelo.
 *
 * Fuente única de verdad para el ruteo. Antes cada consumidor repetía su propia
 * cadena de ternarios, con defaults inconsistentes: llm.ts mandaba a
 * `/api/custom/generate` para todo lo que no fuera gemini/openrouter/ollama
 * (incluidos claude y hf), mientras inlineAi.ts y cli/agentClient.ts caían a
 * `/api/gemini/generate`. Consecuencia: agregar un provider obligaba a tocar
 * 7 lugares y uno quedaba roto en silencio.
 *
 * @param modelId     Id del modelo (con o sin prefijo de provider).
 * @param streaming   Pedir el endpoint de streaming cuando el provider lo soporte.
 * @param fallback    Provider a usar si el id no matchea ninguno. Default 'google'.
 */
export function resolveEndpoint(
  modelId: string,
  opts: { streaming?: boolean; fallback?: ProviderType } = {}
): string {
  const { streaming = false, fallback = 'google' } = opts;
  const provider = detectProvider(modelId, fallback, []);
  const config = PROVIDER_CONFIGS[provider];
  // Sólo google y anthropic exponen stream; el resto usa su endpoint normal.
  if (streaming && config.streamEndpoint) return config.streamEndpoint;
  return config.defaultEndpoint;
}

/**
 * Endpoint SSE de streaming, o `null` si el provider no lo expone.
 *
 * Distinto de `resolveEndpoint(..., { streaming: true })`, que degrada al
 * endpoint normal. Algunos consumidores necesitan distinguir "no hay stream"
 * de "el stream es otro endpoint" para no abrir una conexión inútil.
 */
export function resolveStreamEndpoint(modelId: string): string | null {
  const provider = detectProvider(modelId, 'google', []);
  return PROVIDER_CONFIGS[provider].streamEndpoint ?? null;
}

