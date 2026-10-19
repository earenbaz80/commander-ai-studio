import type { ToolDefinition } from '../types';
import { withActiveRoot } from '../activeProject';

export interface FsReadInput {
  path: string;
  maxBytes?: number;
}

export interface FsReadOutput {
  content: string;
  bytes: number;
  exists: boolean;
}

async function callServer(toolId: string, input: any): Promise<any> {
  const res = await fetch('/api/agent/run-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId, input: withActiveRoot(input || {}) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: (err as any).error || `HTTP ${res.status}` };
  }
  return res.json();
}

export const fsReadTool: ToolDefinition<FsReadInput, FsReadOutput> = {
  id: 'fs.read',
  description: 'Leer archivo del workspace (vía servidor).',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callServer('fs.read', input),
};

export interface FsWriteInput {
  path: string;
  content: string;
  overwrite?: boolean;
}

export interface FsWriteOutput {
  path: string;
  bytes: number;
}

export const fsWriteTool: ToolDefinition<FsWriteInput, FsWriteOutput> = {
  id: 'fs.write',
  description: 'Crear/reescribir archivo en el workspace (vía servidor).',
  danger: true,
  requiresApproval: () => true,
  run: async (input) => callServer('fs.write', input),
};

export interface FsEditInput {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface FsEditOutput {
  path: string;
  replaced: number;
}

export const fsEditTool: ToolDefinition<FsEditInput, FsEditOutput> = {
  id: 'fs.edit',
  description: 'Editar archivo reemplazando texto exacto (vía servidor).',
  danger: true,
  requiresApproval: () => true,
  run: async (input) => callServer('fs.edit', input),
};

export interface FsGlobInput {
  pattern: string;
}

export interface FsGlobOutput {
  files: string[];
}

export const fsGlobTool: ToolDefinition<FsGlobInput, FsGlobOutput> = {
  id: 'fs.glob',
  description: 'Buscar archivos por patrón glob (vía servidor).',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callServer('fs.glob', input),
};

export interface FsGrepInput {
  pattern: string;
  path?: string;
  include?: string;
}

export interface FsGrepMatch {
  file: string;
  line: number;
  text: string;
}

export interface FsGrepOutput {
  matches: FsGrepMatch[];
}

export const fsGrepTool: ToolDefinition<FsGrepInput, FsGrepOutput> = {
  id: 'fs.grep',
  description: 'Buscar texto en archivos (vía servidor).',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callServer('fs.grep', input),
};
