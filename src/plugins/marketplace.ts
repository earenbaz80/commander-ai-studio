/**
 * Descubrimiento e instalación nativa de plugins.
 *
 * El catálogo son los marketplace de Claude: repos de GitHub con
 * `.claude-plugin/marketplace.json`. Al instalar un plugin no se guarda un zip
 * opaco: se traen sus archivos y se convierten en piezas que Commander ya sabe
 * usar — `skills/commands`, `skills/agents` y servidores MCP en la config.
 *
 * Se hace en el servidor por CORS, por caché y porque la API de GitHub limita
 * el ritmo (admite `GITHUB_TOKEN`).
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getToolsConfig, writeConfig } from '../config/index.js';
import { withRequiredFrontMatter } from '../../skills/api';
import {
  classifyPluginFile,
  filterPlugins,
  normalizeMarketplacePlugins,
  type PluginEntry,
} from './catalog.js';

export const pluginMarketRouter = Router();

const GITHUB_API = 'https://api.github.com';
const GITHUB_RAW = 'https://raw.githubusercontent.com';
const CATALOG_TTL_MS = 10 * 60_000;
const NET_TIMEOUT_MS = 15_000;
/** Un plugin son textos: con estos topes no se puede llenar el disco desde un repo. */
const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;
const WANTED_FILE = /\.(md|mcp\.json)$/i;

/** Catálogos por defecto: el oficial curado y el repo de Anthropic. */
const MARKETPLACES = (
  process.env.COMMANDER_PLUGIN_MARKETPLACES ||
  'anthropics/claude-plugins-official,anthropics/claude-code'
)
  .split(',')
  .map((repo) => repo.trim())
  .filter((repo) => /^[\w.-]+\/[\w.-]+$/.test(repo));

const catalogCache = new Map<string, { at: number; entries: PluginEntry[] }>();
const repoCache = new Map<
  string,
  { at: number; branch: string; files: { path: string; size: number }[] }
>();

