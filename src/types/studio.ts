export type StudioMode = 
  | 'chat'
  | 'freeform'
  | 'structured'
  | 'composer'
  | 'huggingface'
  | 'telemetry'
  | 'compare'
  | 'live_voice'
  | 'agent';

export type ProviderType =
  | 'google'
  | 'huggingface'
  | 'xai'
  | 'anthropic'
  | 'ollama'
  | 'lmstudio'
  | 'openrouter'
  | 'openai'
  | 'nvidia'
  | 'pollinations'
  | 'custom'
  | 'local'
  | 'freebuff';

/** Modo de ejecución del agente. */
export type RunMode = 'build' | 'plan' | 'readonly';

export interface AIModel {
  id: string;
  name: string;
  provider: ProviderType;
  description: string;
  badge?: string;
  contextWindow: string;
  /** Ventana de contexto en tokens (numérico para ordenar/filtrar). */
  contextLength?: number;
  supportsImage?: boolean;
  supportsAudio?: boolean;
  supportsVideo?: boolean;
  supportsThinking?: boolean;
  supportsTools?: boolean;
  supportsJSONMode?: boolean;
  supportsParallelTools?: boolean;
  isLocalWasm?: boolean;
  isAgent?: boolean;
  hfRepoId?: string;
  isDownloaded?: boolean;
  sizeMb?: number;
  /** Modalidades de entrada soportadas. */
  inputModalities?: ('text' | 'image' | 'audio' | 'video')[];
  /** Modalidades de salida soportadas. */
  outputModalities?: ('text' | 'image' | 'audio')[];
  /** Precio por 1M tokens de entrada/salida (USD). */
  pricing?: { input: number; output: number };
  /** Licencia del modelo (ej: 'apache-2.0', 'mit', 'custom'). */
  license?: string;
  /** Arquitectura (transformer, mamba, etc.). */
  architecture?: string;
  /** Quantization disponible (para modelos locales). */
  quantization?: string[];
  /** Fecha de conocimiento (ISO string). */
  knowledgeCutoff?: string;
  /** Fecha de lanzamiento (ISO string). */
  releaseDate?: string;
  /** Tags adicionales para filtrado. */
  tags?: string[];
  /** Si el modelo está obsoleto/deprecated. */
  deprecated?: boolean;
  /** Versión del modelo (semver). */
  version?: string;
}

export interface HfHubModel {
  id: string;
  modelId: string;
  author?: string;
  downloads: number;
  likes: number;
  pipeline_tag?: string;
  tags?: string[];
  lastModified?: string;
  private?: boolean;
  sizeMb?: number;
}

export interface DownloadedLocalModel {
  id: string;
  name: string;
  hfRepoId: string;
  sizeMb: number;
  downloadDate: string;
  pipelineTag: string;
  quantization: string;
  status: 'ready' | 'downloading' | 'error';
  progress?: number;
}

export interface ToolsConfig {
  googleSearch: boolean;
  codeExecution: boolean;
  urlContext?: boolean;
}

export interface ParameterConfig {
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  thinkingLevel?: 'MINIMAL' | 'LOW' | 'HIGH';
  stopSequences?: string[];
  responseFormat: 'text' | 'json';
  jsonSchema?: string;
  tools?: ToolsConfig;
  systemInstruction: string;
  examples: StructuredExample[];
  // HuggingFace specific
  hfQuantization: 'fp16' | 'q8' | 'q4';
  hfApiToken?: string;
  anthropicApiKey?: string;
}

export interface GroundingSource {
  title?: string;
  url?: string;
  snippet?: string;
}

export interface AgentStep {
  id: string;
  type: 'thought' | 'tool_call' | 'tool_result' | 'file_created';
  title: string;
  content: string;
  toolName?: string;
  status?: 'running' | 'completed' | 'error';
  latencyMs?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  content: string;
  timestamp: string;
  attachments?: {
    type: 'image' | 'audio' | 'file';
    url: string;
    name: string;
    mimeType: string;
  }[];
  tokensUsed?: number;
  latencyMs?: number;
  thinkingProcess?: string;
  providerUsed?: ProviderType;
  modelUsed?: string;
  // AI Studio Advanced Capabilities
  variants?: string[];
  activeVariantIndex?: number;
  groundingSources?: GroundingSource[];
  webSearchQueries?: string[];
  agentSteps?: AgentStep[];
  environmentId?: string;
  interactionId?: string;
  metrics?: {
    latencyMs?: number;
    totalTokens?: number;
  };
}

export interface StructuredExample {
  id: string;
  input: string;
  output: string;
}

export interface PromptTemplate {
  id: string;
  title: string;
  description: string;
  category: 'code' | 'creative' | 'analysis' | 'translation' | 'structured' | 'agent';
  systemInstruction: string;
  defaultPrompt: string;
  recommendedModel: string;
}

export interface ExecutionMetrics {
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  latencyMs: number;
  costEstimate: string;
}

export interface PromptVersion {
  id: string;
  projectId: string;
  timestamp: string;
  parameters: ParameterConfig;
  title: string;
  note?: string;
}

export interface HistorySession {
  id: string;
  title: string;
  mode: StudioMode;
  timestamp: string;
  promptTitle?: string;
  messages?: ChatMessage[];
  parameters?: ParameterConfig;
  selectedModel?: string;
  codeSnippet?: string;
  codeLanguage?: string;
  /** Pestaña propietaria del historial (multi-chat). Las entradas antiguas no lo tienen. */
  tabId?: string;
}
