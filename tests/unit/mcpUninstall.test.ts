/**
 * `POST /api/mcp/uninstall` tiene que **persistir** la baja.
 *
 * `writeConfig` fusiona con `commander.json`: borrar el servidor en memoria y
 * reenviar `tools` dejaba la clave en el fichero y el servidor reaparecía en la
 * lectura siguiente. La baja viaja como `null`, que `deepMerge` interpreta como
 * borrado (la misma que usa la desinstalación de plugins).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uninstallMcpServer } from '../../src/mcp/uninstall';
import { getToolsConfig, resetConfig, writeConfig } from '../../src/config/index';

let root = '';
let previousCwd = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdr-mcp-uninstall-'));
  previousCwd = process.cwd();
  process.chdir(root);
  resetConfig();
});

afterEach(() => {
  process.chdir(previousCwd);
  resetConfig();
  fs.rmSync(root, { recursive: true, force: true });
});

function seedServers(servers: Record<string, { command: string; args?: string[] }>): void {
  writeConfig({ tools: { mcp: { enabled: true, servers } } } as any);
  resetConfig();
}

function serversInConfig(): Record<string, unknown> {
  const tools: any = getToolsConfig();
  return tools?.mcp?.servers ?? {};
}

describe('baja de un servidor MCP', () => {
  it('con dos servidores quita uno y lo deja fuera del fichero', () => {
    seedServers({
      db: { command: 'db-mcp', args: [] },
      kv: { command: 'kv-mcp', args: [] },
    });

    const result = uninstallMcpServer('db');

    expect(result).toEqual({ removed: true, remaining: 1, enabled: true });
    // Se relee del disco: si la baja sólo hubiera ocurrido en memoria, `db` volvería.
    resetConfig();
    expect(Object.keys(serversInConfig())).toEqual(['kv']);
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'commander.json'), 'utf8'));
    expect(Object.keys(onDisk.tools.mcp.servers)).toEqual(['kv']);
  });

  it('al quitar el último desactiva MCP y vacía la lista', () => {
    seedServers({ db: { command: 'db-mcp', args: [] } });

    const result = uninstallMcpServer('db');

    expect(result).toEqual({ removed: true, remaining: 0, enabled: false });
    resetConfig();
    const tools: any = getToolsConfig();
    expect(tools.mcp.enabled).toBe(false);
    expect(Object.keys(tools.mcp.servers ?? {})).toEqual([]);
  });

  it('un nombre que no existe no reescribe nada', () => {
    seedServers({ db: { command: 'db-mcp', args: [] } });
    const before = fs.readFileSync(path.join(root, 'commander.json'), 'utf8');

    const result = uninstallMcpServer('fantasma');

    expect(result).toEqual({ removed: false, remaining: 1, enabled: true });
    expect(fs.readFileSync(path.join(root, 'commander.json'), 'utf8')).toBe(before);
  });

  it('sin MCP configurado responde que no había nada', () => {
    const result = uninstallMcpServer('db');

    expect(result).toEqual({ removed: false, remaining: 0, enabled: false });
    expect(fs.existsSync(path.join(root, 'commander.json'))).toBe(false);
  });
});
