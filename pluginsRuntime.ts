/**
 * Plugins locales del proyecto: hooks de tool y de lifecycle.
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
 *   • Los hooks de sesión/modelo son observacionales: no cambian la corrida.
 *   • Un hook que lanza NUNCA rompe la corrida: se anota en `errors` y se sigue.
 *   • Ningún hook puede colgar la corrida: cada uno tiene un timeout.
 *   • Los plugins corren en orden alfabético por id.
 *   • El módulo se recarga solo cuando cambia su mtime, sin reiniciar el server.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

/** Directorio de plugins, relativo a la raíz del proyecto. */
export const PLUGINS_DIR = path.join('.commander', 'plugins');

/** Tope por defecto de cada hook. Un plugin lento no puede colgar la sesión. */
export const DEFAULT_PLUGIN_HOOK_TIMEOUT_MS = 5_000;

/** Tope máximo aceptado, para que una configuración absurda no bloquee minutos. */
export const MAX_PLUGIN_HOOK_TIMEOUT_MS = 60_000;

/** Un id de plugin es un nombre de directorio y nada más. */
const PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface PluginRunOptions {
  /** Timeout de cada hook; por defecto `DEFAULT_PLUGIN_HOOK_TIMEOUT_MS`. */
  timeoutMs?: number;
}

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

/** Contexto común de los hooks que no son de tool. */
export interface PluginSessionContext {
  sessionId: string;
  root: string;
  goal: string;
  model: string;
}

export interface PluginModelContext extends PluginSessionContext {
  phase: 'before' | 'after';
  /** Número de llamada al modelo dentro de la corrida (1, 2, …). */
  turn: number;
  /** Sólo en `afterModel`: si la llamada terminó bien. */
  ok?: boolean;
  /** Sólo en `afterModel` con `ok:false`: el motivo del fallo. */
  error?: string;
}

export interface PluginSessionEndContext extends PluginSessionContext {
  answer: string;
}

export interface PluginStopContext extends PluginSessionContext {
  reason: 'user' | 'timeout';
}

export interface PluginErrorContext extends PluginSessionContext {
  error: string;
}

export interface PluginLifecycleRun {
  /** Ids de los plugins cuyo hook terminó dentro del timeout. */
  ran: string[];
  errors: PluginError[];
}

export interface PluginHooks {
  beforeTool?: (ctx: PluginContext) => unknown | Promise<unknown>;
  afterTool?: (ctx: PluginAfterContext) => unknown | Promise<unknown>;
  sessionStart?: (ctx: PluginSessionContext) => unknown | Promise<unknown>;
  beforeModel?: (ctx: PluginModelContext) => unknown | Promise<unknown>;
  afterModel?: (ctx: PluginModelContext) => unknown | Promise<unknown>;
  sessionEnd?: (ctx: PluginSessionEndContext) => unknown | Promise<unknown>;
  stop?: (ctx: PluginStopContext) => unknown | Promise<unknown>;
  error?: (ctx: PluginErrorContext) => unknown | Promise<unknown>;
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
    sessionStart: typeof candidate.sessionStart === 'function' ? candidate.sessionStart : undefined,
    beforeModel: typeof candidate.beforeModel === 'function' ? candidate.beforeModel : undefined,
    afterModel: typeof candidate.afterModel === 'function' ? candidate.afterModel : undefined,
    sessionEnd: typeof candidate.sessionEnd === 'function' ? candidate.sessionEnd : undefined,
    stop: typeof candidate.stop === 'function' ? candidate.stop : undefined,
    error: typeof candidate.error === 'function' ? candidate.error : undefined,
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
 * Normaliza el timeout de un hook.
 *
 * Un valor inválido o no positivo cae al default en vez de desactivar el
 * límite: un plugin no puede elegir esperar para siempre.
 */
function hookTimeoutMs(opts?: PluginRunOptions): number {
  const requested = Number(opts?.timeoutMs);
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_PLUGIN_HOOK_TIMEOUT_MS;
  return Math.min(Math.floor(requested), MAX_PLUGIN_HOOK_TIMEOUT_MS);
}

/** Ejecuta un hook con timeout, incluyendo hooks que nunca resuelven. */
function runWithTimeout<T>(fn: () => T | Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`timeout después de ${timeoutMs} ms`));
    }, timeoutMs);
    Promise.resolve()
      .then(fn)
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

