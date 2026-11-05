/**
 * Skill Loader (P1 #9) - Carga skills desde archivos Markdown.
 *
 * Lee skills desde el directorio `skills/` y los parsea (front-matter YAML + cuerpo).
 */

import fs from 'fs';
import path from 'path';

export interface SkillParameter {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description: string;
}

export interface Skill {
  id: string;
  name: string;
  version: string;
  type: 'command' | 'agent' | 'template';
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
}

interface FrontMatter {
  id: string;
  name: string;
  version: string;
  type: 'command' | 'agent' | 'template';
  description: string;
  author: string;
  tags: string[];
  permissions: string[];
  requires: string[];
  parameters: SkillParameter[];
  [key: string]: unknown;
}

/**
 * Directorio base de skills (configurable por env).
 */
function skillsRoot(): string {
  return process.env.SKILLS_ROOT || path.join(process.cwd(), 'skills');
}

/**
 * Parsea front-matter YAML de un archivo Markdown.
 */
function parseFrontMatter(content: string): { frontMatter: FrontMatter; body: string } | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  try {
    const yaml = fmMatch[1];
    // Parser YAML simple (solo subconjunto necesario)
    const fm: Partial<FrontMatter> = {};
    const lines = yaml.split('\n');
    let inArray = false;
    let arrayKey = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('- ')) {
        if (inArray && arrayKey) {
          (fm as any)[arrayKey] = ((fm as any)[arrayKey] || []).concat(trimmed.slice(2).trim());
        }
        continue;
      }
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        let value: unknown = trimmed.slice(colonIdx + 1).trim();
        // Quita comillas
        if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (typeof value === 'string' && value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        // Detecta array
        if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
        }
        (fm as Record<string, unknown>)[key] = value;
      }
    }
    return {
      frontMatter: fm as FrontMatter,
      body: content.slice(fmMatch[0].length).trim(),
    };
  } catch {
    return null;
  }
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

/**
 * Carga un skill individual desde archivo.
 */
export async function loadSkill(filePath: string): Promise<Skill | null> {
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = parseFrontMatter(content);
  if (!parsed) return null;
  const { frontMatter, body } = parsed;
  const sections = parseBodySections(body);
  const params = parseParameters(sections.parameters || '');
  return {
    ...frontMatter,
    parameters: params,
    descriptionLong: sections.description || '',
    usage: sections.usage || '',
    implementation: sections.implementation || '',
    examples: sections.examples || '',
    rawMarkdown: content,
    filePath,
    type: frontMatter.type,
  } as Skill;
}

/** Carpetas con las que se clasifica cada skill. */
const SKILL_CATEGORIES = ['commands', 'agents', 'templates'] as const;

/** Markdown de una carpeta, vacío si no existe. */
function markdownFilesIn(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith('.md'))
    .map((file) => path.join(dirPath, file));
}

/**
 * Carga todos los skills del directorio `skills/`.
 *
 * Los plugins instalados viven cada uno en `skills/plugins/<id>/<categoría>/`,
 * separados de las skills propias: así git puede ignorar `skills/plugins/`
 * entero sin ocultar lo que sí forma parte del proyecto.
 */
export async function loadAllSkills(): Promise<Skill[]> {
  const root = skillsRoot();
  const files: string[] = [];

  for (const dir of SKILL_CATEGORIES) {
    files.push(...markdownFilesIn(path.join(root, dir)));
  }

  const pluginsRoot = path.join(root, 'plugins');
  if (fs.existsSync(pluginsRoot)) {
    for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const dir of SKILL_CATEGORIES) {
        files.push(...markdownFilesIn(path.join(pluginsRoot, entry.name, dir)));
      }
    }
  }

  const skills: Skill[] = [];
  for (const file of files) {
    const skill = await loadSkill(file);
    if (skill) skills.push(skill);
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