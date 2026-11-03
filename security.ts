export const SHELL_BLOCKED = [
  'rm -rf /', 'rm -rf --no-preserve-root', 'mkfs', ':(){:|:&};', 'shutdown',
  'reboot', 'halt', 'poweroff', 'dd if=', 'chmod -r /', '> /dev/sda',
  'mkfs.ext4', 'mkfs.ext3', 'mkfs.vfat', 'fdisk', 'format c:',
  'wget', 'curl', 'nc ', 'netcat', 'telnet', 'ssh ', 'scp ', 'sftp ',
  'base64 -d', 'eval ', 'exec ', 'source ', '. ', 'sudo ', 'su ',
  'chown', 'chmod 777', 'chmod -R 777', '/etc/passwd', '/etc/shadow',
  '.ssh', '.env', 'credentials', 'id_rsa', 'id_ed25519',
  'npm exec', 'npm x ',
];

// Incluye separadores/redirecciones que un shell interpretaría (cmd.exe y sh).
// `%` y `^` se bloquean porque cmd.exe expande %VAR% (p. ej. claves de API) y escapa con ^.
export const SHELL_OPERATORS = ['|', ';', '&&', '||', '`', '$(', '${', '<(', '>(', '>>', '2>', '&>', '&', '>', '<', '%', '^'];

export const SHELL_ALLOW_PREFIX = [
  // npm: solo subcomandos que no instalan paquetes ajenos. `npm install <pkg>`
  // y `npm exec` ejecutan el código del paquete (postinstall) con los
  // privilegios del servidor, así que no pueden estar en la allowlist.
  'npm run ', 'npm test', 'npm ls', 'npm list', 'npm --version',
  'git status', 'git log',
  'git diff', 'ls', 'dir', 'echo ', 'tsc ', 'vite ',
  'mkdir ', 'pwd', 'whoami',
  'git add ', 'git commit ', 'git stash ', 'git branch ', 'git checkout ',
  'git remote ', 'git fetch ', 'git pull ', 'git push ', 'git show ',
  'git restore ', 'git switch ', 'git config --get ', 'findstr ',
  // Sin `find`: `find . -delete` y `find . -exec <cmd>` no usan operadores de
  // shell, así que pasaban todos los filtros anteriores.
  'grep ', 'rg ', 'head ', 'tail ', 'wc ', 'sort ', 'uniq ',
];

/**
 * Tools que el servidor ejecuta para el agente. Es la lista que decide dos cosas:
 *
 *  - qué `toolId` acepta `/api/agent/run-tool` (y, con eso, qué puede llamar el
 *    orquestador sin morir en un 400);
 *  - qué tools se pueden recortar con `allowedTools`/`deniedTools` del proyecto.
 *
 * La mayoría viaja por run-tool. `worktree.create` no: el cliente habla con
 * `POST /api/worktrees` porque lo que hace (git worktree add, copiar .env,
 * `npm install`) no es una tool de contexto. Aun así entra aquí, porque ese
 * endpoint aplica los mismos permisos: estar en esta lista es lo que hace que
 * el modo plan y las listas del proyecto lo gobiernen.
 *
 * `tests/toolRegistry.test.ts` cruza esta lista con `TOOL_REGISTRY` en las dos
 * direcciones: una tool que el modelo ve y el servidor rechaza es un bug de una
 * línea, y una que el servidor acepta pero nadie define es la mitad de un unit.
 */
export const AGENT_TOOLS = new Set([
  'fs.read', 'fs.write', 'fs.edit', 'fs.glob', 'fs.grep',
  'fs.propose.edit', 'fs.propose.write',
  'shell.run', 'shell.job',
  'browser', 'preview',
  'read_diagnostics',
  'code.analyze', 'code.refactor', 'code.fix',
  'task', 'spawn_agents', 'skill', 'run_file_change_hooks',
  'web.fetch', 'web.search', 'code.run', 'mcp.call', 'mcp.list',
  'git.status', 'git.diff', 'git.log', 'git.commit',
  'git.worktree', 'git.rebase', 'git.conflict',
  'worktree.create',
]);

// ── Rutas sensibles: nunca se leen ni se buscan ──
//
// `shell.run` ya bloquea `.env`/`id_rsa`/`credentials` desde SHELL_BLOCKED, pero
// las tools de filesystem pasan por otro camino. Sin este filtro, un
// `fs.read({path: '.env'})` manda las claves del proyecto al proveedor del LLM.

/** Nombres completos que siempre son secretos. */
const SECRET_BASENAMES = new Set([
  '.npmrc', '.netrc', '_netrc', '.pgpass', '.htpasswd',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
]);

/** Extensiones de material criptográfico. */
const SECRET_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore'];

/** Plantillas de entorno: inertes, el agente sí puede leerlas. */
export const ENV_TEMPLATE_RE = /^\.env\.(example|sample|template|dist|defaults)$/i;

/** ¿La ruta es un archivo de secretos que el agente no debe leer? */
export function isSensitivePath(relPath: string): boolean {
  const base = String(relPath || '').split(/[\\/]/).pop() || '';
  const lower = base.toLowerCase();
  if (lower === '.env') return true;
  if (lower.startsWith('.env.') && !ENV_TEMPLATE_RE.test(lower)) return true;
  if (SECRET_BASENAMES.has(lower)) return true;
  return SECRET_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export const SENSITIVE_READ_MESSAGE =
  'Archivo sensible (claves/credenciales): no se lee ni se busca. ' +
  'Pide al usuario que copie el valor que necesites, o lee una plantilla .env.example.';

/**
 * Sanea un mensaje de commit antes de interpolarlo en `git commit -m "..."`.
 * El comando se ejecuta vía shell (execSync), así que hay que eliminar
 * sustitución de comandos, encadenamiento, redirecciones y saltos de línea.
 * Los paréntesis se conservan (convencional commits: "fix(scope): ...").
 */
export function sanitizeGitMessage(msg: unknown): string {
  return String(msg || '')
    .slice(0, 500)
    .replace(/["`$;|&<>\r\n]/g, '')
    .trim();
}
