import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getToolsConfig, writeConfig } from '../config/index.js';
import { listServerTools, callServerTool } from './client.js';
import {
  startMcpOAuth,
  handleMcpOAuthCallback,
  getMcpAuthStatus,
  logoutMcp,
} from './oauth.js';

/**
 * MCP Registry API endpoints (Express Router).
 *
 * Endpoints (montados bajo /api/mcp):
 * - GET  /list       - List configured servers
 * - POST /install    - Register a new MCP server
 * - POST /uninstall  - Unregister an MCP server
 * - GET  /health     - Health check for all MCP servers
 */

export const mcpRouter = Router();

type McpServer = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

type McpConfig = {
  enabled: boolean;
  servers?: Record<string, McpServer>;
};

/**
 * Devuelve (y si hace falta inicializa) la config MCP dentro de tools.
 */
function getMcp(tools: ReturnType<typeof getToolsConfig>): McpConfig {
  if (!tools.mcp) {
    tools.mcp = { enabled: true, servers: {} };
  } else if (!tools.mcp.servers) {
    tools.mcp.servers = {};
  }
  return tools.mcp;
}

/**
 * Lista de servidores MCP configurados.
 */
mcpRouter.get('/list', (_req, res) => {
  try {
    const tools = getToolsConfig();
    const mcp = tools.mcp;

    if (!mcp || mcp.enabled === false) {
      return res.json({ enabled: false, servers: [], total: 0 });
    }

    const servers = mcp.servers || {};
    const serverList = Object.entries(servers).map(([name, cfg]) => ({
      name,
      command: cfg.command,
      args: cfg.args || [],
      env: cfg.env || {},
    }));

    res.json({ enabled: mcp.enabled, servers: serverList, total: serverList.length });
  } catch (err) {
    console.error('[MCP] list failed:', err);
    res.status(500).json({ error: 'Failed to list MCP servers' });
  }
});

/**
 * Registra un nuevo servidor MCP.
 * body: { name: string, command: string, args?: string[], env?: object }
 */
mcpRouter.post('/install', (req, res) => {
  try {
    const { name, command, args = [], env, auth } = req.body ?? {};

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name (string) is required' });
    }
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: 'command (string) is required' });
    }

    const tools = getToolsConfig();
    const mcp = getMcp(tools);
    mcp.enabled = true;

    mcp.servers![name] = {
      command,
      args: Array.isArray(args) ? args : [],
      ...(env && typeof env === 'object' ? { env } : {}),
      ...(auth && typeof auth === 'object' && auth.type ? { auth } : {}),
    };

    writeConfig({ tools }, 'project');

    res.json({ success: true, name, command, message: `Server "${name}" registered` });
  } catch (err) {
    console.error('[MCP] install failed:', err);
    res.status(500).json({ error: 'Failed to install MCP server' });
  }
});

/**
 * Elimina un servidor MCP.
 * body: { name: string }
 */
mcpRouter.post('/uninstall', (req, res) => {
  try {
    const { name } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name (string) is required' });
    }

    const tools = getToolsConfig();
    if (!tools.mcp?.servers || !tools.mcp.servers[name]) {
      return res.json({ success: true, message: `No server named "${name}"` });
    }

    delete tools.mcp.servers[name];

    // Si no quedan servidores, desactiva MCP para no dejar config vacía.
    if (Object.keys(tools.mcp.servers).length === 0) {
      tools.mcp.enabled = false;
    }

    writeConfig({ tools }, 'project');

    res.json({ success: true, name, message: `Server "${name}" unregistered` });
  } catch (err) {
    console.error('[MCP] uninstall failed:', err);
    res.status(500).json({ error: 'Failed to uninstall MCP server' });
  }
});

/**
 * Importa servidores MCP desde una carpeta externa (ej. .config/mcp o similar).
 * body: { sourceDir: string }
 */
