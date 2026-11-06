/**
 * Utilidades comunes para adaptadores de despliegue.
 *
 * `describeProject` es deliberadamente local y sin red: detecta el tipo de
 * proyecto, su build y su carpeta de salida. Cada adaptador decide después qué
 * hacer con esa información.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  CommanderAppManifest,
  DeployEnvironment,
  ProjectDescriptor,
  ProjectKind,
} from './types';

const OUTPUT_CANDIDATES = ['dist', 'build', 'out', 'public'] as const;
const PROJECT_KINDS = new Set<ProjectKind>(['static', 'spa', 'worker', 'ssr', 'unknown']);

export function isDeployEnvironment(value: unknown): value is DeployEnvironment {
  return value === 'preview' || value === 'production';
}

export function isProjectKind(value: unknown): value is ProjectKind {
  return typeof value === 'string' && PROJECT_KINDS.has(value as ProjectKind);
}

/** Identificador estable por ruta, con el mismo proyecto entre reinicios. */
export function projectIdFor(rootInput: string): string {
  const resolved = path.resolve(String(rootInput || '').trim());
  const base = path
    .basename(resolved)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'proyecto';
  const hash = createHash('sha1')
    .update(resolved.replace(/\\/g, '/').toLowerCase())
    .digest('hex')
    .slice(0, 8);
  return `${base}-${hash}`;
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readManifest(root: string): CommanderAppManifest | null {
  const value = readJson(path.join(root, 'commander.app.json'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as CommanderAppManifest;
}

function hasIndex(root: string): boolean {
  return OUTPUT_CANDIDATES.some((candidate) =>
    fs.existsSync(path.join(root, candidate, 'index.html'))
  );
}

function detectOutputDir(root: string): string | null {
  for (const candidate of OUTPUT_CANDIDATES) {
    if (fs.existsSync(path.join(root, candidate, 'index.html'))) return candidate;
  }
  return null;
}

function hasFile(root: string, names: string[]): boolean {
  return names.some((name) => fs.existsSync(path.join(root, name)));
}

function detectKind(root: string, pkg: any): ProjectKind {
  if (hasFile(root, ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'])) return 'worker';
  if (
    hasFile(root, [
      'next.config.js',
      'next.config.mjs',
      'next.config.cjs',
      'next.config.ts',
    ])
  ) {
    return 'ssr';
  }
  if (!hasIndex(root)) return 'unknown';
  const deps = pkg?.dependencies ?? {};
  const devDeps = pkg?.devDependencies ?? {};
  return deps.react || devDeps.react || deps.vite || devDeps.vite ? 'spa' : 'static';
}

/**
 * Describe un proyecto sin ejecutar build ni tocar la red.
 *
 * Un manifiesto explícito manda sobre la detección por archivos; así el usuario
 * puede corregir un caso ambiguo sin renombrar carpetas.
 */
export async function describeProject(rootInput: string): Promise<ProjectDescriptor> {
  const root = path.resolve(String(rootInput || '').trim());
  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch {
    throw new Error(`No existe el proyecto: ${rootInput}`);
  }
  if (!stat.isDirectory()) throw new Error('La ruta del proyecto no es un directorio');

  const pkg = readJson(path.join(root, 'package.json'));
  const manifest = readManifest(root);
  const manifestKind = manifest?.kind;
  const kind = isProjectKind(manifestKind) ? manifestKind : detectKind(root, pkg);
  const manifestOutput = manifest?.build?.outputDir;
  const outputDir =
    typeof manifestOutput === 'string' && manifestOutput.trim()
      ? manifestOutput.trim()
      : detectOutputDir(root);

  return {
    id: projectIdFor(root),
    root,
    name: path.basename(root) || root,
    kind,
    buildScript: typeof pkg?.scripts?.build === 'string',
    outputDir,
    manifest,
  };
}
