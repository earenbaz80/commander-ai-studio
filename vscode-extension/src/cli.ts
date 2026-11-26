import * as fs from 'fs';
import * as path from 'path';

/**
 * CLI empaquetado en el VSIX (`scripts/bundle-cli.mjs`). Es el mismo binario
 * del escritorio: la extensión lo usa para arrancar el servidor embebido y no
 * para implementar el agente.
 */
export function bundledCliPath(extensionPath: string): string | null {
  const file = path.join(extensionPath, 'cli', 'commander.mjs');
  return fs.existsSync(file) ? file : null;
}
