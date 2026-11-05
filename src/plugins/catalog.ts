/**
 * Catálogo de plugins (datos puros).
 *
 * Los marketplace de Claude son repos de GitHub con un
 * `.claude-plugin/marketplace.json` que lista plugins y de dónde sale cada uno.
 * Aquí sólo se normaliza esa información: sin red ni express, para poder
 * probarla con fixtures. La descarga vive en `marketplace.ts`.
 */

export type PluginSourceKind = 'path' | 'git-subdir' | 'github' | 'git' | 'url' | 'unknown';

export interface PluginEntry {
  /** `nombre@marketplace`, único entre catálogos. */
  id: string;
  name: string;
  description?: string;
  category?: string;
  version?: string;
  author?: string;
  /** Repo del catálogo (`owner/repo`). */
  marketplace: string;
  sourceKind: PluginSourceKind;
  /** Ruta del plugin dentro del repo del catálogo, si vive ahí. */
  sourcePath?: string;
  /** Repo propio del plugin, cuando la fuente es otro repositorio. */
  repo?: string;
  /** Rama, tag o sha donde vive la carpeta del plugin. */
  ref?: string;
  installable: boolean;
  reason?: string;
}

const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * `source` de una entrada puede ser una ruta (`"./plugins/x"`), un repo
 * (`"owner/repo"`) o un objeto (`{source:"github", repo}`,
 * `{source:"git", url}`). Sólo las rutas dentro del repo del catálogo se pueden
 * instalar sin clonar nada.
 */
export function normalizePluginSource(source: unknown): {
  kind: PluginSourceKind;
  sourcePath?: string;
  repo?: string;
  ref?: string;
} {
  const cleanPath = (value: string) => value.replace(/^\.?\//, '').replace(/\/+$/, '');
  if (typeof source === 'string') {
    const value = source.trim();
    if (!value) return { kind: 'unknown' };
    if (value.startsWith('./') || value.startsWith('../') || value.startsWith('/')) {
      return { kind: 'path', sourcePath: cleanPath(value) };
    }
    if (/^[\w.-]+\/[\w.-]+$/.test(value)) return { kind: 'github', repo: value };
    return { kind: 'unknown' };
  }
  if (source && typeof source === 'object') {
    const data = source as Record<string, unknown>;
    const kind = String(data.source ?? '').toLowerCase();
    if (kind === 'github' && typeof data.repo === 'string' && data.repo.trim()) {
      return { kind: 'github', repo: data.repo.trim() };
    }
    // La forma más común en los marketplace de Claude: un repo y una carpeta
    // dentro de él (`git-subdir`), a menudo fijada a un tag o sha.
    if (kind === 'git-subdir' && typeof data.path === 'string' && data.path.trim()) {
      const repo = parseGithubRepo(data.url);
      const ref = typeof data.ref === 'string' && data.ref.trim() ? data.ref.trim() : undefined;
      return {
        kind: 'git-subdir',
        sourcePath: cleanPath(data.path.trim()),
        ...(repo ? { repo } : {}),
        ...(ref ? { ref } : {}),
      };
    }
    if ((kind === 'git' || kind === 'url') && typeof data.url === 'string') {
      return { kind: kind as PluginSourceKind };
    }
    if (kind === 'path' && typeof data.path === 'string') {
      return { kind: 'path', sourcePath: cleanPath(String(data.path)) };
    }
  }
  return { kind: 'unknown' };
}

/** `https://github.com/owner/repo(.git)` → `owner/repo`. */
function parseGithubRepo(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const match = url
    .trim()
    .match(/^(?:https?:\/\/|git@)github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/** Traduce el `marketplace.json` de un repo a entradas normalizadas. */
export function normalizeMarketplacePlugins(repo: string, data: any): PluginEntry[] {
  const list = Array.isArray(data?.plugins) ? data.plugins : [];
  const entries: PluginEntry[] = [];

  for (const raw of list) {
    const name = String(raw?.name ?? '').trim();
    if (!PLUGIN_NAME_RE.test(name)) continue;

    const source = normalizePluginSource(raw?.source);
    const installable =
      Boolean(source.sourcePath) && (source.kind === 'path' || source.kind === 'git-subdir');
    const authorName =
      typeof raw?.author === 'string'
        ? raw.author
        : typeof raw?.author?.name === 'string'
          ? raw.author.name
          : undefined;

    entries.push({
      id: `${name}@${String(data?.name ?? repo)}`,
      name,
      ...(typeof raw?.description === 'string' ? { description: raw.description } : {}),
      ...(typeof raw?.category === 'string' ? { category: raw.category } : {}),
      ...(typeof raw?.version === 'string' ? { version: raw.version } : {}),
      ...(authorName ? { author: authorName } : {}),
      marketplace: repo,
      sourceKind: source.kind,
      ...(source.sourcePath ? { sourcePath: source.sourcePath } : {}),
      ...(source.repo ? { repo: source.repo } : {}),
      ...(source.ref ? { ref: source.ref } : {}),
      installable,
      ...(installable
        ? {}
        : {
            reason:
              source.kind === 'path'
                ? 'la entrada no apunta a ninguna carpeta'
                : source.kind === 'url'
                  ? 'la fuente es un repo sin carpeta concreta'
                  : `fuente ${source.kind}: el plugin vive en otro repositorio`,
          }),
    });
  }

  return entries;
}

export type PluginFileKind = 'skill' | 'agent' | 'command' | 'mcp' | 'other';

/**
 * Qué es cada archivo del plugin. En un plugin de Claude, las skills viven en
 * `skills/<slug>/SKILL.md`, los agentes en `agents/*.md`, los comandos en
 * `commands/*.md` y los servidores MCP en `.mcp.json`.
 */
export function classifyPluginFile(filePath: string): { kind: PluginFileKind; slug?: string } {
  const clean = filePath.replace(/^\/+/, '');
  const lower = clean.toLowerCase();
  if (lower.endsWith('.mcp.json')) return { kind: 'mcp' };
  if (!lower.endsWith('.md')) return { kind: 'other' };

  const parts = clean.split('/');
  const file = parts.pop() || '';
  const parent = (parts.pop() || '').toLowerCase();

  if (file.toLowerCase() === 'skill.md' && parent) return { kind: 'skill', slug: parent };
  if (parent === 'commands') return { kind: 'command', slug: file.replace(/\.md$/i, '').toLowerCase() };
  if (parent === 'agents') return { kind: 'agent', slug: file.replace(/\.md$/i, '').toLowerCase() };
  return { kind: 'other' };
}

/** Filtro por texto y recorte de la lista, igual que en el resto del catálogo. */
export function filterPlugins(entries: PluginEntry[], query: string, limit: number): PluginEntry[] {
  const q = query.trim().toLowerCase();
  const matched = q
    ? entries.filter((entry) =>
        [entry.name, entry.description, entry.category, entry.author, entry.marketplace]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      )
    : entries;
  return matched.slice(0, Math.max(1, limit));
}
