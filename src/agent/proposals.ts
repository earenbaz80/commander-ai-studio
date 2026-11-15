/**
 * Normaliza las propuestas de la sesión para que el checkpoint no crezca con
 * duplicados ni con variantes pendientes del mismo archivo.
 */
import type { ProposalStatsV2, SessionProposalV2 } from './sessionTypes';

export const MAX_SESSION_PROPOSALS = 50;
export const MAX_PENDING_PROPOSALS_PER_PATH = 3;

/** Descartes que aplicó una pasada de normalización. */
export interface ProposalDropStats {
  duplicates: number;
  perFileCap: number;
  totalCap: number;
}

export function emptyProposalStats(): ProposalStatsV2 {
  return {
    created: 0,
    duplicatesDropped: 0,
    perFileCapDropped: 0,
    totalCapDropped: 0,
    reviewed: 0,
    applied: 0,
    discarded: 0,
  };
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/** Normaliza los contadores persistidos sin perder los que ya existían. */
export function normalizeProposalStats(value: unknown): ProposalStatsV2 {
  const raw = value && typeof value === 'object' ? (value as Partial<ProposalStatsV2>) : {};
  return {
    created: count(raw.created),
    duplicatesDropped: count(raw.duplicatesDropped),
    perFileCapDropped: count(raw.perFileCapDropped),
    totalCapDropped: count(raw.totalCapDropped),
    reviewed: count(raw.reviewed),
    applied: count(raw.applied),
    discarded: count(raw.discarded),
  };
}

/** Contadores iniciales para estados anteriores a la instrumentación. */
export function proposalStatsFor(
  proposals: readonly SessionProposalV2[],
  raw: unknown
): ProposalStatsV2 {
  const stats = normalizeProposalStats(raw);
  if (raw) return stats;
  stats.created = proposals.length;
  stats.reviewed = proposals.filter((proposal) => proposal.reviewedAt !== undefined).length;
  stats.applied = proposals.filter((proposal) => proposal.applied).length;
  stats.discarded = proposals.filter((proposal) => proposal.discardedAt !== undefined).length;
  return stats;
}

function asProposal(value: unknown): SessionProposalV2 | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Partial<SessionProposalV2>;
  if (
    typeof p.proposalId !== 'string' ||
    typeof p.path !== 'string' ||
    typeof p.diff !== 'string' ||
    typeof p.baseHash !== 'string'
  ) {
    return null;
  }
  return {
    proposalId: p.proposalId,
    path: p.path,
    diff: p.diff,
    baseHash: p.baseHash,
    // Las propuestas anteriores a `afterHash` se conservan para revisarlas,
    // pero el aplicador las rechaza: sin hash final no hay garantía.
    afterHash: typeof p.afterHash === 'string' ? p.afterHash : '',
    applied: p.applied === true,
    tool: typeof p.tool === 'string' ? p.tool : 'fs.propose',
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
    ...(typeof p.reviewedAt === 'number' ? { reviewedAt: p.reviewedAt } : {}),
    ...(typeof p.discardedAt === 'number' ? { discardedAt: p.discardedAt } : {}),
    ...(typeof p.appliedAt === 'number' ? { appliedAt: p.appliedAt } : {}),
    ...(typeof p.checkpointId === 'string' ? { checkpointId: p.checkpointId } : {}),
  };
}

/**
 * Deja una propuesta por `(ruta, baseHash, diff)` —la más reciente—, como
 * máximo `MAX_PENDING_PROPOSALS_PER_PATH` pendientes por archivo y
 * `MAX_SESSION_PROPOSALS` en total. Una duplicada que ya se aplicó sigue
 * aplicada: volver a proponer el mismo cambio no la resucita.
 */
export function normalizeProposals(
  proposals: readonly SessionProposalV2[],
  drops?: ProposalDropStats
): SessionProposalV2[] {
  const byKey = new Map<string, SessionProposalV2>();
  for (const raw of proposals) {
    const proposal = asProposal(raw);
    if (!proposal) continue;
    const key = `${proposal.path}\u0000${proposal.baseHash}\u0000${proposal.diff}`;
    const previous = byKey.get(key);
    if (previous && drops) drops.duplicates += 1;
    // Reinsertar mueve el duplicado al final: el orden sigue a la última vez.
    byKey.delete(key);
    const applied = proposal.applied || previous?.applied === true;
    byKey.set(key, {
      ...proposal,
      applied,
      createdAt: Math.max(proposal.createdAt, previous?.createdAt ?? 0),
      // Si el duplicado aplicado es el viejo, no se pierde su checkpoint.
      ...(!proposal.applied && previous?.appliedAt !== undefined
        ? { appliedAt: previous.appliedAt }
        : {}),
      ...(!proposal.applied && previous?.checkpointId
        ? { checkpointId: previous.checkpointId }
        : {}),
    });
  }

  const kept: SessionProposalV2[] = [];
  const pendingByPath = new Map<string, number>();
  // De más nueva a más vieja para descartar primero las pendientes antiguas.
  for (const proposal of [...byKey.values()].reverse()) {
    if (!proposal.applied) {
      const pending = pendingByPath.get(proposal.path) ?? 0;
      if (pending >= MAX_PENDING_PROPOSALS_PER_PATH) {
        if (drops) drops.perFileCap += 1;
        continue;
      }
      pendingByPath.set(proposal.path, pending + 1);
    }
    kept.push(proposal);
  }

  const total = kept.length;
  if (drops && total > MAX_SESSION_PROPOSALS) drops.totalCap += total - MAX_SESSION_PROPOSALS;
  return kept.reverse().slice(-MAX_SESSION_PROPOSALS);
}
