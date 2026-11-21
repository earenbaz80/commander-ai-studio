/**
 * Corrida aislada en un proceso hijo.
 *
 * Dos tandas de T10 (2026-11-21) murieron a mitad de corrida con código 1, sin
 * traza de JS, sin resumen y sin línea en el JSONL: el runner se llevó por
 * delante la tanda entera. Con la corrida en su propio proceso, una muerte así
 * pierde como máximo esa corrida y deja un `error` con el código de salida.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

export interface IsolatedRun<T> {
  /** Resultado que dejó el worker, si terminó y escribió el archivo. */
  result?: T;
  toolCalls: number;
  answer: string;
  /** Motivo cuando no hubo resultado: muerte, error de arranque o timeout. */
  error?: string;
  exitCode: number | null;
  signal: string | null;
}

export interface IsolatedRunOptions {
  command: string;
  args: string[];
  /** Archivo JSON donde el worker deja `{ result, toolCalls, answer }`. */
  resultPath: string;
  /** Tope del proceso; al vencerlo se mata al hijo. */
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

/** Sólo las últimas líneas de stderr: es diagnóstico, no un log completo. */
const MAX_STDERR = 4_000;

export function runIsolated<T>(opts: IsolatedRunOptions): Promise<IsolatedRun<T>> {
  try {
    fs.rmSync(opts.resultPath, { force: true });
  } catch {
    /* el archivo se reescribe o el worker falla y se informa */
  }
  return new Promise((resolve) => {
    let settled = false;
    let stderr = '';
    let timedOut = false;
    const child = spawn(opts.command, opts.args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, ...opts.env },
      windowsHide: true,
    });
    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (exitCode === 0) {
        try {
          const payload = JSON.parse(fs.readFileSync(opts.resultPath, 'utf8'));
          resolve({
            result: payload?.result as T,
            toolCalls: Number(payload?.toolCalls ?? 0),
            answer: String(payload?.answer ?? ''),
            exitCode,
            signal,
          });
          return;
        } catch {
          /* sin archivo válido se informa abajo */
        }
      }
      const cola = stderr.trim().split(/\r?\n/).slice(-3).join(' | ');
      const motivo = timedOut
        ? `la corrida no terminó en ${Math.round(opts.timeoutMs / 1000)}s`
        : exitCode !== null
          ? `el proceso de la corrida terminó con código ${exitCode} sin dejar resultado`
          : `el proceso de la corrida terminó con señal ${signal ?? 'desconocida'} sin dejar resultado`;
      resolve({
        toolCalls: 0,
        answer: '',
        error: cola ? `${motivo}: ${cola}` : motivo,
        exitCode,
        signal,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* ya había terminado */
      }
    }, opts.timeoutMs);
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > MAX_STDERR) stderr = stderr.slice(-MAX_STDERR);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        toolCalls: 0,
        answer: '',
        error: `no se pudo lanzar la corrida: ${error.message}`,
        exitCode: null,
        signal: null,
      });
    });
    child.once('exit', (code, signal) => finish(code, signal));
  });
}
