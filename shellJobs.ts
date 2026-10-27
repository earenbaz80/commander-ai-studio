/**
 * Ejecución de pipelines y trabajos en segundo plano del agente.
 *
 * Dos reglas que no se negocian aquí:
 *
 * 1. **Nunca hay un shell interpretando el comando.** Cada etapa ya viene
 *    validada por `splitPipeline` y se lanza por separado; los pipes se
 *    construyen encadenando `stdio` en Node. En Windows cada etapa va por
 *    `cmd /c` (porque `npm` es un `.cmd` y `echo`/`dir` son builtins) y en
 *    POSIX se hace `spawn(bin, args)` sin shell.
 *
 * 2. **Solo se mata lo que este registro arrancó.** `stop` acepta un id (y,
 *    opcionalmente, un pid que debe pertenecer a ese trabajo). No existe forma
 *    de pedir la muerte de un PID arbitrario: si no está en el registro, se
 *    rechaza. Nada de `taskkill` por patrón ni de `pkill`.
 */

import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { segmentBinary } from './src/agent/shellCommand.js';

export type JobStatus = 'running' | 'exited' | 'stopped';

export interface ShellJob {
  id: string;
  command: string;
  segments: string[];
  cwd: string;
  /** PIDs de todas las etapas (el de la última es el que reporta el código). */
  pids: number[];
  /** PID de la última etapa. */
  pid: number | null;
  logPath: string;
  startedAt: number;
  status: JobStatus;
  exitCode: number | null;
  endedAt: number | null;
  error?: string;
}

export interface PublicJob extends Omit<ShellJob, 'segments'> {
  runningMs: number;
}

/** Máximo de trabajos recordados a la vez (los terminados se desalojan antes). */
export const MAX_JOBS = 10;

/** Directorio de logs: fuera del proyecto, para no ensuciar el repo. */
export const JOB_DIR = path.join(os.tmpdir(), 'commander-jobs');

const jobs = new Map<string, ShellJob>();
let seq = 0;

function spawnSegment(segment: string, cwd: string, stdio: any[]): ChildProcess {
  if (process.platform === 'win32') {
    return spawn(process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', segment], {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: stdio as any,
    });
  }
  const tokens = segment.split(/\s+/).filter(Boolean);
  const [bin, ...args] = tokens;
  return spawn(bin, args, { cwd, windowsHide: true, stdio: stdio as any });
}

function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (!pid || pid <= 0) return resolve();
    if (process.platform === 'win32') {
      execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true }, () => resolve());
      return;
    }
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return resolve();
    }
    setTimeout(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* ya murió */
      }
      resolve();
    }, 1200);
  });
}

function alive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function toPublicJob(job: ShellJob): PublicJob {
  const { segments: _segments, ...rest } = job;
  return {
    ...rest,
    runningMs: (job.endedAt ?? Date.now()) - job.startedAt,
  };
}

function evictIfFull(): string | null {
  if (jobs.size < MAX_JOBS) return null;
  for (const [id, job] of jobs) {
    if (job.status !== 'running') {
      jobs.delete(id);
      return null;
    }
  }
  return `Ya hay ${MAX_JOBS} trabajos en marcha; para alguno con shell.job { action: "stop", id } antes de lanzar otro.`;
}

export interface PipelineOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * Ejecuta un pipeline en primer plano y devuelve la salida de la última etapa.
 * El timeout mata todas las etapas; el código 124 marca el corte.
 */
export function runPipeline(segments: string[], cwd: string, timeoutMs: number): Promise<PipelineOutput> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const children: ChildProcess[] = [];

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout: stdout.slice(0, 20000), stderr: stderr.slice(0, 5000), exitCode, timedOut });
    };
    const appendErr = (chunk: unknown) => {
      stderr = (stderr + String(chunk)).slice(-5000);
    };

    let input: any = 'ignore';
    segments.forEach((segment, i) => {
      const isLast = i === segments.length - 1;
      const child = spawnSegment(segment, cwd, [input, 'pipe', 'pipe']);
      children.push(child);
      input = child.stdout;
      child.stderr?.on('data', appendErr);
      child.on('error', (e: any) => {
        appendErr(
          e?.code === 'ENOENT'
            ? `No existe el ejecutable: ${segmentBinary(segment)}\n`
            : `${e?.message || e}\n`,
        );
        if (isLast) finish(1);
      });
      if (isLast) {
        child.stdout?.on('data', (d) => {
          stdout = (stdout + String(d)).slice(-20000);
        });
        child.on('close', (code) => finish(code ?? 0));
      }
    });

    timer = setTimeout(() => {
      timedOut = true;
      for (const child of children) {
        try {
          child.kill();
        } catch {
          /* ya murió */
        }
      }
      const last = children[children.length - 1];
      if (process.platform === 'win32' && last?.pid) void killTree(last.pid);
      finish(124);
    }, timeoutMs);
  });
}