mcpRouter.post('/import', (req, res) => {
  try {
    const { sourceDir } = req.body ?? {};
    if (!sourceDir || typeof sourceDir !== 'string') {
      return res.status(400).json({ error: 'sourceDir (string) is required' });
    }
    // Lee archivos de configuración MCP del directorio origen
    const importPath = path.resolve(process.cwd(), sourceDir);
    if (!fs.existsSync(importPath)) {
      return res.status(400).json({ error: 'sourceDir no existe' });
    }
    const tools = getToolsConfig();
    const mcp = getMcp(tools);
    mcp.enabled = true;
    let imported = 0;
    const errors: string[] = [];
    try {
      const entries = fs.readdirSync(importPath);
      for (const entry of entries) {
        const fullPath = path.join(importPath, entry);
        if (!fs.statSync(fullPath).isFile()) continue;
        if (entry.endsWith('.json') || entry.endsWith('.mcp.json')) {
          try {
            const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            if (content.mcpServers) {
              for (const [name, cfg] of Object.entries(content.mcpServers)) {
                mcp.servers![name] = cfg as any;
                imported++;
              }
            } else if (content.command) {
              // Formato individual: { command, args, env }
              const name = entry.replace(/\.(json|mcp\.json)$/, '');
              mcp.servers![name] = content as any;
              imported++;
            }
          } catch (e) {
            errors.push(`${entry}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    } catch (e) {
      errors.push(`lectura directorio: ${e instanceof Error ? e.message : String(e)}`);
    }
    writeConfig({ tools }, 'project');
    res.json({ success: true, imported, errors });
  } catch (err) {
    console.error('[MCP] import failed:', err);
    res.status(500).json({ error: 'Failed to import MCP servers' });
  }
});

// ==================== OAUTH (por servidor) ====================

/**
 * Inicia el flujo OAuth para un servidor. Devuelve la authorizeUrl.
 * El cliente abre esa URL en un popup para autorizar.
 */
mcpRouter.post('/:name/auth/start', (req, res) => {
  const { name } = req.params;
  try {
    const { authorizeUrl, state } = startMcpOAuth(name);
    res.json({ success: true, authorizeUrl, state });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Callback OAuth: intercambia el code por token y redirige al frontend.
 */
mcpRouter.get('/:name/auth/callback', async (req, res) => {
  const { name } = req.params;
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const error = req.query.error as string | undefined;

  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
  if (error) {
    return res.redirect(`${frontend}/?mcp_auth=error&server=${encodeURIComponent(name)}&reason=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return res.redirect(`${frontend}/?mcp_auth=error&server=${encodeURIComponent(name)}&reason=missing_params`);
  }

  try {
    await handleMcpOAuthCallback(name, code, state);
    res.redirect(`${frontend}/?mcp_auth=success&server=${encodeURIComponent(name)}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    res.redirect(`${frontend}/?mcp_auth=error&server=${encodeURIComponent(name)}&reason=${encodeURIComponent(reason)}`);
  }
});

/**
 * Estado de autenticación del servidor (para mostrar en la UI).
 */
mcpRouter.get('/:name/auth/status', (req, res) => {
  const { name } = req.params;
  res.json({ name, ...getMcpAuthStatus(name) });
});

/**
 * Cierra la sesión OAuth del servidor (borra token almacenado).
 */
mcpRouter.post('/:name/auth/logout', (req, res) => {
  const { name } = req.params;
  logoutMcp(name);
  res.json({ success: true, name });
});

// ==================== TOOLS (invocación stdio) ====================

/**
 * Lista las tools que expone un servidor MCP local (spawn + tools/list).
 */
mcpRouter.post('/:name/tools', async (req, res) => {
  const { name } = req.params;
  const r = await listServerTools(name);
  if (!r.ok) return res.status(502).json({ error: r.error });
  const tools = r.data?.tools ?? r.data ?? [];
  res.json({ name, tools });
});

/**
 * Invoca una tool de un servidor MCP local.
 * body: { tool: string, args?: object }
 */
mcpRouter.post('/:name/call', async (req, res) => {
  const { name } = req.params;
  const { tool, args } = req.body ?? {};
  if (!tool || typeof tool !== 'string') {
    return res.status(400).json({ error: 'tool (string) es requerido' });
  }
  const r = await callServerTool(name, tool, args ?? {});
  if (!r.ok) return res.status(502).json({ error: r.error });
  res.json({ name, tool, result: r.data });
});

/**
 * Health check: intenta ejecutar brevemente cada comando registrado.
 */
mcpRouter.get('/health', async (_req, res) => {
  try {
    const tools = getToolsConfig();
    const mcp = tools.mcp;

    if (!mcp || mcp.enabled === false) {
      return res.json({ status: 'disabled', total: 0, servers: [] });
    }

    const servers = mcp.servers || {};
    const { spawnSync } = await import('child_process');

    const results = Object.entries(servers).map(([name, cfg]) => {
      const c = cfg as { command: string; args?: string[] };
      try {
        const r = spawnSync(c.command, c.args || [], { timeout: 3000 });
        return {
          name,
          command: c.command,
          status: r.status === 0 ? 'healthy' : 'unreachable',
          output: r.stdout ? r.stdout.toString().slice(0, 200) : null,
        };
      } catch (err) {
        return {
          name,
          command: c.command,
          status: 'unknown' as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const summary = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    res.json({ status: 'ready', total: results.length, summary, servers: results });
  } catch (err) {
    console.error('[MCP] health failed:', err);
    res.status(500).json({ error: 'Health check failed', details: String(err) });
  }
});

export default mcpRouter;
