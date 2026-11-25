/**
 * Skill Loader (P1 #9) - Carga skills desde archivos Markdown.
 *
 * Lee skills desde el directorio `skills/` y los parsea (front-matter YAML + cuerpo).
 *
 * Formatos soportados (F4B):
 *   1. `commander`: front matter completo (`id`, `name`, `type`, `description`),
 *      el de `skills/commands`, `skills/agents` y `skills/templates`.
 *   2. `claude-skill`: `skills/<slug>/SKILL.md` con `name` y `description`
 *      (más `license`/`argument-hint` opcionales). El id sale de la carpeta.
 *   3. `plugin-markdown`: `<slug>.md` de `skills/plugins/<id>/{commands,agents}`;
 *      el tipo sale de la carpeta y el id del front matter o `<plugin>/<slug>`.
 *
 * Un archivo inválido (sin front matter, sin `description`, `type` desconocido o
 * id imposible) no se carga: se descarta en vez de entrar al catálogo con
 * campos inventados.
 */

import fs from 'fs';
import path from 'path';
import { PLUGIN_SKILLS_DIR } from './layout';

export interface SkillParameter {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description: string;
}

export type SkillFormat = 'commander' | 'claude-skill' | 'plugin-markdown';

const SKILL_TYPES = ['command', 'agent', 'template'] as const;

type SkillType = (typeof SKILL_TYPES)[number];

export interface Skill {
  id: string;
  name: string;
  version: string;
  type: SkillType;
  description: string;
  author: string;
  tags: string[];
  permissions: string[];
  requires: string[];
  // Front-matter extendido
  parameters: SkillParameter[];
  // Secciones del cuerpo
  descriptionLong: string;
  usage: string;
  implementation: string;
  examples: string;
  rawMarkdown: string;
  // Metadatos de archivo
  filePath: string;
  /** Formato del que salió: permite auditar qué se cargó y de dónde. */
  format: SkillFormat;
}

/** Un id es un slug; los plugins lo prefijan (`<plugin>/<slug>`). */
const SKILL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

/**
 * Directorio base de skills (configurable por env).
 */
function skillsRoot(): string {
  return process.env.SKILLS_ROOT || path.join(process.cwd(), 'skills');
}

type FrontMatter = Record<string, unknown>;

/**
 * Parsea front-matter YAML de un archivo Markdown.
 *
 * Subconjunto suficiente para los tres formatos: escalares, listas en línea
 * (`[a, b]`) y en bloque, y escalares plegados (`>`/`|`, como el `description`
 * multilínea de los SKILL.md). Las claves anidadas (`metadata:`) se ignoran.
 * Acepta `\r\n` porque el checkout de Windows los entrega así.
 */
