import { z } from 'zod';
import { GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODELS, MAX_FALLBACK_MODELS } from './geminiModels';

/**
 * Filtros comunes a todos los proveedores, con el mismo criterio en todo el catálogo.
 *
 * `enabled: false` apaga un proveedor sin borrar sus credenciales, y las listas
 * recortan su catálogo (`claude-*` casa por prefijo). Son opcionales: sin ellas
 * todo sigue encendido y visible.
 */
const providerFilters = {
  enabled: z.boolean().optional(),
  whitelist: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
  blacklist: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
};

export const ProviderConfigSchema = z.object({
  google: z.object({
    ...providerFilters,
    apiKey: z.string().optional(),
    defaultModel: z.string().default(GEMINI_DEFAULT_MODEL),
    // Cuánto se recuerda que una key no admite grounding / code execution.
    toolsMemoryTtlMinutes: z.number().int().min(1).max(24 * 60).default(30),
    // Cadena de respaldo que usa el servidor cuando la petición no trae la suya.
    // Un array vacío es una decisión explícita («sin respaldo»), no un hueco:
    // el default sólo se aplica cuando la clave falta por completo.
    fallbackModels: z
      .array(z.string().trim().min(1).max(80))
      .max(MAX_FALLBACK_MODELS)
      .default([...GEMINI_FALLBACK_MODELS]),
  }).optional(),
  anthropic: z.object({
    ...providerFilters,
    apiKey: z.string().optional(),
    defaultModel: z.string().default('claude-3-5-sonnet-20241022'),
  }).optional(),
  huggingface: z.object({
    ...providerFilters,
    apiToken: z.string().optional(),
    defaultModel: z.string().default('deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B'),
    device: z.enum(['webgpu', 'wasm', 'cpu']).default('webgpu'),
    quantization: z.enum(['q4', 'q8', 'fp16', 'fp32']).default('q4'),
  }).optional(),
  ollama: z.object({
    ...providerFilters,
    host: z.string().url().default('http://localhost:11434'),
    defaultModel: z.string().default('llama3.2'),
  }).optional(),
  // LM Studio expone una API OpenAI-compatible. El host puede ser local o de
  // otro equipo de la red (p. ej. http://192.168.1.20:1234/v1).
  lmstudio: z.object({
    ...providerFilters,
    // Remoto (casa) y local (este portátil). El servidor usa el que responda.
    host: z.string().url().default('http://localhost:1234/v1'),
    localHost: z.string().url().optional(),
    defaultModel: z.string().optional(),
  }).optional(),
  openrouter: z.object({
    ...providerFilters,
    apiKey: z.string().optional(),
    defaultModel: z.string().default('deepseek/deepseek-chat-v3-0324:free'),
  }).optional(),
  openai: z.object({
    ...providerFilters,
    apiKey: z.string().optional(),
    defaultModel: z.string().default('gpt-4.1-mini'),
  }).optional(),
  // NVIDIA NIM: endpoint OpenAI-compatible en integrate.api.nvidia.com.
  nvidia: z.object({
    ...providerFilters,
    apiKey: z.string().optional(),
    defaultModel: z.string().default('meta/llama-3.3-70b-instruct'),
  }).optional(),
  pollinations: z.object({
    ...providerFilters,
    defaultModel: z.string().default('openai'),
  }).optional(),
  custom: z.object({
    ...providerFilters,
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    defaultModel: z.string().optional(),
  }).optional(),
  // Proveedores añadidos por el usuario: cualquier endpoint OpenAI-compatible
  // con nombre propio. Se guardan por id y sus modelos llevan el prefijo
  // `openai-compatible/<id>/<modelo>`.
  openaiCompatible: z.record(
    z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
    z.object({
      ...providerFilters,
      name: z.string().trim().min(1).max(80),
      baseUrl: z.string().url(),
      apiKey: z.string().optional(),
      models: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
      defaultModel: z.string().optional(),
    })
  ).optional(),
  xai: z.object({
    ...providerFilters,
    apiKey: z.string().optional(),
    defaultModel: z.string().default('grok-beta'),
  }).optional(),
});

