import type { ToolDefinition } from '../types';
import { withActiveRoot } from '../activeProject';
import { splitPipeline } from '../shellCommand';

export interface ShellRunInput {
  command: string;
  timeoutMs?: number;
  /** Arranca el comando en segundo plano: devuelve id, pid y log. */
  background?: boolean;
}

export interface ShellRunOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Comandos seguros permitidos sin aprobación.
 * Solo operaciones de lectura/inspección y builds comunes.
 */
const SAFE_COMMANDS: RegExp[] = [
  /^ls\b/, /^dir\b/, /^cat\b/, /^type\b/,
  /^echo\b/, /^pwd\b/, /^which\b/, /^where\b/,
  /^grep\b/, /^rg\b/, /^ag\b/,
  /^head\b/, /^tail\b/, /^wc\b/, /^sort\b/, /^uniq\b/,
  /^git status\b/, /^git diff\b/, /^git log\b/, /^git branch\b/,
  /^git show\b/, /^git remote\b/, /^git tag\b/,
  /^npm (list|run|test|audit|outdated|version)\b/,
  /^npx\b/, /^bun (run|test)\b/,
  /^node -v\b/, /^npm -v\b/,
  /^tsc\b/, /^vite\b/,
];

/**
 * Patrones peligrosos que SIEMPRE requieren aprobación.
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/, /\bdel\s+\/s\b/, /\brmdir\s+\/s\b/,
  /\bformat\b/, /\bmkfs\b/, /\bshutdown\b/, /\breboot\b/,
  /\bgit\s+push\s+--force\b/, /\bgit\s+push\s+-f\b/,
  /\bfork\s+bomb\b/, /:\(\)\{:\|:&\};:/,
  /\bchmod\s+-R\s+777\b/, /\bchown\s+-R\b/,
  /\bmv\b.*(\/|\.\.)\//, /\bcp\b.*(\/|\.\.)\//,
  /\b>\s*\/dev\//, /\bdd\b/,
  /\bnpm\s+publish\b/, /\byarn\s+publish\b/,
  /\bgemini\b/, /\bclaude\b/, // evita llamadas recursivas a otros agentes
  /\bcurl\b.*\|\s*(bash|sh)\b/, /\bwget\b.*\|\s*(bash|sh)\b/,
  /\bsudo\b/, /\bsu\b/,
  /\bdocker\b/, /\bpodman\b/,
  /\bkubectl\b/, /\bhelm\b/,
  /\bssh\b/, /\bscp\b/, /\bftp\b/,
  /\bmount\b/, /\bumount\b/,
  /\bkill\b/, /\bpkill\b/, /\bkillall\b/,
  /\biptables\b/, /\bfirewall\b/,
  /\bcrontab\b/, /\bat\b/, /\batq\b/,
  /\bsystemctl\b/, /\bservice\b/,
  /\buseradd\b/, /\busermod\b/, /\buserdel\b/,
  /\bpasswd\b/,
  /\bvi\b/, /\bvim\b/, /\bnano\b/, /\bemacs\b/, // editores interactivos
  /\btop\b/, /\bhtop\b/, /\bless\b/, /\bmore\b/,
];

/**
 * Determina si un comando requiere aprobación.
 * Estrategia: allowlist para comandos seguros, denylist para peligrosos.
 * Todo lo demás requiere aprobación por defecto (fail-safe).
 */
function commandRequiresApproval(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return true;

  // Denylist: siempre peligroso
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(cmd)) return true;
  }

  // Allowlist: seguro si coincide
  for (const pattern of SAFE_COMMANDS) {
    if (pattern.test(cmd)) return false;
  }

  // Por defecto, requiere aprobación (fail-safe)
  return true;
}

export const shellRunTool: ToolDefinition<ShellRunInput, ShellRunOutput> = {
  id: 'shell.run',
  description: 'Ejecutar comando shell en el servidor (admite pipes; con aprobación si es peligroso).',
  danger: true,
  // Un pipeline pide aprobación si cualquiera de sus etapas la pediría sola.
  requiresApproval: (input) => {
    const parsed = splitPipeline(input.command || '');
    if (!parsed.ok) return true;
    return parsed.segments.some((segment) => commandRequiresApproval(segment));
  },
  run: async (input) => {
    const res = await fetch('/api/agent/run-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId: 'shell.run', input: withActiveRoot(input as any) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: (err as any).error || `HTTP ${res.status}` };
    }
    return res.json();
  },
};

/**
 * Utilidad para tests: verificar si un comando es seguro
 */
export function isCommandSafe(command: string): boolean {
  const parsed = splitPipeline(command);
  return parsed.ok && parsed.segments.every((segment) => !commandRequiresApproval(segment));
}

/**
 * `shell.job`: consulta y para los trabajos que el agente dejó en segundo plano.
 * El servidor solo acepta ids de su propio registro (y un pid que pertenezca a
 * ese trabajo), así que aquí no hay forma de matar un proceso arbitrario.
 */
export interface ShellJobInput {
  action: 'list' | 'logs' | 'stop';
  id?: string;
  /** Líneas de log a devolver en `logs` (1-500, por defecto 40). */
  tail?: number;
  /** Comprobación extra en `stop`: debe pertenecer al trabajo indicado. */
  pid?: number;
}

export const shellJobTool: ToolDefinition<ShellJobInput, any> = {
  id: 'shell.job',
  description: 'Trabajos en segundo plano: listar, leer el log (tail) y parar por id.',
  danger: true,
  requiresApproval: (input) => input.action === 'stop',
  run: async (input) => {
    const res = await fetch('/api/agent/run-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId: 'shell.job', input: withActiveRoot(input as any) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: (err as any).error || `HTTP ${res.status}` };
    }
    return res.json();
  },
};