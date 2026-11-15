/** Agrupación de propuestas para el comando `/proposals` del REPL. */
import fs from 'node:fs';
import path from 'node:path';
import { isSensitivePath } from '../../security';
import type { SessionProposalV2 } from '../agent/sessionTypes';
import { hashContent } from '../agent/proposalHash';

export interface PendingProposal {
  proposal: SessionProposalV2;
  /** La base del archivo ya no coincide con `baseHash`. */
  stale: boolean;
}

export interface ProposalGroup {
  path: string;
  items: PendingProposal[];
}

/** Hash del archivo actual, o `null` si no se puede comprobar con seguridad. */
function currentHash(root: string, relPath: string): string | null {
  if (isSensitivePath(relPath)) return null;
  const abs = path.resolve(root, relPath);
  const rel = path.relative(path.resolve(root), abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  try {
    if (!fs.existsSync(abs)) return hashContent('');
    if (!fs.statSync(abs).isFile()) return null;
    return hashContent(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Agrupa las propuestas pendientes por archivo y marca las que ya no encajan
 * con el contenido actual. No modifica el estado ni aplica nada.
 */
export function groupPendingProposals(
  proposals: readonly SessionProposalV2[] | undefined,
  root: string
): ProposalGroup[] {
  const byPath = new Map<string, PendingProposal[]>();
  for (const proposal of proposals ?? []) {
    if (proposal.applied || proposal.discardedAt !== undefined) continue;
    const hash = currentHash(root, proposal.path);
    const item = { proposal, stale: hash === null || hash !== proposal.baseHash };
    const items = byPath.get(proposal.path);
    if (items) items.push(item);
    else byPath.set(proposal.path, [item]);
  }

  return [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, items]) => ({
      path: file,
      items: items.sort((a, b) => b.proposal.createdAt - a.proposal.createdAt),
    }));
}
