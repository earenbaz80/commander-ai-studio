import { AIModel } from '../types/studio';

export const GEMINI_MODELS: AIModel[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    provider: 'google',
    description: 'El modelo insignia de Google (2026): razonamiento multimodal de frontera, velocidad extrema y soporte nativo para agentes autónomos.',
    badge: 'Insignia 2026',
    contextWindow: '1M tokens',
    supportsThinking: true,
    supportsImage: true,
    supportsAudio: true,
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    provider: 'google',
    description: 'Modelo de última generación 2026 optimizado para respuestas ultrarrápidas, visión computacional y flujos continuos.',
    badge: 'Flash 2026',
    contextWindow: '1M tokens',
    supportsImage: true,
    supportsAudio: true,
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    provider: 'google',
    description: 'Modelo Pro 2026 con razonamiento profundo para arquitectura de software, resolución matemática y ventana masiva de 2M tokens.',
    badge: 'Pro 2026',
    contextWindow: '2M tokens',
    supportsThinking: true,
    supportsImage: true,
    supportsAudio: true,
  },
  // Este id no se usa por `generateContent`: `handleGeminiInteractions` lo manda
  // a la Interactions API (`ai.interactions.create`). Sondearlo con un ping
  // normal devuelve 400 «This model only supports Interactions API», que es lo
  // esperado y no un modelo roto: no lo saques del selector por eso.
  {
    id: 'antigravity-preview-09-2026',
    name: 'Google Antigravity Agent (Sandbox 2026)',
    provider: 'google',
    description: 'Agente autónomo 2026 con sandbox de ejecución remota de código en Linux y navegación web en tiempo real.',
    badge: 'Agente 2026',
    contextWindow: '1M tokens',
    supportsImage: true,
    supportsAudio: false,
    isAgent: true,
  }
];

export const HUGGINGFACE_MODELS: AIModel[] = [
  {
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
    name: 'DeepSeek-R1 Distill 1.5B',
    provider: 'huggingface',
    description: 'Modelo de razonamiento de frontera ultraligero para ejecución local WebGPU/API.',
    badge: 'Popular Local',
    contextWindow: '32K tokens',
    supportsThinking: true,
    isLocalWasm: true,
    hfRepoId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B'
  },
  {
    id: 'deepseek-ai/DeepSeek-R1-Distill-Llama-8B',
    name: 'DeepSeek-R1 Distill Llama 8B',
    provider: 'huggingface',
    description: 'Razonador profundo de alto calibre basado en arquitectura Llama 8B.',
    badge: 'Reasoning 8B',
    contextWindow: '64K tokens',
    supportsThinking: true,
    isLocalWasm: true,
    hfRepoId: 'deepseek-ai/DeepSeek-R1-Distill-Llama-8B'
  },
  {
    id: 'Qwen/Qwen2.5-Coder-1.5B-Instruct',
    name: 'Qwen 2.5 Coder 1.5B',
    provider: 'huggingface',
    description: 'Líder en generación y depuración de código en formato ligero y local.',
    badge: 'Coder Top',
    contextWindow: '32K tokens',
    isLocalWasm: true,
    hfRepoId: 'Qwen/Qwen2.5-Coder-1.5B-Instruct'
  },
  {
    id: 'meta-llama/Llama-3.2-1B-Instruct',
    name: 'Meta Llama 3.2 1B Instruct',
    provider: 'huggingface',
    description: 'Modelo ultraligero de Meta diseñado para velocidad instantánea y bajo consumo.',
    badge: 'Ultra Fast',
    contextWindow: '128K tokens',
    isLocalWasm: true,
    hfRepoId: 'meta-llama/Llama-3.2-1B-Instruct'
  },
  {
    id: 'meta-llama/Llama-3.2-3B-Instruct',
    name: 'Meta Llama 3.2 3B Instruct',
    provider: 'huggingface',
    description: 'Excelente modelo multitarea de Meta ideal para apps móviles y de escritorio.',
    badge: 'Meta Local',
    contextWindow: '128K tokens',
    isLocalWasm: true,
    hfRepoId: 'meta-llama/Llama-3.2-3B-Instruct'
  },
  {
    id: 'mistralai/Mistral-7B-Instruct-v0.3',
    name: 'Mistral 7B Instruct v0.3',
    provider: 'huggingface',
    description: 'Modelo de 7 mil millones de parámetros de alto rendimiento en lógica y código.',
    badge: 'High Perf',
    contextWindow: '32K tokens',
    hfRepoId: 'mistralai/Mistral-7B-Instruct-v0.3'
  },
  {
    id: 'google/gemma-2-2b-it',
    name: 'Gemma 2 2B IT',
    provider: 'huggingface',
    description: 'Modelo abierto optimizado para correr localmente en navegadores y dispositivos.',
    badge: 'Open Source',
    contextWindow: '8K tokens',
    isLocalWasm: true,
    hfRepoId: 'google/gemma-2-2b-it'
  },
  {
    id: 'microsoft/Phi-3.5-mini-instruct',
    name: 'Phi-3.5 Mini Instruct',
    provider: 'huggingface',
    description: 'Modelo compacto de Microsoft con razonamiento avanzado y 128K de contexto.',
    badge: 'Microsoft',
    contextWindow: '128K tokens',
    isLocalWasm: true,
    hfRepoId: 'microsoft/Phi-3.5-mini-instruct'
  },
  {
    id: 'Xenova/whisper-tiny',
    name: 'Whisper Tiny (Reconocimiento de Voz)',
    provider: 'huggingface',
    description: 'Modelo de transcripción y reconocimiento de audio offline en WebGPU/WASM.',
    badge: 'Audio Local',
    contextWindow: 'Audio',
    isLocalWasm: true,
    hfRepoId: 'Xenova/whisper-tiny'
  },
  {
    id: 'hexgrad/Kokoro-82M',
    name: 'Kokoro 82M (Síntesis de Voz TTS)',
    provider: 'huggingface',
    description: 'Generación de voz ultrarrápida y de alta calidad 100% offline.',
    badge: 'TTS Voice',
    contextWindow: 'Audio',
    isLocalWasm: true,
    hfRepoId: 'hexgrad/Kokoro-82M'
  },
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    name: 'HF MiniLM Embeddings (Local WASM)',
    provider: 'huggingface',
    description: 'Modelo de vectores y embeddings 100% offline para búsqueda semántica local.',
    badge: 'Local WASM',
    contextWindow: '512 tokens',
    isLocalWasm: true,
    hfRepoId: 'Xenova/all-MiniLM-L6-v2'
  }
];

