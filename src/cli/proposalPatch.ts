/**
 * Exporta una propuesta como `.patch` después de comprobar que git la puede
 * aplicar sobre el workspace actual. La validación ocurre antes de crear el
 * archivo: un diff obsoleto o inválido no deja un parche a medias.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isSensitivePath } from '../../security.js';
import type { SessionProposalV2 } from '../agent/sessionTypes.js';

export type PatchExportErrorCode =
  | 'EMPTY_DIFF'
  | 'PATH_INVALID'
  | 'GIT_CHECK_FAILED'
  | 'WRITE_FAILED';

export interface PatchExportResult {
  ok: boolean;
  path?: string;
  error?: string;
  code?: PatchExportErrorCode;
}

function fail(code: PatchExportErrorCode, error: string): PatchExportResult {
  return { ok: false, code, error };
}

function safeFileName(proposalId: string): string {
  const base = proposalId.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
  const name = base || 'propuesta';
  return name.endsWith('.patch') ? name : `${name}.patch`;
}

/** Ruta relativa por defecto, dentro del directorio ignorado `.commander`. */
export function defaultPatchPath(root: string, proposalId: string): string {
  return path.join(root, '.commander', 'patches', safeFileName(proposalId));
}

function isInsideRoot(root: string, abs: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(abs));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function gitError(error: unknown): string {
  const value = error as { stderr?: Buffer | string; message?: string };
  const stderr =
    typeof value?.stderr === 'string' ? value.stderr : value?.stderr?.toString('utf8') ?? '';
  const text = stderr.trim() || value?.message?.trim() || 'git apply --check rechazó el diff';
  return text.split(/\r?\n/).slice(-4).join(' ');
}

/** Valida el diff contra el workspace sin escribir nada. */
export function validatePatchWithGit(
  diff: string,
  root: string
): { ok: true } | { ok: false; error: string } {
  if (!diff.trim()) return { ok: false, error: 'la propuesta no tiene diff' };
  try {
    execFileSync('git', ['apply', '--check', '-'], {
      cwd: root,
      input: diff,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: gitError(error) };
  }
}

/**
 * Exporta el diff a `.commander/patches/<proposalId>.patch`.
 *
 * Primero valida la ruta de la propuesta y el diff con `git apply --check`;
 * sólo si ambas pasan crea el directorio y escribe el parche.
 */
export function exportProposalPatch(
  proposal: SessionProposalV2,
  root: string
): PatchExportResult {
  if (!proposal.diff.trim()) return fail('EMPTY_DIFF', 'la propuesta no tiene diff');
  if (isSensitivePath(proposal.path)) {
    return fail('PATH_INVALID', 'la propuesta apunta a una ruta sensible');
  }

  const proposalAbs = path.resolve(root, proposal.path);
  if (!isInsideRoot(root, proposalAbs)) {
    return fail('PATH_INVALID', 'la propuesta apunta fuera del proyecto');
  }

  const check = validatePatchWithGit(proposal.diff, root);
  if (!check.ok) {
    return fail('GIT_CHECK_FAILED', `git apply --check falló: ${check.error}`);
  }

  const target = defaultPatchPath(root, proposal.proposalId);
  const patch = proposal.diff.endsWith('\n') ? proposal.diff : `${proposal.diff}\n`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, patch, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail('WRITE_FAILED', `no se pudo escribir el parche: ${message}`);
  }

  return { ok: true, path: path.relative(root, target).split(path.sep).join('/') };
}
