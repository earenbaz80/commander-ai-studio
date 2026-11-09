/**
 * Cliente único para ejecutar tools del agente desde la UI.
 *
 * Centraliza el contrato con /api/agent/run-tool: todas las vistas del
 * Workbench (árbol de archivos, terminal, navegador) hablan con el mismo
 * endpoint que usan los modelos, así que "lo que el modelo puede hacer,
 * la interfaz también".
 */

import type { VerificationEnvironment, VerificationTestEvidence } from '../artifacts/types';
import { getActiveProjectRoot } from '../agent/activeProject';

export interface ToolResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Ejecuta una tool del agente contra el servidor. */
export async function runAgentTool<T = unknown>(
  toolId: string,
  input: Record<string, unknown> = {},
  /** Root explícito; si se omite se usa el proyecto activo global. */
  root?: string
): Promise<ToolResponse<T>> {
  const rootToUse = root !== undefined ? root : getActiveProjectRoot();
  try {
    const res = await fetch('/api/agent/run-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolId,
        input: rootToUse ? { ...input, root: rootToUse } : input,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok && json.ok === undefined) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return json as ToolResponse<T>;
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error de red' };
  }
}

/** Lista todos los archivos del root indicado (relativos, máx 500). */
export async function listProjectFiles(root?: string): Promise<{ files: string[]; error?: string }> {
  const target = root !== undefined ? root : getActiveProjectRoot();
  if (!target) return { files: [], error: 'Sin proyecto activo' };
  const res = await runAgentTool<{ files: string[] }>('fs.glob', { pattern: '*' }, target);
  if (!res.ok) return { files: [], error: res.error || 'No se pudo listar' };
  return { files: res.data?.files || [] };
}

/** Lee un archivo del proyecto activo. */
export async function readProjectFile(
  path: string,
  maxBytes = 200_000,
  root?: string
): Promise<{ content?: string; error?: string }> {
  const res = await runAgentTool<{ content: string; exists: boolean }>(
    'fs.read',
    { path, maxBytes },
    root !== undefined ? root : undefined
  );
  if (!res.ok) return { error: res.error || 'No se pudo leer' };
  if (!res.data?.exists) return { error: 'El archivo no existe' };
  return { content: res.data.content };
}

/**
 * Escribe (crea o sobreescribe) un archivo del proyecto activo.
 * Usa `fs.write` con overwrite para permitir guardar cambios.
 */
export async function writeProjectFile(
  path: string,
  content: string,
  root?: string
): Promise<{ ok: boolean; error?: string; bytes?: number }> {
  const res = await runAgentTool<{ path: string; bytes: number }>(
    'fs.write',
    { path, content, overwrite: true },
    root !== undefined ? root : undefined
  );
  if (!res.ok) return { ok: false, error: res.error || 'No se pudo guardar' };
  return { ok: true, bytes: res.data?.bytes };
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  testEvidence?: VerificationTestEvidence;
  environment?: VerificationEnvironment;
}

/** Ejecuta un comando shell en el servidor. */
export async function runShellCommand(command: string, timeoutMs = 30_000, root?: string): Promise<{
  ok: boolean;
  data?: ShellResult;
  error?: string;
}> {
  return runAgentTool<ShellResult>('shell.run', { command, timeoutMs }, root);
}