export const OLLAMA_MODELS: AIModel[] = [
  {
    id: 'ollama/llama3.2',
    name: 'Llama 3.2 (Ollama local, gratis)',
    provider: 'ollama',
    description: 'Corre 100% gratis en tu PC con Ollama. Requiere `ollama serve` + `ollama pull llama3.2`.',
    badge: 'Gratis Local',
    contextWindow: '128K tokens',
  },
  {
    id: 'ollama/qwen2.5-coder',
    name: 'Qwen 2.5 Coder (Ollama local, gratis)',
    provider: 'ollama',
    description: 'Coder local gratuito. Requiere `ollama pull qwen2.5-coder`.',
    badge: 'Gratis Coder',
    contextWindow: '32K tokens',
  },
  {
    id: 'ollama/deepseek-r1',
    name: 'DeepSeek R1 (Ollama local, gratis)',
    provider: 'ollama',
    description: 'Razonador local gratuito. Requiere `ollama pull deepseek-r1`.',
    badge: 'Gratis Reasoning',
    contextWindow: '128K tokens',
    supportsThinking: true,
  },
  {
    id: 'ollama/mistral',
    name: 'Mistral (Ollama local, gratis)',
    provider: 'ollama',
    description: 'Modelo Mistral local gratuito. Requiere `ollama pull mistral`.',
    badge: 'Gratis',
    contextWindow: '32K tokens',
  },
];

export const OPENROUTER_FREE_MODELS: AIModel[] = [
  {
    id: 'openrouter/deepseek/deepseek-chat-v3-0324:free',
    name: 'DeepSeek V3 (OpenRouter gratis)',
    provider: 'openrouter',
    description: 'Frontera gratuita vía OpenRouter. Solo necesitas API key gratuita.',
    badge: 'Gratis Nube',
    contextWindow: '64K tokens',
  },
  {
    id: 'openrouter/qwen/qwen-2.5-coder-32b-instruct:free',
    name: 'Qwen Coder 32B (OpenRouter gratis)',
    provider: 'openrouter',
    description: 'Coder 32B gratuito en la nube vía OpenRouter.',
    badge: 'Gratis Coder',
    contextWindow: '32K tokens',
  },
];

export const CUSTOM_MODELS: AIModel[] = [
  {
    id: 'custom/big-pickle',
    name: 'Big Pickle (OpenCode Zen, gratis)',
    provider: 'custom',
    description: 'Gratis ($0) vía OpenCode Zen con reasoning y 200K contexto. Solo pide API key de Zen.',
    badge: 'Gratis $0',
    contextWindow: '200K tokens',
    supportsThinking: true,
  },
  {
    id: 'custom/muse-spark-1.3-contributor-free',
    name: 'Muse Spark 1.3 Free (OpenCode Zen, gratis)',
    provider: 'custom',
    description: 'Gratis ($0) vía OpenCode Zen con 1M de contexto. Solo pide API key de Zen.',
    badge: 'Gratis $0',
    contextWindow: '1M tokens',
  },
  {
    id: 'custom/nemotron-3-ultra-free',
    name: 'Nemotron 3 Ultra Free (OpenCode Zen, gratis)',
    provider: 'custom',
    description: 'Gratis ($0) vía OpenCode Zen con reasoning y 1M de contexto. Solo pide API key de Zen.',
    badge: 'Gratis $0',
    contextWindow: '1M tokens',
    supportsThinking: true,
  },
  {
    id: 'custom/custom',
    name: 'OpenAI-compatible (endpoint propio)',
    provider: 'custom',
    description: 'Endpoint compatible independiente: vLLM, llama.cpp, oMLX, OpenCode Zen, etc.',
    badge: 'Custom',
    contextWindow: 'Variable',
  },
];

// Capacidades de tool-calling del agente (dialecto nativo):
// Gemini + OpenAI-compatible (Ollama/OpenRouter/Custom) → function calling real.
// HF local → sin tool-calling nativo (el agente cae a JSON en texto).
for (const m of GEMINI_MODELS) m.supportsTools = true;
for (const m of OLLAMA_MODELS) m.supportsTools = true;
for (const m of OPENROUTER_FREE_MODELS) m.supportsTools = true;
for (const m of CUSTOM_MODELS) m.supportsTools = true;
for (const m of HUGGINGFACE_MODELS) m.supportsTools = false;

export const ALL_MODELS = [...GEMINI_MODELS, ...HUGGINGFACE_MODELS, ...OLLAMA_MODELS, ...OPENROUTER_FREE_MODELS, ...CUSTOM_MODELS];
