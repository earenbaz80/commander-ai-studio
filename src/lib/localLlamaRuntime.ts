/**
 * Runtime nativo de llama.cpp para Commander.
 *
 * Commander descarga el binario de llama.cpp y arranca `llama-server` contra un
 * GGUF de `local_models/`. El resto de la app habla con el endpoint OpenAI que
 * expone ese proceso, así que un modelo descargado desde la app no necesita
 * Ollama, LM Studio, Bionic ni Strata.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

export interface LlamaBinaries {
  server?: string;
  cli?: string;
}

export interface LocalRuntimeStatus {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  model?: string;
  modelPath?: string;
  context?: number;
  gpuLayers?: number;
  port?: number;
  baseUrl?: string;
  pid?: number;
  error?: string;
  logs?: string;
  binary?: string;
}

export interface LocalRuntimeResult extends LocalRuntimeStatus {
  success: boolean;
}

type SpawnFn = (command: string, args: string[], options: Record<string, unknown>) => ChildProcess;

interface RuntimeDeps {
  spawn: SpawnFn;
  fetch: typeof fetch;
  findBinaries: () => LlamaBinaries;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  timeoutMs: number;
  pollMs: number;
  stopTimeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_MS = 500;
const DEFAULT_STOP_TIMEOUT_MS = 15_000;

/**
 * Busca `llama-server` y `llama-cli` dentro del runtime gestionado y en PATH.
 * Prefiere server: el CLI de una sola pasada no sirve para chat multi-turno.
 */
export function findLlamaBinaries(
  runtimeDir: string,
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform
): LlamaBinaries {
  const serverNames = platform === 'win32' ? ['llama-server.exe', 'llama-server'] : ['llama-server'];
  const cliNames = platform === 'win32' ? ['llama-cli.exe', 'llama-cli'] : ['llama-cli'];
  const result: LlamaBinaries = {};

  const walk = (dir: string, depth: number) => {
    if (depth > 4 || !fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!result.server && serverNames.includes(entry.name)) result.server = full;
      if (!result.cli && cliNames.includes(entry.name)) result.cli = full;
    }
  };
  walk(runtimeDir, 0);

  const dirs = String(env.PATH || env.Path || '')
    .split(path.delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean);
  for (const dir of dirs) {
    for (const name of serverNames) {
      if (!result.server && fs.existsSync(path.join(dir, name))) result.server = path.join(dir, name);
    }
    for (const name of cliNames) {
      if (!result.cli && fs.existsSync(path.join(dir, name))) result.cli = path.join(dir, name);
    }
  }
  return result;
}

function tail(value: string, max = 4_000): string {
  return value.length > max ? `…${value.slice(-max)}` : value;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('No se pudo reservar un puerto'))));
    });
  });
}

export class LocalLlamaRuntimeManager {
  private readonly deps: RuntimeDeps;
  private child: ChildProcess | null = null;
  private busy = false;
  private status: LocalRuntimeStatus = { state: 'stopped' };

  constructor(deps: Partial<RuntimeDeps> = {}) {
    this.deps = {
      spawn: spawn as SpawnFn,
      fetch,
      findBinaries: () => findLlamaBinaries(path.join(process.cwd(), 'runtime', 'llama')),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      timeoutMs: DEFAULT_TIMEOUT_MS,
      pollMs: DEFAULT_POLL_MS,
      stopTimeoutMs: DEFAULT_STOP_TIMEOUT_MS,
      ...deps,
    };
  }

  getStatus(): LocalRuntimeStatus {
    return { ...this.status };
  }

  getAvailability(): { available: boolean; server?: string; cli?: string } {
    const binaries = this.deps.findBinaries();
    return {
      available: Boolean(binaries.server),
      ...(binaries.server ? { server: binaries.server } : {}),
      ...(binaries.cli ? { cli: binaries.cli } : {}),
    };
  }

  async start(options: {
    modelPath: string;
    modelName?: string;
    context?: number;
    gpuLayers?: number;
    port?: number;
  }): Promise<LocalRuntimeResult> {
    if (this.busy) return this.failure('Hay otra operación del runtime en curso');
    this.busy = true;
    try {
      return await this.doStart(options);
    } catch (error: any) {
      return this.failure(error?.message || 'No se pudo arrancar llama.cpp');
    } finally {
      this.busy = false;
    }
  }

  async stop(): Promise<LocalRuntimeResult> {
    if (this.busy) return this.failure('Hay otra operación del runtime en curso');
    this.busy = true;
    try {
      return await this.doStop();
    } catch (error: any) {
      return this.failure(error?.message || 'No se pudo detener llama.cpp');
    } finally {
      this.busy = false;
    }
  }

