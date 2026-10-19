/**
 * Unit tests para MCP OAuth (status y bearer token, sin red).
 * El flujo OAuth2 completo requiere HTTP mock; aquí probamos la config
 * y el estado derivado (bearer + ausencia de auth).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeConfig, resetConfig } from '../../src/config/index';
import { getMcpAuthStatus, getMcpAccessToken } from '../../src/mcp/oauth';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-oauth-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  resetConfig();
});

afterEach(() => {
  process.chdir(originalCwd);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignorar */
  }
  resetConfig();
});

describe('MCP OAuth - status', () => {
  it('servidor sin auth configurado → no autenticado, type null', () => {
    writeConfig({
      tools: { mcp: { enabled: true, servers: { plain: { command: 'node' } } } },
    });
    resetConfig();

    const status = getMcpAuthStatus('plain');
    expect(status.authenticated).toBe(false);
    expect(status.type).toBeNull();
  });

  it('servidor inexistente → no autenticado, type null', () => {
    const status = getMcpAuthStatus('no-existe');
    expect(status.authenticated).toBe(false);
    expect(status.type).toBeNull();
  });

  it('servidor bearer con token → autenticado', () => {
    writeConfig({
      tools: {
        mcp: {
          enabled: true,
          servers: {
            api: {
              command: 'node',
              auth: { type: 'bearer', clientId: 'x', bearerToken: 'sk-abc' },
            },
          },
        },
      },
    });
    resetConfig();

    const status = getMcpAuthStatus('api');
    expect(status.authenticated).toBe(true);
    expect(status.type).toBe('bearer');
  });

  it('servidor bearer sin token → no autenticado', () => {
    writeConfig({
      tools: {
        mcp: {
          enabled: true,
          servers: { api: { command: 'node', auth: { type: 'bearer', clientId: 'x' } } },
        },
      },
    });
    resetConfig();

    const status = getMcpAuthStatus('api');
    expect(status.authenticated).toBe(false);
    expect(status.type).toBe('bearer');
  });

  it('servidor OAuth2 sin token almacenado → no autenticado', () => {
    writeConfig({
      tools: {
        mcp: {
          enabled: true,
          servers: {
            oauth: {
              command: 'node',
              auth: {
                type: 'oauth2',
                clientId: 'cid',
                authorizeUrl: 'https://a.com/auth',
                tokenUrl: 'https://a.com/token',
              },
            },
          },
        },
      },
    });
    resetConfig();

    const status = getMcpAuthStatus('oauth');
    expect(status.authenticated).toBe(false);
    expect(status.type).toBe('oauth2');
  });
});

describe('MCP OAuth - getMcpAccessToken', () => {
  it('bearer devuelve el token estático', async () => {
    writeConfig({
      tools: {
        mcp: {
          enabled: true,
          servers: { api: { command: 'node', auth: { type: 'bearer', clientId: 'x', bearerToken: 'sk-xyz' } } },
        },
      },
    });
    resetConfig();

    const token = await getMcpAccessToken('api');
    expect(token).toBe('sk-xyz');
  });

  it('sin auth → null', async () => {
    writeConfig({ tools: { mcp: { enabled: true, servers: { plain: { command: 'node' } } } } });
    resetConfig();

    const token = await getMcpAccessToken('plain');
    expect(token).toBeNull();
  });

  it('OAuth2 sin token almacenado → null', async () => {
    writeConfig({
      tools: {
        mcp: {
          enabled: true,
          servers: {
            oauth: {
              command: 'node',
              auth: { type: 'oauth2', clientId: 'cid', authorizeUrl: 'https://a.com/auth', tokenUrl: 'https://a.com/token' },
            },
          },
        },
      },
    });
    resetConfig();

    const token = await getMcpAccessToken('oauth');
    expect(token).toBeNull();
  });
});
