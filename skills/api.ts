/**
 * Skill Plugin API (P1 #9) - Endpoints HTTP para skills.
 *
 * Expone los skills como API REST para el cliente.
 */

// @ts-ignore - express types from main project
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { loadAllSkills, findSkillById, findSkillsByTag, findSkillsByType, loadSkill } from './loader';

const router = Router();

/** GET /api/skills - Lista todos los skills */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const skills = await loadAllSkills();
    return res.json({ success: true, skills });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== DESCUBRIMIENTO E INSTALACIÓN ====================

/**
 * Catálogo público de claudemarketplace.net. Se consulta desde el servidor
 * para no depender de CORS y para cachear: la página limita el ritmo.
 * Cada entrada es un SKILL.md dentro de un repo de GitHub
 * (`id` = owner/repo/slug), así que instalar es descargar ese archivo.
 */
const MARKETPLACE_BASE = process.env.SKILLS_MARKETPLACE_URL || 'https://www.claudemarketplace.net';
const DISCOVER_TTL_MS = 60_000;
const discoverCache = new Map<string, { at: number; body: unknown }>();

function skillsRootDir(): string {
  return process.env.SKILLS_ROOT || path.join(process.cwd(), 'skills');
}

/**
 * Slugs de comandos ya instalados: las skills propias viven en
 * `skills/commands` y las de cada plugin en `skills/plugins/<id>/commands`.
 */
function installedCommandSlugs(): Set<string> {
  const root = skillsRootDir();
  const dirs = [path.join(root, 'commands')];
  const pluginsRoot = path.join(root, 'plugins');
  if (fs.existsSync(pluginsRoot)) {
    for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(path.join(pluginsRoot, entry.name, 'commands'));
    }
  }

  const slugs = new Set<string>();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.toLowerCase().endsWith('.md')) slugs.add(file.replace(/\.md$/i, '').toLowerCase());
    }
  }
  return slugs;
}

type MarketplaceSkill = {
  id: string;
  name: string;
  slug: string;
  source: string;
  summary?: string;
  installs: number;
  stars: number;
  categories: string[];
  url: string;
};

function normalizeMarketplaceSkill(entry: any): MarketplaceSkill | null {
  const id = String(entry?.id ?? entry?.external_id ?? '').trim();
  // owner/repo/slug: cualquier otra forma no se puede descargar de raw.githubusercontent.
  if (!/^[\w.-]+\/[\w.-]+\/[\w.-]+$/.test(id)) return null;
  const [, repoOwner, slugFromId] = id.split('/');
  const slug = String(entry.slug ?? slugFromId).trim() || slugFromId;
  return {
    id,
    name: String(entry.name ?? slug).trim() || slug,
    slug,
    source: String(entry.source ?? `${id.split('/')[0]}/${repoOwner}`).trim(),
    summary: typeof entry.summary === 'string' ? entry.summary : undefined,
    installs: Number(entry.installs) || 0,
    stars: Number(entry.github_stars) || 0,
    categories: Array.isArray(entry.categories) ? entry.categories.slice(0, 4).map(String) : [],
    url: `${MARKETPLACE_BASE}/skills/${encodeURIComponent(id)}`,
  };
}

/**
 * El catálogo público tarda y a veces corta la conexión: un reintento (15 s en
 * vez de 8) evita que la pestaña se quede sin nada por un timeout puntual.
 */
const CATALOG_TIMEOUT_MS = 15_000;

