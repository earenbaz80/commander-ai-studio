import { getCachedApiKey } from './apiKeys';
/**
 * Centralized AI Provider Logic
 *
 * Single source of truth for:
 * - Provider detection from model ID
 * - Endpoint resolution
 * - Payload building per provider
 * - Streaming vs non-streaming handling
 */
import type { ParameterConfig, ProviderType, ChatMessage, DownloadedLocalModel } from '../types/studio';
import { HUGGINGFACE_MODELS } from '../data/models';
import { DEFAULT_MODEL } from '../utils/defaultModel';

export interface ProviderPayload {
  endpoint: string;
  payload: unknown;
  isStreaming: boolean;
  requiresAuth: boolean;
}

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

  // HuggingFace models (contain '/' or match known HF models)
  const isHfModel =
    modelId.includes('/') ||
    HUGGINGFACE_MODELS.some((m) => m.id === modelId) ||
    downloadedModels.some((m) => m.hfRepoId === modelId || m.id === modelId);
  if (isHfModel) return 'huggingface';

  // Ollama models
  if (modelId.startsWith('ollama/')) return 'ollama';

  // OpenRouter models
  if (modelId.startsWith('openrouter/')) return 'openrouter';

  // Pollinations models
  if (modelId.startsWith('pollinations/')) return 'pollinations';

  // Custom models
  if (modelId.startsWith('custom/')) return 'custom';

  // Local GGUF models
  if (modelId.startsWith('local/')) return 'local';

  // xAI models
  if (modelId.startsWith('custom/')) return 'custom';

  // xAI models
  if (modelId.startsWith('grok')) return 'xai';

  // Default to Google
  return 'google';
}

/**
 * Build payload for the specific provider
 */