type LifecycleHookName =
  | 'sessionStart'
  | 'beforeModel'
  | 'afterModel'
  | 'sessionEnd'
  | 'stop'
  | 'error';

/** Corre un hook de lifecycle en todos los plugins, en orden, sin cortar por fallos. */
async function runLifecycleHook(
  root: string,
  hook: LifecycleHookName,
  ctx: PluginSessionContext | PluginModelContext | PluginSessionEndContext | PluginStopContext | PluginErrorContext,
  opts?: PluginRunOptions,
): Promise<PluginLifecycleRun> {
  const loaded = await loadPlugins(root);
  const errors = [...loaded.errors];
  const ran: string[] = [];
  const timeoutMs = hookTimeoutMs(opts);
  for (const plugin of loaded.plugins) {
    const fn = plugin.hooks[hook] as ((value: unknown) => unknown | Promise<unknown>) | undefined;
    if (typeof fn !== 'function') continue;
    try {
      await runWithTimeout(() => fn(ctx), timeoutMs);
      ran.push(plugin.id);
    } catch (error: any) {
      errors.push({ plugin: plugin.id, hook, error: String(error?.message || error) });
    }
  }
  return { ran, errors };
}

export function runSessionStartHooks(
  root: string,
  ctx: PluginSessionContext,
  opts?: PluginRunOptions,
): Promise<PluginLifecycleRun> {
  return runLifecycleHook(root, 'sessionStart', ctx, opts);
}

export function runBeforeModelHooks(
  root: string,
  ctx: PluginModelContext,
  opts?: PluginRunOptions,
): Promise<PluginLifecycleRun> {
  return runLifecycleHook(root, 'beforeModel', ctx, opts);
}

export function runAfterModelHooks(
  root: string,
  ctx: PluginModelContext,
  opts?: PluginRunOptions,
): Promise<PluginLifecycleRun> {
  return runLifecycleHook(root, 'afterModel', ctx, opts);
}

export function runSessionEndHooks(
  root: string,
  ctx: PluginSessionEndContext,
  opts?: PluginRunOptions,
): Promise<PluginLifecycleRun> {
  return runLifecycleHook(root, 'sessionEnd', ctx, opts);
}

export function runStopHooks(
  root: string,
  ctx: PluginStopContext,
  opts?: PluginRunOptions,
): Promise<PluginLifecycleRun> {
  return runLifecycleHook(root, 'stop', ctx, opts);
}

export function runErrorHooks(
  root: string,
  ctx: PluginErrorContext,
  opts?: PluginRunOptions,
): Promise<PluginLifecycleRun> {
  return runLifecycleHook(root, 'error', ctx, opts);
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
  opts?: PluginRunOptions,
): Promise<{ input: Record<string, unknown>; ran: string[]; errors: PluginError[] }> {
  const loaded = await loadPlugins(root);
  const errors = [...loaded.errors];
  const ran: string[] = [];
  const timeoutMs = hookTimeoutMs(opts);
  let current = input;
  for (const plugin of loaded.plugins) {
    if (!plugin.hooks.beforeTool) continue;
    try {
      const out: any = await runWithTimeout(
        () => plugin.hooks.beforeTool!({ toolId, input: current, root }),
        timeoutMs,
      );
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
  opts?: PluginRunOptions,
): Promise<{ result: ToolResultLike; ran: string[]; errors: PluginError[] }> {
  const loaded = await loadPlugins(root);
  const errors = [...loaded.errors];
  const ran: string[] = [];
  const timeoutMs = hookTimeoutMs(opts);
  let current = result;
  for (const plugin of loaded.plugins) {
    if (!plugin.hooks.afterTool) continue;
    try {
      const out: any = await runWithTimeout(
        () => plugin.hooks.afterTool!({ toolId, input, root, result: current }),
        timeoutMs,
      );
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