  private failure(error: string): LocalRuntimeResult {
    this.status = { ...this.status, state: 'error', error };
    return { success: false, ...this.status };
  }

  private async doStart(options: {
    modelPath: string;
    modelName?: string;
    context?: number;
    gpuLayers?: number;
    port?: number;
  }): Promise<LocalRuntimeResult> {
    const modelPath = path.resolve(String(options.modelPath || ''));
    if (!modelPath || !fs.existsSync(modelPath) || !/\.gguf$/i.test(modelPath)) {
      throw new Error('Modelo GGUF no encontrado');
    }
    const context = Math.round(Number(options.context) || 8_192);
    if (!Number.isInteger(context) || context < 512 || context > 1_048_576) {
      throw new Error('Contexto inválido (512–1048576)');
    }
    const gpuLayers = Math.round(Number(options.gpuLayers ?? 99));
    if (!Number.isFinite(gpuLayers) || gpuLayers < 0 || gpuLayers > 999) {
      throw new Error('Capas GPU inválidas (0–999)');
    }

    const current = this.status;
    if (
      current.state === 'running' &&
      current.modelPath === modelPath &&
      current.context === context &&
      current.gpuLayers === gpuLayers &&
      this.child
    ) {
      return { success: true, ...this.status };
    }

    await this.doStop();

    const binaries = this.deps.findBinaries();
    if (!binaries.server) {
      throw new Error(
        'No se encontró llama-server. Descarga el runtime de llama.cpp desde Commander o instálalo en el PATH.'
      );
    }

    const port = Number(options.port) > 0 ? Math.round(Number(options.port)) : await freePort();
    this.status = {
      state: 'starting',
      model: options.modelName || path.basename(modelPath),
      modelPath,
      context,
      gpuLayers,
      port,
      baseUrl: `http://127.0.0.1:${port}/v1`,
      binary: binaries.server,
    };

    const args = [
      '-m',
      modelPath,
      '-c',
      String(context),
      '-ngl',
      String(gpuLayers),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--parallel',
      '1',
    ];
    const child = this.deps.spawn(binaries.server, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    let logs = '';
    const append = (chunk: Buffer | string) => {
      logs = tail(`${logs}${String(chunk)}`);
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
          error: `llama-server terminó antes de cargar el modelo (código ${code ?? '?'}${signal ? `, ${signal}` : ''})`,
          logs,
        };
      } else if (this.status.state === 'running' || this.status.state === 'stopping') {
        this.status = { ...this.status, state: 'stopped' };
      }
      if (this.child === child) this.child = null;
    });

    const deadline = this.deps.now() + this.deps.timeoutMs;
    while (this.deps.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) {
        throw new Error(`llama-server terminó antes de estar listo: ${tail(logs)}`);
      }
      try {
        const response = await this.deps.fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) {
          await response.body?.cancel().catch(() => {});
          this.status = {
            ...this.status,
            state: 'running',
            pid: child.pid,
          };
          return { success: true, ...this.status };
        }
        await response.body?.cancel().catch(() => {});
      } catch {
        /* todavía cargando */
      }
      await this.deps.sleep(this.deps.pollMs);
    }

    try {
      child.kill();
    } catch {
      /* ya terminó */
    }
    throw new Error(
      `llama-server no respondió en ${Math.round(this.deps.timeoutMs / 1000)} s. ${tail(logs)}`
    );
  }

  private async doStop(): Promise<LocalRuntimeResult> {
    const child = this.child;
    if (!child) {
      this.status = { state: 'stopped' };
      return { success: true, ...this.status };
    }
    this.status = { ...this.status, state: 'stopping' };
    // El listener se registra antes del kill: en Windows el proceso puede
    // emitir `exit` de forma síncrona y `once()` llegaría tarde.
    const exited = new Promise<boolean>((resolve) => {
      if (child.exitCode !== null) return resolve(true);
      child.once('exit', () => resolve(true));
    });
    try {
      child.kill();
    } catch {
      /* puede haber terminado entre la comprobación y el kill */
    }
    const timeout = this.deps.sleep(this.deps.stopTimeoutMs).then(() => false);
    const didExit = await Promise.race([exited, timeout]);
    if (!didExit) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* sin más opciones portables */
      }
    }
    if (this.child === child) this.child = null;
    this.status = { state: 'stopped' };
    return { success: true, ...this.status };
  }
}

export function localModelPath(root: string, filename: unknown): string | null {
  const base = path.basename(String(filename || '').replace(/\\/g, '/'));
  if (!base || base === '.' || base === '..' || !/\.gguf$/i.test(base)) return null;
  return path.join(root, base);
}