function parseFrontMatter(content: string): { frontMatter: FrontMatter; body: string } | null {
  const normalized = content.replace(/\r\n/g, '\n');
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm: FrontMatter = {};
  let key = '';
  let block: string[] | null = null;
  let list: string[] | null = null;

  const flush = () => {
    if (!key) return;
    if (block) fm[key] = block.join(' ').replace(/\s+/g, ' ').trim();
    else if (list) fm[key] = list;
    block = null;
    list = null;
  };

  for (const line of fmMatch[1].split('\n')) {
    if (!line.trim()) {
      if (block) block.push('');
      continue;
    }
    if (block && /^\s/.test(line)) {
      block.push(line.trim());
      continue;
    }
    if (list && /^\s*-\s+/.test(line)) {
      list.push(line.replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''));
      continue;
    }
    // Clave anidada de un objeto que no forma parte del subconjunto.
    if (/^\s/.test(line)) continue;

    flush();
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    key = match[1];
    const value = match[2].trim();
    if (value === '>' || value === '|') {
      block = [];
      continue;
    }
    if (!value) {
      list = [];
      continue;
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      fm[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      continue;
    }
    fm[key] = value.replace(/^["']|["']$/g, '');
  }
  flush();

  return {
    frontMatter: fm,
    body: normalized.slice(fmMatch[0].length).trim(),
  };
}

/**
 * Extrae secciones del cuerpo Markdown por encabezados ##.
 */
function parseBodySections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const headingRegex = /^##\s+(.+)$/gm;
  let lastMatch: RegExpExecArray | null = null;
  let lastHeading = '';
  let lastIndex = 0;
  while ((lastMatch = headingRegex.exec(body)) !== null) {
    const heading = lastMatch[1].trim();
    const start = lastMatch.index + lastMatch[0].length;
    if (lastHeading) {
      sections[lastHeading.toLowerCase()] = body.slice(lastIndex, lastMatch.index).trim();
    }
    lastHeading = heading;
    lastIndex = start;
  }
  if (lastHeading) {
    sections[lastHeading.toLowerCase()] = body.slice(lastIndex).trim();
  }
  return sections;
}

/**
 * Parsea parámetros desde tabla Markdown o lista.
 */
function parseParameters(section: string): SkillParameter[] {
  const params: SkillParameter[] = [];
  // Intenta tabla Markdown
  const tableRegex = /^\|?\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|?$/gm;
  let match: RegExpExecArray | null;
  let isHeader = true;
  while ((match = tableRegex.exec(section)) !== null) {
    if (isHeader) { isHeader = false; continue; }
    const [, name, type, required, defaultVal, desc] = match;
    params.push({
      name: name.trim(),
      type: type.trim(),
      required: required.trim().toLowerCase() === 'sí' || required.trim().toLowerCase() === 'yes' || required.trim() === 'true',
      default: defaultVal.trim() === '-' ? undefined : defaultVal.trim(),
      description: desc.trim(),
    });
  }
  return params;
}

/** Texto de un campo del front matter, recortado y sin comillas. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/^["']|["']$/g, '').trim() : '';
}

/** Lista de strings: acepta `[a, b]`, bloque o un escalar suelto. */
function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  const single = text(value);
  return single ? [single] : [];
}

export interface SkillFileContext {
  /** Tipo que impone la carpeta (`commands`, `agents`, `templates`). */
  folderType?: SkillType;
  /** Slug de la carpeta, para los ids que no están en el front matter. */
  fallbackId?: string;
  /** Prefijo del plugin instalado (`<plugin>/<slug>`). */
  pluginId?: string;
}

/**
 * Normaliza y valida un skill.
 *
 * Devuelve `null` si el archivo no es un skill válido: sin front matter, sin
 * `description`, con `type` desconocido o con un id que no es un slug.
 */
export function normalizeSkill(
  content: string,
  filePath: string,
  context: SkillFileContext = {},
): Skill | null {
  const parsed = parseFrontMatter(content);
  if (!parsed) return null;

  const { frontMatter: fm, body } = parsed;
  const isSkillMd = path.basename(filePath).toLowerCase() === 'skill.md';
  const explicitId = text(fm.id);
  const name = text(fm.name);
  const description = text(fm.description);
  const declaredType = text(fm.type);

  if (declaredType && !SKILL_TYPES.includes(declaredType as SkillType)) return null;

  // El id explícito manda; si no hay, la carpeta (SKILL.md) o el slug del
  // archivo (`commands/mi-orden.md`), con el plugin por delante.
  const fallbackId = context.fallbackId || path.basename(filePath, path.extname(filePath)).toLowerCase();
  const id = explicitId || (context.pluginId ? `${context.pluginId}/${fallbackId}` : fallbackId);
  if (!SKILL_ID_RE.test(id)) return null;

  // Los tres formatos comparten la exigencia de descripción: es lo que ve el
  // modelo al elegir la skill, y una sin ella no aporta nada al catálogo.
  if (!description) return null;

  const format: SkillFormat =
    explicitId && declaredType ? 'commander' : isSkillMd ? 'claude-skill' : 'plugin-markdown';

  // `commander` es el formato estricto: si declara id y type, declara nombre.
  if (format === 'commander' && !name) return null;

  const type = (declaredType as SkillType | '') || context.folderType || 'command';
  const sections = parseBodySections(body);

  return {
    id,
    name: name || id.split('/').pop() || id,
    version: text(fm.version) || '1.0.0',
    type,
    description,
    author: text(fm.author),
    tags: asList(fm.tags),
    permissions: asList(fm.permissions),
    requires: asList(fm.requires),
    parameters: parseParameters(sections.parameters || ''),
    descriptionLong: sections.description || '',
    usage: sections.usage || '',
    implementation: sections.implementation || '',
    examples: sections.examples || '',
    rawMarkdown: content,
    filePath,
    format,
  };
}

