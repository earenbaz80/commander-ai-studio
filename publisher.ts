/**
 * Publicador local de Commander.
 *
 * Un proyecto se publica como una release inmutable: se copia su build a
 * `.commander/publish/<slug>/releases/<id>/` y los punteros `preview` y
 * `production` deciden qué release se sirve en cada entorno. Promover y hacer
 * rollback sólo mueven esos punteros; nunca se reescribe una release.
 *
 * Las releases se sirven bajo `/published/<slug>/<entorno>/`. Para que una build
 * de Vite funcione en esa subruta, se reescriben las referencias absolutas de
 * HTML/CSS (`/assets/...` -> `assets/...`). Las releases que dependan de rutas
 * absolutas dentro de JavaScript no se pueden arreglar aquí de forma fiable:
 * el publicador no finge que sí.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { DeploymentRecord, RemoteDeploymentState } from './deploy/types';

export type PublishEnvironment = 'preview' | 'production';

export interface ReleaseMeta {
  id: string;
  createdAt: string;
  fileCount: number;
  bytes: number;
  outputDir: string;
  built: boolean;
}

export interface PublishState {
  version: 1;
  root: string;
  name: string;
  slug: string;
  preview: string | null;
  production: string | null;
  productionHistory: string[];
  releases: ReleaseMeta[];
  /** Estado del último adaptador remoto; opcional para no romper estados viejos. */
  remote?: RemoteDeploymentState;
}

export interface PublishedRelease extends ReleaseMeta {
  url: string;
}

export interface PublishStatus {
  project: {
    root: string;
    name: string;
    slug: string;
    buildScript: boolean;
    detectedOutputDir: string | null;
  };
  preview: PublishedRelease | null;
  production: PublishedRelease | null;
  canRollback: boolean;
  releases: Array<
    ReleaseMeta & {
      url: string;
      isPreview: boolean;
      isProduction: boolean;
    }
  >;
}

export interface CreateReleaseOptions {
  outputDir?: string;
  build?: boolean;
}

export interface CreateReleaseResult {
  release: ReleaseMeta;
  status: PublishStatus;
  buildLog: string;
}

const MAX_FILES = 20_000;
const MAX_BYTES = 300 * 1024 * 1024;
const MAX_RELEASES = 20;
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_CANDIDATES = ['dist', 'build', 'out', 'public'];
const PROJECT_DIRS_TO_SKIP = new Set(['.git', '.commander', 'node_modules', '.next', 'coverage']);

const locks = new Map<string, Promise<unknown>>();

function publishBaseDir(baseDir?: string): string {
  return path.resolve(
    baseDir || process.env.COMMANDER_PUBLISH_DIR || path.join(process.cwd(), '.commander', 'publish')
  );
}

function realProjectRoot(input: string): string {
  const resolved = path.resolve(String(input || '').trim());
  if (!fs.existsSync(resolved)) throw new Error(`No existe el proyecto: ${input}`);
  let real: string;
  try {
    real = fs.realpathSync.native(resolved);
  } catch {
    real = resolved;
  }
  if (!fs.statSync(real).isDirectory()) throw new Error('La ruta del proyecto no es un directorio');
  return real;
}

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'proyecto';
}

/** Slug estable por ruta: el mismo proyecto conserva su URL entre reinicios. */
export function projectSlug(root: string): string {
  const real = realProjectRoot(root).replace(/\\/g, '/').toLowerCase();
  const hash = createHash('sha1').update(real).digest('hex').slice(0, 8);
  return `${slugify(path.basename(real) || 'proyecto')}-${hash}`;
}

export function isValidPublishSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug);
}

export function publishUrl(slug: string, environment: PublishEnvironment): string {
  return `/published/${encodeURIComponent(slug)}/${environment}/`;
}

function projectDir(root: string, baseDir?: string): string {
  return path.join(publishBaseDir(baseDir), projectSlug(root));
}

function statePath(root: string, baseDir?: string): string {
  return path.join(projectDir(root, baseDir), 'state.json');
}

function defaultState(root: string): PublishState {
  const real = realProjectRoot(root);
  return {
    version: 1,
    root: real,
    name: path.basename(real) || real,
    slug: projectSlug(real),
    preview: null,
    production: null,
    productionHistory: [],
    releases: [],
  };
}

function isReleaseId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/i.test(value);
}

/** Los IDs remotos no comparten el alfabeto local: Vercel usa `dpl_…`. */
function isRemoteDeploymentId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,199}$/i.test(value);
}

