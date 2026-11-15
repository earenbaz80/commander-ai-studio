/**
 * Aplicador determinista de propuestas.
 *
 * No llama al modelo: reconstruye el contenido desde el diff guardado, exige
 * que el archivo siga siendo el del `baseHash`, comprueba el `afterHash` antes
 * de escribir y guarda un checkpoint del estado previo. Una propuesta ya
 * aplicada se devuelve como éxito para que reintentar sea seguro.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isSensitivePath } from '../../security';
import { resolveProjectPath } from '../../projects';
import { snapshotPath } from '../../checkpoints';
import type { SessionProposalV2 } from './sessionTypes';
import { hashContent } from './proposalHash';

export type ApplyProposalErrorCode =
  | 'PROPOSAL_NOT_FOUND'
  | 'PROPOSAL_DISCARDED'
  | 'SESSION_RUNNING'
  | 'MISSING_AFTER_HASH'
  | 'STALE_BASE'
  | 'INVALID_DIFF'
  | 'AFTER_HASH_MISMATCH'
  | 'PATH_INVALID'
  | 'WRITE_FAILED';

export interface ApplyProposalResult {
  ok: boolean;
  code?: ApplyProposalErrorCode;
  error?: string;
  hint?: string;
  applied?: boolean;
  alreadyApplied?: boolean;
  changed?: boolean;
  path?: string;
  checkpointId?: string;
  /** Propuesta actualizada; sólo en una aplicación real y correcta. */
  proposal?: SessionProposalV2;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newCount: number;
  oldLines: string[];
  newLines: string[];
}

function fail(code: ApplyProposalErrorCode, error: string, hint?: string): ApplyProposalResult {
  return { ok: false, code, error, ...(hint ? { hint } : {}) };
}

/** Compara roots resolviendo symlinks y mayúsculas de Windows. */
function sameRoot(a: string, b: string): boolean {
  const normalize = (value: string) => {
    try {
      return fs.realpathSync.native(value).replace(/\\/g, '/').toLowerCase();
    } catch {
      return path.resolve(value).replace(/\\/g, '/').toLowerCase();
    }
  };
  return normalize(a) === normalize(b);
}

/**
 * Parsea el diff unificado que genera `toUnifiedDiff`. Deliberadamente
 * estricto: cualquier línea que no sea cabecera, hunk, contexto, suma o resta
 * invalida el parche en vez de adivinar.
 */
function parseUnifiedDiff(diff: string): Hunk[] | null {
  const lines = diff.split('\n');
  // Un guardado con salto final no convierte el parche en inválido; el diff
  // generado por `toUnifiedDiff` no lo lleva, pero el texto puede pasar por
  // herramientas que sí lo añaden.
  if (lines.at(-1) === '') lines.pop();
  let cursor = 0;
  while (cursor < lines.length && (lines[cursor].startsWith('--- ') || lines[cursor].startsWith('+++ '))) {
    cursor++;
  }

  const hunks: Hunk[] = [];
  while (cursor < lines.length) {
    const header = lines[cursor++];
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
    if (!match) return null;
    const oldStart = Number(match[1]);
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    const newCount = match[4] === undefined ? 1 : Number(match[4]);
    const oldLines: string[] = [];
    const newLines: string[] = [];

    while (cursor < lines.length && !lines[cursor].startsWith('@@ ')) {
      const line = lines[cursor++];
      const tag = line[0];
      const text = line.slice(1);
      if (tag === ' ') {
        oldLines.push(text);
        newLines.push(text);
      } else if (tag === '-') {
        oldLines.push(text);
      } else if (tag === '+') {
        newLines.push(text);
      } else {
        return null;
      }
    }

    if (oldLines.length !== oldCount || newLines.length !== newCount) return null;
    hunks.push({ oldStart, oldCount, newCount, oldLines, newLines });
  }

  return hunks;
}

/** Aplica los hunks sobre el contenido exacto; `null` si no encajan. */
function applyHunks(content: string, hunks: Hunk[]): string | null {
  const lines = content.split('\n');
  const out: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    if (hunk.oldStart < 1) return null;
    const start = hunk.oldStart - 1;
    if (start < cursor || start + hunk.oldCount > lines.length) return null;
    for (let i = 0; i < hunk.oldLines.length; i++) {
      if (lines[start + i] !== hunk.oldLines[i]) return null;
    }
    out.push(...lines.slice(cursor, start), ...hunk.newLines);
    cursor = start + hunk.oldCount;
  }

  out.push(...lines.slice(cursor));
  return out.join('\n');
}

/**
 * Aplica una propuesta a disco.
 *
 * `dryRun` valida base, diff y resultado sin escribir ni crear checkpoint.
 * En una aplicación real devuelve la propuesta marcada como aplicada, con
 * `appliedAt` y `checkpointId`.
 */