export const ToolsConfigSchema = z.object({
  fs: z.object({
    enabled: z.boolean().default(true),
    allowList: z.array(z.string()).default([]),
    denyList: z.array(z.string()).default([]),
  }).optional(),
  shell: z.object({
    enabled: z.boolean().default(true),
    allowList: z.array(z.string()).default([]),
    denyList: z.array(z.string()).default([]),
    timeoutMs: z.number().int().positive().default(30000),
  }).optional(),
  git: z.object({
    enabled: z.boolean().default(true),
  }).optional(),
  web: z.object({
    enabled: z.boolean().default(true),
    timeoutMs: z.number().int().positive().default(10000),
  }).optional(),
  mcp: z.object({
    enabled: z.boolean().default(false),
    servers: z.record(z.string(), z.object({
      command: z.string(),
      args: z.array(z.string()).default([]),
      env: z.record(z.string(), z.string()).optional(),
      // Autenticación opcional para servidores MCP remotos.
      auth: z.object({
        type: z.enum(['oauth2', 'bearer']).default('oauth2'),
        // Cliente público: PKCE sin secret. Cliente confidencial: con secret.
        clientId: z.string(),
        clientSecret: z.string().optional(),
        authorizeUrl: z.string().url().optional(),
        tokenUrl: z.string().url().optional(),
        scopes: z.array(z.string()).default([]),
        // Token estático para type=bearer (se guarda aquí; en prod usar vars de entorno).
        bearerToken: z.string().optional(),
      }).optional(),
    })).default({}),
  }).optional(),
});

export const UIConfigSchema = z.object({
  theme: z.enum(['norton', 'matrix', 'amber', 'dos', 'light', 'solarized']).default('norton'),
  language: z.enum(['es', 'en', 'de']).default('es'),
  showTooltips: z.boolean().default(true),
  lowResourceMode: z.boolean().default(false),
  powerSaverMode: z.boolean().default(false),
  // Mismos valores que aplica la UI (`font-scale-normal|lg|xl`). Antes el
  // schema pedía small/normal/large, que ningún control produce.
  fontScale: z.enum(['normal', 'lg', 'xl']).default('normal'),
  compactMode: z.boolean().default(false),
  // Los anchos de panel viven en localStorage (`commander_sidebar_width`,
  // `commander_workbench_width`): aquí eran una segunda fuente que nadie leía.
});

export const ShortcutsConfigSchema = z.record(z.string(), z.string()).default({
  palette: 'Ctrl+K',
  workspaceSymbol: 'Ctrl+P',
  inspector: 'Ctrl+,',
  sidebar: 'Ctrl+B',
  newPrompt: 'Ctrl+Alt+N',
  workbench: 'Ctrl+Alt+B',
  saveVersion: 'Ctrl+S',
  compiler: 'Ctrl+Alt+C',
  newTab: 'Ctrl+T',
  closeTab: 'Ctrl+W',
  generalAudit: 'Ctrl+Shift+G',
  shortcutsHelp: 'Ctrl+/',
  voice: 'Ctrl+Alt+V',
});

export const AgentConfigSchema = z.object({
  maxSteps: z.number().int().positive().default(25),
  maxTurns: z.number().int().positive().default(10),
  approvalMode: z.enum(['auto', 'manual', 'never']).default('manual'),
  planMode: z.boolean().default(false),
  autoCompact: z.boolean().default(true),
  contextWindow: z.number().int().positive().default(128000),
});

export const ServerConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(3280),
  host: z.string().default('127.0.0.1'),
  corsOrigins: z.array(z.string().url()).default([]),
  enableAuth: z.boolean().default(false),
  sessionSecret: z.string().optional(),
});

export const CommanderConfigSchema = z.object({
  version: z.number().int().default(1),
  // Zod 4 exige en `.default()` el valor ya parseado, así que `{}` no vale para
  // un objeto con defaults internos. `.prefault()` aplica el valor antes de
  // validar, que es el comportamiento que tenía Zod 3: `{}` entra, los defaults
  // de cada campo lo completan.
  providers: ProviderConfigSchema.prefault({}),
  tools: ToolsConfigSchema.prefault({}),
  ui: UIConfigSchema.prefault({}),
  shortcuts: ShortcutsConfigSchema,
  agent: AgentConfigSchema.prefault({}),
  server: ServerConfigSchema.prefault({}),
  projects: z.object({
    allowList: z.array(z.string()).default([]),
    autoAddCwd: z.boolean().default(true),
  }).prefault({}),
  telemetry: z.object({
    enabled: z.boolean().default(false),
    endpoint: z.string().url().optional(),
    anonymousId: z.string().optional(),
  }).prefault({}),
  experimental: z.object({
    streamingParser: z.boolean().default(false),
    wasmSandbox: z.boolean().default(false),
    multiAgent: z.boolean().default(false),
  }).prefault({}),
});

export type CommanderConfig = z.infer<typeof CommanderConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ToolsConfig = z.infer<typeof ToolsConfigSchema>;
export type UIConfig = z.infer<typeof UIConfigSchema>;
export type ShortcutsConfig = z.infer<typeof ShortcutsConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export const DEFAULT_CONFIG: CommanderConfig = CommanderConfigSchema.parse({});