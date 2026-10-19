/**
 * Permisos y modos del agente (P1 #5).
 *
 * Configuración POR PROYECTO persistida en `.commander/permissions.json`:
 *   • mode: 'build' | 'plan' | 'readonly'
 *       - build    → todo permitido (dentro del root y las tools globales).
 *       - plan     → sólo analizar/proponer: se prohiben tools que escriben o ejecutan.
 *       - readonly → igual que plan (sólo lectura).
 *   • allowedTools / deniedTools → lista blanca/negra de tools.
 *   • files.read / files.write → globs de rutas permitidas (vacío = sin restricción).
 *
 * Se aplica en `handleAgentRunTool` (el único punto por el que pasan todas las
 * tools del agente), por lo que es seguro: el modelo no puede eludirlo.
 */

import fs from 'fs';
import path from 'path';

export type AgentMode = 'build' | 'plan' | 'readonly';

export interface Permissions {
  mode: AgentMode;
  /** null = todas permitidas (excepto las denegadas). */
  allowedTools: string[] | null;
  deniedTools: string[];
  files: { read: string[]; write: string[] };
}

export const DEFAULT_PERMISSIONS: Permissions = {
  mode: 'build',
  allowedTools: null,
  deniedTools: [],
  files: { read: [], write: [] },
};

/** Tools que modifican el filesystem o el repo. */
const FILE_WRITE_TOOLS = new Set(['fs.write', 'fs.edit', 'git.commit']);
/** Tools que ejecutan código/comandos (pueden modificar de forma indirecta). */
const EXEC_TOOLS = new Set(['shell.run', 'code.run']);

// ── Coincidencia de globs ( ** , * , ? ) sobre rutas relativas ──

function globToRegex(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // **/ cruza segmentos
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** ¿La ruta relativa coincide con alguno de los globs? (vacío = todos). */
export function isPathAllowed(globs: string[], relPath: string): boolean {
  if (!globs || globs.length === 0) return true;
  const norm = normalizeRel(relPath);
  return globs.some((g) => globToRegex(g).test(norm));
}

/**
 * Valida una tool contra los permisos. Devuelve null si está permitida,
 * o un mensaje de error si se deniega.
 */
export function enforceTool(perms: Permissions, toolId: string): string | null {
  if (perms.allowedTools && !perms.allowedTools.includes(toolId)) {
    return `Tool deshabilitada por la configuración de permisos: ${toolId}`;
  }
  if (perms.deniedTools.includes(toolId)) {
    return `Tool denegada por la configuración de permisos: ${toolId}`;
  }
  if (perms.mode !== 'build' && (FILE_WRITE_TOOLS.has(toolId) || EXEC_TOOLS.has(toolId))) {
    const modo = perms.mode === 'plan' ? 'Plan' : 'Sólo lectura';
    return `Modo ${modo}: no se puede ejecutar ${toolId}. Analiza y propone, no hagas cambios.`;
  }
  return null;
}

/** Valida una ruta contra los globs de lectura/escritura. */
export function enforcePath(perms: Permissions, relPath: string, kind: 'read' | 'write'): string | null {
  const globs = kind === 'read' ? perms.files.read : perms.files.write;
  if (!globs || globs.length === 0) return null;
  if (isPathAllowed(globs, relPath)) return null;
  const que = kind === 'read' ? 'lectura' : 'escritura';
  return `Ruta fuera de los permisos de ${que}: ${relPath}`;
}

// ── Persistencia en .commander/permissions.json ──

const CACHE_DIR = '.commander';
const CACHE_FILE = 'permissions.json';
const permsCache = new Map<string, Permissions>();

function canonical(root: string): string {
  try {
    return fs.realpathSync.native(root);
  } catch {
    return root;
  }
}

/** Tools que deben estar siempre permitidas si se usa lista blanca explícita. */
const CORE_TOOLS = ['task', 'read_diagnostics'];

/** Rellena valores por defecto y valida la estructura. */
export function normalizePermissions(input: unknown): Permissions {
  const p = (input || {}) as Partial<Permissions>;
  const mode: AgentMode = p.mode === 'plan' || p.mode === 'readonly' ? p.mode : 'build';
  const allowedTools =
    Array.isArray(p.allowedTools)
      ? [...new Set([...p.allowedTools.map(String), ...CORE_TOOLS])].slice(0, 100)
      : null;
  const deniedTools = Array.isArray(p.deniedTools) ? p.deniedTools.map(String).slice(0, 100) : [];
  const read = Array.isArray(p.files?.read) ? p.files!.read.map(String).slice(0, 200) : [];
  const write = Array.isArray(p.files?.write) ? p.files!.write.map(String).slice(0, 200) : [];
  return { mode, allowedTools, deniedTools, files: { read, write } };
}

export function getPermissions(root: string): Permissions {
  const key = canonical(root);
  const cached = permsCache.get(key);
  if (cached) return cached;
  let loaded = normalizePermissions(null);
  try {
    const raw = fs.readFileSync(path.join(key, CACHE_DIR, CACHE_FILE), 'utf8');
    loaded = normalizePermissions(JSON.parse(raw));
  } catch {
    loaded = normalizePermissions(null);
  }
  permsCache.set(key, loaded);
  return loaded;
}

export function setPermissions(root: string, perms: unknown): Permissions {
  const key = canonical(root);
  const normalized = normalizePermissions(perms);
  try {
    fs.mkdirSync(path.join(key, CACHE_DIR), { recursive: true });
    fs.writeFileSync(path.join(key, CACHE_DIR, CACHE_FILE), JSON.stringify(normalized, null, 2), 'utf8');
  } catch {
    /* sin permisos de escritura: vive en memoria */
  }
  permsCache.set(key, normalized);
  return normalized;
}

export function invalidatePermissions(root: string): void {
  permsCache.delete(canonical(root));
}
