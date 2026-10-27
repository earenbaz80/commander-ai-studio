import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHELL_BLOCKED, SHELL_OPERATORS, SHELL_ALLOW_PREFIX, sanitizeGitMessage } from '../security.js';

test('SHELL_BLOCKED contiene patrones destructivos críticos', () => {
  assert.ok(SHELL_BLOCKED.includes('rm -rf /'));
  assert.ok(SHELL_BLOCKED.includes('mkfs'));
  assert.ok(SHELL_BLOCKED.includes('shutdown'));
  assert.ok(SHELL_BLOCKED.includes(':(){:|:&};'));
  assert.ok(SHELL_BLOCKED.includes('/etc/passwd'));
  assert.ok(SHELL_BLOCKED.includes('.ssh'));
  assert.ok(SHELL_BLOCKED.includes('.env'));
});

test('SHELL_OPERATORS contiene operadores de shell peligrosos', () => {
  assert.ok(SHELL_OPERATORS.includes('|'));
  assert.ok(SHELL_OPERATORS.includes(';'));
  assert.ok(SHELL_OPERATORS.includes('&&'));
  assert.ok(SHELL_OPERATORS.includes('||'));
  assert.ok(SHELL_OPERATORS.includes('`'));
  assert.ok(SHELL_OPERATORS.includes('$('));
  assert.ok(SHELL_OPERATORS.includes('${'));
});

test('SHELL_ALLOW_PREFIX contiene comandos seguros', () => {
  assert.ok(SHELL_ALLOW_PREFIX.includes('npm run '));
  assert.ok(SHELL_ALLOW_PREFIX.includes('git status'));
  assert.ok(SHELL_ALLOW_PREFIX.includes('ls'));
  assert.ok(SHELL_ALLOW_PREFIX.includes('echo '));
});

test('allowlist: npm install/exec quedan fuera (el postinstall es RCE)', () => {
  // El prefijo suelto `npm ` permitía `npm install <pkg>` y `npm exec <pkg>`,
  // que ejecutan código del paquete sin usar ningún operador de shell.
  assert.ok(!SHELL_ALLOW_PREFIX.includes('npm '), 'no debe existir el prefijo "npm " suelto');
  for (const cmd of ['npm install evil', 'npm i evil', 'npm exec evil', 'npm uninstall x']) {
    assert.ok(
      !SHELL_ALLOW_PREFIX.some((p) => cmd.toLowerCase().startsWith(p)),
      `no debería permitir: ${cmd}`
    );
  }
});

test('allowlist: los npm permitidos siguen funcionando', () => {
  for (const cmd of ['npm run build', 'npm test', 'npm test:node', 'npm ls']) {
    assert.ok(
      SHELL_ALLOW_PREFIX.some((p) => cmd.toLowerCase().startsWith(p)),
      `debería permitir: ${cmd}`
    );
  }
});

test('allowlist: find queda fuera (-delete / -exec no usan operadores)', () => {
  for (const cmd of ['find . -delete', 'find . -exec rm {}']) {
    assert.ok(
      !SHELL_ALLOW_PREFIX.some((p) => cmd.toLowerCase().startsWith(p)),
      `no debería permitir: ${cmd}`
    );
  }
});

test('SHELL_ALLOW_PREFIX NO contiene comandos peligrosos', () => {
  const dangerous = ['rm -rf', 'rm ', 'del ', 'del /s', 'cp ', 'mv ', 'cat ', 'type ', 'node ', 'npx ', 'python ', 'pip ', 'awk ', 'sed ', 'format', 'mkfs', 'shutdown', 'sudo', 'su'];
  for (const cmd of dangerous) {
    assert.ok(!SHELL_ALLOW_PREFIX.includes(cmd), `No debería permitir: ${cmd}`);
  }
});

test('SHELL_OPERATORS bloquea expansión de variables de cmd.exe', () => {
  assert.ok(SHELL_OPERATORS.some((op) => 'echo %GEMINI_API_KEY%'.includes(op)));
});

test('Comando con operador de shell es detectado', () => {
  const malicious = 'ls | cat /etc/passwd';
  const hasOperator = SHELL_OPERATORS.some((op) => malicious.includes(op));
  assert.ok(hasOperator, 'Debería detectar operador |');
});

test('Comando con $() es detectado', () => {
  const malicious = 'echo $(whoami)';
  const hasOperator = SHELL_OPERATORS.some((op) => malicious.includes(op));
  assert.ok(hasOperator, 'Debería detectar $()');
});

test('Comando con backtick es detectado', () => {
  const malicious = 'echo `whoami`';
  const hasOperator = SHELL_OPERATORS.some((op) => malicious.includes(op));
  assert.ok(hasOperator, 'Debería detectar backtick');
});

test('Patrón rm -rf / es bloqueado', () => {
  const cmd = 'rm -rf / --no-preserve-root';
  const isBlocked = SHELL_BLOCKED.some((b) => cmd.toLowerCase().includes(b));
  assert.ok(isBlocked, 'Debería bloquear rm -rf /');
});

test('Acceso a .env es bloqueado', () => {
  const cmd = 'cat .env';
  const isBlocked = SHELL_BLOCKED.some((b) => cmd.toLowerCase().includes(b));
  assert.ok(isBlocked, 'Debería bloquear acceso a .env');
});

test('Acceso a .ssh es bloqueado', () => {
  const cmd = 'cat .ssh/id_rsa';
  const isBlocked = SHELL_BLOCKED.some((b) => cmd.toLowerCase().includes(b));
  assert.ok(isBlocked, 'Debería bloquear acceso a .ssh');
});

test('sudo es bloqueado', () => {
  const cmd = 'sudo rm -rf /';
  const isBlocked = SHELL_BLOCKED.some((b) => cmd.toLowerCase().includes(b));
  assert.ok(isBlocked, 'Debería bloquear sudo');
});

test('sanitizeGitMessage elimina sustitución de comandos', () => {
  assert.equal(sanitizeGitMessage('fix $(whoami)'), 'fix (whoami)');
  assert.equal(sanitizeGitMessage('fix `whoami`'), 'fix whoami');
});

test('sanitizeGitMessage elimina encadenamiento y redirección', () => {
  assert.equal(sanitizeGitMessage('a; rm -rf /'), 'a rm -rf /');
  assert.equal(sanitizeGitMessage('a | cat'), 'a  cat');
  assert.equal(sanitizeGitMessage('a && b'), 'a  b');
  assert.equal(sanitizeGitMessage('a > /tmp/x'), 'a  /tmp/x');
  assert.equal(sanitizeGitMessage('a\nb'), 'ab');
});

test('sanitizeGitMessage conserva mensajes convencionales', () => {
  assert.equal(sanitizeGitMessage('fix(scope): multiplexar vista'), 'fix(scope): multiplexar vista');
  assert.equal(sanitizeGitMessage('  docs: readme  '), 'docs: readme');
});

test('sanitizeGitMessage acota a 500 caracteres', () => {
  assert.equal(sanitizeGitMessage('x'.repeat(600)).length, 500);
});
