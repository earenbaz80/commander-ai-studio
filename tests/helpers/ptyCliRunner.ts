/**
 * Ejecuta `commander agent` con un PTY real y reenvía su salida al padre.
 *
 * El runner de tests no debe quedarse con handles nativos de ConPTY: este
 * proceso auxiliar posee el PTY y sale en cuanto el CLI termina.
 */
import { spawn } from 'node-pty';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const CLI_PATH = path.join(REPO_ROOT, 'bin', 'commander.ts');

const child = spawn(
  process.execPath,
  ['--import', 'tsx', CLI_PATH, 'agent', ...process.argv.slice(2)],
  {
    cwd: REPO_ROOT,
    cols: 120,
    rows: 40,
    name: 'xterm-color',
    env: process.env as Record<string, string>,
  }
);

child.onData((chunk) => process.stdout.write(chunk));
child.onExit(({ exitCode }) => {
  // Forzar la salida cierra el handle del PTY sin el agente de ConPTY.
  process.stdout.write('', () => process.exit(exitCode ?? 1));
});

process.once('SIGTERM', () => {
  try {
    child.kill();
  } catch {
    /* ya terminó */
  }
  process.exit(143);
});
