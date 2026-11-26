import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'child_process';
import * as http from 'http';
import { bundledCliPath } from './cli';

/**
 * Servidor embebido: arrancar si hace falta y reutilizar si ya responde.
 *
 * El servidor es el mismo de Commander (`cli/server.mjs`, con `commander
 * serve`): la extensión no implementa ni el bucle ni los permisos. Se escucha
 * sólo en loopback y se detiene al desactivar la extensión.
 */

const DEFAULT_URL = 'http://127.0.0.1:3280';
const API_KEY_SECRET = 'commander.apiKey';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const START_TIMEOUT_MS = 30_000;

let child: ChildProcess | undefined;
let channel: vscode.OutputChannel | undefined;
let starting: Promise<string> | undefined;

export function serverUrl(): string {
  return vscode.workspace.getConfiguration('commander').get<string>('serverUrl') || DEFAULT_URL;
}

export function workspaceCwd(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

/** Nombre de la variable de entorno que recibe la clave (allowlist corta). */
export function apiKeyName(): string {
  const allowed = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'CUSTOM_API_KEY'];
  const configured = vscode.workspace.getConfiguration('commander').get<string>('apiKeyName');
  return configured && allowed.includes(configured) ? configured : 'GEMINI_API_KEY';
}

function output(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel('Commander');
  return channel;
}

function isHealthy(url: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = http.get(`${url}/api/health`, { timeout: timeoutMs }, (res) => {
      res.resume();
      done(res.statusCode === 200);
    });
    req.on('timeout', () => {
      req.destroy();
      done(false);
    });
    req.on('error', () => done(false));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function secretEnv(context: vscode.ExtensionContext): Promise<Record<string, string>> {
  const value = await context.secrets.get(API_KEY_SECRET);
  return value ? { [apiKeyName()]: value } : {};
}

/** Pide la clave y la guarda en el almacén seguro de VS Code (nunca en settings). */
export async function configureApiKey(context: vscode.ExtensionContext): Promise<void> {
  const name = apiKeyName();
  const value = await vscode.window.showInputBox({
    prompt: `Clave de ${name} (se guarda en el almacén seguro de VS Code)`,
    password: true,
    ignoreFocusOut: true,
  });
  if (!value?.trim()) return;
  await context.secrets.store(API_KEY_SECRET, value.trim());
  // El servidor lee la clave al arrancar: se reinicia para que la tome.
  stopServer();
  void vscode.window.showInformationMessage(`Commander: clave de ${name} guardada.`);
}

export async function clearApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(API_KEY_SECRET);
  stopServer();
  void vscode.window.showInformationMessage('Commander: clave eliminada.');
}

/**
 * Devuelve la URL del servidor, arrancándolo si no responde. Las llamadas
 * concurrentes comparten el mismo arranque.
 */
export async function ensureServer(context: vscode.ExtensionContext): Promise<string> {
  const url = serverUrl();
  if (await isHealthy(url)) return url;

  if (!vscode.workspace.getConfiguration('commander').get<boolean>('autoStartServer', true)) {
    throw new Error(`El servidor no responde en ${url} y commander.autoStartServer está desactivado.`);
  }
  if (starting) return starting;

  starting = startServer(context, url).finally(() => {
    starting = undefined;
  });
  return starting;
}

async function startServer(context: vscode.ExtensionContext, url: string): Promise<string> {
  const parsed = new URL(url);
  if (!LOOPBACK.has(parsed.hostname)) {
    throw new Error(`No se arranca el servidor en ${parsed.hostname}: sólo loopback (127.0.0.1/localhost).`);
  }
  const cli = bundledCliPath(context.extensionPath);
  if (!cli) {
    throw new Error(
      'El VSIX no trae el servidor embebido (cli/server.mjs). Reinstalá el paquete generado con ' +
        '`npm run package` en vscode-extension.'
    );
  }

  const port = parsed.port || '3280';
  const log = output();
  log.appendLine(`[commander] arrancando servidor en 127.0.0.1:${port} (cwd: ${workspaceCwd()})`);

  const proc = spawn(process.execPath, [cli, 'serve', '--port', port, '--host', '127.0.0.1'], {
    cwd: workspaceCwd(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...(await secretEnv(context)) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = proc;

  let exitDetail = '';
  proc.stdout?.on('data', (data: Buffer) => log.append(data.toString()));
  proc.stderr?.on('data', (data: Buffer) => log.append(data.toString()));
  proc.on('exit', (code, signal) => {
    if (child === proc) child = undefined;
    if (code !== 0 && code !== null) exitDetail = `el servidor terminó con código ${code}`;
    else if (signal) exitDetail = `el servidor terminó con señal ${signal}`;
    log.appendLine(`[commander] servidor detenido (${code ?? signal ?? 'sin código'})`);
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exitDetail) throw new Error(`${exitDetail}. Mirá la salida "Commander" para el detalle.`);
    if (await isHealthy(url, 1000)) return url;
    await delay(300);
  }
  throw new Error(
    `El servidor no respondió en ${START_TIMEOUT_MS / 1000} s en ${url}. ` +
      'Mirá la salida "Commander" para el detalle (clave, puerto ocupado, CLI incompleto).'
  );
}

export function stopServer(): void {
  if (child && !child.killed) child.kill();
  child = undefined;
}
