/**
 * Unit tests para el MCP Registry
 */
import { describe, it, expect } from 'vitest';
import { CommanderConfigSchema } from '../../src/config/schema';

describe('MCP Config Schema', () => {
  it('debe dejar MCP como opcional/undefined cuando tools está vacío', () => {
    const config = CommanderConfigSchema.parse({});
    // tools default es {} vacío → mcp no está definido
    expect(config.tools?.mcp).toBeUndefined();
  });

  it('debe deshabilitar MCP por defecto cuando se declara sin enabled', () => {
    const config = CommanderConfigSchema.parse({
      tools: { mcp: { servers: {} } },
    });
    expect(config.tools?.mcp?.enabled).toBe(false);
  });

  it('debe aceptar servidores MCP registrados', () => {
    const input: any = {
      tools: {
        mcp: {
          enabled: true,
          servers: {
            filesystem: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', '/project'],
            },
            git: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-git'],
            },
          },
        },
      },
    };
    const result = CommanderConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.data && result.data.tools?.mcp) {
      const servers = result.data.tools.mcp.servers;
      expect(Object.keys(servers!)).toContain('filesystem');
      expect(servers!.filesystem.command).toBe('npx');
      expect(servers!.filesystem.args).toContain('-y');
    }
  });

  it('debe aceptar variables de entorno opcionales por servidor', () => {
    const input: any = {
      tools: {
        mcp: {
          enabled: true,
          servers: {
            custom: {
              command: 'node',
              args: ['server.js'],
              env: { API_KEY: 'secret', DEBUG: 'true' },
            },
          },
        },
      },
    };
    const result = CommanderConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.data && result.data.tools?.mcp) {
      expect(result.data.tools.mcp.servers!.custom.env).toEqual({
        API_KEY: 'secret',
        DEBUG: 'true',
      });
    }
  });

  it('debe rechazar un servidor sin command', () => {
    const input: any = {
      tools: {
        mcp: {
          enabled: true,
          servers: {
            broken: { args: ['-y'] }, // falta command
          },
        },
      },
    };
    const result = CommanderConfigSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it('debe aplicar args=[] por defecto si no se pasa', () => {
    const input: any = {
      tools: { mcp: { enabled: true, servers: { simple: { command: 'node' } } } },
    };
    const result = CommanderConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.data && result.data.tools?.mcp) {
      expect(result.data.tools.mcp.servers!.simple.args).toEqual([]);
    }
  });
});

describe('MCP Auth Schema', () => {
  it('debe aceptar auth OAuth2 con PKCE (sin clientSecret)', () => {
    const input: any = {
      tools: {
        mcp: {
          enabled: true,
          servers: {
            remote: {
              command: 'npx',
              args: ['-y', 'remote-mcp'],
              auth: {
                type: 'oauth2',
                clientId: 'my-public-client',
                authorizeUrl: 'https://auth.example.com/authorize',
                tokenUrl: 'https://auth.example.com/token',
                scopes: ['mcp:read', 'mcp:write'],
              },
            },
          },
        },
      },
    };
    const result = CommanderConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.data && result.data.tools?.mcp) {
      const auth = result.data.tools.mcp.servers!.remote.auth;
      expect(auth?.type).toBe('oauth2');
      expect(auth?.clientId).toBe('my-public-client');
      expect(auth?.scopes).toContain('mcp:read');
      expect(auth?.clientSecret).toBeUndefined();
    }
  });

  it('debe aceptar auth bearer estático', () => {
    const input: any = {
      tools: {
        mcp: {
          enabled: true,
          servers: {
            static: {
              command: 'node',
              args: ['server.js'],
              auth: {
                type: 'bearer',
                clientId: 'unused',
                bearerToken: 'sk-test-12345',
              },
            },
          },
        },
      },
    };
    const result = CommanderConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.data && result.data.tools?.mcp) {
      const auth = result.data.tools.mcp.servers!.static.auth;
      expect(auth?.type).toBe('bearer');
      expect(auth?.bearerToken).toBe('sk-test-12345');
    }
  });

  it('debe rechazar auth type inválido', () => {
    const input: any = {
      tools: {
        mcp: {
          enabled: true,
          servers: {
            bad: { command: 'node', auth: { type: 'magic', clientId: 'x' } },
          },
        },
      },
    };
    const result = CommanderConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('debe rechazar auth OAuth2 sin clientId', () => {
    const input: any = {
      tools: {
        mcp: {
          enabled: true,
          servers: {
            bad: {
              command: 'node',
              auth: { type: 'oauth2', authorizeUrl: 'https://a.com/a', tokenUrl: 'https://a.com/t' },
            },
          },
        },
      },
    };
    const result = CommanderConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
