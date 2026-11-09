/**
 * REPL interactivo (F1-08).
 *
 * La continuidad se prueba contra el proveedor falso: dos turnos reales deben
 * compartir una única sesión y el segundo prompt debe llevar el historial del
 * primero. La cancelación se prueba en dos capas: `runAgent` con un fetch
 * lento abortado, y `ReplSession` verificando que Ctrl+C deja el bucle usable.
 * El último caso arranca `commander` sin subcomando por stdin/stdout de pipe.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplSession } from '../../src/cli/repl.js';
import { runAgent, type RunAgentOptions } from '../../src/cli/agentClient.js';
import { Tui } from '../../src/cli/tui.js';
import { createSessionState, type CliEventV2 } from '../../src/agent/sessionTypes.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const CLI_PATH = path.join(REPO_ROOT, 'bin', 'commander.ts');

interface CliResult {
  code: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

function quietTui(): { tui: Tui; lines: string[] } {
  const tui = new Tui({ interactive: false, color: false });
  const lines: string[] = [];
  tui.line = (text = '') => {
    lines.push(text);
  };
  tui.rule = () => {};
  return { tui, lines };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout esperando condición');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function runReplProcess(serverUrl: string, input: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', CLI_PATH],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          COMMANDER_SERVER: serverUrl,
          NO_COLOR: '1',
          GEMINI_API_KEY: '',
          GOOGLE_API_KEY: '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 20_000);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-200_000);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-50_000);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, stdout, stderr });
    });

    child.stdin?.end(input);
  });
}

describe('REPL: continuidad y cancelación', () => {
  test('varios turnos conservan la misma sesión y el historial', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const { tui } = quietTui();
    const session = new ReplSession({
      serverUrl: fake.baseUrl,
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      tui,
    });

    await session.handleLine('SCENARIO:final primer turno');
    const firstId = session.state?.id;
    assert.equal(typeof firstId, 'string', 'el primer turno crea una sesión');

    await session.handleLine('SCENARIO:final segundo turno');
    assert.equal(session.state?.id, firstId, 'el segundo turno reutiliza la sesión');
    assert.equal(
      fake.requests.filter(
        (request) => request.method === 'POST' && request.path === '/api/agent/sessions'
      ).length,
      1,
      'no se crea una sesión nueva por turno'
    );

    const streams = fake.requests.filter((request) => request.path === '/api/gemini/stream');
    assert.equal(streams.length, 2, 'cada turno llama al modelo');
    const secondPrompt = JSON.stringify(streams[1]?.body ?? {});
    assert.match(secondPrompt, /primer turno/, 'el segundo prompt lleva el turno anterior');
    assert.match(secondPrompt, /Listo: el faro funciona/, 'y también la respuesta anterior');
    assert.match(secondPrompt, /segundo turno/, 'y el objetivo nuevo');
    const userTurns = (session.state?.turns ?? []).filter((turn) => turn.role === 'user');
    assert.equal(userTurns.length, 2, 'quedan los dos objetivos en el historial');
    assert.equal(session.state?.status, 'completed');
  });

  test('Ctrl+C aborta el turno en vuelo y el siguiente turno funciona', async () => {
    const { tui } = quietTui();
    const state = createSessionState({
      id: 'sess_repl_cancel',
      goal: 'cancelar',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
    });
    let calls = 0;
    let aborted = false;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    const session = new ReplSession({
      serverUrl: 'http://127.0.0.1:1',
      cwd: '/workspace/demo',
      tui,
      deps: {
        runAgent: async (opts: RunAgentOptions) => {
          calls += 1;
          if (calls === 1) {
            markStarted?.();
            await new Promise<void>((resolve) => {
              if (opts.signal?.aborted) {
                resolve();
                return;
              }
              opts.signal?.addEventListener('abort', () => resolve(), { once: true });
            });
            aborted = opts.signal?.aborted === true;
            return {
              answer: '',
              steps: 0,
              sessionId: state.id,
              seq: 1,
              state,
              cancelled: true,
            };
          }
          return { answer: 'segundo listo', steps: 1, sessionId: state.id, seq: 2, state };
        },
      },
    });

    const firstTurn = session.handleLine('primer turno');
    await started;
    assert.equal(session.isRunning, true, 'el turno está en vuelo');
    session.cancelTurn();
    await firstTurn;
    assert.equal(aborted, true, 'el AbortSignal llegó a runAgent');
    assert.equal(session.isRunning, false, 'el REPL vuelve a estar disponible');

    await session.handleLine('segundo turno');
    assert.equal(calls, 2, 'el siguiente turno arranca normalmente');
  });

  test('runAgent propaga el abort y persiste el estado cancelado', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const controller = new AbortController();
    const events: CliEventV2[] = [];
    const pending = runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:slow Cancelación real.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      stream: false,
      maxSteps: 2,
      persistSession: true,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });

    await waitFor(() =>
      fake.requests.some((request) => request.path === '/api/gemini/generate')
    );
    controller.abort();
    const result = await pending;

    assert.equal(result.cancelled, true);
    assert.equal(result.state?.status, 'cancelled');
    assert.ok(
      events.some((event) => event.type === 'error' && /cancelado/i.test(event.text)),
      'el abort emite un error legible'
    );
    const saved = fake.requests
      .filter((request) => request.method === 'PUT' && request.path.endsWith('/state'))
      .at(-1);
    assert.equal(saved?.body?.state?.status, 'cancelled');
  });

  test('commander sin subcomando corre por stdin, multilínea y sin TTY', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const result = await runReplProcess(
      fake.baseUrl,
      '/help\nSCENARIO:final primera línea \\\nsegunda línea\n/exit\n'
    );

    assert.equal(result.timedOut, false, `stderr: ${result.stderr}`);
    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /\[commander\] REPL/);
    assert.match(result.stdout, /\/compact\s+resume el historial/);
    assert.match(result.stdout, /Listo: el faro funciona/);
    assert.equal(result.stdout.includes('\x1b['), false, 'sin secuencias ANSI en el pipe');
    const prompt = JSON.stringify(
      fake.requests.find((request) => request.path === '/api/gemini/stream')?.body ?? {}
    );
    assert.match(prompt, /primera línea/);
    assert.match(prompt, /segunda línea/);
    assert.equal(
      fake.requests.some((request) => request.path === '/api/gemini/stream'),
      true
    );
  });

  test('commander sin subcomando sale al cerrar stdin (Ctrl+D)', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const result = await runReplProcess(fake.baseUrl, 'SCENARIO:final adiós\n');

    assert.equal(result.timedOut, false, `stderr: ${result.stderr}`);
    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /Listo: el faro funciona/);
  });

  test('runAgent aborta una tool en vuelo y deja el estado cancelado', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const controller = new AbortController();
    const pending = runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:slow-tool Cancelación de tool.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      stream: false,
      maxSteps: 3,
      persistSession: true,
      signal: controller.signal,
    });

    await waitFor(() =>
      fake.requests.some((request) => request.path === '/api/agent/run-tool')
    );
    controller.abort();
    const result = await pending;

    assert.equal(result.cancelled, true);
    assert.equal(result.state?.status, 'cancelled');
  });
});
