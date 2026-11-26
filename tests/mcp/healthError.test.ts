/**
 * Cuando `spawnSync` no puede lanzar el comando de un servidor MCP, su error
 * repite el valor recibido. Ese valor es `command` o un `args[i]` de la config,
 * así que `/api/mcp/health` no debe devolverlo.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mcpHealthDetails, mcpHealthError } from '../../src/mcp/index';
import { loadConfig } from '../../src/config/index';

const SECRET = 'secreto-en-argumento-4d2a8f';

const previousDetailsSecret = process.env.MCP_HEALTH_DETAILS_SECRET;

afterEach(() => {
  if (previousDetailsSecret === undefined) delete process.env.MCP_HEALTH_DETAILS_SECRET;
  else process.env.MCP_HEALTH_DETAILS_SECRET = previousDetailsSecret;
});

describe('mcpHealthError', () => {
  it('no repite el argumento que provocó el fallo y mantiene el motivo', () => {
    let thrown: unknown;
    try {
      spawnSync(process.execPath, ['-e', 'x', `--token=${SECRET}\u0000`]);
    } catch (err) {
      thrown = err;
    }

    const message = mcpHealthError(thrown);

    expect(message).toContain('must be a string without null bytes');
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain('Received');
  });

  it('tampoco repite un comando con contenido de la config', () => {
    let thrown: unknown;
    try {
      spawnSync(`node\u0000${SECRET}`, []);
    } catch (err) {
      thrown = err;
    }

    const message = mcpHealthError(thrown);

    expect(message).toContain('must be a string without null bytes');
    expect(message).not.toContain(SECRET);
  });

  it('deja intactos los errores que no repiten el valor', () => {
    expect(mcpHealthError(new Error('spawn EACCES'))).toBe('spawn EACCES');
    expect(mcpHealthError('fallo desconocido')).toBe('fallo desconocido');
  });
});

describe('mcpHealthDetails', () => {
  it('redacta una credencial si un mensaje futuro la repite', () => {
    const secret = 'credencial-de-detalle-7c1e';
    process.env.MCP_HEALTH_DETAILS_SECRET = secret;

    const details = mcpHealthDetails(new Error(`falló con ${secret}`));

    expect(details).toContain('[redactado]');
    expect(details).not.toContain(secret);
  });

  it('el detalle de una config inválida lleva la ruta, no el valor', () => {
    const secret = 'sk-live-ABCDEFGH12345678';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-health-details-'));
    fs.writeFileSync(
      path.join(dir, 'commander.json'),
      JSON.stringify({ ui: { theme: secret } }),
      'utf8'
    );

    let thrown: unknown;
    try {
      loadConfig({ cwd: dir, skipCache: true });
    } catch (err) {
      thrown = err;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    const details = mcpHealthDetails(thrown);

    expect(details).toContain('Invalid configuration');
    expect(details).toContain('ui');
    expect(details).toContain('theme');
    expect(details).not.toContain(secret);
  });
});
