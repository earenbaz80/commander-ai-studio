import type { ToolDefinition } from '../types';
import { withActiveRoot } from '../activeProject';
import { splitPipeline } from '../shellCommand';

export interface ShellRunInput {
  command: string;
  timeoutMs?: number;
  /** Arranca el comando en segundo plano: devuelve id, pid y log. */
  background?: boolean;
  /** Directorio de ejecución dentro del workspace (por defecto, la raíz). */
  cwd?: string;
  /**
   * Permitir un comando que no está en la allowlist. La aprobación del usuario
   * ya se pidió (`requiresApproval` la exige siempre para esos comandos): esto
   * sólo le dice al servidor que no rechace la ejecución.
   */
  allowUnlisted?: boolean;
  /** Abrir stdin para escribirle con `shell.job { action: "write" }`. Exige background. */
  interactive?: boolean;
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
  description:
    'Ejecutar comando shell en el servidor (admite pipes; con aprobación si es peligroso). ' +
    'cwd fija el directorio dentro del proyecto; allowUnlisted ejecuta algo fuera de la ' +
    'allowlist una vez aprobado; interactive abre stdin para shell.job write.',
  danger: true,
  // Un pipeline pide aprobación si cualquiera de sus etapas la pediría sola.
  // `allowUnlisted` NO relaja esto: un comando fuera de la lista siempre pasa
  // por el usuario, aunque el modelo pida el permiso en la propia llamada.
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
  action: 'list' | 'logs' | 'stop' | 'read' | 'write';
  id?: string;
  /** Líneas de log a devolver en `logs` (1-500, por defecto 40). */
  tail?: number;
  /** Con `read`: byte desde el que devolver lo nuevo (lo devuelve la llamada anterior). */
  cursor?: number;
  /** Con `write`: texto a enviar al stdin del proceso interactivo. */
  data?: string;
  /** Comprobación extra en `stop`: debe pertenecer al trabajo indicado. */
  pid?: number;
}

export const shellJobTool: ToolDefinition<ShellJobInput, any> = {
  id: 'shell.job',
  description:
    'Trabajos en segundo plano: listar, leer el log (tail), leer sólo lo nuevo desde un cursor ' +
    '(read), escribir en el stdin de un proceso interactivo (write) y parar por id.',
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
};/**
 * `shell.pty`: sesión interactiva persistente (proceso real con TTY).
 *
 * No reemplaza a `shell.run`: eso ejecuta y devuelve salida. Esto abre un
 * proceso —un REPL, `npm init`, un TUI— y habla con él a lo largo de varias
 * llamadas. Abrir y cerrar siempre piden aprobación: es un proceso vivo en la
 * máquina del usuario.
 */
export interface ShellPtyInput {
  action: 'open' | 'read' | 'write' | 'resize' | 'close' | 'list';
  id?: string;
  executable?: string;
  args?: string[];
  cwd?: string;
  cols?: number;
  rows?: number;
  data?: string;
  cursor?: number;
}

export const shellPtyTool: ToolDefinition<ShellPtyInput, any> = {
  id: 'shell.pty',
  description:
    'Sesión PTY persistente: abre un ejecutable con argumentos en array (sin shell ni pipes), ' +
    'lee sólo la salida nueva desde un cursor, escribe en su stdin, redimensiona y cierra.',
  danger: true,
  requiresApproval: (input) => input.action === 'open' || input.action === 'close',
  run: async (input) => {
    const res = await fetch('/api/agent/run-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId: 'shell.pty', input: withActiveRoot(input as any) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: (err as any).error || `HTTP ${res.status}` };
    }
    return res.json();
  },
};