/**
 * Arranca un pipeline en segundo plano: stdio a un log y el proceso desacoplado
 * del request. Devuelve el trabajo con su id para consultarlo o pararlo.
 */
export function startJob(
  command: string,
  segments: string[],
  cwd: string,
): { ok: true; job: PublicJob } | { ok: false; error: string } {
  const full = evictIfFull();
  if (full) return { ok: false, error: full };

  try {
    fs.mkdirSync(JOB_DIR, { recursive: true });
  } catch (e: any) {
    return { ok: false, error: `No se pudo crear el directorio de logs: ${e?.message || e}` };
  }

  seq += 1;
  const id = `job-${Date.now().toString(36)}-${seq}`;
  const logPath = path.join(JOB_DIR, `${id}.log`);
  let fd: number;
  try {
    fd = fs.openSync(logPath, 'a');
  } catch (e: any) {
    return { ok: false, error: `No se pudo abrir el log: ${e?.message || e}` };
  }

  const job: ShellJob = {
    id,
    command,
    segments,
    cwd,
    pids: [],
    pid: null,
    logPath,
    startedAt: Date.now(),
    status: 'running',
    exitCode: null,
    endedAt: null,
  };

  const closeLog = () => {
    try {
      fs.closeSync(fd);
    } catch {
      /* ya cerrado */
    }
  };

  let input: any = 'ignore';
  segments.forEach((segment, i) => {
    const isLast = i === segments.length - 1;
    const child = spawnSegment(segment, cwd, [input, isLast ? fd : 'pipe', fd]);
    if (child.pid) job.pids.push(child.pid);
    input = isLast ? null : child.stdout;

    child.on('error', (e: any) => {
      const msg = e?.code === 'ENOENT'
        ? `No existe el ejecutable: ${segmentBinary(segment)}`
        : String(e?.message || e);
      job.error = msg;
      try {
        fs.appendFileSync(logPath, `[error] ${msg}\n`);
      } catch {
        /* sin log */
      }
      if (job.status === 'running') {
        job.status = 'exited';
        job.exitCode = 1;
        job.endedAt = Date.now();
      }
      closeLog();
    });

    if (isLast) {
      job.pid = child.pid ?? null;
      child.on('close', (code) => {
        if (job.status === 'running') {
          job.status = 'exited';
          job.exitCode = code ?? 0;
          job.endedAt = Date.now();
        }
        closeLog();
      });
    }
  });

  jobs.set(id, job);
  return { ok: true, job: toPublicJob(job) };
}

export function listJobs(): PublicJob[] {
  return [...jobs.values()].map(toPublicJob);
}

export function getJob(id: string): ShellJob | undefined {
  return jobs.get(id);
}

/** Lee el final del log. `tail` es el número de líneas (1-500). */
export function readJobLog(id: string, tail = 40, maxChars = 8000) {
  const job = jobs.get(id);
  if (!job) return { ok: false as const, error: `Trabajo desconocido: ${id}. Usa action "list".` };

  let text = '';
  try {
    text = fs.readFileSync(job.logPath, 'utf8');
  } catch {
    text = '';
  }
  // Sin el salto final, `tail: 1` devuelve la última línea real y no la vacía.
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
  const wanted = Math.max(1, Math.min(500, Math.trunc(Number(tail) || 40)));
  const chunk = lines.slice(-wanted).join('\n').slice(-maxChars);
  return {
    ok: true as const,
    data: {
      ...toPublicJob(job),
      lines: wanted,
      truncated: lines.length > wanted || text.length > maxChars,
      content: chunk,
    },
  };
}

/**
 * Para un trabajo arrancado por el agente. Si se pasa `pid`, debe pertenecer a
 * ese trabajo: es la única forma de nombrar un proceso, y siempre se resuelve
 * contra el registro.
 */
export async function stopJob(id: string, pid?: number) {
  const job = jobs.get(id);
  if (!job) return { ok: false as const, error: `Trabajo desconocido: ${id}. Usa action "list".` };
  if (pid !== undefined && !job.pids.includes(pid)) {
    return { ok: false as const, error: `El PID ${pid} no pertenece al trabajo ${id}.` };
  }
  if (job.status !== 'running') {
    return { ok: false as const, error: `El trabajo ${id} ya terminó (${job.status}).` };
  }

  const targets = [...job.pids];
  const wasAlive = targets.some(alive);
  await Promise.all(targets.map((p) => killTree(p)));

  job.status = 'stopped';
  job.endedAt = Date.now();
  job.exitCode = null;
  try {
    fs.appendFileSync(job.logPath, `\n[stopped] trabajo ${id} detenido (pids ${targets.join(', ')})\n`);
  } catch {
    /* sin log */
  }

  return {
    ok: true as const,
    data: { id, stopped: true, pids: targets, wasAlive, status: job.status },
  };
}

/** Solo para tests: vacía el registro sin tocar procesos. */
export function _resetJobs(): void {
  jobs.clear();
}
