/**
 * Evidencia de tests para un artifact de verificación.
 *
 * Este módulo es puro salvo la lectura del runtime: no ejecuta tests ni toca
 * disco. El ejecutor real (`shell.run`) le pasa comando, tiempos, `exitCode` y
 * tails; aquí se aplican las reglas que impiden convertir un fallo en verde.
 */
import type {
  VerificationEnvironment,
  VerificationTestEvidence,
  VerificationTestStatus,
} from './types';

/** Tope por stream; el artifact no debe ser un volcado de consola. */
export const DEFAULT_TAIL_CHARS = 8_000;

export interface TestEvidenceInput {
  id?: string;
  command: string;
  cwd: string;
  /** `null` significa que el comando no llegó a ejecutarse. */
  exitCode: number | null;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  /** Un timeout es un fallo, pero se conserva la marca para distinguirlo. */
  timedOut?: boolean;
  /** Fuerza el caso “no ejecutado” incluso si el caller trae un código. */
  executed?: boolean;
}

export interface TestEvidenceOptions {
  maxTailChars?: number;
}

export interface NotRunTestEvidenceInput {
  id?: string;
  command: string;
  cwd: string;
  startedAt: number;
}

export type VerificationEnvironmentInput = Partial<VerificationEnvironment>;
export type GitEnvironment = Pick<VerificationEnvironment, 'commit' | 'branch'>;
export type GitEnvironmentReader = () => Promise<GitEnvironment>;

/**
 * Comandos que producen evidencia de tests. Se exige que el comando esté al
 * inicio o después de un separador (`&&`, `;`, `|`) para no marcar un
 * `echo "npm test"` como una corrida.
 */
const TEST_COMMAND_RE =
  /(?:^|[;&|]\s*)(?:npm\s+(?:run\s+)?test(?::[\w:-]+)?|npx\s+(?:vitest|jest|playwright\s+test)\b|(?:vitest|jest|pytest|playwright\s+test|bun\s+test|yarn\s+test|pnpm\s+test|go\s+test|cargo\s+test|node\s+--test|tsx\s+--test)\b)/i;

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND_RE.test(String(command ?? '').trim());
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]'],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_API_KEY]'],
  [/\bnpm_[A-Za-z0-9]{20,}\b/g, '[REDACTED_NPM_TOKEN]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]'],
  [
    /(\b(?:Proxy-)?Authorization\s*:\s*(?:Basic|Bearer)\s+)[A-Za-z0-9._~+/=-]+/gi,
    '$1[REDACTED]',
  ],
  [
    /(\b[A-Za-z0-9_]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|token|password|passwd|pwd|credentials?)\b\s*[:=]\s*)(["']?)[^\s"']+\2/gi,
    '$1$2[REDACTED]$2',
  ],
];

/**
 * Quita credenciales evidentes antes de que el texto entre en un artifact.
 * No inspecciona `process.env`: sólo trabaja con el texto que recibe.
 */
export function redactSecrets(text: string | undefined): string {
  let out = String(text ?? '');
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Conserva el final del stream, que es donde suele estar el fallo, y acota el
 * resultado completo (incluido el aviso de truncado) a `maxChars`.
 */
export function tailText(text: string | undefined, maxChars = DEFAULT_TAIL_CHARS): string {
  const clean = redactSecrets(text);
  const limit = Math.max(0, Math.floor(Number(maxChars) || 0));
  if (limit === 0) return '';
  if (clean.length <= limit) return clean;

  const suffixBudget = Math.max(0, limit - 64);
  const omitted = clean.length - suffixBudget;
  const marker = `… [${omitted} caracteres omitidos]\n`;
  const suffix = clean.slice(-Math.max(0, limit - marker.length));
  return (marker + suffix).slice(-limit);
}

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** FNV-1a estable para que dos corridas iguales no dependan de Math.random. */
function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildTestEvidence(
  input: TestEvidenceInput,
  options: TestEvidenceOptions = {}
): VerificationTestEvidence {
  const command = redactSecrets(String(input.command ?? '').trim());
  const cwd = redactSecrets(String(input.cwd ?? '').trim());
  const rawStartedAt = finite(input.startedAt);
  const startedAt = rawStartedAt ?? 0;
  const rawExitCode = finite(input.exitCode ?? undefined);
  const exitCode = rawExitCode ?? null;
  const timedOut = input.timedOut === true;
  const executed =
    input.executed === false
      ? false
      : timedOut || exitCode !== null || input.executed === true;
  const status: VerificationTestStatus = !executed
    ? 'not-run'
    : timedOut || exitCode !== 0
      ? 'failed'
      : 'passed';

  const rawDuration = finite(input.durationMs);
  const rawFinishedAt = finite(input.finishedAt);
  const finishedAt = Math.max(
    startedAt,
    rawFinishedAt ?? startedAt + Math.max(0, rawDuration ?? 0)
  );
  const durationMs = !executed
    ? 0
    : Math.max(0, rawDuration ?? finishedAt - startedAt);

  const maxTailChars = Math.max(
    0,
    Math.floor(finite(options.maxTailChars) ?? DEFAULT_TAIL_CHARS)
  );
  const id =
    String(input.id ?? '').trim() ||
    `test-${startedAt}-${stableHash(`${command}\0${cwd}`)}`;

  return {
    id,
    command,
    cwd,
    status,
    exitCode: executed ? exitCode : null,
    durationMs,
    startedAt,
    finishedAt,
    stdoutTail: tailText(input.stdout, maxTailChars),
    stderrTail: tailText(input.stderr, maxTailChars),
    ...(timedOut ? { timedOut: true } : {}),
  };
}

/** Atajo explícito para una corrida que no llegó a ejecutarse. */
export function buildNotRunTestEvidence(
  input: NotRunTestEvidenceInput
): VerificationTestEvidence {
  return buildTestEvidence({
    ...input,
    exitCode: null,
    executed: false,
    durationMs: 0,
    finishedAt: input.startedAt,
  });
}

interface RuntimeProcess {
  version?: string;
  platform?: string;
  arch?: string;
}

function runtimeProcess(): RuntimeProcess | undefined {
  return (globalThis as { process?: RuntimeProcess }).process;
}

function runtimeNode(): string {
  return runtimeProcess()?.version?.trim() || 'unknown';
}

function runtimeOs(): string {
  const proc = runtimeProcess();
  if (proc?.platform) {
    return proc.arch ? `${proc.platform}-${proc.arch}` : proc.platform;
  }
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    return navigator.userAgent.slice(0, 120);
  }
  return 'unknown';
}

function nonEmpty(value: string | undefined): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

export function buildVerificationEnvironment(
  input: VerificationEnvironmentInput = {}
): VerificationEnvironment {
  const node = nonEmpty(input.node) ?? runtimeNode();
  const os = nonEmpty(input.os) ?? runtimeOs();
  const commit = nonEmpty(input.commit);
  const branch = nonEmpty(input.branch);
  return {
    node,
    os,
    ...(commit ? { commit } : {}),
    ...(branch ? { branch } : {}),
  };
}

/**
 * Captura Node/SO y, si el caller lo aporta, commit y rama. El lector de git
 * vive en el servidor: este módulo no importa `child_process` para poder
 * ejecutarse también desde tests o desde el bundle del cliente.
 */
export async function captureVerificationEnvironment(
  readGit?: GitEnvironmentReader
): Promise<VerificationEnvironment> {
  let git: GitEnvironment = {};
  if (readGit) {
    try {
      git = await readGit();
    } catch {
      git = {};
    }
  }
  return buildVerificationEnvironment(git);
}
