/**
 * Registro de proyectos (allowlist de directorios).
 *
 * El agente ya no está atado a process.cwd(): puede operar sobre varios
 * proyectos, pero SOLO dentro de los directorios registrados aquí.
 *
 * Fuentes de roots permitidos:
 *  - process.cwd()  → siempre (compatibilidad y smoke tests)
 *  - AGENT_ROOTS    → allowlist estricta de arranque (env, separada por comas)
 *  - .agent-roots.json → roots añadidos en runtime por el usuario (persistente)
 *
 * Cada root se valida y canonicaliza (realpath) al registrarse; los symlinks
 * no pueden sacar una ruta fuera del root.
 */

import fs from 'fs';
import path from 'path';

const MAX_ROOTS = 20;

/**
 * Dónde se persisten los roots añadidos en runtime.
 * Por defecto .agent-roots.json en el cwd; los tests aíslan la persistencia
 * con AGENT_ROOTS_FILE para no ensuciar el registro real del usuario.
 */
const CONFIG_FILE = process.env.AGENT_ROOTS_FILE
  ? path.resolve(process.env.AGENT_ROOTS_FILE)
  : path.join(process.cwd(), '.agent-roots.json');

/** Directorios que nunca deben poder registrarse como proyecto. */
const FORBIDDEN_ROOTS = new Set([
  '/', '/etc', '/usr', '/var', '/bin', '/sbin', '/lib', '/boot', '/dev',
  '/proc', '/sys', '/root', '/home',
  'c:\\', 'c:/', 'c:\\windows', 'c:/windows',
  'c:\\program files', 'c:/program files',
  'c:\\program files (x86)', 'c:/program files (x86)',
  'c:\\users', 'c:/users',
]);

function isForbidden(root: string): boolean {
  const norm = root.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  if (norm === '') return true;
  // Raíz de cualquier unidad (C:\, D:\, /home) es demasiado amplia.
  const driveRoot = /^[a-z]:$/.test(norm.replace('\\', '')) || /^[a-z]:\\?$/.test(norm);
  if (driveRoot) return true;
  if (path.parse(root).root.replace(/\\/g, '/').toLowerCase() === root.replace(/\\/g, '/').toLowerCase()) return true;
  for (const bad of FORBIDDEN_ROOTS) {
    const b = bad.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    if (norm === b) return true;
  }
  return false;
}

/** Canonicaliza y valida un directorio candidato. Devuelve el root o lanza. */
export function normalizeRoot(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Directorio requerido');
  if (input.length > 1024) throw new Error('Ruta demasiado larga');

  const resolved = path.resolve(input.trim());

  if (!fs.existsSync(resolved)) throw new Error(`No existe: ${input}`);

  // Canonicalizamos para resolver symlinks y nombres cortos (8.3) de Windows.
  let real: string;
  try {
    real = fs.realpathSync.native(resolved);
  } catch {
    real = resolved;
  }
  if (!fs.statSync(real).isDirectory()) throw new Error('No es un directorio');

  if (isForbidden(real)) throw new Error('Ese directorio no se puede usar como proyecto');

  // Un root no puede estar dentro de otro root ya registrado (evita anidar ruido).
  return real;
}

function readFileRoots(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return Array.isArray(parsed?.roots) ? parsed.roots : [];
  } catch {
    return [];
  }
}

function writeFileRoots(roots: string[]) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ roots }, null, 2), 'utf8');
  } catch {
    /* best-effort: si no se puede persistir, el root sigue válido en memoria */
  }
}

let runtimeRoots: string[] = [];