/**
 * Carga un skill individual desde archivo.
 */
export async function loadSkill(filePath: string, context: SkillFileContext = {}): Promise<Skill | null> {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  return normalizeSkill(content, filePath, context);
}

/** Carpetas con las que se clasifica cada skill. */
const SKILL_CATEGORIES = [
  ['commands', 'command'],
  ['agents', 'agent'],
  ['templates', 'template'],
] as const;

/** Markdown de una carpeta, vacío si no existe. */
function markdownFilesIn(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith('.md'))
    .map((file) => path.join(dirPath, file));
}

/** Carpetas de primer nivel con `SKILL.md` (formato de Claude). */
function skillMdFilesIn(root: string): Array<{ file: string; slug: string }> {
  const found: Array<{ file: string; slug: string }> = [];
  if (!fs.existsSync(root)) return found;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // `commands`, `agents`, `templates` y `plugins` tienen su propio barrido.
    if (
      entry.name === PLUGIN_SKILLS_DIR ||
      SKILL_CATEGORIES.some(([dir]) => dir === entry.name)
    ) continue;
    const file = path.join(root, entry.name, 'SKILL.md');
    if (fs.existsSync(file)) found.push({ file, slug: entry.name.toLowerCase() });
  }
  return found;
}

/**
 * Carga todos los skills del directorio `skills/`.
 *
 * Los plugins instalados viven cada uno en `skills/plugins/<id>/<categoría>/`,
 * separados de las skills propias: así git puede ignorar `skills/plugins/`
 * entero sin ocultar lo que sí forma parte del proyecto. Si dos archivos
 * declaran el mismo id gana el primero que se lee (proyecto antes que plugin),
 * así un plugin no reemplaza una skill propia.
 */
export async function loadAllSkills(): Promise<Skill[]> {
  const root = skillsRoot();
  const skills: Skill[] = [];
  const seen = new Set<string>();

  const add = (skill: Skill | null) => {
    if (!skill || seen.has(skill.id)) return;
    seen.add(skill.id);
    skills.push(skill);
  };

  for (const [dir, folderType] of SKILL_CATEGORIES) {
    for (const file of markdownFilesIn(path.join(root, dir))) {
      add(await loadSkill(file, { folderType }));
    }
  }

  for (const { file, slug } of skillMdFilesIn(root)) {
    add(await loadSkill(file, { folderType: 'command', fallbackId: slug }));
  }

  const pluginsRoot = path.join(root, PLUGIN_SKILLS_DIR);
  if (fs.existsSync(pluginsRoot)) {
    for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginId = entry.name.toLowerCase();
      for (const [dir, folderType] of SKILL_CATEGORIES) {
        for (const file of markdownFilesIn(path.join(pluginsRoot, entry.name, dir))) {
          add(
            await loadSkill(file, {
              folderType,
              fallbackId: path.basename(file, '.md').toLowerCase(),
              pluginId,
            }),
          );
        }
      }
      for (const { file, slug } of skillMdFilesIn(path.join(pluginsRoot, entry.name))) {
        add(await loadSkill(file, { folderType: 'command', fallbackId: slug, pluginId }));
      }
    }
  }

  return skills;
}

/**
 * Busca skill por ID.
 */
export async function findSkillById(id: string): Promise<Skill | null> {
  const skills = await loadAllSkills();
  return skills.find(s => s.id === id) || null;
}

/**
 * Filtra skills por tag.
 */
export async function findSkillsByTag(tag: string): Promise<Skill[]> {
  const skills = await loadAllSkills();
  return skills.filter(s => s.tags.includes(tag));
}

/**
 * Filtra skills por tipo.
 */
export async function findSkillsByType(type: 'command' | 'agent' | 'template'): Promise<Skill[]> {
  const skills = await loadAllSkills();
  return skills.filter(s => s.type === type);
}
