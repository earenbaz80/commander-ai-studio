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
  'npm ', 'git status', 'git log',
  'git diff', 'ls', 'dir', 'echo ', 'tsc ', 'vite ',
  'mkdir ', 'pwd', 'whoami',
  'git add ', 'git commit ', 'git stash ', 'git branch ', 'git checkout ',
  'git remote ', 'git fetch ', 'git pull ', 'git push ', 'git show ',
  'git restore ', 'git switch ', 'git config --get ', 'findstr ', 'find ',
  'grep ', 'rg ', 'head ', 'tail ', 'wc ', 'sort ', 'uniq ',
  'npm --version',
];

export const AGENT_TOOLS = new Set([
  'fs.read', 'fs.write', 'fs.edit', 'fs.glob', 'fs.grep', 'shell.run', 'shell.job',
  'read_diagnostics',
  'task',
  'web.fetch', 'web.search', 'code.run', 'mcp.call', 'mcp.list',
  'git.status', 'git.diff', 'git.log', 'git.commit',
  'git.worktree', 'git.rebase', 'git.conflict',
]);

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
