import type { ToolDefinition } from '../types';
import { withActiveRoot } from '../activeProject';

export interface FsReadInput {
  path: string;
  /** Línea inicial (1-based). Con offset o limit se devuelve solo esa ventana. */
  offset?: number;
  /** Líneas a devolver desde offset (máx 2000; por defecto 200). */
  limit?: number;
  /** Prefija cada línea con su número (`  12| `). Por defecto, texto literal. */
  numberLines?: boolean;
}

export interface FsReadOutput {
  /** Texto literal del archivo o de la ventana (sin numerar salvo numberLines). */
  content: string;
  bytes: number;
  exists: boolean;
  startLine: number;
  endLine: number;
  totalLines: number;
  /** Hay líneas fuera de la ventana: pedir otra con offset/limit. */
  truncated: boolean;
  hint?: string;
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
  description: 'Leer archivo del workspace por ventana: offset/limit y metadatos de líneas (vía servidor).',
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

/**
 * Resultado del typecheck del borrador (`diagnose: true`).
 *
 * Se declara aquí, y no importando el de `agentTools.ts`, porque ese módulo es
 * del servidor: importarlo desde el cliente arrastraría `fs` y `child_process`
 * al bundle.
 */
export interface ProposedDiagnosticsSummary {
  /** `false` si no se pudo comprobar (sin tsconfig, sin typescript…): ver `note`. */
  checked: boolean;
  /** Sólo diagnósticos del archivo propuesto; los de sus imports ya existían. */
  diagnostics: {
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning';
    code: string;
    message: string;
  }[];
  errorCount: number;
  warningCount: number;
  note?: string;
}

export interface FsProposeWriteInput {
  path: string;
  content: string;
  /** Typechequear el contenido propuesto sin escribirlo. Lento: úsalo si el cambio es dudoso. */
  diagnose?: boolean;
}
export interface FsProposeWriteOutput {
  path: string;
  changed: boolean;
  exists: boolean;
  additions: number;
  deletions: number;
  diff: string;
  hint?: string;
  /** Presente sólo con `diagnose: true` y si hay algo que cambiar. */
  diagnostics?: ProposedDiagnosticsSummary;
}
export const fsProposeWriteTool: ToolDefinition<FsProposeWriteInput, FsProposeWriteOutput> = {
  id: 'fs.propose.write',
  description:
    'Proponer escribir un archivo (crear o sobreescribir) SIN tocar disco. Devuelve un diff unificado ' +
    'para que el usuario decida si se aplica. Funciona en modo plan. Con diagnose:true typechequea ' +
    'el contenido propuesto sin escribirlo.',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callServer('fs.propose.write', input),
};

export interface FsProposeEditInput {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
  /** Typechequear el archivo resultante sin escribirlo. Lento: úsalo si el cambio es dudoso. */
  diagnose?: boolean;
}
export interface FsProposeEditOutput {
  path: string;
  changed: boolean;
  exists: boolean;
  additions: number;
  deletions: number;
  diff: string;
  hint?: string;
  /** Presente sólo con `diagnose: true` y si hay algo que cambiar. */
  diagnostics?: ProposedDiagnosticsSummary;
}
export const fsProposeEditTool: ToolDefinition<FsProposeEditInput, FsProposeEditOutput> = {
  id: 'fs.propose.edit',
  description:
    'Proponer un edit (str_replace) SIN tocar disco. Devuelve un diff unificado para revisión. ' +
    'Funciona en modo plan. Con diagnose:true typechequea el resultado sin escribirlo.',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callServer('fs.propose.edit', input),
};

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
  /** Líneas de contexto antes de cada coincidencia (0-20). */
  before?: number;
  /** Líneas de contexto después de cada coincidencia (0-20). */
  after?: number;
  /** Atajo: fija before y after a la vez (0-20). */
  context?: number;
}

export interface FsGrepMatch {
  file: string;
  line: number;
  text: string;
  before?: string[];
  after?: string[];
}

export interface FsGrepOutput {
  matches: FsGrepMatch[];
  /** Se alcanzó el tope de 100 coincidencias: refina el patrón o la ruta. */
  truncated?: boolean;
  context?: { before: number; after: number };
}

export const fsGrepTool: ToolDefinition<FsGrepInput, FsGrepOutput> = {
  id: 'fs.grep',
  description: 'Buscar texto en archivos con contexto antes/después de cada coincidencia (vía servidor).',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callServer('fs.grep', input),
};
