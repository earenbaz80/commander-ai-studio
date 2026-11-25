/**
 * Los plugins instalados viven en `skills/plugins/<id>/` (decisión de F4B,
 * criterio 4: no se mueven bajo `.commander/`), para que git pueda ignorar esa
 * carpeta entera sin ocultar las skills propias.
 *
 * Este caso fija las tres cosas que hacen verificable la decisión: la ruta sale
 * de una sola constante, el loader lee de ahí y el loader **no** lee de
 * `.commander`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAllSkills } from '../../skills/loader';
import { PLUGIN_SKILLS_DIR, pluginSkillsPath } from '../../skills/layout';

const creados: string[] = [];

afterEach(() => {
  delete process.env.SKILLS_ROOT;
  for (const dir of creados.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function rootTemporal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-skills-'));
  creados.push(dir);
  return dir;
}

const skillMarkdown = (id: string) =>
  ['---', `id: ${id}`, `name: ${id}`, 'type: command', 'description: demo', '---', '', '# Demo', ''].join('\n');

describe('descubrimiento de skills', () => {
  it('la ubicación del plugin sale de una constante: skills/plugins/<id>', () => {
    expect(PLUGIN_SKILLS_DIR).toBe('plugins');
    expect(pluginSkillsPath('/proyecto/skills', 'demo')).toBe(
      path.join('/proyecto/skills', 'plugins', 'demo'),
    );
  });

  it('carga las skills propias y las de un plugin instalado', async () => {
    const root = rootTemporal();
    process.env.SKILLS_ROOT = root;

    fs.mkdirSync(path.join(root, 'commands'), { recursive: true });
    fs.writeFileSync(path.join(root, 'commands', 'propia.md'), skillMarkdown('propia'), 'utf8');

    const pluginAgents = path.join(pluginSkillsPath(root, 'demo'), 'agents');
    fs.mkdirSync(pluginAgents, { recursive: true });
    fs.writeFileSync(path.join(pluginAgents, 'revisor.md'), skillMarkdown('demo/revisor'), 'utf8');

    const skills = await loadAllSkills();

    expect(skills.map((skill) => skill.id).sort()).toEqual(['demo/revisor', 'propia']);
  });

  it('no lee skills desde .commander: allí sólo vive el estado del plugin', async () => {
    const root = rootTemporal();
    process.env.SKILLS_ROOT = root;

    // Una copia bajo `.commander/plugins` no es una skill instalada: la
    // instalación nativa escribe en `skills/plugins` (la copia es el origen).
    const copia = path.join(root, '.commander', 'plugins', 'demo', 'commands');
    fs.mkdirSync(copia, { recursive: true });
    fs.writeFileSync(path.join(copia, 'fantasma.md'), skillMarkdown('demo/fantasma'), 'utf8');

    const skills = await loadAllSkills();

    expect(skills).toEqual([]);
  });

  it('el proyecto gana sobre el plugin cuando repiten id', async () => {
    const root = rootTemporal();
    process.env.SKILLS_ROOT = root;

    fs.mkdirSync(path.join(root, 'commands'), { recursive: true });
    fs.writeFileSync(path.join(root, 'commands', 'propia.md'), skillMarkdown('demo/revisor'), 'utf8');
    const pluginCommands = path.join(pluginSkillsPath(root, 'demo'), 'commands');
    fs.mkdirSync(pluginCommands, { recursive: true });
    fs.writeFileSync(
      path.join(pluginCommands, 'revisor.md'),
      skillMarkdown('demo/revisor').replace('Demo', 'Plugin'),
      'utf8',
    );

    const skills = await loadAllSkills();

    expect(skills.filter((skill) => skill.id === 'demo/revisor')).toHaveLength(1);
    expect(skills[0].format).toBe('commander');
    expect(skills[0].filePath).toContain(path.join('commands', 'propia.md'));
  });
});