async function fetchMarketplaceJson(url: string): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`El catálogo respondió ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('red');
}

/**
 * GET /api/skills/discover?q=react&limit=10
 * Busca en el catálogo público. Sin `q` devuelve las más instaladas, para que
 * la pestaña muestre algo desde el principio.
 */
router.get('/discover', async (req: Request, res: Response) => {
  const q = String(req.query.q ?? '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);

  const key = `${q.toLowerCase()}:${limit}`;
  const hit = discoverCache.get(key);
  if (hit && Date.now() - hit.at < DISCOVER_TTL_MS) {
    return res.json({ ...(hit.body as object), cached: true });
  }

  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (q) params.set('q', q);
    const data: any = await fetchMarketplaceJson(`${MARKETPLACE_BASE}/api/skills?${params}`);
    const results = (Array.isArray(data?.skills) ? data.skills : [])
      .map(normalizeMarketplaceSkill)
      .filter((s: MarketplaceSkill | null): s is MarketplaceSkill => Boolean(s));

    const installed = installedCommandSlugs();

    const body = {
      success: true,
      source: 'claudemarketplace.net',
      count: results.length,
      total: Number(data?.total) || results.length,
      results: results.map((entry: MarketplaceSkill) => ({
        ...entry,
        installed: installed.has(entry.slug.toLowerCase()),
      })),
    };
    discoverCache.set(key, { at: Date.now(), body });

    if (discoverCache.size > 50) {
      const oldest = [...discoverCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) discoverCache.delete(oldest[0]);
    }

    return res.json(body);
  } catch (e: any) {
    console.error('[skills] discover failed:', e?.message || e);
    return res.status(502).json({
      success: false,
      results: [],
      error: `No se pudo consultar el catálogo (${e?.message || 'red'})`,
    });
  }
});

/** Rutas donde los repos suelen guardar el SKILL.md de cada skill. */
function rawSkillCandidates(source: string, slug: string): string[] {
  const paths = [
    `skills/${slug}/SKILL.md`,
    `${slug}/SKILL.md`,
    `.claude/skills/${slug}/SKILL.md`,
    `plugins/${slug}/skills/${slug}/SKILL.md`,
  ];
  const urls: string[] = [];
  for (const branch of ['main', 'master']) {
    for (const p of paths) urls.push(`https://raw.githubusercontent.com/${source}/${branch}/${p}`);
  }
  return urls;
}

/**
 * Cuando el SKILL.md no está en las rutas típicas hay que buscar en el árbol
 * del repo: el slug del catálogo no siempre coincide con la carpeta
 * (p. ej. `vercel-react-best-practices` vive en `skills/react-best-practices`).
 * El árbol se cachea 10 min y admite GITHUB_TOKEN para no agotar el límite.
 */
const repoTreeCache = new Map<string, { at: number; paths: string[] }>();
const REPO_TREE_TTL_MS = 10 * 60_000;

async function repoSkillPaths(source: string): Promise<{ paths: string[]; error?: string }> {
  const hit = repoTreeCache.get(source);
  if (hit && Date.now() - hit.at < REPO_TREE_TTL_MS) return { paths: hit.paths };

  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'commander-ai-studio',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    const r = await fetch(`https://api.github.com/repos/${source}/git/trees/HEAD?recursive=1`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      const hint =
        r.status === 403 || r.status === 429
          ? ' (límite de la API de GitHub; define GITHUB_TOKEN)'
          : '';
      return { paths: [], error: `GitHub respondió ${r.status}${hint}` };
    }
    const data: any = await r.json();
    const paths: string[] = (Array.isArray(data?.tree) ? data.tree : [])
      .map((node: any) => String(node?.path || ''))
      .filter((p: string) => /SKILL\.md$/i.test(p));
    repoTreeCache.set(source, { at: Date.now(), paths });
    return { paths };
  } catch (e: any) {
    return { paths: [], error: e?.message || 'red' };
  }
}

function pickSkillPath(paths: string[], slug: string): string | null {
  const candidates = paths.map((p) => ({ path: p, folder: p.split('/').slice(-2)[0] || '' }));
  const target = slug.toLowerCase();
  const exact = candidates.find((c) => c.folder.toLowerCase() === target);
  if (exact) return exact.path;
  const suffix = candidates.find((c) => c.folder && target.endsWith(c.folder.toLowerCase()));
  if (suffix) return suffix.path;
  const loose = candidates.find(
    (c) =>
      c.folder &&
      (target.includes(c.folder.toLowerCase()) || c.folder.toLowerCase().includes(target))
  );
  if (loose) return loose.path;
  return paths.length === 1 ? paths[0] : null;
}

