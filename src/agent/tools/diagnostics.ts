import type { ToolDefinition } from '../types';
import { withActiveRoot } from '../activeProject';

export interface ReadDiagnosticsInput {
  /** Ruta relativa para limitar el resultado a un único archivo (opcional). */
  path?: string;
}

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ReadDiagnosticsOutput {
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  /** Presente cuando el proyecto no es TypeScript o no tiene tsc instalado. */
  note?: string;
}

async function callServer(toolId: string, input: unknown): Promise<any> {
  const res = await fetch('/api/agent/run-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId, input: withActiveRoot((input || {}) as Record<string, unknown>) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: (err as any).error || `HTTP ${res.status}` };
  }
  return res.json();
}

/**
 * Diagnósticos estáticos del proyecto vía `tsc --noEmit` (lenguaje TypeScript).
 * Es la base del `read_diagnostics` del roadmap P0 #3: el agente puede comprobar
 * si su edición introdujo errores sin ejecutar un build completo.
 */
export const readDiagnosticsTool: ToolDefinition<ReadDiagnosticsInput, ReadDiagnosticsOutput> = {
  id: 'read_diagnostics',
  description: 'Diagnósticos estáticos del proyecto (errores/warnings de TypeScript vía tsc).',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callServer('read_diagnostics', input),
};
