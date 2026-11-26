/**
 * Instalación/desinstalación con MCP y manifiesto corrupto (F4B).
 *
 * El manifiesto es la fuente normal de lo que hay que borrar, pero no la única:
 * la instalación deja un sidecar `<id>.mcp.json` con los servidores que tocó y
 * una carpeta `skills/plugins/<id>`. Sin esos dos, un manifiesto corrupto dejaba
 * servidores MCP configurados y skills copiadas para siempre.
 *
 * La contraparte es el confinamiento: nada fuera de `skills/` o
 * `.commander/plugins/` se borra, aunque el manifiesto lo pida con `..`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uninstallInstalledPlugin } from '../../src/plugins/uninstall';
import { getToolsConfig, resetConfig, writeConfig } from '../../src/config/index';

let root = '';
let previousCwd = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdr-uninstall-'));
  previousCwd = process.cwd();
  process.chdir(root);
  resetConfig();
});

afterEach(() => {
  process.chdir(previousCwd);
  resetConfig();
  fs.rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function serversInConfig(): Record<string, unknown> {
  const tools: any = getToolsConfig();
  return tools?.mcp?.servers ?? {};
}

describe('desinstalación de un plugin instalado', () => {
  it('con el manifiesto corrupto usa el sidecar y no deja servidores MCP huérfanos', () => {
    write('.commander/plugins/analytics.manifest.json', '{ esto no es json');
    write('.commander/plugins/analytics.mcp.json', JSON.stringify({ servers: ['db', 'kv'] }));
    write('.commander/plugins/analytics/index.js', 'export default {};');
    write('skills/plugins/analytics/commands/reporte.md', '# Reporte');
    // Archivo ajeno al plugin: debe sobrevivir.
    write('skills/commands/propia.md', '# Propia');

    writeConfig({
      tools: {
        mcp: {
          servers: {
            db: { command: 'db-mcp', args: [] },
            kv: { command: 'kv-mcp', args: [] },
            otro: { command: 'otro-mcp', args: [] },
          },
        },
      },
    } as any);
    resetConfig();
    expect(Object.keys(serversInConfig()).sort()).toEqual(['db', 'kv', 'otro']);

    const result = uninstallInstalledPlugin('analytics', { root: process.cwd() });

    expect(result.id).toBe('analytics');
    // Los dos servidores del sidecar salen; el que no era del plugin se queda.
    expect(result.mcpServers.sort()).toEqual(['db', 'kv']);
    expect(Object.keys(serversInConfig())).toEqual(['otro']);

    // Nada del plugin sobrevive; lo ajeno sí.
    expect(fs.existsSync(path.join(root, '.commander/plugins/analytics.manifest.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.commander/plugins/analytics.mcp.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.commander/plugins/analytics'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'skills/plugins/analytics'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'skills/commands/propia.md'), 'utf8')).toBe('# Propia');
  });

  it('con manifiesto válido borra lo declarado y nunca sale de sus carpetas', () => {
    const outside = path.join(root, '..', `fuera-${path.basename(root)}.txt`);
    fs.writeFileSync(outside, 'no tocar', 'utf8');

    write(
      '.commander/plugins/demo.manifest.json',
      JSON.stringify({
        id: 'demo',
        components: { commands: ['uno'], mcp: ['buscar'] },
        // La primera ruta intenta escapar con `..`; la segunda es legítima.
        written: ['../' + path.basename(outside), 'skills/plugins/demo/commands/uno.md'],
      }),
    );
    write('skills/commands/uno.md', '# Uno');
    write('skills/plugins/demo/commands/uno.md', '# Uno (plugin)');
    write('skills/commands/ajena.md', '# Ajena');

    writeConfig({
      tools: { mcp: { servers: { buscar: { command: 'buscar-mcp', args: [] } } } },
    } as any);
    resetConfig();

    const result = uninstallInstalledPlugin('demo', { root: process.cwd() });

    expect(result.mcpServers).toEqual(['buscar']);
    expect(serversInConfig()).toEqual({});
    expect(fs.existsSync(path.join(root, 'skills/commands/uno.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'skills/plugins/demo'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'skills/commands/ajena.md'))).toBe(true);
    // El `..` del manifiesto no sacó el borrado de `skills/`.
    expect(fs.readFileSync(outside, 'utf8')).toBe('no tocar');
    fs.rmSync(outside, { force: true });
  });

  it('sin nada instalado no falla y no toca la config', () => {
    writeConfig({ tools: { mcp: { servers: { otro: { command: 'x', args: [] } } } } } as any);
    resetConfig();

    const result = uninstallInstalledPlugin('inexistente', { root: process.cwd() });

    expect(result).toEqual({ id: 'inexistente', removed: [], mcpServers: [] });
    expect(Object.keys(serversInConfig())).toEqual(['otro']);
  });
});