function isRemoteDeployment(value: any): value is DeploymentRecord {
  return Boolean(
    value &&
      typeof value === 'object' &&
      isRemoteDeploymentId(value.id) &&
      isReleaseId(value.releaseId) &&
      (value.environment === 'preview' || value.environment === 'production') &&
      typeof value.url === 'string' &&
      value.url.length <= 2000 &&
      typeof value.createdAt === 'string' &&
      ['queued', 'building', 'ready', 'failed', 'unknown'].includes(value.status) &&
      typeof value.provider === 'string'
  );
}

/**
 * Normaliza el bloque remoto sin convertirlo en obligatorio.
 *
 * Un estado antiguo (sin `remote`) o un bloque corrupto no debe impedir que
 * Commander siga sirviendo las releases locales.
 */
function normalizeRemoteState(value: any): RemoteDeploymentState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const deployments: DeploymentRecord[] = Array.isArray(value.deployments)
    ? value.deployments
        .filter(isRemoteDeployment)
        .map((deployment: DeploymentRecord) => ({ ...deployment }))
    : [];
  const productionHistory: string[] = Array.isArray(value.productionHistory)
    ? value.productionHistory.filter(isRemoteDeploymentId)
    : [];
  return {
    provider:
      typeof value.provider === 'string' && value.provider.trim()
        ? value.provider.trim().slice(0, 80)
        : 'unknown',
    preview: isRemoteDeploymentId(value.preview) ? value.preview : null,
    production: isRemoteDeploymentId(value.production) ? value.production : null,
    productionHistory,
    deployments,
  };
}

function normalizeState(value: any, root: string): PublishState {
  const fallback = defaultState(root);
  if (!value || typeof value !== 'object') return fallback;
  const releases = Array.isArray(value.releases)
    ? value.releases.filter(
        (r: any) =>
          r &&
          typeof r.id === 'string' &&
          /^[a-z0-9][a-z0-9-]{0,79}$/i.test(r.id) &&
          typeof r.createdAt === 'string' &&
          typeof r.fileCount === 'number' &&
          typeof r.bytes === 'number'
      ).map((r: any) => ({
        id: r.id,
        createdAt: r.createdAt,
        fileCount: r.fileCount,
        bytes: r.bytes,
        outputDir: typeof r.outputDir === 'string' ? r.outputDir : '.',
        built: r.built === true,
      }))
    : [];
  const remote = normalizeRemoteState(value.remote);
  return {
    ...fallback,
    root: typeof value.root === 'string' ? value.root : fallback.root,
    name: typeof value.name === 'string' ? value.name : fallback.name,
    slug: typeof value.slug === 'string' && isValidPublishSlug(value.slug) ? value.slug : fallback.slug,
    preview: typeof value.preview === 'string' ? value.preview : null,
    production: typeof value.production === 'string' ? value.production : null,
    productionHistory: Array.isArray(value.productionHistory)
      ? value.productionHistory.filter(
          (id: unknown): id is string =>
            typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/i.test(id)
        )
      : [],
    releases,
    ...(remote ? { remote } : {}),
  };
}

async function readState(root: string, baseDir?: string): Promise<PublishState> {
  try {
    const raw = await fsp.readFile(statePath(root, baseDir), 'utf8');
    return normalizeState(JSON.parse(raw), root);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return defaultState(root);
    if (error instanceof SyntaxError) throw new Error('El estado de publicación está corrupto');
    throw error;
  }
}

async function writeState(root: string, state: PublishState, baseDir?: string): Promise<void> {
  const dir = projectDir(root, baseDir);
  await fsp.mkdir(dir, { recursive: true });
  const file = statePath(root, baseDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, file);
}

function within(parent: string, child: string): boolean {
  const p = parent.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  const c = child.replace(/\\/g, '/').toLowerCase();
  return c === p || c.startsWith(`${p}/`);
}

function relativeToProject(root: string, target: string): string {
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return '.';
  return rel.replace(/\\/g, '/');
}

function readPackageScripts(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  } catch {
    return {};
  }
}

export function hasBuildScript(root: string): boolean {
  return typeof readPackageScripts(realProjectRoot(root)).build === 'string';
}

function detectOutputDir(root: string): string | null {
  for (const candidate of OUTPUT_CANDIDATES) {
    const dir = path.join(root, candidate);
    try {
      if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'index.html'))) return candidate;
    } catch {
      /* siguiente candidato */
    }
  }
  return null;
}

