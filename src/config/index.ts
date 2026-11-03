import fs from 'fs';
import path from 'path';
import { CommanderConfigSchema, CommanderConfig, DEFAULT_CONFIG, type ProviderConfig, type ToolsConfig, type UIConfig, type AgentConfig, type ServerConfig } from './schema';
import { GEMINI_DEFAULT_MODEL } from './geminiModels';

/** Partial profundo: permite pasar solo las claves que se quieren cambiar. */
type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [P in keyof T]?: DeepPartial<T[P]> }
    : T;

const CONFIG_FILENAMES = ['commander.json', 'commander.local.json', '.commander/config.json'];
const GLOBAL_CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'commander');
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, 'config.json');

let configCache: CommanderConfig | null = null;
let configPathCache: string | null = null;
let watchers: fs.FSWatcher[] = [];

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
        tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result;
}

function findConfigFile(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  while (dir !== path.parse(dir).root) {
    for (const filename of CONFIG_FILENAMES) {
      const fullPath = path.join(dir, filename);
      if (fs.existsSync(fullPath)) return fullPath;
    }
    dir = path.dirname(dir);
  }
  if (fs.existsSync(GLOBAL_CONFIG_FILE)) return GLOBAL_CONFIG_FILE;
  return null;
}

function loadConfigFile(filePath: string): Partial<CommanderConfig> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    console.warn(`[config] Failed to load ${filePath}:`, e instanceof Error ? e.message : e);
    return {};
  }
}

function loadEnvOverrides(): Partial<CommanderConfig> {
  const overrides: Partial<CommanderConfig> = {};
  
  if (process.env.COMMANDER_PORT) overrides.server = { ...(overrides.server || {}), port: Number(process.env.COMMANDER_PORT) } as any;
  if (process.env.COMMANDER_HOST) overrides.server = { ...(overrides.server || {}), host: process.env.COMMANDER_HOST } as any;
  if (process.env.COMMANDER_THEME) overrides.ui = { ...(overrides.ui || {}), theme: process.env.COMMANDER_THEME as any } as any;
  if (process.env.COMMANDER_LANG) overrides.ui = { ...(overrides.ui || {}), language: process.env.COMMANDER_LANG as any } as any;
  if (process.env.GEMINI_API_KEY) overrides.providers = { ...(overrides.providers || {}), google: { apiKey: process.env.GEMINI_API_KEY, defaultModel: GEMINI_DEFAULT_MODEL } } as any;
  if (process.env.ANTHROPIC_API_KEY) overrides.providers = { ...(overrides.providers || {}), anthropic: { apiKey: process.env.ANTHROPIC_API_KEY, defaultModel: 'claude-3-5-sonnet-20241022' } } as any;
  if (process.env.HF_API_TOKEN) overrides.providers = { ...(overrides.providers || {}), huggingface: { apiToken: process.env.HF_API_TOKEN, defaultModel: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B', device: 'webgpu', quantization: 'q4' } } as any;
  if (process.env.OPENROUTER_API_KEY) overrides.providers = { ...(overrides.providers || {}), openrouter: { apiKey: process.env.OPENROUTER_API_KEY, defaultModel: 'deepseek/deepseek-chat-v3-0324:free' } } as any;
  if (process.env.OPENAI_API_KEY) overrides.providers = { ...(overrides.providers || {}), openai: { apiKey: process.env.OPENAI_API_KEY, defaultModel: 'gpt-4.1-mini' } } as any;
  if (process.env.NVIDIA_API_KEY) overrides.providers = { ...(overrides.providers || {}), nvidia: { apiKey: process.env.NVIDIA_API_KEY, defaultModel: 'meta/llama-3.3-70b-instruct' } } as any;
  if (process.env.OLLAMA_HOST) overrides.providers = { ...(overrides.providers || {}), ollama: { host: process.env.OLLAMA_HOST, defaultModel: 'llama3.2' } } as any;
  if (process.env.CUSTOM_BASE_URL) overrides.providers = { ...(overrides.providers || {}), custom: { baseUrl: process.env.CUSTOM_BASE_URL, defaultModel: 'custom' } } as any;
  if (process.env.CUSTOM_API_KEY) overrides.providers = { ...(overrides.providers || {}), custom: { apiKey: process.env.CUSTOM_API_KEY } } as any;
  if (process.env.XAI_API_KEY) overrides.providers = { ...(overrides.providers || {}), xai: { apiKey: process.env.XAI_API_KEY, defaultModel: 'grok-beta' } } as any;
  
  return overrides;
}

/**
 * Config de los ficheros (global → proyecto), sin variables de entorno.
 *
 * Es la base que se puede volver a escribir: las variables de entorno nunca
 * deben acabar guardadas en `commander.json` (una API key del entorno no es
 * asunto del fichero). No valida; eso lo hace quien la consume.
 */
function loadFileLayers(cwd: string = process.cwd()): any {
  let merged: any = DEFAULT_CONFIG;

  // Global config (lowest priority)
  if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
    merged = deepMerge(merged, loadConfigFile(GLOBAL_CONFIG_FILE));
  }

  // Project config (higher priority)
  const projectConfig = findConfigFile(cwd);
  if (projectConfig) {
    merged = deepMerge(merged, loadConfigFile(projectConfig));
  }

  return merged;
}

export function loadConfig(opts?: { cwd?: string; skipCache?: boolean }): CommanderConfig {
  const cwd = opts?.cwd || process.cwd();
  
  if (configCache && !opts?.skipCache) return configCache;
  
  let merged = loadFileLayers(cwd);

  const projectConfig = findConfigFile(cwd);
  if (projectConfig) configPathCache = projectConfig;
  
  // Env vars (highest priority)
  merged = deepMerge(merged, loadEnvOverrides());
  
  // Validate
  const result = CommanderConfigSchema.safeParse(merged);
  if (!result.success) {
    console.error('[config] Validation failed:', result.error.flatten().fieldErrors);
    throw new Error(`Invalid configuration: ${result.error.message}`);
  }
  
  configCache = result.data;
  return configCache;
}

export function getConfig(): CommanderConfig {
  if (!configCache) return loadConfig();
  return configCache;
}

export function getConfigPath(): string | null {
  if (!configPathCache) loadConfig();
  return configPathCache;
}

/** Fichero global de usuario: donde van las credenciales, fuera del proyecto. */
export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_FILE;
}

