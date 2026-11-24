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
 *   • `plugin.json` declara la versión de API y los permisos. Si existe, el
 *     manifiesto se valida ANTES de importar el módulo: una API incompatible se
 *     rechaza sin ejecutar una línea y los hooks sin permiso no se despachan.
 *   • Sin `plugin.json` el plugin se carga como legado (todos los hooks).
 *   • El módulo se recarga solo cuando cambia su mtime o el del manifiesto.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

/** Directorio de plugins, relativo a la raíz del proyecto. */
export const PLUGINS_DIR = path.join('.commander', 'plugins');

/** Manifiesto opcional dentro de la carpeta del plugin. */
export const PLUGIN_MANIFEST_FILE = 'plugin.json';

/**
 * Versión de API que implementa este runtime.
 *
 * El manifiesto declara la mayor (`1`, `"1"` o `"1.2.0"`). Una mayor distinta
 * se rechaza sin importar el módulo: los hooks de esa API pueden no existir.
 */
export const PLUGIN_API_VERSION = 1;

/** Permisos que puede declarar un manifiesto. */
export const PLUGIN_PERMISSIONS = ['tools', 'lifecycle'] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

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

/** Qué permiso necesita cada hook; un hook sin permiso no se despacha. */
const HOOK_PERMISSION: Record<keyof PluginHooks, PluginPermission> = {
  beforeTool: 'tools',
  afterTool: 'tools',
  sessionStart: 'lifecycle',
  beforeModel: 'lifecycle',
  afterModel: 'lifecycle',
  sessionEnd: 'lifecycle',
  stop: 'lifecycle',
  error: 'lifecycle',
};

/** Manifiesto validado de un plugin con `plugin.json`. */
export interface PluginManifest {
  /** Mayor de la API que declara el plugin. */
  apiVersion: number;
  /** Hooks que el plugin puede usar. */
  permissions: PluginPermission[];
  name?: string;
  version?: string;
}

export interface LoadedPlugin {
  id: string;
  file: string;
  hooks: PluginHooks;
  /** Ausente en plugins legados, escritos antes del manifiesto. */
  manifest?: PluginManifest;
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

/** Mayor de `apiVersion`: acepta `1`, `"1"` o `"1.2.0"`; `null` si no sirve. */
export function parsePluginApiVersion(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,4})(?:\.\d{1,4}){0,2}$/);
  return match ? Number(match[1]) : null;
}

/** Ruta del manifiesto de un plugin, junto a su fichero de entrada. */
export function pluginManifestPath(file: string): string {
  return path.join(path.dirname(file), PLUGIN_MANIFEST_FILE);
}

/**
 * Lee y valida `plugin.json` sin ejecutar el plugin.
 *
 * Devuelve `error` cuando el manifiesto existe pero no es válido o declara una
 * API que este runtime no entiende: en ese caso el módulo no se importa. Sin
 * manifiesto devuelve `{}` y el plugin se carga como legado.
 */
function readPluginManifest(file: string): { manifest?: PluginManifest; error?: string } {
  const manifestPath = pluginManifestPath(file);
  if (!fs.existsSync(manifestPath)) return {};

  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (error: any) {
    return { error: `no se pudo leer ${PLUGIN_MANIFEST_FILE}: ${String(error?.message || error)}` };
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: `${PLUGIN_MANIFEST_FILE} no es JSON válido` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: `${PLUGIN_MANIFEST_FILE} debe ser un objeto` };
  }
  if (data.apiVersion === undefined || data.apiVersion === null || data.apiVersion === '') {
    return { error: `${PLUGIN_MANIFEST_FILE} sin apiVersion` };
  }

  const apiVersion = parsePluginApiVersion(data.apiVersion);
  if (apiVersion === null) {
    return { error: `apiVersion inválida: ${JSON.stringify(data.apiVersion)}` };
  }
  if (apiVersion !== PLUGIN_API_VERSION) {
    return {
      error:
        `apiVersion ${JSON.stringify(data.apiVersion)} incompatible: ` +
        `este runtime implementa la API ${PLUGIN_API_VERSION}.x`,
    };
  }

  if (!Array.isArray(data.permissions)) {
    return { error: `${PLUGIN_MANIFEST_FILE} sin permissions (usa [] si no necesita hooks)` };
  }
  const permissions: PluginPermission[] = [];
  for (const value of data.permissions) {
    const permission = typeof value === 'string' ? value.trim() : '';
    if (!PLUGIN_PERMISSIONS.includes(permission as PluginPermission)) {
      return {
        error:
          `permiso desconocido: ${JSON.stringify(value)}; ` +
          `válidos: ${PLUGIN_PERMISSIONS.join(', ')}`,
      };
    }
    if (!permissions.includes(permission as PluginPermission)) {
      permissions.push(permission as PluginPermission);
    }
  }

  return {
    manifest: {
      apiVersion,
      permissions,
      ...(typeof data.name === 'string' && data.name.trim() ? { name: data.name.trim() } : {}),
      ...(typeof data.version === 'string' && data.version.trim()
        ? { version: data.version.trim() }
        : {}),
    },
  };
}

