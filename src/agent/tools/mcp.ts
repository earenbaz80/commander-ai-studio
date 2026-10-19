import type { ToolDefinition } from '../types';

async function callServer(toolId: string, input: unknown): Promise<any> {
  const res = await fetch('/api/agent/run-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId, input }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: (err as any).error || `HTTP ${res.status}` };
  }
  return res.json();
}

export const mcpCallToolDef: ToolDefinition<any, any> = {
  id: 'mcp.call' as any,
  description: 'Llamar tool de un servidor MCP (vía proxy servidor).',
  danger: true,
  requiresApproval: () => true,
  run: async (input) => callServer('mcp.call', input),
};

export const mcpListToolDef: ToolDefinition<any, any> = {
  id: 'mcp.list' as any,
  description: 'Listar tools de un servidor MCP (vía proxy servidor).',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callServer('mcp.list', input),
};
