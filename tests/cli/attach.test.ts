/**
 * `commander attach <sessionId>`: adjuntarse a una corrida del escritorio.
 *
 * El servidor falso imita sólo lo que usa el comando: health, carga de una
 * sesión en ejecución y su SSE reanudable. Así se prueba el proceso real sin
 * proveedor, sin claves y sin arrancar el servidor de la app.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSessionState, makeEventV2, type CliEventV2 } from '../../src/agent/sessionTypes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const CLI_PATH = path.join(REPO_ROOT, 'bin', 'commander.ts');
const SESSION_ID = 'sess_attach';
const ANSWER = 'Listo desde el escritorio.';

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface AttachFixture {
  baseUrl: string;
  requests: string[];
  close: () => Promise<void>;
}

function frame(event: CliEventV2): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function goneFrame(seq: number): string {
  return `id: ${seq}\nevent: gone\ndata: ${JSON.stringify({ sessionId: SESSION_ID, reason: 'completed' })}\n\n`;
}

async function startAttachFixture(): Promise<AttachFixture> {
  const requests: string[] = [];
  const state = createSessionState({
    id: SESSION_ID,
    goal: 'Revisar el faro desde la terminal',
    cwd: REPO_ROOT,
    model: 'gemini/fake',
  });
  state.status = 'running';

  const events: CliEventV2[] = [
    makeEventV2(SESSION_ID, 1, {
      type: 'tool_call',
      tool: 'fs.read',
      input: { path: 'README.md' },
    }),
    makeEventV2(SESSION_ID, 2, {
      type: 'tool_result',
      tool: 'fs.read',
      ok: true,
      summary: 'README leído',
    }),
    makeEventV2(SESSION_ID, 3, { type: 'answer', text: ANSWER }),
  ];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push(`${req.method} ${url.pathname}${url.search}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    const streamMatch = url.pathname.match(
      new RegExp(`^/api/agent/sessions/${SESSION_ID}/stream$`)
    );
    if (req.method === 'GET' && streamMatch) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      for (const event of events) res.write(frame(event));
      // El estado final se publica antes del cierre para que el GET posterior
      // del CLI lea la respuesta autoritativa.
      state.status = 'completed';
      state.answer = ANSWER;
      res.end(goneFrame(3));
      return;
    }

    const sessionMatch = url.pathname.match(
      new RegExp(`^/api/agent/sessions/${SESSION_ID}$`)
    );
    if (req.method === 'GET' && sessionMatch) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          running: state.status === 'running',
          state,
        })
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'ruta no simulada' }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

function runAttach(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', CLI_PATH, 'attach', ...args],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, NO_COLOR: '1', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
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
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

describe('CLI attach al stream de una sesión del escritorio', () => {
  test('acepta una sesión running y emite NDJSON hasta done', async () => {
    const fixture = await startAttachFixture();
    try {
      const result = await runAttach([
        SESSION_ID,
        '--server',
        fixture.baseUrl,
        '--json',
      ]);
      const message = `exit=${result.code} stdout=${result.stdout} stderr=${result.stderr}`;
      assert.equal(result.code, 0, message);
      assert.equal(result.timedOut, false, message);
      const events = result.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as any);
      assert.deepEqual(events.map((event) => event.type), [
        'tool_call',
        'tool_result',
        'answer',
        'done',
      ]);
      assert.equal(events[0].tool, 'fs.read');
      assert.equal(events[2].text, ANSWER);
      assert.equal(events[3].answer, ANSWER);
      assert.equal(events[3].sessionId, SESSION_ID);
      assert.ok(events[3].seq > events[2].seq, 'done conserva el cursor del stream');
      assert.ok(
        fixture.requests.includes(`GET /api/agent/sessions/${SESSION_ID}/stream?after=0`),
        `el comando pidió el stream desde cero: ${fixture.requests.join(', ')}`
      );
    } finally {
      await fixture.close();
    }
  });

  test('en modo humano pinta la cabecera adjunta y la respuesta', async () => {
    const fixture = await startAttachFixture();
    try {
      const result = await runAttach([SESSION_ID, '--server', fixture.baseUrl]);
      const message = `exit=${result.code} stdout=${result.stdout} stderr=${result.stderr}`;
      assert.equal(result.code, 0, message);
      assert.equal(result.timedOut, false, message);
      assert.match(result.stdout, /adjunto/);
      assert.match(result.stdout, /Revisar el faro desde la terminal/);
      assert.match(result.stdout, /Listo desde el escritorio\./);
      assert.match(result.stdout, /Listo/);
    } finally {
      await fixture.close();
    }
  });

  test('una sesión inexistente falla antes de abrir el stream', async () => {
    const fixture = await startAttachFixture();
    try {
      const result = await runAttach(['sess_no_existe', '--server', fixture.baseUrl, '--json']);
      assert.equal(result.code, 1, `exit=${result.code}`);
      assert.equal(result.timedOut, false);
      assert.match(result.stdout, /"type":"error"/);
      assert.equal(
        fixture.requests.some((request) => request.includes('/stream')),
        false,
        'no abre SSE si la sesión no existe'
      );
    } finally {
      await fixture.close();
    }
  });
});
