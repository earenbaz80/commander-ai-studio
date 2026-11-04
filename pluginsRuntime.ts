/**
 * Plugins locales del proyecto: hooks `beforeTool` y `afterTool`.
 *
 * Un plugin es un módulo JS en `.commander/plugins/<id>/index.js` (o
 * `index.mjs` / `index.cjs`) que exporta ganchos opcionales. Se cargan desde el
 * proyecto que se está trabajando, no desde el cwd del servidor, y corren en el
 * mismo proceso: son código de confianza del usuario, igual que un script de
 * `package.json`.
 *
 * Reglas que sí importan al agente:
 *   • `beforeTool` puede reemplazar la entrada devolviendo `{ input }`.
 *   • `afterTool` puede reemplazar el resultado devolviendo `{ result }`.
 *   • Un hook que lanza NUNCA rompe la tool: se anota en `errors` y se sigue.
 *   • El módulo se recarga solo cuando cambia su mtime, sin reiniciar el server.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

/** Directorio de plugins, relativo a la raíz del proyecto. */
export const PLUGINS_DIR = path.join('.commander', 'plugins');

/** Un id de plugin es un nombre de directorio y nada más. */
const PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface PluginError {
  plugin: string;
  hook: string;
  error: string;
}

export interface ToolResultLike {
  ok: boolean;
  data?: any;
  error?: string;
  status?: number;
}

export interface PluginContext {
  toolId: string;
  input: Record<string, unknown>;
  root: string;
}

export interface PluginAfterContext extends PluginContext {
  result: ToolResultLike;
}

export interface PluginHooks {
  beforeTool?: (ctx: PluginContext) => unknown | Promise<unknown>;
  afterTool?: (ctx: PluginAfterContext) => unknown | Promise<unknown>;
}

export interface LoadedPlugin {
  id: string;
  file: string;
  hooks: PluginHooks;
}

interface CacheEntry {
  key: string;
  plugins: LoadedPlugin[];
  errors: PluginError[];
}

const CACHE = new Map<string, CacheEntry>();

/** Ficheros de plugin presentes en `<root>/.commander/plugins`, ordenados por id. */
export function listPluginFiles(root: string): Array<{ id: string; file: string }> {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(path.join(root, PLUGINS_DIR), { withFileTypes: true });
  } catch {
    return [];
  }
  const found: Array<{ id: string; file: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !PLUGIN_ID_RE.test(entry.name)) continue;
    for (const name of ['index.js', 'index.mjs', 'index.cjs']) {
      const file = path.join(root, PLUGINS_DIR, entry.name, name);
      try {
        if (fs.statSync(file).isFile()) {
          found.push({ id: entry.name, file });
          break;
        }
      } catch {
        /* sin fichero de entrada */
      }
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

function mtimeOf(file: string): number {
  try {
    return Math.floor(fs.statSync(file).mtimeMs);
  } catch {
    return 0;
  }
}

/** Elige las funciones del módulo: `export default { … }` o exports con nombre. */
function pickHooks(mod: any): PluginHooks {
  const candidate = mod && typeof mod.default === 'object' && mod.default !== null ? mod.default : mod;
  if (!candidate || typeof candidate !== 'object') return {};
  return {
    beforeTool: typeof candidate.beforeTool === 'function' ? candidate.beforeTool : undefined,
    afterTool: typeof candidate.afterTool === 'function' ? candidate.afterTool : undefined,
  };
}

/**
 * Plugins del proyecto, con caché invalidada por mtime.
 * Un plugin que no compila queda en `errors` y no impide cargar los demás.
 */
async function loadPlugins(root: string): Promise<{ plugins: LoadedPlugin[]; errors: PluginError[] }> {
  const files = listPluginFiles(root);
  const key = files.map((f) => `${f.id}:${mtimeOf(f.file)}`).join('|');
  const cached = CACHE.get(root);
  if (cached && cached.key === key) return cached;

  const plugins: LoadedPlugin[] = [];
  const errors: PluginError[] = [];
  for (const { id, file } of files) {
    try {
      const mod = await import(`${pathToFileURL(file).href}?v=${mtimeOf(file)}`);
      plugins.push({ id, file, hooks: pickHooks(mod) });
    } catch (error: any) {
      errors.push({ plugin: id, hook: 'load', error: String(error?.message || 'no se pudo cargar') });
    }
  }
  const entry: CacheEntry = { key, plugins, errors };
  CACHE.set(root, entry);
  return entry;
}

/** Olvida la caché de un proyecto (lo usan los tests y el reinicio de plugins). */
export function clearPluginCache(root?: string): void {
  if (root) CACHE.delete(root);
  else CACHE.clear();
}

/**
 * Ejecuta los `beforeTool` en orden.
 * Sólo se acepta `{ input }`: devolver otra cosa se ignora, para que un hook
 * despistado no sustituya la entrada entera por `undefined`.
 */
export async function runBeforeToolHooks(
  root: string,
  toolId: string,
  input: Record<string, unknown>,
): Promise<{ input: Record<string, unknown>; ran: string[]; errors: PluginError[] }> {
  const loaded = await loadPlugins(root);
  const errors = [...loaded.errors];
  const ran: string[] = [];
  let current = input;
  for (const plugin of loaded.plugins) {
    if (!plugin.hooks.beforeTool) continue;
    try {
      const out: any = await plugin.hooks.beforeTool({ toolId, input: current, root });
      ran.push(plugin.id);
      if (out && typeof out === 'object' && out.input && typeof out.input === 'object') {
        current = out.input as Record<string, unknown>;
      }
    } catch (error: any) {
      errors.push({ plugin: plugin.id, hook: 'beforeTool', error: String(error?.message || error) });
    }
  }
  return { input: current, ran, errors };
}

/** Ejecuta los `afterTool` en orden; sólo se acepta `{ result }`. */
export async function runAfterToolHooks(
  root: string,
  toolId: string,
  input: Record<string, unknown>,
  result: ToolResultLike,
): Promise<{ result: ToolResultLike; ran: string[]; errors: PluginError[] }> {
  const loaded = await loadPlugins(root);
  const errors = [...loaded.errors];
  const ran: string[] = [];
  let current = result;
  for (const plugin of loaded.plugins) {
    if (!plugin.hooks.afterTool) continue;
    try {
      const out: any = await plugin.hooks.afterTool({ toolId, input, root, result: current });
      ran.push(plugin.id);
      if (out && typeof out === 'object' && out.result && typeof out.result === 'object') {
        current = out.result as ToolResultLike;
      }
    } catch (error: any) {
      errors.push({ plugin: plugin.id, hook: 'afterTool', error: String(error?.message || error) });
    }
  }
  return { result: current, ran, errors };
}