export function watchConfig(callback: (config: CommanderConfig) => void): () => void {
  const cwd = process.cwd();
  const projectConfig = findConfigFile(cwd);
  
  const filesToWatch = new Set<string>();
  if (projectConfig) filesToWatch.add(projectConfig);
  if (fs.existsSync(GLOBAL_CONFIG_FILE)) filesToWatch.add(GLOBAL_CONFIG_FILE);
  
  for (const file of filesToWatch) {
    try {
      const watcher = fs.watch(file, { persistent: false }, (event) => {
        if (event === 'change') {
          configCache = null;
          configPathCache = null;
          try {
            const newConfig = loadConfig({ skipCache: true });
            callback(newConfig);
          } catch (e) {
            console.warn('[config] Reload failed:', e instanceof Error ? e.message : e);
          }
        }
      });
      watchers.push(watcher);
    } catch (e) {
      console.warn(`[config] Failed to watch ${file}:`, e instanceof Error ? e.message : e);
    }
  }
  
  return () => {
    for (const w of watchers) w.close();
    watchers = [];
  };
}

export function writeConfig(config: DeepPartial<CommanderConfig>, target?: 'project' | 'global'): string {
  // La base son sólo los ficheros: fusionar `loadConfig()` aquí guardaría en
  // `commander.json` las API keys que únicamente venían del entorno.
  const existing = loadFileLayers();
  const merged = deepMerge(existing, config);
  
  const validated = CommanderConfigSchema.parse(merged);
  
  let filePath: string;
  if (target === 'global') {
    if (!fs.existsSync(GLOBAL_CONFIG_DIR)) fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    filePath = GLOBAL_CONFIG_FILE;
  } else {
    const projectConfig = findConfigFile() || path.join(process.cwd(), 'commander.json');
    filePath = projectConfig;
  }
  
  fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), 'utf-8');
  // Se invalida en vez de fijar la config escrita: al releer se vuelven a
  // aplicar las variables de entorno, que no forman parte del fichero.
  configCache = null;
  configPathCache = filePath;
  
  return filePath;
}

export function resetConfig(): void {
  configCache = null;
  configPathCache = null;
}

/**
 * Cambia sólo la duración de la marca «esta key no admite herramientas integradas»
 * (`providers.google.toolsMemoryTtlMinutes`).
 *
 * Lee el fichero tal cual, sin fusionar las variables de entorno, para no acabar
 * escribiendo una API key del entorno en `commander.json`: toca ese único campo
 * y valida el resultado antes de guardarlo.
 */