function frontMatterValue(markdown: string, key: string): string | undefined {
  const fm = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return undefined;
  const line = fm[1].match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm'));
  if (!line) return undefined;
  return line[1].trim().replace(/^["']|["']$/g, '');
}

/**
 * Los SKILL.md del marketplace sólo traen name/description; el loader necesita
 * id/type/version, así que se completan sin tocar el cuerpo del archivo.
 */
export function withRequiredFrontMatter(
  markdown: string,
  meta: { id: string; slug: string; source: string; summary?: string }
): string {
  const fm = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const existing = fm ? fm[1].trim() : '';
  const body = fm ? markdown.slice(fm[0].length) : markdown;
  const has = (key: string) => new RegExp(`^${key}\\s*:`, 'm').test(existing);
  const quote = (v: string) => `"${v.replace(/"/g, '\\"')}"`;

  const description =
    frontMatterValue(markdown, 'description') || meta.summary || `Skill ${meta.slug} (${meta.source})`;

  const extra: string[] = [];
  if (!has('id')) extra.push(`id: ${quote(meta.id)}`);
  if (!has('name')) extra.push(`name: ${meta.slug}`);
  if (!has('version')) extra.push('version: "1.0.0"');
  if (!has('type')) extra.push('type: command');
  if (!has('description')) extra.push(`description: ${quote(description)}`);
  if (!has('author')) extra.push(`author: ${meta.source}`);
  if (!has('tags')) extra.push('tags: []');
  if (!has('requires')) extra.push('requires: []');
  if (!has('permissions')) extra.push('permissions: []');

  const frontMatter = [existing, ...extra].filter(Boolean).join('\n');
  return `---\n${frontMatter}\n---\n\n${body.trim()}\n`;
}

/**
 * POST /api/skills/install
 * body: { id: "owner/repo/slug", overwrite?: boolean }
 * Descarga el SKILL.md del repo y lo deja en skills/commands/<slug>.md.
 */
router.post('/install', async (req: Request, res: Response) => {
  try {
    const id = String(req.body?.id ?? '').trim();
    const overwrite = Boolean(req.body?.overwrite);
    const parts = id.split('/');
    if (parts.length !== 3 || !/^[\w.-]+\/[\w.-]+\/[\w.-]+$/.test(id)) {
      return res.status(400).json({ success: false, error: 'id debe tener la forma owner/repo/slug' });
    }

    const [owner, repo, rawSlug] = parts;
    const slug = rawSlug.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    const source = `${owner}/${repo}`;
    const destDir = path.join(skillsRootDir(), 'commands');
    const dest = path.join(destDir, `${slug}.md`);

    // Sólo se escribe dentro de skills/commands: el slug es un nombre de archivo.
    if (!slug || destDir !== path.join(skillsRootDir(), 'commands')) {
      return res.status(400).json({ success: false, error: 'slug inválido' });
    }

    if (fs.existsSync(dest) && !overwrite) {
      return res.json({ success: true, alreadyInstalled: true, path: dest, slug });
    }

    let found: { url: string; markdown: string } | null = null;
    const tried: string[] = [];
    for (const url of rawSkillCandidates(source, rawSlug)) {
      tried.push(url);
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const markdown = await r.text();
        if (markdown.trim()) {
          found = { url, markdown };
          break;
        }
      } catch {
        // Se prueba la siguiente ruta/rama.
      }
    }

    if (!found) {
      const tree = await repoSkillPaths(source);
      const path2 = tree.paths.length ? pickSkillPath(tree.paths, rawSlug) : null;
      if (path2) {
        tried.push(`árbol del repo: ${path2}`);
        for (const branch of ['main', 'master']) {
          const url = `https://raw.githubusercontent.com/${source}/${branch}/${path2}`;
          try {
            const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!r.ok) continue;
            const markdown = await r.text();
            if (markdown.trim()) {
              found = { url, markdown };
              break;
            }
          } catch {
            // Siguiente rama.
          }
        }
      }

      if (!found) {
        return res.status(404).json({
          success: false,
          error:
            'No se encontró SKILL.md en el repositorio' +
            (tree.error ? `: ${tree.error}` : ' (rutas, ramas y árbol probados)'),
          tried,
        });
      }
    }

    fs.mkdirSync(destDir, { recursive: true });
    const summary =
      frontMatterValue(found.markdown, 'description') || `Skill ${slug} desde ${source}`;
    fs.writeFileSync(
      dest,
      withRequiredFrontMatter(found.markdown, { id, slug, source, summary }),
      'utf8'
    );

    return res.json({ success: true, installed: true, slug, source, path: dest, raw: found.url });
  } catch (e: any) {
    console.error('[skills] install failed:', e?.message || e);
    return res.status(500).json({ success: false, error: e?.message || 'install failed' });
  }
});

