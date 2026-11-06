/**
 * Preflight de una release local.
 *
 * Se ejecuta antes de cualquier subida. No sigue symlinks y devuelve todos los
 * problemas encontrados para que la UI pueda explicarlos sin exponer valores
 * de secretos.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { PreflightIssue, PreflightIssueCode, PreflightResult } from './types';

export const PREFLIGHT_MAX_FILES = 20_000;
export const PREFLIGHT_MAX_BYTES = 300 * 1024 * 1024;

const FORBIDDEN_FILE =
  /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.git-credentials|\.htpasswd|\.DS_Store|Thumbs\.db|id_(?:rsa|dsa|ecdsa|ed25519))$/i;
const FORBIDDEN_EXTENSION = /\.(?:pem|key|p12|pfx)$/i;
const SECRET_FILE = /^(?:secrets?|credentials|service-account[^/]*)\.(?:json|ya?ml|toml)$/i;
const SOURCE_MAP_FILE = /\.map$/i;
const FORBIDDEN_SEGMENT = new Set(['.git', '.svn', '.hg', 'node_modules']);
const INLINE_SOURCE_MAP = /\bsourceMappingURL\s*=/i;
const TEXT_FILE =
  /\.(?:html?|css|js|mjs|cjs|jsx|tsx?|json|txt|xml|svg|webmanifest|ya?ml|toml|md)$/i;

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'clave privada', pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  {
    label: 'token de GitHub',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  { label: 'token de OpenAI', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: 'token de Stripe', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { label: 'token de AWS', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'token de Slack', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'clave de Google', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];

export interface PreflightFile {
  file: string;
  data: Buffer;
}

function issue(file: string, code: PreflightIssueCode, message: string): PreflightIssue {
  return { file, code, message };
}

function inspectFile(file: string, data: Buffer): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const parts = file.split('/');
  const basename = parts[parts.length - 1] || '';

  if (parts.some((part) => FORBIDDEN_SEGMENT.has(part.toLowerCase()))) {
    issues.push(issue(file, 'forbidden', `La release contiene una ruta prohibida: ${file}`));
    return issues;
  }
  if (SOURCE_MAP_FILE.test(basename)) {
    issues.push(issue(file, 'source-map', `La release contiene un source map no permitido: ${file}`));
    return issues;
  }
  if (
    FORBIDDEN_FILE.test(basename) ||
    FORBIDDEN_EXTENSION.test(basename) ||
    SECRET_FILE.test(basename)
  ) {
    issues.push(issue(file, 'forbidden', `La release contiene un archivo prohibido: ${file}`));
    return issues;
  }
  if (!TEXT_FILE.test(basename)) return issues;

  const text = data.toString('utf8');
  if (INLINE_SOURCE_MAP.test(text)) {
    issues.push(
      issue(file, 'source-map', `La release contiene una referencia a un source map: ${file}`)
    );
  }
  for (const secret of SECRET_PATTERNS) {
    if (secret.pattern.test(text)) {
      issues.push(
        issue(file, 'secret', `La release contiene un secreto (${secret.label}): ${file}`)
      );
    }
  }
  return issues;
}

export function preflightFiles(files: PreflightFile[]): PreflightResult {
  const issues: PreflightIssue[] = [];
  let bytes = 0;
  for (const file of files) {
    bytes += file.data.byteLength;
    issues.push(...inspectFile(file.file, file.data));
  }
  return {
    ok: issues.length === 0,
    fileCount: files.length,
    bytes,
    issues,
  };
}

/** Lee una release completa sin lanzar el primer error: la UI ve todos. */
export async function preflightRelease(root: string): Promise<PreflightResult> {
  const files: PreflightFile[] = [];
  const issues: PreflightIssue[] = [];
  let fileCount = 0;
  let bytes = 0;
  let limitHit = false;

  const visit = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error: any) {
      issues.push(
        issue('.', 'unreadable', `No se pudo leer la release: ${error?.message || 'error de disco'}`)
      );
      return;
    }

    for (const entry of entries) {
      if (limitHit) return;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).replace(/\\/g, '/') || entry.name;

      if (entry.isSymbolicLink()) {
        issues.push(issue(rel, 'symlink', `La release contiene un symlink no permitido: ${rel}`));
        continue;
      }
      if (entry.isDirectory()) {
        if (FORBIDDEN_SEGMENT.has(entry.name.toLowerCase())) {
          issues.push(issue(rel, 'forbidden', `La release contiene una ruta prohibida: ${rel}`));
          continue;
        }
        await visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;

      let size = 0;
      try {
        size = (await fsp.stat(abs)).size;
      } catch (error: any) {
        issues.push(
          issue(rel, 'unreadable', `No se pudo leer ${rel}: ${error?.message || 'error de disco'}`)
        );
        continue;
      }

      fileCount += 1;
      bytes += size;
      if (fileCount > PREFLIGHT_MAX_FILES) {
        issues.push(
          issue(rel, 'limit', `La release supera el límite de ${PREFLIGHT_MAX_FILES} archivos`)
        );
        limitHit = true;
        return;
      }
      if (bytes > PREFLIGHT_MAX_BYTES) {
        issues.push(issue(rel, 'limit', 'La release supera el límite de 300 MB'));
        limitHit = true;
        return;
      }

      try {
        files.push({ file: rel, data: await fsp.readFile(abs) });
      } catch (error: any) {
        issues.push(
          issue(rel, 'unreadable', `No se pudo leer ${rel}: ${error?.message || 'error de disco'}`)
        );
      }
    }
  };

  await visit(root);
  const inspected = preflightFiles(files);
  return {
    ok: issues.length === 0 && inspected.ok,
    fileCount,
    bytes,
    issues: [...issues, ...inspected.issues],
  };
}
