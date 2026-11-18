/**
 * Runtime nativo de llama.cpp para Commander.
 *
 * Commander descarga el binario de llama.cpp y arranca `llama-server` contra un
 * GGUF de `local_models/`. El resto de la app habla con el endpoint OpenAI que
 * expone ese proceso, así que un modelo descargado desde la app no necesita
 * Ollama, LM Studio, Bionic ni Strata.
 *
 * Los modelos grandes (MoE tipo Qwen3.8 o Qwen3.6-35B-A3B) se ejecutan aquí
 * con la misma técnica que usa Strata: expertos en RAM (`--n-cpu-moe`), capas
 * densas en GPU, plantilla Jinja, flash attention y caché KV cuantizada. Por
 * eso el manager no se limita a `-m/-c/-ngl`: expone esos ajustes como estado
 * del proceso y los reconstruye al arrancar.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

export interface LlamaBinaries {
  server?: string;
  cli?: string;
}

/** Ajustes de llama.cpp pensados para modelos grandes y tool calling. */
export interface LocalRuntimeTuning {
  /** `--jinja`: usa la plantilla de chat del GGUF (tool calling moderno). */
  jinja?: boolean;
  /** `--flash-attn`: atención flash; requisito de la caché KV cuantizada. */
  flashAttention?: boolean;
  /** `--n-cpu-moe`: capas de expertos MoE que quedan en CPU/RAM. */
  cpuMoeLayers?: number;
  /** `--cache-type-k`: tipo de la caché KV de claves (`q8_0`, `f16`…). */
  cacheTypeK?: string;
  /** `--cache-type-v`: tipo de la caché KV de valores. */
  cacheTypeV?: string;
  /** `--tensor-split`: proporción por GPU, por ejemplo `1,1`. */
  tensorSplit?: string;
}

/** Ajustes ya validados y listos para construir argumentos o comparar procesos. */
export interface NormalizedLocalRuntimeTuning {
  jinja: boolean;
  flashAttention: boolean;
  cpuMoeLayers?: number;
  cacheTypeK?: string;
  cacheTypeV?: string;
  tensorSplit?: string;
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
  /** Ajustes con los que se arrancó el proceso actual. */
  jinja?: boolean;
  flashAttention?: boolean;
  cpuMoeLayers?: number;
  cacheTypeK?: string;
  cacheTypeV?: string;
  tensorSplit?: string;
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

/** Tipos de caché KV que entiende la build instalada (`-ctk/-ctv`). */
export const KV_CACHE_TYPES = [
  'f32',
  'f16',
  'bf16',
  'f8_e4m3',
  'q8_0',
  'q5_1',
  'q5_0',
  'q4_1',
  'q4_0',
  'iq4_nl',
] as const;

/** Tipos de caché KV que no son de coma flotante: exigen flash-attn. */
export const QUANTIZED_KV_TYPES = new Set<string>([
  'f8_e4m3',
  'q8_0',
  'q5_1',
  'q5_0',
  'q4_1',
  'q4_0',
  'iq4_nl',
]);

/**
 * Valida y completa los ajustes. Jinja y flash attention van activos por
 * defecto: sin ellos un MoE grande pierde tool calling o no arranca con caché
 * cuantizada, que es justo lo que el usuario no quiere descubrir al cargar.
 */
export function normalizeLocalRuntimeTuning(
  input: LocalRuntimeTuning = {}
): NormalizedLocalRuntimeTuning {
  const jinja = input.jinja !== false;
  const flashAttention = input.flashAttention !== false;
  const rawMoe = input.cpuMoeLayers;
  const cpuMoeLayers =
    rawMoe === undefined || rawMoe === null || String(rawMoe).trim() === ''
      ? undefined
      : Math.round(Number(rawMoe));
  if (
    cpuMoeLayers !== undefined &&
    (!Number.isFinite(cpuMoeLayers) || cpuMoeLayers < 0 || cpuMoeLayers > 999)
  ) {
    throw new Error('Capas MoE en CPU inválidas (0–999)');
  }

  const readCacheType = (value: unknown, label: string): string | undefined => {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!raw) return undefined;
    if (!(KV_CACHE_TYPES as readonly string[]).includes(raw)) {
      throw new Error(`${label} inválida (${KV_CACHE_TYPES.join(', ')})`);
    }
    return raw;
  };
  const cacheTypeK = readCacheType(input.cacheTypeK, 'Caché KV de claves');
  const cacheTypeV = readCacheType(input.cacheTypeV, 'Caché KV de valores');