function envRoots(): string[] {
  return (process.env.AGENT_ROOTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function baseRoots(): string[] {
  const out: string[] = [normalizeRoot(process.cwd())];
  for (const r of envRoots()) {
    try { out.push(normalizeRoot(r)); } catch { /* env inválida se ignora */ }
  }
  return out;
}

function dedupe(list: string[]): string[] {
  const out: string[] = [];
  for (const r of list) {
    const key = r.replace(/\\/g, '/').toLowerCase();
    if (!out.some((x) => x.replace(/\\/g, '/').toLowerCase() === key)) out.push(r);
  }
  return out;
}

/** Roots registrados actualmente (cwd + env + runtime), sin duplicados. */
export function listRoots(): string[] {
  return dedupe([...baseRoots(), ...runtimeRoots, ...readFileRoots()]);
}

/** Roots que el usuario puede quitar (excluye cwd y los de AGENT_ROOTS). */
export function removableRoots(): string[] {
  const base = baseRoots();
  return listRoots().filter((r) => !base.some((b) => b.replace(/\\/g, '/').toLowerCase() === r.replace(/\\/g, '/').toLowerCase()));
}

export function addRoot(input: unknown): { roots: string[]; added: string } {
  const real = normalizeRoot(input);
  const roots = listRoots();
  const key = real.replace(/\\/g, '/').toLowerCase();
  if (!roots.some((x) => x.replace(/\\/g, '/').toLowerCase() === key)) {
    runtimeRoots = [...runtimeRoots, real];
    const persisted = [...new Set([...readFileRoots(), real])];
    writeFileRoots(persisted.slice(-MAX_ROOTS));
  }
  return { roots: listRoots(), added: real };
}

export function removeRoot(input: unknown): { roots: string[] } {
  const target = path.resolve(String(input || '').replace(/\\/g, '/').replace(/\/$/, ''));
  const key = (() => { try { return fs.realpathSync.native(target).replace(/\\/g, '/').toLowerCase(); } catch { return target.replace(/\\/g, '/').toLowerCase(); } })();

  const base = baseRoots();
  if (base.some((r) => r.replace(/\\/g, '/').toLowerCase() === key)) {
    throw new Error('Ese directorio no se puede quitar (raíz por defecto del servidor)');
  }
  runtimeRoots = runtimeRoots.filter((r) => r.replace(/\\/g, '/').toLowerCase() !== key);
  writeFileRoots(readFileRoots().filter((r) => r.replace(/\\/g, '/').toLowerCase() !== key));
  return { roots: listRoots() };
}

/** ¿`abs` está dentro de `root`? (compara con separadores normalizados) */
function withinRoot(abs: string, root: string): boolean {
  const r = root.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  const a = abs.replace(/\\/g, '/').toLowerCase();
  if (a === r) return true;
  return a.startsWith(r + '/');
}

/** ¿La ruta absoluta cae dentro de alguno de los roots permitidos? */
export function isInsideRoots(abs: string, roots = listRoots()): boolean {
  return roots.some((root) => withinRoot(abs, root));
}

/**
 * Resuelve una ruta de input contra los roots permitidos.
 * - rutas relativas: se prueban contra cada root (gana el primero que contiene la ruta)
 * - rutas absolutas: deben caer dentro de un root
 * Lanza si escapa del sandbox.
 */
export function resolveProjectPath(inputPath: string, rootHint?: string): { abs: string; root: string } {
  const raw = String(inputPath || '').trim();
  if (!raw) throw new Error('Path requerido');
  if (raw.length > 2000) throw new Error('Path demasiado largo');

  const roots = rootHint ? dedupe([normalizeRoot(rootHint), ...listRoots()]) : listRoots();

  for (const root of roots) {
    const abs = path.resolve(root, raw);
    if (!withinRoot(abs, root)) continue;

    // Si el archivo existe, el destino real (symlinks) también debe estar dentro del root.
    if (fs.existsSync(abs)) {
      let real: string;
      try {
        real = fs.realpathSync.native(abs);
      } catch {
        continue;
      }
      let realRoot: string;
      try {
        realRoot = fs.realpathSync.native(root);
      } catch {
        realRoot = root;
      }
      if (!withinRoot(real, realRoot)) throw new Error('Path fuera del proyecto (symlink)');
      return { abs: real, root: realRoot };
    }

    return { abs, root };
  }

  throw new Error('Path fuera de los proyectos permitidos');
}

/** Ruta relativa al root, para mostrar en la UI. */
export function displayPath(abs: string, root?: string): string {
  if (root) {
    const rel = path.relative(root, abs);
    if (rel && !rel.startsWith('..')) return rel;
  }
  return abs;
}