function resolveOutputDir(root: string, outputDir?: string): { abs: string; relative: string } {
  const requested = String(outputDir || '').trim();
  const abs = requested ? path.resolve(root, requested) : path.join(root, detectOutputDir(root) || 'dist');
  if (!within(root, abs)) throw new Error('La carpeta de salida debe estar dentro del proyecto');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new Error(`No existe la carpeta de salida: ${requested || path.basename(abs)}`);
  }
  if (!stat.isDirectory()) throw new Error('La salida no es una carpeta');
  if (!fs.existsSync(path.join(abs, 'index.html'))) {
    throw new Error('La salida no contiene index.html; compila el proyecto antes de publicar');
  }
  return { abs, relative: relativeToProject(root, abs) };
}

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

function tail(text: string, max = 6000): string {
  return text.length > max ? `…${text.slice(-max)}` : text;
}

async function runBuild(root: string): Promise<string> {
  const scripts = readPackageScripts(root);
  if (typeof scripts.build !== 'string') {
    throw new Error('El proyecto no define "npm run build"; desmarca construir o añade el script');
  }
  return new Promise<string>((resolve, reject) => {
    let output = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(tail(output));
    };
    // El comando es fijo y el script lo define el propio proyecto: publicar con
    // "construir" es una acción explícita del usuario, no una entrada libre.
    const child = spawn('npm', ['run', 'build'], {
      cwd: root,
      env: { ...process.env, CI: '1' },
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (b: Buffer) => { output += b.toString(); });
    child.stderr?.on('data', (b: Buffer) => { output += b.toString(); });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      if (code === 0) finish();
      else finish(new Error(`npm run build falló (código ${code})\n${tail(output)}`));
    });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ya terminó */ }
      finish(new Error(`npm run build excedió ${BUILD_TIMEOUT_MS / 60000} minutos\n${tail(output)}`));
    }, BUILD_TIMEOUT_MS);
  });
}

interface CopyStats {
  fileCount: number;
  bytes: number;
}

async function copyTree(src: string, dest: string, stats: CopyStats): Promise<void> {
  const entries = await fsp.readdir(src, { withFileTypes: true });
  await fsp.mkdir(dest, { recursive: true });

  for (const entry of entries) {
    if (
      PROJECT_DIRS_TO_SKIP.has(entry.name) ||
      /^\.env(\..*)?$/i.test(entry.name) ||
      entry.name === '.npmrc' ||
      entry.name === '.netrc'
    ) {
      continue;
    }
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    let stat: fs.Stats;
    try {
      stat = await fsp.lstat(from);
    } catch {
      continue;
    }
    // No seguir symlinks: una build no debe poder publicar archivos de fuera
    // del proyecto ni bucles del sistema de archivos.
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      await copyTree(from, to, stats);
      continue;
    }
    if (!stat.isFile()) continue;
    stats.fileCount += 1;
    stats.bytes += stat.size;
    if (stats.fileCount > MAX_FILES) throw new Error(`La build supera el límite de ${MAX_FILES} archivos`);
    if (stats.bytes > MAX_BYTES) throw new Error('La build supera el límite de 300 MB');
    await fsp.copyFile(from, to);
  }
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (current: string) => {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(abs);
      else if (entry.isFile()) out.push(abs);
    }
  };
  await visit(dir);
  return out;
}

/**
 * Convierte referencias root-absolute en relativas. Vite, por defecto, emite
 * `/assets/...`; servido bajo `/published/...` eso apuntaría a la raíz de
 * Commander. Las rutas de JavaScript no se tocan (sus imports internos ya son
 * relativos y reescribir código arbitrario sería peor que fallar).
 */
