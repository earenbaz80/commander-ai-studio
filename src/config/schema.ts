import { z } from 'zod';
import { GEMINI_DEFAULT_MODEL } from './geminiModels';

export const ProviderConfigSchema = z.object({
  google: z.object({
    apiKey: z.string().optional(),
    defaultModel: z.string().default(GEMINI_DEFAULT_MODEL),
  }).optional(),
  anthropic: z.object({
    apiKey: z.string().optional(),
    defaultModel: z.string().default('claude-3-5-sonnet-20241022'),
  }).optional(),
  huggingface: z.object({
    apiToken: z.string().optional(),
    defaultModel: z.string().default('deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B'),
    device: z.enum(['webgpu', 'wasm', 'cpu']).default('webgpu'),
    quantization: z.enum(['q4', 'q8', 'fp16', 'fp32']).default('q4'),
  }).optional(),
  ollama: z.object({
    host: z.string().url().default('http://localhost:11434'),
    defaultModel: z.string().default('llama3.2'),
  }).optional(),
  openrouter: z.object({
    apiKey: z.string().optional(),
    defaultModel: z.string().default('deepseek/deepseek-chat-v3-0324:free'),
  }).optional(),
  pollinations: z.object({
    defaultModel: z.string().default('openai'),
  }).optional(),
  custom: z.object({
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    defaultModel: z.string().optional(),
  }).optional(),
  xai: z.object({
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
  theme: z.enum(['norton', 'matrix', 'amber', 'dos']).default('norton'),
  language: z.enum(['es', 'en', 'de']).default('es'),
  showTooltips: z.boolean().default(true),
  lowResourceMode: z.boolean().default(false),
  powerSaverMode: z.boolean().default(false),
  fontScale: z.enum(['small', 'normal', 'large']).default('normal'),
  compactMode: z.boolean().default(false),
  sidebarWidth: z.number().int().min(200).max(600).default(280),
  rightPanelWidth: z.number().int().min(280).max(900).default(380),
});

export const ShortcutsConfigSchema = z.record(z.string()).default({
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
  providers: ProviderConfigSchema.default({}),
  tools: ToolsConfigSchema.default({}),
  ui: UIConfigSchema.default({}),
  shortcuts: ShortcutsConfigSchema,
  agent: AgentConfigSchema.default({}),
  server: ServerConfigSchema.default({}),
  projects: z.object({
    allowList: z.array(z.string()).default([]),
    autoAddCwd: z.boolean().default(true),
  }).default({}),
  telemetry: z.object({
    enabled: z.boolean().default(false),
    endpoint: z.string().url().optional(),
    anonymousId: z.string().optional(),
  }).default({}),
  experimental: z.object({
    streamingParser: z.boolean().default(false),
    wasmSandbox: z.boolean().default(false),
    multiAgent: z.boolean().default(false),
  }).default({}),
});

export type CommanderConfig = z.infer<typeof CommanderConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ToolsConfig = z.infer<typeof ToolsConfigSchema>;
export type UIConfig = z.infer<typeof UIConfigSchema>;
export type ShortcutsConfig = z.infer<typeof ShortcutsConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export const DEFAULT_CONFIG: CommanderConfig = CommanderConfigSchema.parse({});