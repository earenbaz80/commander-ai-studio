/**
 * Cuando `spawnSync` no puede lanzar el comando de un servidor MCP, su error
 * repite el valor recibido. Ese valor es `command` o un `args[i]` de la config,
 * así que `/api/mcp/health` no debe devolverlo.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mcpHealthError } from '../../src/mcp/index';

const SECRET = 'secreto-en-argumento-4d2a8f';

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
