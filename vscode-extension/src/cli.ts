import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Localización y lanzamiento del CLI.
 *
 * El VSIX viaja con `cli/commander.mjs` y `cli/server.mjs` (ver
 * `scripts/bundle-cli.mjs`), así que en producción no hace falta `npx` ni un
 * `commander` global. El binario de Node es el propio Electron del extension
 * host (`ELECTRON_RUN_AS_NODE=1`), que ya está en la máquina.
 */

export interface AgentRun {
  extensionPath: string;
  /** `commander.cliCommand`: sólo para desarrollo o instalaciones propias. */
  configuredCli?: string;
  serverUrl: string;
  model?: string;
  task: string;
  cwd: string;
}

export interface TerminalInvocation {
  shellPath: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

/** Ruta del CLI empaquetado, o `null` si el VSIX se armó sin `cli/`. */
export function bundledCliPath(extensionPath: string): string | null {
  const file = path.join(extensionPath, 'cli', 'commander.mjs');
  return fs.existsSync(file) ? file : null;
}

function agentArgs(run: AgentRun, json: boolean): string[] {
  const args = ['agent', run.task, '--server', run.serverUrl];
  const model = (run.model ?? '').trim();
  if (model) args.push('--model', model);
  if (json) args.push('--json');
  return args;
}

/**
 * Terminal con TTY real: `shellPath` es el ejecutable de Node y los argumentos
 * van como argv, sin comillas de shell. Eso es lo que permite que el motor de
 * permisos pregunte en la terminal (con `--json` la aprobación se deniega).
 */
export function terminalInvocation(run: AgentRun): TerminalInvocation | null {
  const cli = bundledCliPath(run.extensionPath);
  if (!cli) return null;
  return {
    shellPath: process.execPath,
    args: [cli, ...agentArgs(run, false)],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    cwd: run.cwd,
  };
}

/**
 * Fallback de desarrollo cuando no hay `cli/` empaquetado: un comando de shell
 * configurado a mano (`npx commander`, `commander`, …).
 */
export function shellCommand(run: AgentRun): string {
  const configured = (run.configuredCli ?? 'npx commander').trim();
  const parts = [configured, ...agentArgs(run, false).map(shellArgument)];
  return parts.join(' ');
}

/**
 * Comillas para cmd/bash: JSON.stringify no sirve en PowerShell (duplica las
 * barras), así que se normaliza a comillas simples y se quitan los saltos.
 */
function shellArgument(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ').replace(/"/g, "'");
  return `"${clean}"`;
}

/** Spawn sin shell para el webview (`--json`); misma resolución que la terminal. */
export function spawnAgent(run: AgentRun, json: boolean): ChildProcess {
  const cli = bundledCliPath(run.extensionPath);
  if (cli) {
    return spawn(process.execPath, [cli, ...agentArgs(run, json)], {
      cwd: run.cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
    });
  }
  const configured = (run.configuredCli ?? '').trim();
  if (!configured) {
    throw new Error(
      'El VSIX no trae el CLI (cli/commander.mjs) y commander.cliCommand está vacío. ' +
        'Empaquetá con `npm run package` en vscode-extension o definí el comando del CLI.'
    );
  }
  return spawn(configured, agentArgs(run, json), {
    cwd: run.cwd,
    env: { ...process.env },
    shell: true,
    windowsHide: true,
  });
}