  const tensorSplitRaw = typeof input.tensorSplit === 'string' ? input.tensorSplit.trim() : '';
  if (tensorSplitRaw && !/^\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?){0,15}$/.test(tensorSplitRaw)) {
    throw new Error('tensor-split inválido (proporciones por GPU, por ejemplo 1,1)');
  }

  const quantized = [cacheTypeK, cacheTypeV].some((type) => !!type && QUANTIZED_KV_TYPES.has(type));
  if (quantized && !flashAttention) {
    throw new Error('La caché KV cuantizada requiere flash-attn');
  }

  return {
    jinja,
    flashAttention,
    ...(cpuMoeLayers ? { cpuMoeLayers } : {}),
    ...(cacheTypeK ? { cacheTypeK } : {}),
    ...(cacheTypeV ? { cacheTypeV } : {}),
    ...(tensorSplitRaw ? { tensorSplit: tensorSplitRaw } : {}),
  };
}

export interface LlamaServerArgsInput extends NormalizedLocalRuntimeTuning {
  modelPath: string;
  context: number;
  gpuLayers: number;
  port: number;
}

/**
 * Argumentos de `llama-server`. El orden es estable para que el proceso se
 * pueda comparar (y reiniciar) cuando cambia cualquier ajuste.
 */
export function buildLlamaServerArgs(input: LlamaServerArgsInput): string[] {
  return [
    '-m',
    input.modelPath,
    '-c',
    String(input.context),
    '-ngl',
    String(input.gpuLayers),
    '--host',
    '127.0.0.1',
    '--port',
    String(input.port),
    '--parallel',
    '1',
    // Jinja viene activado por defecto en la build instalada: para apagarlo
    // hace falta el negativo explícito, igual que con flash-attn, que exige
    // valor ('on'|'off'|'auto') y si no se come el argumento siguiente.
    ...(input.jinja ? ['--jinja'] : ['--no-jinja']),
    ...(input.flashAttention ? ['--flash-attn', 'on'] : ['--flash-attn', 'off']),
    ...(input.cpuMoeLayers ? ['--n-cpu-moe', String(input.cpuMoeLayers)] : []),
    ...(input.cacheTypeK ? ['--cache-type-k', input.cacheTypeK] : []),
    ...(input.cacheTypeV ? ['--cache-type-v', input.cacheTypeV] : []),
    ...(input.tensorSplit ? ['--tensor-split', input.tensorSplit] : []),
  ];
}

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

function sameTuning(
  current: LocalRuntimeStatus,
  tuning: NormalizedLocalRuntimeTuning
): boolean {
  return (
    current.jinja === tuning.jinja &&
    current.flashAttention === tuning.flashAttention &&
    (current.cpuMoeLayers ?? undefined) === tuning.cpuMoeLayers &&
    (current.cacheTypeK ?? undefined) === tuning.cacheTypeK &&
    (current.cacheTypeV ?? undefined) === tuning.cacheTypeV &&
    (current.tensorSplit ?? undefined) === tuning.tensorSplit
  );
}

type LocalRuntimeStartOptions = {
  modelPath: string;
  modelName?: string;
  context?: number;
  gpuLayers?: number;
  port?: number;
} & LocalRuntimeTuning;

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

  async start(options: LocalRuntimeStartOptions): Promise<LocalRuntimeResult> {
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

  private async doStart(options: LocalRuntimeStartOptions): Promise<LocalRuntimeResult> {
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
    const tuning = normalizeLocalRuntimeTuning(options);

    const current = this.status;
    if (
      current.state === 'running' &&
      current.modelPath === modelPath &&
      current.context === context &&
      current.gpuLayers === gpuLayers &&
      sameTuning(current, tuning) &&
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
      ...tuning,
    };

    const args = buildLlamaServerArgs({ modelPath, context, gpuLayers, port, ...tuning });
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
