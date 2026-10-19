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

export interface WebFetchInput {
  url: string;
  maxChars?: number;
}

export const webFetchTool: ToolDefinition<WebFetchInput, any> = {
  id: 'web.fetch',
  description: 'Descargar URL y devolver texto/markdown (vía servidor, con allowlist http/https).',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callServer('web.fetch', input),
};

export interface WebSearchInput {
  query: string;
  limit?: number;
}

export const webSearchTool: ToolDefinition<WebSearchInput, any> = {
  id: 'web.search',
  description: 'Buscar en web (vía servidor, DuckDuckGo HTML, sin API key).',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callServer('web.search', input),
};

export interface CodeRunInput {
  code: string;
  timeoutMs?: number;
}

export const codeRunTool: ToolDefinition<CodeRunInput, any> = {
  id: 'code.run',
  description: 'Ejecutar snippet JS en sandbox del servidor (sin acceso a fs/process).',
  danger: true,
  requiresApproval: () => true,
  run: async (input) => callServer('code.run', input),
};