export function buildProviderPayload(
  provider: ProviderType,
  modelId: string,
  userText: string,
  parameters: ParameterConfig,
  options: {
    messages?: ChatMessage[];
    attachments?: File[];
    systemInstruction?: string;
    isStreaming?: boolean;
    runMode?: 'build' | 'plan' | 'readonly';
  } = {}
): ProviderPayload {
  const config = PROVIDER_CONFIGS[provider];
  const {
    messages = [],
    attachments = [],
    systemInstruction = parameters.systemInstruction,
    isStreaming = config.supportsStreaming,
    runMode = 'build',
  } = options;

  // Plan mode suffix
  const planSuffix =
    runMode === 'plan'
      ? '\n\n[PLAN MODE] Analyze, investigate and propose a detailed plan. Do NOT make changes, write or modify files; deliver the plan and await approval.'
      : '';
  const effectiveSystemInstruction = `${systemInstruction || ''}${planSuffix}`;

  // Convert files to base64 parts (for Google)
  const fileParts = attachments.length > 0
    ? attachments.map((file) => ({
        inlineData: {
          data: '', // Will be filled by caller with base64
          mimeType: file.type,
        },
      }))
    : [];

  // Get API keys from localStorage
  const geminiApiKey = getCachedApiKey('GEMINI_API_KEY') || undefined;
  const anthropicApiKey = parameters.anthropicApiKey || getCachedApiKey('ANTHROPIC_API_KEY') || undefined;
  const hfApiToken = parameters.hfApiToken || getCachedApiKey('HF_API_TOKEN') || undefined;
  const openrouterApiKey = getCachedApiKey('OPENROUTER_API_KEY') || undefined;
  const ollamaHost = getCachedApiKey('OLLAMA_HOST') || undefined;
  const customBaseUrl = getCachedApiKey('CUSTOM_BASE_URL') || undefined;
  const customApiKey = getCachedApiKey('CUSTOM_API_KEY') || getCachedApiKey('OPENCODE_API_KEY') || undefined;
  const customModel = getCachedApiKey('CUSTOM_MODEL') || modelId;

  const basePayload = {
    model: modelId,
    systemInstruction: effectiveSystemInstruction,
    temperature: parameters.temperature,
    maxTokens: parameters.maxTokens,
  };

  switch (provider) {
    case 'anthropic': {
      const endpoint = isStreaming ? config.streamEndpoint! : config.defaultEndpoint;
      return {
        endpoint,
        payload: {
          ...basePayload,
          prompt: userText,
          messages: messages.map((m) => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: userText }]),
          anthropicApiKey,
          topP: parameters.topP,
          topK: parameters.topK,
        },
        isStreaming: true,
        requiresAuth: !!anthropicApiKey,
      };
    }

    case 'google': {
      const endpoint = isStreaming ? config.streamEndpoint! : config.defaultEndpoint;
      return {
        endpoint,
        payload: {
          apiKey: geminiApiKey,
          contents: [
            ...fileParts,
            {
              text: parameters.examples.length > 0
                ? `${parameters.examples.map((ex) => `Input: ${ex.input}\nOutput: ${ex.output}`).join('\n\n')}\n\nInput: ${userText}\nOutput:`
                : userText,
            },
          ],
          systemInstruction: effectiveSystemInstruction,
          model: modelId,
          temperature: parameters.temperature,
          topP: parameters.topP,
          topK: parameters.topK,
          maxTokens: parameters.maxTokens,
          thinkingLevel: parameters.thinkingLevel,
          responseMimeType: parameters.responseFormat === 'json' ? 'application/json' : undefined,
          responseSchema: parameters.responseFormat === 'json' ? parameters.jsonSchema : undefined,
          tools: (() => {
            const t: any[] = [];
            if (parameters.tools?.googleSearch) t.push({ googleSearch: {} });
            if (parameters.tools?.codeExecution) t.push({ codeExecution: {} });
            if (parameters.tools?.urlContext !== false) t.push({ urlContext: {} });
            if (parameters.tools?.customFunctions && parameters.tools.customFunctions.length > 0) {
              const funcs = parameters.tools.customFunctions.map((f) => {
                let parsedParams = {};
                try {
                  parsedParams = typeof f.parametersJson === 'string' ? JSON.parse(f.parametersJson) : f.parametersJson;
                } catch {
                  console.warn('Error parsing function params JSON');
                }
                return { name: f.name, description: f.description, parameters: parsedParams };
              });
              t.push({ functionDeclarations: funcs });
            }
            return t.length > 0 ? t : undefined;
          })(),
        },
        isStreaming: true,
        requiresAuth: !!geminiApiKey,
      };
    }

    case 'huggingface': {
      return {
        endpoint: config.defaultEndpoint,
        payload: {
          prompt: userText,
          model: modelId,
          hfApiToken,
          systemInstruction: effectiveSystemInstruction,
          temperature: parameters.temperature,
          maxTokens: parameters.maxTokens,
          geminiApiKey: geminiApiKey || getCachedApiKey('GEMINI_API_KEY') || undefined,
        },
        isStreaming: false,
        requiresAuth: !!hfApiToken,
      };
    }

    case 'ollama': {
      return {
        endpoint: config.defaultEndpoint,
        payload: {
          prompt: userText,
          model: modelId.replace('ollama/', ''),
          systemInstruction: effectiveSystemInstruction,
          temperature: parameters.temperature,
          maxTokens: parameters.maxTokens,
          ollamaHost,
        },
        isStreaming: false,
        requiresAuth: false,
      };
    }

    case 'openrouter': {
      return {
        endpoint: config.defaultEndpoint,
        payload: {
          prompt: userText,
          model: modelId.replace('openrouter/', ''),
          systemInstruction: effectiveSystemInstruction,
          temperature: parameters.temperature,
          maxTokens: parameters.maxTokens,
          openrouterApiKey,
        },
        isStreaming: false,
        requiresAuth: !!openrouterApiKey,
      };
    }

    case 'pollinations': {
      return {
        endpoint: config.defaultEndpoint,
        payload: {
          prompt: userText,
          model: modelId.replace('pollinations/', ''),
          systemInstruction: effectiveSystemInstruction,
          temperature: parameters.temperature,
          maxTokens: parameters.maxTokens,
        },
        isStreaming: false,
        requiresAuth: false,
      };
    }

    case 'custom': {
      return {
        endpoint: config.defaultEndpoint,
        payload: {
          prompt: userText,
          model: customModel,
          systemInstruction: effectiveSystemInstruction,
          temperature: parameters.temperature,
          maxTokens: parameters.maxTokens,
          baseURL: customBaseUrl,
          apiKey: customApiKey,
        },
        isStreaming: false,
        requiresAuth: !!customApiKey,
      };
    }

    case 'local': {
      return {
        endpoint: config.defaultEndpoint,
        payload: {
          prompt: userText,
          model: modelId.replace('local/', ''),
          systemInstruction: effectiveSystemInstruction,
          temperature: parameters.temperature,
          maxTokens: parameters.maxTokens,
        },
        isStreaming: false,
        requiresAuth: false,
      };
    }

    case 'xai': {
      return {
        endpoint: config.defaultEndpoint,
        payload: {
          prompt: userText,
          model: modelId,
          systemInstruction: effectiveSystemInstruction,
          temperature: parameters.temperature,
          maxTokens: parameters.maxTokens,
        },
        isStreaming: false,
        requiresAuth: false,
      };
    }

    default: {
      // Fallback to Google
      const endpoint = isStreaming ? PROVIDER_CONFIGS.google.streamEndpoint! : PROVIDER_CONFIGS.google.defaultEndpoint;
      return {
        endpoint,
        payload: {
          apiKey: geminiApiKey,
          contents: [{ text: userText }],
          systemInstruction: effectiveSystemInstruction,
          model: modelId,
          temperature: parameters.temperature,
          topP: parameters.topP,
          topK: parameters.topK,
          maxTokens: parameters.maxTokens,
          thinkingLevel: parameters.thinkingLevel,
        },
        isStreaming: true,
        requiresAuth: !!geminiApiKey,
      };
    }
  }
}

/**
 * Get the appropriate endpoint for a model, considering Ollama host
 */
export function getEndpointWithHost(payload: ProviderPayload): string {
  if (payload.endpoint === '/api/ollama/generate') {
    const ollamaHost = (payload.payload as any).ollamaHost;
    if (ollamaHost) {
      return `${payload.endpoint}?host=${encodeURIComponent(ollamaHost)}`;
    }
  }
  return payload.endpoint;
}

/**
 * Check if a model supports function calling natively
 */
export function modelSupportsTools(provider: ProviderType): boolean {
  const config = PROVIDER_CONFIGS[provider];
  if (!config.supportsTools) return false;

  // Some specific models may not support tools even if provider does
  // This can be extended with a model-specific registry
  return true;
}

/**
 * Get default model for a provider
 */
export function getDefaultModelForProvider(provider: ProviderType): string {
  switch (provider) {
    case 'google': return 'gemini-2.0-flash';
    case 'anthropic': return 'claude-3-5-sonnet-20241022';
    case 'huggingface': return 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B';
    case 'ollama': return 'ollama/llama3.2';
    case 'openrouter': return 'openrouter/deepseek/deepseek-chat-v3-0324:free';
    case 'pollinations': return 'pollinations/openai';
    case 'custom': return 'custom/custom';
    case 'xai': return 'grok-3';
    case 'local': return 'local/qwen2.5-1.5b-instruct-q8_0.gguf';
    default: return DEFAULT_MODEL;
  }
}