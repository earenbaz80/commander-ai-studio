import type { CheckpointMeta } from '../utils/checkpointsApi';

/**
 * Selección de checkpoints para deshacer y rehacer pasos.
 *
 * Cada escritura del agente (`fs.write`, `fs.edit`, `code.fix`) ya deja en el
 * servidor el contenido PREVIO de la ruta tocada. Deshacer es restaurar el
 * checkpoint más reciente que siga vigente; rehacer necesita además el estado
 * actual, que se captura justo antes de revertir.
 */
export const STEP_TOOLS = new Set(['fs.write', 'fs.edit', 'code.fix']);

/** ¿Este checkpoint lo produjo una escritura del agente? */
export function isStepCheckpoint(cp: CheckpointMeta): boolean {
  return (
    !!cp &&
    STEP_TOOLS.has(String(cp.tool || '')) &&
    Array.isArray(cp.files) &&
    cp.files.length > 0
  );
}

/** Checkpoint a deshacer: el más reciente que no se haya deshecho ya. */
export function nextUndoCandidate(
  list: CheckpointMeta[],
  skip: Iterable<string> = []
): CheckpointMeta | null {
  const skipSet = new Set(skip);
  const candidates = (Array.isArray(list) ? list : [])
    .filter((cp) => isStepCheckpoint(cp) && !skipSet.has(cp.id))
    .sort((a, b) => b.ts - a.ts);
  return candidates[0] ?? null;
}

/** Rutas únicas del checkpoint, sin repetir. */
export function checkpointPaths(cp: CheckpointMeta): string[] {
  return Array.from(new Set((cp.files || []).map((file) => file.path))).filter(Boolean);
}
