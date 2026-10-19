import type { ToolDefinition } from '../types';
import { withActiveRoot } from '../activeProject';

export interface ShellRunInput {
  command: string;
  timeoutMs?: number;
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
  /^find\b/, /^grep\b/, /^rg\b/, /^ag\b/,
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
  description: 'Ejecutar comando shell en el servidor (con aprobación si es peligroso).',
  danger: true,
  requiresApproval: (input) => commandRequiresApproval(input.command || ''),
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
  return !commandRequiresApproval(command);
}