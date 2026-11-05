/**
 * Los plugins instalados escriben en `skills/plugins/<id>/` para que git pueda
 * ignorar esa carpeta entera sin ocultar las skills propias. Este caso fija que
 * el loader lee las dos ubicaciones.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAllSkills } from '../../skills/loader';

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
  it('carga las skills propias y las de un plugin instalado', async () => {
    const root = rootTemporal();
    process.env.SKILLS_ROOT = root;

    fs.mkdirSync(path.join(root, 'commands'), { recursive: true });
    fs.writeFileSync(path.join(root, 'commands', 'propia.md'), skillMarkdown('propia'), 'utf8');

    const pluginAgents = path.join(root, 'plugins', 'demo', 'agents');
    fs.mkdirSync(pluginAgents, { recursive: true });
    fs.writeFileSync(path.join(pluginAgents, 'revisor.md'), skillMarkdown('demo/revisor'), 'utf8');

    const skills = await loadAllSkills();

    expect(skills.map((skill) => skill.id).sort()).toEqual(['demo/revisor', 'propia']);
  });
});
