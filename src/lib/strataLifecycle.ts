/**
 * Ciclo de vida del host local de Strata.
 *
 * El servidor de Commander puede lanzar el CLI de Strata y esperar a que
 * `/v1/status` confirme el modelo cargado. El proceso se mantiene fuera del
 * navegador: la UI sólo pide `start`/`stop` y recibe un estado. Las dependencias
 * son inyectables para probar la espera, el timeout y los argumentos sin
 * arrancar un host real.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeStrataLocalBaseUrl,
  parseStrataLocalStatus,
  probeStrataLocal,
  strataLocalEndpointInfo,
  strataLocalModelName,
} from './strataLocal';
import { redactStrataSecret } from './strataRedaction';

export type StrataLifecycleState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface StrataLifecycleStatus {
  state: StrataLifecycleState;
  baseUrl: string;
  requestedModel?: string;
  model?: string;
  context?: number;
  pid?: number;
  startedAt?: number;
  error?: string;
  logs?: string;
}

export interface StrataLifecycleResult extends StrataLifecycleStatus {
  success: boolean;
}

export interface StrataStartOptions {
  model: string;
  context: number;
  baseUrl?: string;
  apiKey?: string;
}

export interface StrataStopOptions {
  baseUrl?: string;
  apiKey?: string;
}

type SpawnFn = (command: string, args: string[], options: Record<string, unknown>) => ChildProcess;

interface LifecycleDeps {
  spawn: SpawnFn;
  fetch: typeof fetch;
  findBinary: () => string | null;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  timeoutMs: number;
  pollMs: number;
  stopTimeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_MS = 1_000;
const DEFAULT_STOP_TIMEOUT_MS = 30_000;

function tail(value: string, max = 4_000): string {
  return value.length > max ? `…${value.slice(-max)}` : value;
}

function portFromBaseUrl(baseUrl: string): number {
  try {
    const port = Number(new URL(baseUrl).port);
    return Number.isInteger(port) && port > 0 ? port : 8080;
  } catch {
    return 8080;
  }
}

function authHeaders(apiKey?: string): Record<string, string> {
  return {
    Accept: 'application/json',
    ...(apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
  };
}

/** Busca el CLI sin aceptar una ruta arbitraria desde la petición. */
export function findStrataBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform
): string | null {
  const explicit = env.STRATA_BIN?.trim();
  if (explicit) return explicit;

  const names = platform === 'win32' ? ['strata.CMD', 'strata.exe', 'strata'] : ['strata'];
  const dirs = String(env.PATH || env.Path || '')
    .split(path.delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean);
  if (platform === 'win32' && env.LOCALAPPDATA) {
    dirs.unshift(path.join(env.LOCALAPPDATA, 'Strata', 'terminal', 'current', 'bin'));
  }
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export class StrataLifecycleManager {
  private readonly deps: LifecycleDeps;
  private child: ChildProcess | null = null;
  private busy = false;
  private status: StrataLifecycleStatus = { state: 'stopped', baseUrl: '' };

  constructor(deps: Partial<LifecycleDeps> = {}) {
    this.deps = {
      spawn: spawn as SpawnFn,
      fetch,
      findBinary: () => findStrataBinary(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      timeoutMs: DEFAULT_TIMEOUT_MS,
      pollMs: DEFAULT_POLL_MS,
      stopTimeoutMs: DEFAULT_STOP_TIMEOUT_MS,
      ...deps,
    };
  }

  getStatus(): StrataLifecycleStatus {
    return { ...this.status };
  }

  getAvailability(): { available: boolean; binary?: string } {
    const binary = this.deps.findBinary();
    return binary ? { available: true, binary } : { available: false };
  }

  async start(options: StrataStartOptions): Promise<StrataLifecycleResult> {
    if (this.busy) return this.failure('Hay otra operación de Strata en curso');
    this.busy = true;
    try {
      return await this.doStart(options);
    } catch (error: any) {
      return this.failure(error?.message || 'No se pudo arrancar Strata');
    } finally {
      this.busy = false;
    }
  }

  async stop(options: StrataStopOptions = {}): Promise<StrataLifecycleResult> {
    if (this.busy) return this.failure('Hay otra operación de Strata en curso');
    this.busy = true;
    try {
      return await this.doStop(options);
    } catch (error: any) {
      return this.failure(error?.message || 'No se pudo detener Strata');
    } finally {
      this.busy = false;
    }
  }

  private failure(error: string): StrataLifecycleResult {
    this.status = { ...this.status, state: 'error', error };
    return { success: false, ...this.status };
  }

  private async doStart(options: StrataStartOptions): Promise<StrataLifecycleResult> {
    const baseUrl = normalizeStrataLocalBaseUrl(options.baseUrl);
    const endpoint = strataLocalEndpointInfo(baseUrl);
    if (endpoint.remote) {
      throw new Error('El ciclo de vida sólo puede gestionar un Strata en loopback');
    }
    const model = strataLocalModelName(String(options.model || '')).trim();
    if (!model) throw new Error('Modelo de Strata requerido');
    const context = Math.round(Number(options.context));
    if (!Number.isInteger(context) || context < 2_048 || context > 1_048_576) {
      throw new Error('Contexto de Strata inválido (2048–1048576)');
    }
    const apiKey = options.apiKey?.trim() || undefined;

    this.status = {
      state: 'starting',
      baseUrl,
      requestedModel: model,
      context,
    };

    const current = await this.readStatus(baseUrl, apiKey);
    if (current?.loaded && current.model) {
      const sameModel = await this.isRequestedModel(current.model, model, baseUrl, apiKey);
      const sameContext = !current.contextWindow || current.contextWindow === context;
      if (sameModel && sameContext) {
        this.status = {
          state: 'running',
          baseUrl,
          requestedModel: model,
          model: current.model,
          context: current.contextWindow || context,
        };
        return { success: true, ...this.status };
      }
    }

    if (current || this.child) await this.doStop({ baseUrl, apiKey });

    const binary = this.deps.findBinary();
    if (!binary) {
      throw new Error('No se encontró el CLI de Strata; define STRATA_BIN o instálalo en el PATH');
    }

    const port = portFromBaseUrl(baseUrl);
    const args = [
      'launch',
      '--model',
      model,
      '--context',
      String(context),
      '--port',
      String(port),
      '--no-tui',
      '--yes',
      '--output',
      'json',
    ];
    if (apiKey) args.push('--api-key-env', 'STRATA_API_KEY');

    const env = {
      ...process.env,
      ...(apiKey ? { STRATA_API_KEY: apiKey } : {}),
    };
    const child = this.deps.spawn(binary, args, {
      env,
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    let logs = '';
    const append = (chunk: Buffer | string) => {
      logs = tail(`${logs}${redactStrataSecret(String(chunk), apiKey)}`);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    let spawnError: Error | null = null;
    child.once('error', (error) => {
      spawnError = error;
      append(String(error?.message || error));
    });
    child.once('exit', (code, signal) => {
      if (this.status.state === 'starting') {
        this.status = {
          ...this.status,
          state: 'error',
          error: `Strata terminó antes de cargar el modelo (código ${code ?? '?'}${signal ? `, ${signal}` : ''})`,
          logs,
        };
      }
      if (this.child === child) this.child = null;
    });

    try {
      const deadline = this.deps.now() + this.deps.timeoutMs;
      while (this.deps.now() < deadline) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null) {
          throw new Error(`Strata terminó antes de cargar el modelo: ${tail(logs)}`);
        }
        const currentStatus = await this.readStatus(baseUrl, apiKey);
        if (currentStatus?.loaded && currentStatus.model) {
          if (!(await this.isRequestedModel(currentStatus.model, model, baseUrl, apiKey))) {
            throw new Error(
              `Strata cargó "${currentStatus.model}", no "${model}". Cambia el modelo antes de enviar mensajes.`
            );
          }
          this.status = {
            state: 'running',
            baseUrl,
            requestedModel: model,
            model: currentStatus.model,
            context: currentStatus.contextWindow || context,
            pid: child.pid,
            startedAt: this.deps.now(),
            logs: tail(logs),
          };
          return { success: true, ...this.status };
        }
        await this.deps.sleep(this.deps.pollMs);
      }

      throw new Error(
        `Strata no confirmó el modelo "${model}" en ${Math.round(this.deps.timeoutMs / 1000)} s. ${tail(logs)}`
      );
    } catch (error) {
      if (this.child && this.child.exitCode === null) {
        try {
          this.child.kill();
        } catch {
          /* el proceso ya terminó */
        }
      }
      this.child = null;
      throw error;
    }
  }

  private async doStop(options: StrataStopOptions = {}): Promise<StrataLifecycleResult> {
    const baseUrl = normalizeStrataLocalBaseUrl(options.baseUrl || this.status.baseUrl);
    const endpoint = strataLocalEndpointInfo(baseUrl);
    if (endpoint.remote) {
      throw new Error('El ciclo de vida sólo puede gestionar un Strata en loopback');
    }
    const apiKey = options.apiKey?.trim() || undefined;
    const current = await this.readStatus(baseUrl, apiKey);
    this.status = { ...this.status, state: 'stopping', baseUrl };

    if (!current && !this.child) {
      this.status = { state: 'stopped', baseUrl };
      return { success: true, ...this.status };
    }
    const binary = this.deps.findBinary();
    if (!binary && !this.child) {
      throw new Error('Strata está en marcha, pero no se encontró el CLI para detenerlo');
    }

    let logs = '';
    if (binary) {
      const env = { ...process.env, ...(apiKey ? { STRATA_API_KEY: apiKey } : {}) };
      const result = await this.runCommand(
        binary,
        ['launch', '--stop'],
        env,
        this.deps.stopTimeoutMs,
        apiKey
      );
      logs = result.logs;
      if (result.code !== 0) {
        throw new Error(`El CLI de Strata no pudo detener el host: ${tail(logs)}`);
      }
    }
    if (this.child && this.child.exitCode === null) {
      try {
        this.child.kill();
      } catch {
        /* el proceso ya terminó */
      }
    }
    this.child = null;

    const deadline = this.deps.now() + this.deps.stopTimeoutMs;
    while (this.deps.now() < deadline) {
      if (!(await this.readStatus(baseUrl, apiKey))) {
        this.status = {
          state: 'stopped',
          baseUrl,
          ...(logs.trim() ? { logs: tail(logs) } : {}),
        };
        return { success: true, ...this.status };
      }
      await this.deps.sleep(250);
    }
    throw new Error('Strata siguió respondiendo después de detenerlo');
  }

  private async runCommand(
    binary: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
    secret?: string
  ): Promise<{ code: number | null; logs: string }> {
    const child = this.deps.spawn(binary, args, {
      env,
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      logs = tail(`${logs}${redactStrataSecret(String(chunk), secret)}`);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      logs = tail(`${logs}${redactStrataSecret(String(chunk), secret)}`);
    });
    return await new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error: Error | null, code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve({ code, logs });
      };
      timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ya terminó */
        }
        finish(new Error(`El CLI de Strata no respondió en ${Math.round(timeoutMs / 1000)} s`), null);
      }, timeoutMs);
      child.once('error', (error) => finish(error, null));
      child.once('exit', (code) => finish(null, code));
    });
  }

  private async readStatus(baseUrl: string, apiKey?: string) {
    try {
      const response = await this.deps.fetch(`${baseUrl}/status`, {
        headers: authHeaders(apiKey),
        signal: AbortSignal.timeout(2_500),
      });
      if (!response.ok) return null;
      return parseStrataLocalStatus(await response.json().catch(() => null));
    } catch {
      return null;
    }
  }

  /** Acepta el alias que el CLI resuelve a un id canónico. */
  private async isRequestedModel(
    actual: string,
    requested: string,
    baseUrl: string,
    apiKey?: string
  ): Promise<boolean> {
    if (actual === requested) return true;
    try {
      const probe = await probeStrataLocal(baseUrl, apiKey, {
        timeoutMs: 2_000,
        fetcher: this.deps.fetch,
      });
      const requestedEntry = probe.entries.find(
        (entry) => entry.id === requested || entry.name === requested || entry.aliases?.includes(requested)
      );
      const actualEntry = probe.entries.find((entry) => entry.id === actual || entry.aliases?.includes(actual));
      if (requestedEntry && actualEntry) return requestedEntry.id === actualEntry.id;
      if (requestedEntry) return requestedEntry.id === actual;
      return Boolean(actualEntry?.aliases?.includes(requested));
    } catch {
      return false;
    }
  }
}