/**
 * Deja sólo los hooks que el manifiesto permite.
 *
 * Un hook exportado sin su permiso se anota y no se despacha: el plugin no gana
 * un punto de extensión por olvidar declararlo. Los plugins legados conservan
 * todos sus hooks.
 */
function restrictHooks(
  id: string,
  hooks: PluginHooks,
  manifest: PluginManifest | undefined,
  errors: PluginError[],
): PluginHooks {
  if (!manifest) return hooks;
  const allowed = new Set<PluginPermission>(manifest.permissions);
  const restricted: PluginHooks = {};
  for (const name of Object.keys(hooks) as Array<keyof PluginHooks>) {
    if (typeof hooks[name] !== 'function') continue;
    const permitted = HOOK_PERMISSION[name];
    if (allowed.has(permitted)) {
      (restricted as Record<string, unknown>)[name] = hooks[name];
    } else {
      errors.push({
        plugin: id,
        hook: name,
        error: `el hook necesita el permiso "${permitted}" y ${PLUGIN_MANIFEST_FILE} no lo declara`,
      });
    }
  }
  return restricted;
}

/**
 * Plugins del proyecto, con caché invalidada por mtime del módulo y del
 * manifiesto. Un plugin que no compila o no pasa el manifiesto queda en
 * `errors` y no impide cargar los demás.
 */
async function loadPlugins(root: string): Promise<{ plugins: LoadedPlugin[]; errors: PluginError[] }> {
  const files = listPluginFiles(root);
  const key = files
    .map((f) => `${f.id}:${mtimeOf(f.file)}:${mtimeOf(pluginManifestPath(f.file))}`)
    .join('|');
  const cached = CACHE.get(root);
  if (cached && cached.key === key) return cached;

  const plugins: LoadedPlugin[] = [];
  const errors: PluginError[] = [];
  for (const { id, file } of files) {
    // El manifiesto se valida antes de importar: un plugin con API incompatible
    // no llega a ejecutar ni su código de nivel superior.
    const read = readPluginManifest(file);
    if (read.error) {
      errors.push({ plugin: id, hook: 'manifest', error: read.error });
      continue;
    }
    try {
      const mod = await import(`${pathToFileURL(file).href}?v=${mtimeOf(file)}`);
      const hooks = restrictHooks(id, pickHooks(mod), read.manifest, errors);
      plugins.push({ id, file, hooks, ...(read.manifest ? { manifest: read.manifest } : {}) });
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

export type PluginLifecycleHookName =
  | 'sessionStart'
  | 'beforeModel'
  | 'afterModel'
  | 'sessionEnd'
  | 'stop'
  | 'error';

/** Corre un hook de lifecycle en todos los plugins, en orden, sin cortar por fallos. */
async function runLifecycleHook(
  root: string,
  hook: PluginLifecycleHookName,
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

/**
 * Ejecuta un hook por nombre. Lo usa el endpoint que atiende a los bucles que
 * corren fuera del servidor (CLI y navegador), sin duplicar el runtime.
 */
export function runPluginHook(
  root: string,
  hook: PluginLifecycleHookName,
  ctx: PluginSessionContext | PluginModelContext | PluginSessionEndContext | PluginStopContext | PluginErrorContext,
  opts?: PluginRunOptions,
): Promise<PluginLifecycleRun> {
  return runLifecycleHook(root, hook, ctx, opts);
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