/** GitHub falla a veces de forma transitoria: un reintento antes de rendirse. */
async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetch(url, { headers: githubHeaders(), signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('red');
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'commander-ai-studio',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function skillsRootDir(): string {
  return process.env.SKILLS_ROOT || path.join(process.cwd(), 'skills');
}

function pluginsDir(): string {
  return path.join(process.cwd(), '.commander', 'plugins');
}

/**
 * Ref (rama/tag/sha, por defecto la rama principal) y lista de archivos del
 * repo, con 10 min de caché. `ref` evita la petición de metadatos cuando el
 * marketplace ya fija la versión del plugin.
 */
async function repoMeta(
  repo: string,
  ref?: string
): Promise<{ branch: string; files: { path: string; size: number }[] }> {
  const cacheKey = ref ? `${repo}@${ref}` : repo;
  const hit = repoCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit;

  let branch = ref || '';
  if (!branch) {
    const infoRes = await fetchWithRetry(`${GITHUB_API}/repos/${repo}`);
    if (!infoRes.ok) {
      throw new Error(
        `GitHub respondió ${infoRes.status} al leer ${repo}` +
          (infoRes.status === 403 || infoRes.status === 429 ? ' (define GITHUB_TOKEN para subir el límite)' : '')
      );
    }
    const info: any = await infoRes.json();
    branch = typeof info?.default_branch === 'string' ? info.default_branch : 'main';
  }

  const treeRes = await fetchWithRetry(
    `${GITHUB_API}/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  );
  if (!treeRes.ok) throw new Error(`GitHub respondió ${treeRes.status} al listar ${repo}`);
  const tree: any = await treeRes.json();
  const files = (Array.isArray(tree?.tree) ? tree.tree : [])
    .filter((node: any) => node?.type === 'blob' && typeof node?.path === 'string')
    .map((node: any) => ({ path: String(node.path), size: Number(node.size) || 0 }));

  const meta = { branch, files };
  repoCache.set(cacheKey, { at: Date.now(), ...meta });
  return meta;
}

/**
 * Lee `.claude-plugin/marketplace.json` directamente del repo (rama `HEAD` y,
 * si el host no la resuelve, `main`/`master`). No usa la API de GitHub: el
 * catálogo tiene que abrirse aunque la API esté limitada o inaccesible.
 */
async function marketplaceEntries(repo: string): Promise<PluginEntry[]> {
  const hit = catalogCache.get(repo);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.entries;

  let lastError: unknown;
  for (const ref of ['HEAD', 'main', 'master']) {
    try {
      const response = await fetch(`${GITHUB_RAW}/${repo}/${ref}/.claude-plugin/marketplace.json`, {
        headers: { accept: 'application/json', 'user-agent': 'commander-ai-studio' },
        signal: AbortSignal.timeout(NET_TIMEOUT_MS),
      });
      if (!response.ok) {
        lastError = new Error(`El marketplace respondió ${response.status}`);
        continue;
      }
      const data: any = await response.json();
      const entries = normalizeMarketplacePlugins(repo, data);
      catalogCache.set(repo, { at: Date.now(), entries });
      return entries;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('red');
}

async function loadAllMarketplaces(): Promise<{ entries: PluginEntry[]; errors: string[] }> {
  const entries: PluginEntry[] = [];
  const errors: string[] = [];
  for (const repo of MARKETPLACES) {
    try {
      entries.push(...(await marketplaceEntries(repo)));
    } catch (error) {
      errors.push(`${repo}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { entries, errors };
}

/** Ids con manifiesto ya escrito en `.commander/plugins`. */
function installedPlugins(): Set<string> {
  try {
    return new Set(
      fs
        .readdirSync(pluginsDir())
        .filter((file) => file.endsWith('.manifest.json'))
        .map((file) => file.replace(/\.manifest\.json$/, ''))
    );
  } catch {
    return new Set();
  }
}

/**
 * GET /api/plugins/discover?q=&limit=20
 * Sin `q` devuelve el catálogo completo recortado por `limit`.
 */
pluginMarketRouter.get('/discover', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

  try {
    const { entries, errors } = await loadAllMarketplaces();
    if (entries.length === 0) {
      return res.status(502).json({
        success: false,
        results: [],
        error: errors.join(' · ') || 'No se pudo leer ningún marketplace',
      });
    }

    const installed = installedPlugins();
    const results = filterPlugins(entries, q, limit).map((entry) => ({
      ...entry,
      installed: installed.has(entry.name),
    }));

    return res.json({
      success: true,
      source: 'marketplace.json (GitHub)',
      marketplaces: MARKETPLACES,
      count: results.length,
      total: entries.length,
      results,
      ...(errors.length ? { errors } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[plugins] discover failed:', message);
    return res.status(502).json({ success: false, results: [], error: message });
  }
});

/**
 * POST /api/plugins/install-from-marketplace
 * body: { marketplace: "owner/repo", name: "plugin", overwrite?: boolean }
 */
pluginMarketRouter.post('/install-from-marketplace', async (req, res) => {
  const marketplace = String(req.body?.marketplace ?? '').trim();
  const name = String(req.body?.name ?? '').trim();
  const overwrite = Boolean(req.body?.overwrite);

  if (!/^[\w.-]+\/[\w.-]+$/.test(marketplace)) {
    return res.status(400).json({ success: false, error: 'marketplace debe ser owner/repo' });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    return res.status(400).json({ success: false, error: 'name inválido' });
  }

  try {
    const entries = await marketplaceEntries(marketplace);
    const entry = entries.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!entry) {
      return res.status(404).json({ success: false, error: `No hay un plugin "${name}" en ${marketplace}` });
    }
    if (!entry.installable || !entry.sourcePath) {
      return res.status(400).json({ success: false, error: entry.reason || 'El plugin no vive en este repo' });
    }

    const dir = pluginsDir();
    const manifestPath = path.join(dir, `${name}.manifest.json`);
    if (fs.existsSync(manifestPath) && !overwrite) {
      return res.json({ success: true, installed: true, alreadyInstalled: true, id: name });
    }

    // Muchos plugins del marketplace oficial viven en otra carpeta de otro repo
    // (`git-subdir`): se instala igual, trayendo sólo su subárbol.
    const targetRepo = entry.repo || marketplace;
    const { branch, files } = await repoMeta(targetRepo, entry.ref);
    const prefix = `${entry.sourcePath.replace(/^\.?\//, '').replace(/\/+$/, '')}/`;
    const wanted = files
      .filter((file) => file.path.startsWith(prefix) && WANTED_FILE.test(file.path) && file.size <= MAX_FILE_BYTES)
      .slice(0, MAX_FILES);

    const downloaded: { rel: string; text: string }[] = [];
    for (const file of wanted) {
      const url = `${GITHUB_RAW}/${targetRepo}/${branch}/${file.path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
        if (!response.ok) continue;
        const text = await response.text();
        if (!text.trim()) continue;
        downloaded.push({ rel: file.path.slice(prefix.length), text });
      } catch {
        // Un archivo que no baja no invalida el resto del plugin.
      }
    }

    if (downloaded.length === 0) {
      return res.status(502).json({ success: false, error: 'No se pudo descargar ningún archivo del plugin' });
    }

    // Copia fiel del plugin dentro del proyecto (referencia para el usuario).
    const pluginDir = path.join(dir, name);
    for (const file of downloaded) {
      const dest = path.join(pluginDir, 'files', file.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.text, 'utf8');
    }

    const components = { commands: [] as string[], agents: [] as string[], skills: [] as string[], mcp: [] as string[] };
    // Rutas exactas escritas en el proyecto: desinstalar borra éstas y no un
    // patrón, así que nunca se lleva por delante un archivo que ya existía.
    const written: string[] = [];
    let mcpChanged = false;
    const tools: any = getToolsConfig();

    for (const file of downloaded) {
      const classified = classifyPluginFile(file.rel);

      if (classified.kind === 'mcp') {
        let parsed: any = null;
        try {
          parsed = JSON.parse(file.text);
        } catch {
          continue;
        }
        const servers = parsed?.mcpServers;
        if (!servers || typeof servers !== 'object') continue;

        const mcp = tools.mcp && typeof tools.mcp === 'object' ? tools.mcp : { enabled: true, servers: {} };
        mcp.enabled = true;
        mcp.servers = mcp.servers && typeof mcp.servers === 'object' ? mcp.servers : {};

        for (const [serverName, config] of Object.entries(servers as Record<string, any>)) {
          if (!config || typeof config.command !== 'string') continue;
          mcp.servers[serverName] = {
            command: config.command,
            args: Array.isArray(config.args) ? config.args.map(String) : [],
            ...(config.env && typeof config.env === 'object' ? { env: config.env } : {}),
          };
          components.mcp.push(serverName);
        }
        tools.mcp = mcp;
        mcpChanged = components.mcp.length > 0;
        continue;
      }

      if (classified.kind === 'other') continue;

      const slug = (classified.slug || name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
      if (!slug) continue;
      const targetDir = path.join(skillsRootDir(), classified.kind === 'agent' ? 'agents' : 'commands');
      fs.mkdirSync(targetDir, { recursive: true });

      let dest = path.join(targetDir, `${slug}.md`);
      if (fs.existsSync(dest)) dest = path.join(targetDir, `${name}-${slug}.md`);

      const summary =
        (file.text.match(/^---\r?\n[\s\S]*?^description\s*:\s*(.+)$/m)?.[1] || '').trim() ||
        entry.description ||
        `Plugin ${name} desde ${marketplace}`;

      fs.writeFileSync(
        dest,
        withRequiredFrontMatter(file.text, {
          id: `${name}/${slug}`,
          slug,
          source: marketplace,
          summary: summary.replace(/^["']|["']$/g, ''),
        }),
        'utf8'
      );
      written.push(path.relative(process.cwd(), dest));

      if (classified.kind === 'agent') components.agents.push(slug);
      else if (classified.kind === 'skill') components.skills.push(slug);
      else components.commands.push(slug);
    }

    if (mcpChanged) writeConfig({ tools }, 'project');

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          id: name,
          name: entry.name,
          version: entry.version ?? null,
          marketplace,
          source: entry.sourcePath,
          ...(entry.repo ? { repo: entry.repo } : {}),
          ...(entry.ref ? { ref: entry.ref } : {}),
          components,
          written,
          files: downloaded.length,
          installedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );

    return res.json({
      success: true,
      installed: true,
      id: name,
      marketplace,
      components,
      files: downloaded.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[plugins] install failed:', message);
    return res.status(500).json({ success: false, error: message });
  }
});

export default pluginMarketRouter;