/** GET /api/skills/:id - Obtiene un skill por ID */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const skill = await findSkillById(req.params.id as string);
    if (!skill) return res.status(404).json({ success: false, error: 'Skill no encontrado' });
    return res.json({ success: true, skill });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/** GET /api/skills/tag/:tag - Filtra por tag */
router.get('/tag/:tag', async (req: Request, res: Response) => {
  try {
    const skills = await findSkillsByTag(req.params.tag as string);
    return res.json({ success: true, skills });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/** GET /api/skills/type/:type - Filtra por tipo */
router.get('/type/:type', async (req: Request, res: Response) => {
  const type = req.params.type as string;
  if (!['command', 'agent', 'template'].includes(type)) {
    return res.status(400).json({ success: false, error: 'Tipo inválido' });
  }
  try {
    const skills = await findSkillsByType(type as 'command' | 'agent' | 'template');
    return res.json({ success: true, skills });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/** POST /api/skills/:id/execute - Ejecuta un command skill (simplificado) */
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const skill = await findSkillById(req.params.id as string);
    if (!skill) return res.status(404).json({ success: false, error: 'Skill no encontrado' });
    if (skill.type !== 'command') {
      return res.status(400).json({ success: false, error: 'Solo commands son ejecutables directamente' });
    }
    return res.json({
      success: true,
      skill: { id: skill.id, name: skill.name },
      script: skill.implementation,
      note: 'Ejecuta este script en el entorno del cliente con los permisos adecuados',
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/** POST /api/skills/import - Importa skills Markdown desde carpeta externa */
router.post('/import', async (req: Request, res: Response) => {
  try {
    const { sourceDir, overwrite = false } = req.body ?? {};
    if (!sourceDir || typeof sourceDir !== 'string') {
      return res.status(400).json({ success: false, error: 'sourceDir (string) es requerido' });
    }

    const resolvedSource = path.resolve(process.cwd(), sourceDir);
    const skillRoot = process.env.SKILLS_ROOT || path.join(process.cwd(), 'skills');
    if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isDirectory()) {
      return res.status(400).json({ success: false, error: 'sourceDir no existe o no es directorio' });
    }

    const walker = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const out: string[] = [];
      for (const entry of entries) {
        const next = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walker(next));
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(next);
      }
      return out;
    };

    const markdownFiles = walker(resolvedSource);
    const imported: string[] = [];
    const skipped: { file: string; reason: string }[] = [];

    for (const file of markdownFiles) {
      const skill = await loadSkill(file);
      if (!skill) {
        skipped.push({ file, reason: 'front-matter inválido' });
        continue;
      }

      let category = 'commands';
      if (skill.type === 'agent') category = 'agents';
      if (skill.type === 'template') category = 'templates';

      const relatives = path.relative(resolvedSource, file).split(path.sep);
      if (['commands', 'agents', 'templates'].includes(relatives[0]?.toLowerCase())) {
        category = relatives[0].toLowerCase();
      }

      const destDir = path.join(skillRoot, category);
      fs.mkdirSync(destDir, { recursive: true });
      const dest = path.join(destDir, path.basename(file));
      if (fs.existsSync(dest) && !overwrite) {
        skipped.push({ file, reason: 'ya existe (overwrite=false)' });
        continue;
      }
      fs.copyFileSync(file, dest);
      imported.push(dest);
    }

    return res.json({ success: true, imported: imported.length, importedFiles: imported, skipped });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'import failed' });
  }
});

export default router;