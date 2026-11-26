/**
 * Los tres formatos de skill y la validación del front matter (F4B).
 *
 *   1. `commander`: front matter completo (`id`, `name`, `type`, `description`).
 *   2. `claude-skill`: `skills/<slug>/SKILL.md` con `name`/`description`.
 *   3. `plugin-markdown`: `skills/plugins/<id>/{commands,agents}/<slug>.md`.
 *
 * Un archivo inválido no entra al catálogo: sin front matter, sin descripción,
 * con `type` desconocido o con un id que no es un slug.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAllSkills } from '../../skills/loader';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdr-skills-'));
  process.env.SKILLS_ROOT = root;
});

afterEach(() => {
  delete process.env.SKILLS_ROOT;
  fs.rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

const commanderSkill = [
  '---',
  'id: lint-typescript',
  'name: Lint TypeScript',
  'version: 1.0.0',
  'type: command',
  'description: Ejecuta tsc y eslint',
  'tags: [lint, typescript]',
  '---',
  '',
  '## Usage',
  'npm run typecheck',
].join('\n');

describe('formatos de skill', () => {
  it('carga los tres formatos y descarta los archivos inválidos', async () => {
    write('commands/lint.md', commanderSkill);

    // Formato de Claude: id = carpeta, sin `type`; descripción plegada.
    write(
      'redactor/SKILL.md',
      [
        '---',
        'name: redactor',
        'description: >',
        '  Redacta notas con una',
        '  descripción plegada.',
        'license: MIT',
        '---',
        '',
        '# Redactor',
      ].join('\n'),
    );

    // Comando de un plugin instalado: tipo por carpeta, id `<plugin>/<slug>`.
    write(
      'plugins/demo/agents/revisor.md',
      ['---', 'description: Revisa el diff antes de aprobar', '---', '', '# Revisor'].join('\n'),
    );

    // Inválidos: sin front matter, sin descripción, `type` desconocido, id roto.
    write('commands/sin-fm.md', '# Sin front matter\n');
    write(
      'commands/sin-desc.md',
      ['---', 'id: sin-desc', 'name: Sin descripción', 'type: command', '---', ''].join('\n'),
    );
    write(
      'commands/tipo-raro.md',
      ['---', 'id: tipo-raro', 'name: Raro', 'type: widget', 'description: nope', '---', ''].join('\n'),
    );
    write(
      'commands/id-roto.md',
      ['---', 'id: ../escape', 'name: Escape', 'type: command', 'description: nope', '---', ''].join('\n'),
    );

    const skills = await loadAllSkills();
    const byId = new Map(skills.map((skill) => [skill.id, skill]));

    expect([...byId.keys()].sort()).toEqual(['demo/revisor', 'lint-typescript', 'redactor']);
    expect(byId.get('lint-typescript')?.format).toBe('commander');
    expect(byId.get('lint-typescript')?.tags).toEqual(['lint', 'typescript']);
    expect(byId.get('redactor')?.format).toBe('claude-skill');
    expect(byId.get('redactor')?.description).toBe('Redacta notas con una descripción plegada.');
    expect(byId.get('redactor')?.type).toBe('command');
    expect(byId.get('demo/revisor')?.format).toBe('plugin-markdown');
    expect(byId.get('demo/revisor')?.type).toBe('agent');
    expect(byId.get('demo/revisor')?.name).toBe('revisor');

    // Los cuatro inválidos quedaron fuera, no cargados a medias.
    for (const id of ['sin-fm', 'sin-desc', 'tipo-raro', 'id-roto']) {
      expect(byId.has(id)).toBe(false);
    }
  });

  it('acepta front matter con saltos CRLF y no duplica ids entre proyecto y plugin', async () => {
    write('commands/dup.md', commanderSkill.replace(/\n/g, '\r\n'));
    // El plugin declara el mismo id: gana el proyecto y no hay dos entradas.
    write(
      'plugins/demo/commands/dup.md',
      ['---', 'id: lint-typescript', 'name: Copia', 'type: command', 'description: Copia del plugin', '---', ''].join('\n'),
    );

    const skills = await loadAllSkills();
    const dup = skills.filter((skill) => skill.id === 'lint-typescript');

    expect(dup).toHaveLength(1);
    expect(dup[0].description).toBe('Ejecuta tsc y eslint');
    expect(dup[0].filePath).toContain(path.join('commands', 'dup.md'));
  });
});