export function rewriteRootAbsoluteReferences(text: string, fromDir: string): string {
  const dir = fromDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const prefix = dir ? `${path.posix.relative(dir, '')}/` : '';

  const rewriteValue = (value: string): string =>
    value.startsWith('/') && !value.startsWith('//')
      ? `${prefix}${value.replace(/^\/+/, '')}`
      : value;

  let rewritten = text.replace(
    /(\b(?:src|href|poster|action)\s*=\s*)(["'])(\/(?!\/)[^"']*)\2/gi,
    (_match, start: string, quote: string, value: string) => `${start}${quote}${rewriteValue(value)}${quote}`
  );

  rewritten = rewritten.replace(
    /(\bsrcset\s*=\s*)(["'])([^"']*)\2/gi,
    (_match, start: string, quote: string, value: string) => {
      if (!/(^|,)\s*\/(?!\/)/.test(value)) return `${start}${quote}${value}${quote}`;
      const candidates = value
        .split(',')
        .map((part) => {
          const match = part.trim().match(/^(\S+)(.*)$/);
          return match ? `${rewriteValue(match[1])}${match[2]}` : part.trim();
        })
        .join(', ');
      return `${start}${quote}${candidates}${quote}`;
    }
  );

  rewritten = rewritten.replace(
    /(url\(\s*)(["']?)(\/(?!\/)[^)"']*)(\2\s*\))/gi,
    (_match, start: string, quote: string, value: string, end: string) =>
      `${start}${quote}${rewriteValue(value)}${end}`
  );

  rewritten = rewritten.replace(
    /(@import\s+)(["'])(\/(?!\/)[^"']*)\2/gi,
    (_match, start: string, quote: string, value: string) => `${start}${quote}${rewriteValue(value)}${quote}`
  );

  return rewritten;
}

async function rewriteReleaseReferences(releaseDir: string): Promise<void> {
  for (const file of await listFiles(releaseDir)) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== '.html' && ext !== '.css') continue;
    const rel = path.relative(releaseDir, file).replace(/\\/g, '/');
    const fromDir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    const content = await fsp.readFile(file, 'utf8');
    const next = rewriteRootAbsoluteReferences(content, fromDir);
    if (next !== content) await fsp.writeFile(file, next, 'utf8');
  }
}

function releaseId(): string {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

function toPublishedRelease(
  release: ReleaseMeta | null | undefined,
  state: PublishState,
  environment: PublishEnvironment
): PublishedRelease | null {
  if (!release) return null;
  return { ...release, url: publishUrl(state.slug, environment) };
}

function buildStatus(state: PublishState, root: string): PublishStatus {
  const releaseById = new Map(state.releases.map((release) => [release.id, release]));
  return {
    project: {
      root,
      name: state.name,
      slug: state.slug,
      buildScript: hasBuildScript(root),
      detectedOutputDir: detectOutputDir(root),
    },
    preview: toPublishedRelease(releaseById.get(state.preview || ''), state, 'preview'),
    production: toPublishedRelease(releaseById.get(state.production || ''), state, 'production'),
    canRollback: state.productionHistory.length > 1,
    releases: state.releases.map((release) => ({
      ...release,
      url: publishUrl(state.slug, 'production'),
      isPreview: release.id === state.preview,
      isProduction: release.id === state.production,
    })),
  };
}

export async function getPublishStatus(rootInput: string, baseDir?: string): Promise<PublishStatus> {
  const root = realProjectRoot(rootInput);
  const state = await readState(root, baseDir);
  return buildStatus(state, root);
}

export interface LocalReleaseForDeploy {
  release: ReleaseMeta;
  dir: string;
}

/** Release local lista para entregar a un adaptador remoto. */
export async function getReleaseForDeploy(
  rootInput: string,
  releaseId?: string,
  baseDir?: string
): Promise<LocalReleaseForDeploy | null> {
  const root = realProjectRoot(rootInput);
  const state = await readState(root, baseDir);
  const id = String(releaseId || '').trim() || state.preview;
  if (!id) return null;
  const release = state.releases.find((item) => item.id === id);
  if (!release) return null;
  const dir = path.join(projectDir(root, baseDir), 'releases', release.id);
  if (!fs.existsSync(path.join(dir, 'index.html'))) return null;
  return { release, dir };
}

export async function getRemoteDeploymentState(
  rootInput: string,
  baseDir?: string
): Promise<RemoteDeploymentState | undefined> {
  const root = realProjectRoot(rootInput);
  const state = await readState(root, baseDir);
  return state.remote;
}

/** Persiste el puntero remoto sin tocar las releases locales. */
export async function saveRemoteDeploymentState(
  rootInput: string,
  remote: RemoteDeploymentState | undefined,
  baseDir?: string
): Promise<void> {
  const root = realProjectRoot(rootInput);
  await withLock(projectSlug(root), async () => {
    const state = await readState(root, baseDir);
    if (remote) {
      const normalized = normalizeRemoteState(remote);
      if (!normalized) throw new Error('Estado remoto inválido');
      state.remote = normalized;
    } else {
      delete state.remote;
    }
    await writeState(root, state, baseDir);
  });
}

export async function createRelease(
  rootInput: string,
  options: CreateReleaseOptions = {},
  baseDir?: string
): Promise<CreateReleaseResult> {
  const root = realProjectRoot(rootInput);
  const slug = projectSlug(root);
  return withLock(slug, async () => {
    const state = await readState(root, baseDir);
    let buildLog = '';
    if (options.build) buildLog = await runBuild(root);
    const output = resolveOutputDir(root, options.outputDir);

    const id = releaseId();
    const destination = path.join(projectDir(root, baseDir), 'releases', id);
    const stats: CopyStats = { fileCount: 0, bytes: 0 };
    try {
      await copyTree(output.abs, destination, stats);
      if (!fs.existsSync(path.join(destination, 'index.html'))) {
        throw new Error('La release copiada no contiene index.html');
      }
      await rewriteReleaseReferences(destination);
    } catch (error) {
      await fsp.rm(destination, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    const release: ReleaseMeta = {
      id,
      createdAt: new Date().toISOString(),
      fileCount: stats.fileCount,
      bytes: stats.bytes,
      outputDir: output.relative,
      built: options.build === true,
    };
    state.releases = [release, ...state.releases].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    state.preview = release.id;
    await writeState(root, state, baseDir);
    await pruneReleases(root, state, baseDir);
    return { release, status: buildStatus(state, root), buildLog };
  });
}

export async function promoteRelease(
  rootInput: string,
  release: string,
  environment: PublishEnvironment,
  baseDir?: string
): Promise<PublishStatus> {
  const root = realProjectRoot(rootInput);
  return withLock(projectSlug(root), async () => {
    const state = await readState(root, baseDir);
    const target = state.releases.find((item) => item.id === release);
    if (!target) throw new Error('La release indicada no existe');
    if (environment === 'preview') {
      state.preview = target.id;
    } else if (state.production !== target.id) {
      state.production = target.id;
      state.productionHistory = [
        target.id,
        ...state.productionHistory.filter((id) => id !== target.id),
      ].slice(0, MAX_RELEASES);
    }
    await writeState(root, state, baseDir);
    return buildStatus(state, root);
  });
}

export async function rollbackProduction(rootInput: string, baseDir?: string): Promise<PublishStatus> {
  const root = realProjectRoot(rootInput);
  return withLock(projectSlug(root), async () => {
    const state = await readState(root, baseDir);
    if (state.productionHistory.length < 2) {
      throw new Error('No hay una producción anterior a la que volver');
    }
    const previous = state.productionHistory[1];
    if (!state.releases.some((release) => release.id === previous)) {
      throw new Error('La release anterior ya no existe');
    }
    state.production = previous;
    state.productionHistory = state.productionHistory.slice(1);
    await writeState(root, state, baseDir);
    return buildStatus(state, root);
  });
}

async function pruneReleases(root: string, state: PublishState, baseDir?: string): Promise<void> {
  const pinned = new Set([state.preview, state.production, ...state.productionHistory.slice(0, 2)]);
  const kept = state.releases.filter((release, index) => index < MAX_RELEASES || pinned.has(release.id));
  const removed = state.releases.filter((release) => !kept.includes(release));
  if (removed.length === 0) return;
  state.releases = kept;
  await writeState(root, state, baseDir);
  await Promise.all(
    removed.map((release) =>
      fsp.rm(path.join(projectDir(root, baseDir), 'releases', release.id), {
        recursive: true,
        force: true,
      }).catch(() => undefined)
    )
  );
}

/** Release que debe servirse en un entorno, o null si el entorno está vacío. */
export function getPublishedRelease(
  slug: string,
  environment: PublishEnvironment,
  baseDir?: string
): { dir: string; release: ReleaseMeta; state: PublishState } | null {
  if (!isValidPublishSlug(slug)) return null;
  const dir = path.join(publishBaseDir(baseDir), slug);
  let state: PublishState;
  try {
    state = normalizeState(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')), dir);
  } catch {
    return null;
  }
  const id = environment === 'preview' ? state.preview : state.production;
  const release = state.releases.find((item) => item.id === id);
  if (!release) return null;
  const releaseDir = path.join(dir, 'releases', release.id);
  if (!fs.existsSync(path.join(releaseDir, 'index.html'))) return null;
  return { dir: releaseDir, release, state };
}

/** Resuelve un archivo dentro de una release sin permitir escapar del directorio. */
export function resolvePublishedFile(releaseDir: string, relativePath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relativePath || '/');
  } catch {
    return null;
  }
  const clean = decoded.replace(/^\/+/, '');
  const target = path.resolve(releaseDir, clean);
  if (!within(releaseDir, target)) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return null;
  }
  if (stat.isDirectory()) {
    const index = path.join(target, 'index.html');
    return fs.existsSync(index) ? index : null;
  }
  return stat.isFile() ? target : null;
}
