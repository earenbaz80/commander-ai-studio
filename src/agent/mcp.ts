export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  token?: string;
}

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

const KEY = 'commander_mcp_servers_v1';

export function loadMCPServers(): MCPServerConfig[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch { return []; }
}

export function saveMCPServers(list: MCPServerConfig[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20))); } catch { /* ignore */ }
}

async function mcpRpc(url: string, method: string, params?: unknown, token?: string): Promise<any> {
  const res = await fetch('/api/agent/run-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId: 'mcp.call', input: { serverUrl: url, method, params, headers: token ? { Authorization: `Bearer ${token}` } : undefined } }),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'MCP error');
  return data.data;
}

export async function mcpListTools(serverUrl: string, token?: string): Promise<MCPToolInfo[]> {
  const data = await mcpRpc(serverUrl, 'tools/list', undefined, token);
  return (data?.result?.tools || data?.tools || []) as MCPToolInfo[];
}

export async function mcpCallTool(serverUrl: string, tool: string, args: unknown, token?: string): Promise<any> {
  const data = await mcpRpc(serverUrl, 'tools/call', { name: tool, arguments: args }, token);
  return data?.result ?? data;
}

// ==================== Registro MCP (servidores locales por comando) ====================
// El registro vive en commander.json (tools.mcp.servers) y se expone por el
// backend. Estos helpers descubren sus tools y las invocan vía el mismo
// endpoint /api/agent/run-tool que usa `mcp.call`, con { server } en vez de
// { serverUrl } (el backend enruta al cliente stdio).

/** Lista los nombres de los servidores MCP del registro. */
export async function listRegistryServers(): Promise<{ name: string; command: string }[]> {
  try {
    const res = await fetch('/api/mcp/list');
    if (!res.ok) return [];
    const data = await res.json();
    return (data.servers || [])
      .filter((s: any) => s && s.name)
      .map((s: any) => ({ name: s.name, command: s.command || '' }));
  } catch {
    return [];
  }
}

/** Descubre las tools de un servidor MCP del registro (por nombre). */
export async function listRegistryServerTools(name: string): Promise<MCPToolInfo[]> {
  try {
    const res = await fetch('/api/agent/run-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId: 'mcp.list', input: { server: name } }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const tools = data?.data?.tools ?? data?.tools ?? [];
    return Array.isArray(tools) ? tools : [];
  } catch {
    return [];
  }
}
