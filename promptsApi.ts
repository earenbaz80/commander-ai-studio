/**
 * Comandos y agentes del proyecto.
 *
 * Un `.md` en `.commander/commands` o `.commander/agents` se ofrece en el chat:
 * el comando expande el objetivo y el agente añade sus instrucciones. El
 * front-matter es opcional (`name`, `description`); el id sale del nombre del
 * fichero para que `/revisar` funcione sin configurar nada.
 */
import fs from 'fs';
import path from 'path';

export interface ProjectPrompt {
  id: string;
  name: string;
  description: string;
  body: string;
}

const MAX_FILES = 50;
const MAX_BODY = 8000;

/** Separa el front-matter opcional del cuerpo, tolerando CRLF. */
export function parsePromptFile(raw: string): { meta: Record<string, string>; body: string } {
  const text = String(raw ?? '').replace(/\r\n/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { meta: {}, body: text.trim() };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
    if (key && value) meta[key] = value;
  }
  return { meta, body: text.slice(match[0].length).trim() };
}

function readPrompts(dir: string): ProjectPrompt[] {
  if (!fs.existsSync(dir)) return [];
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((file) => file.toLowerCase().endsWith('.md'))
      .slice(0, MAX_FILES);
  } catch {
    return [];
  }
  const out: ProjectPrompt[] = [];
  for (const file of files) {
    try {
      const { meta, body } = parsePromptFile(fs.readFileSync(path.join(dir, file), 'utf8'));
      const id = file
        .replace(/\.md$/i, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-');
      if (!id || !body) continue;
      out.push({
        id,
        name: meta.name || id,
        description: meta.description || '',
        body: body.slice(0, MAX_BODY),
      });
    } catch {
      /* fichero ilegible: se ignora */
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Lee los `.md` del proyecto (`.commander/commands` y `.commander/agents`). */
export function listProjectPrompts(root: string): {
  commands: ProjectPrompt[];
  agents: ProjectPrompt[];
} {
  const base = path.join(String(root || '.'), '.commander');
  return {
    commands: readPrompts(path.join(base, 'commands')),
    agents: readPrompts(path.join(base, 'agents')),
  };
}