export function applyProposalToFile(
  proposal: SessionProposalV2,
  opts: { root: string; dryRun?: boolean }
): ApplyProposalResult {
  if (proposal.applied) {
    return {
      ok: true,
      applied: true,
      alreadyApplied: true,
      changed: false,
      path: proposal.path,
      ...(proposal.checkpointId ? { checkpointId: proposal.checkpointId } : {}),
    };
  }
  if (proposal.discardedAt !== undefined) {
    return fail('PROPOSAL_DISCARDED', 'La propuesta fue descartada.');
  }
  if (!proposal.afterHash) {
    return fail(
      'MISSING_AFTER_HASH',
      'La propuesta no tiene afterHash: no se puede verificar el resultado.',
      'Vuelve a generar la propuesta con fs.propose.'
    );
  }
  if (isSensitivePath(proposal.path)) {
    return fail('PATH_INVALID', 'La propuesta apunta a una ruta sensible.');
  }

  let resolved: { abs: string; root: string };
  try {
    resolved = resolveProjectPath(proposal.path, opts.root);
  } catch (error: any) {
    return fail('PATH_INVALID', String(error?.message || error));
  }
  const rel = path.relative(resolved.root, resolved.abs).split(path.sep).join('/');
  if (
    !sameRoot(resolved.root, opts.root) ||
    !rel ||
    rel.startsWith('..') ||
    path.isAbsolute(rel)
  ) {
    return fail('PATH_INVALID', `Ruta fuera del proyecto: ${proposal.path}`);
  }

  let current = '';
  try {
    if (fs.existsSync(resolved.abs)) {
      if (!fs.statSync(resolved.abs).isFile()) {
        return fail('PATH_INVALID', `No es un archivo: ${proposal.path}`);
      }
      current = fs.readFileSync(resolved.abs, 'utf8');
    }
  } catch (error: any) {
    return fail('WRITE_FAILED', `No se pudo leer ${proposal.path}: ${error?.message || error}`);
  }

  const currentHash = hashContent(current);
  // Si el archivo ya está en el estado final, la aplicación anterior llegó a
  // disco aunque el estado no se llegara a guardar. Reintentar es un éxito.
  if (currentHash === proposal.afterHash) {
    if (opts.dryRun) {
      return { ok: true, applied: false, alreadyApplied: true, changed: false, path: proposal.path };
    }
    return {
      ok: true,
      applied: true,
      alreadyApplied: true,
      changed: false,
      path: proposal.path,
      ...(proposal.checkpointId ? { checkpointId: proposal.checkpointId } : {}),
      proposal: { ...proposal, applied: true, appliedAt: proposal.appliedAt ?? Date.now() },
    };
  }

  if (currentHash !== proposal.baseHash) {
    return fail(
      'STALE_BASE',
      'El archivo cambió desde que se generó la propuesta.',
      'Vuelve a proponer el cambio sobre el contenido actual; no se escribió nada.'
    );
  }

  let next = current;
  if (proposal.diff) {
    const hunks = parseUnifiedDiff(proposal.diff);
    if (!hunks || hunks.length === 0) {
      return fail('INVALID_DIFF', 'El diff de la propuesta no tiene un formato válido.');
    }
    const applied = applyHunks(current, hunks);
    if (applied === null) {
      return fail('INVALID_DIFF', 'El diff no encaja con el contenido base; no se escribió nada.');
    }
    next = applied;
  }

  if (hashContent(next) !== proposal.afterHash) {
    return fail(
      'AFTER_HASH_MISMATCH',
      'El resultado del diff no coincide con el afterHash; no se escribió nada.'
    );
  }

  const changed = next !== current;
  if (opts.dryRun) {
    return { ok: true, applied: false, changed, path: proposal.path };
  }

  let checkpointId: string | undefined;
  if (changed) {
    try {
      checkpointId = snapshotPath(
        resolved.root,
        rel,
        `fs.apply ${proposal.path}`,
        'fs.apply'
      ).id;
    } catch (error: any) {
      return fail('WRITE_FAILED', `No se pudo crear el checkpoint: ${error?.message || error}`);
    }

    try {
      fs.mkdirSync(path.dirname(resolved.abs), { recursive: true });
      fs.writeFileSync(resolved.abs, next, 'utf8');
    } catch (error: any) {
      return fail('WRITE_FAILED', `No se pudo escribir ${proposal.path}: ${error?.message || error}`);
    }
  }

  return {
    ok: true,
    applied: true,
    changed,
    path: proposal.path,
    ...(checkpointId ? { checkpointId } : {}),
    proposal: {
      ...proposal,
      applied: true,
      appliedAt: Date.now(),
      ...(checkpointId ? { checkpointId } : {}),
    },
  };
}
