/**
 * Import de servidores MCP: un JSON corrupto no debe devolver el fragmento que
 * incluye el mensaje de `JSON.parse`, porque el archivo puede llevar `env` con
 * credenciales.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importMcpServersFromDir } from '../../src/mcp/index';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-mcp-import-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('importMcpServersFromDir', () => {
  it('no repite el contenido de un archivo JSON corrupto', () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'broken.json'),
      '{"env":{"API_KEY": sk-live-SECRETO}}',
      'utf8'
    );

    const result = importMcpServersFromDir(dir, {});

    expect(result.imported).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('broken.json');
    expect(result.errors[0]).toContain('configuración JSON inválida');
    expect(JSON.stringify(result)).not.toContain('sk-live-SECRETO');
    expect(JSON.stringify(result)).not.toContain('API_KEY');
  });

  it('importa los archivos válidos y sigue con los corruptos', () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'valid.mcp.json'),
      JSON.stringify({ command: 'node', args: ['server.js'], env: { API_KEY: 'x' } }),
      'utf8'
    );
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ roto', 'utf8');

    const servers: Record<string, unknown> = {};
    const result = importMcpServersFromDir(dir, servers);

    expect(result.imported).toBe(1);
    expect(servers.valid).toMatchObject({ command: 'node', args: ['server.js'] });
    expect(result.errors).toEqual(['broken.json: configuración JSON inválida']);
  });
});