export function setGoogleToolsMemoryTtlMinutes(minutes: number): string {
  const projectConfig = findConfigFile() || path.join(process.cwd(), 'commander.json');
  const raw = fs.existsSync(projectConfig) ? loadConfigFile(projectConfig) : {};
  const rawProviders = (raw.providers || {}) as Record<string, unknown>;
  const rawGoogle = (rawProviders.google || {}) as Record<string, unknown>;
  const providers = {
    ...rawProviders,
    google: { ...rawGoogle, toolsMemoryTtlMinutes: minutes },
  };

  const validated = CommanderConfigSchema.parse({ ...raw, providers });
  fs.writeFileSync(projectConfig, JSON.stringify(validated, null, 2), 'utf-8');
  // Igual que en `writeConfig`: al releer, el entorno vuelve a entrar.
  configCache = null;
  configPathCache = projectConfig;

  return projectConfig;
}

/**
 * Cadena de respaldo configurada (`providers.google.fallbackModels`).
 *
 * Devuelve `[]` si se guardó vacía —significa «sin respaldo», una decisión— y
 * `null` sólo si la config no la trae (o no se puede leer), que es cuando toca
 * usar la de por defecto. Esa distinción es la misma que hace la petición con
 * `fallbackModels`, para que config y petición se comporten igual.
 */
export function getGoogleFallbackModels(): string[] | null {
  const chain = getConfig().providers?.google?.fallbackModels;
  return Array.isArray(chain) ? chain : null;
}

/**
 * Guarda la cadena de respaldo sin tocar el resto del fichero.
 *
 * Igual que `setGoogleToolsMemoryTtlMinutes`: lee el fichero real en vez de la
 * config fusionada, para no acabar escribiendo en `commander.json` una API key
 * que sólo venía del entorno.
 */
export function setGoogleFallbackModels(models: string[]): string {
  const projectConfig = findConfigFile() || path.join(process.cwd(), 'commander.json');
  const raw = fs.existsSync(projectConfig) ? loadConfigFile(projectConfig) : {};
  const rawProviders = (raw.providers || {}) as Record<string, unknown>;
  const rawGoogle = (rawProviders.google || {}) as Record<string, unknown>;
  const providers = {
    ...rawProviders,
    google: { ...rawGoogle, fallbackModels: models },
  };

  const validated = CommanderConfigSchema.parse({ ...raw, providers });
  fs.writeFileSync(projectConfig, JSON.stringify(validated, null, 2), 'utf-8');
  // Igual que en `writeConfig`: al releer, el entorno vuelve a entrar.
  configCache = null;
  configPathCache = projectConfig;

  return projectConfig;
}

export function getProviderConfig(): ProviderConfig {
  return getConfig().providers;
}

/** Ids de proveedor que llegan por entorno (sólo nombres, sin valores). */
export function getEnvProviderIds(): string[] {
  return Object.keys(loadEnvOverrides().providers || {});
}

/**
 * Campo ya guardado en config para un proveedor (clave, host o URL).
 *
 * Existe para que los handlers puedan usar lo que se configuró en el gestor
 * de proveedores: antes sólo miraban body/cookie/entorno y lo guardado en
 * `commander.json` no lo leía nadie. Nunca lanza: una config inválida no debe
 * tumbar una petición de chat.
 */
export function getProviderSecret(provider: string, field: string): string | undefined {
  try {
    const value = (getConfig().providers as any)?.[provider]?.[field];
    return typeof value === 'string' && value.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Quita un proveedor del fichero de config.
 *
 * No toca las variables de entorno: si el proveedor también viene de ahí, el
 * GET lo seguirá marcando como configurado (`source: 'env'`).
 */
export function removeProviderConfig(id: string): string {
  const projectConfig = findConfigFile() || path.join(process.cwd(), 'commander.json');
  const raw = fs.existsSync(projectConfig) ? loadConfigFile(projectConfig) : {};
  const rawProviders = (raw.providers || {}) as Record<string, unknown>;
  const providers = { ...rawProviders };
  delete providers[id];

  const validated = CommanderConfigSchema.parse({ ...raw, providers });
  fs.writeFileSync(projectConfig, JSON.stringify(validated, null, 2), 'utf-8');
  // Se invalida en vez de fijar la config escrita: al releer vuelven a entrar
  // las variables de entorno, que no forman parte del fichero.
  configCache = null;
  configPathCache = projectConfig;

  return projectConfig;
}

export function getToolsConfig(): ToolsConfig {
  return getConfig().tools;
}

export function getUIConfig(): UIConfig {
  return getConfig().ui;
}

export function getAgentConfig(): AgentConfig {
  return getConfig().agent;
}

export function getServerConfig(): ServerConfig {
  return getConfig().server;
}

export { CommanderConfigSchema };