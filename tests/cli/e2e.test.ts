/**
 * E2E del CLI (`commander agent --json`) contra un proveedor falso.
 *
 * F1-14: el objetivo es ejercitar el proceso real —parseo de flags, preflight
 * de `/api/health`, bucle del agente, NDJSON y código de salida— sin clave de
 * modelo, sin red externa y sin levantar el servidor de la app.
 *
 * Cada caso deja un recibo en `os.tmpdir()` con stdout, stderr, peticiones y la
 * última línea NDJSON; los mensajes de aserción apuntan a ese recibo.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  startFakeAgentServer,
  type FakeRequest,
  type FakeScenario,
} from '../helpers/fakeAgentServer.js';
import {
  createSessionState,
  makeEventV2,
  type CliEventV2,
} from '../../src/agent/sessionTypes.js';
import { GEMINI_DEFAULT_MODEL } from '../../src/config/geminiModels.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const CLI_PATH = path.join(REPO_ROOT, 'bin', 'commander.ts');
const CLI_TIMEOUT_MS = 45_000;
const RECEIPTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-cli-e2e-'));

interface CliResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface NdjsonEvent {
  schemaVersion?: number;
  seq?: number;
  sessionId?: string;
  type: string;
  text?: string;
  tool?: string;
  input?: unknown;
  ok?: boolean;
  summary?: string;
  answer?: string;
  steps?: number;
  session?: { id?: string; goal?: string; status?: string };
  approval?: {
    id?: string;
    tool?: string;
    input?: unknown;
    diff?: string;
  };
  approvalId?: string;
  decision?: string;
  reason?: string;
  question?: {
    id?: string;
    header?: string;
    text?: string;
    options?: string[];
    allowFreeText?: boolean;
  };
}

interface ReceiptServer {
  baseUrl: string;
  requests: FakeRequest[];
}

function runCliCommand(command: 'agent' | 'attach', args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', CLI_PATH, command, ...args],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          NO_COLOR: '1',
          GEMINI_API_KEY: '',
          GOOGLE_API_KEY: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ya terminó */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ya terminó */
        }
      }, 5_000).unref();
    }, CLI_TIMEOUT_MS);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-1_000_000);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-64_000);
    });

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

/** Invoca `commander agent`; es el arnés histórico de F1-14. */
function runCli(args: string[]): Promise<CliResult> {
  return runCliCommand('agent', args);
}

/** Invoca `commander attach` para ejercitar el stream real de una sesión. */
function runAttach(sessionId: string, args: string[]): Promise<CliResult> {
  return runCliCommand('attach', [sessionId, ...args]);
}

function runScenario(
  scenario: FakeScenario,
  opts: { serverUrl: string; maxSteps?: number; stream?: boolean }
): Promise<CliResult> {
  const args = [
    `SCENARIO:${scenario} Ejecuta el caso E2E.`,
    '--json',
    '--server',
    opts.serverUrl,
    '--max-steps',
    String(opts.maxSteps ?? 5),
  ];
  if (opts.stream === false) args.push('--no-stream');
  return runCli(args);
}

function parseEvents(stdout: string): NdjsonEvent[] {
  const events: NdjsonEvent[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as NdjsonEvent);
    } catch {
      assert.fail(`stdout no es NDJSON: ${line}`);
    }
  }
  return events;
}

/**
 * Sobre v2 de la salida real de `--json`: un solo `sessionId`, `schemaVersion: 2`
 * y `seq` estrictamente creciente. Es lo que consumen la extensión y CI.
 */
function assertEventEnvelope(
  events: NdjsonEvent[],
  sessionId: string,
  message: string
): void {
  assert.ok(events.length > 0, `hay eventos NDJSON: ${message}`);
  let previous = 0;
  for (const event of events) {
    assert.equal(event.schemaVersion, 2, `schemaVersion v2: ${message}`);
    assert.equal(event.sessionId, sessionId, `sessionId estable: ${message}`);
    assert.equal(typeof event.seq, 'number', `seq presente: ${message}`);
    assert.ok(Number(event.seq) > previous, `seq creciente: ${message}`);
    previous = Number(event.seq);
  }
}

function parseEventsSafe(stdout: string): NdjsonEvent[] {
  const events: NdjsonEvent[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as NdjsonEvent);
    } catch {
      /* el recibo conserva la línea cruda en stdout */
    }
  }
  return events;
}

function lastLine(stdout: string): string {
  return stdout.split(/\r?\n/).filter((line) => line.trim()).at(-1) ?? '';
}

function writeReceipt(
  caseName: string,
  scenario: string,
  result: CliResult,
  server: ReceiptServer
): string {
  const file = path.join(RECEIPTS_DIR, `${caseName}.txt`);
  const events = parseEventsSafe(result.stdout);
  const content = [
    `caso: ${caseName}`,
    `escenario: ${scenario}`,
    `servidor: ${server.baseUrl}`,
    `exit: ${result.code}`,
    `signal: ${result.signal ?? 'ninguna'}`,
    `timeout: ${result.timedOut}`,
    `eventos: ${events.length}`,
    `última línea NDJSON: ${lastLine(result.stdout) || '(sin stdout)'}`,
    '',
    '--- stdout ---',
    result.stdout.trimEnd(),
    '',
    '--- stderr ---',
    result.stderr.trimEnd(),
    '',
    '--- peticiones ---',
    ...server.requests.map((request) => {
      const body =
        request.body == null ? '' : ` ${JSON.stringify(request.body).slice(0, 800)}`;
      return `${request.method} ${request.path}${body}`;
    }),
    '',
  ].join('\n');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function diag(result: CliResult, receipt: string): string {
  return [
    `exit=${result.code} timedOut=${result.timedOut}`,
    `última línea NDJSON: ${lastLine(result.stdout) || '(sin stdout)'}`,
    `stderr: ${result.stderr.trim() || '(vacío)'}`,
    `recibo: ${receipt}`,
  ].join('\n');
}

async function getServerSession(
  serverUrl: string,
  id: string
): Promise<{ status: number; state: any }> {
  const res = await fetch(`${serverUrl}/api/agent/sessions/${encodeURIComponent(id)}`);
  const body = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, state: body.state };
}

async function closedPortUrl(): Promise<string> {
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${address.port}`;
}

type SessionStreamMode = 'approval-allow' | 'approval-deny' | 'question' | 'reconnect';

interface SessionStreamFixture extends ReceiptServer {
  sessionId: string;
  connections: Array<{ after: string | null; lastEventId: string | null }>;
  close: () => Promise<void>;
}

function sseFrame(event: CliEventV2): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function sseGone(seq: number, reason = 'completed'): string {
  return `id: ${seq}\nevent: gone\ndata: ${JSON.stringify({ reason })}\n\n`;
}

/**
 * Servidor de sesión mínimo para los casos de attach: approval, question y
 * reconexión. La primera conexión del modo `reconnect` se corta a propósito; la
 * segunda repite el `seq` 2 para comprobar la deduplicación del cliente.
 */
async function startSessionStreamFixture(mode: SessionStreamMode): Promise<SessionStreamFixture> {
  const sessionId = `sess_e2e_${mode}`;
  const requests: FakeRequest[] = [];
  const connections: SessionStreamFixture['connections'] = [];
  const state = createSessionState({
    id: sessionId,
    goal: `E2E ${mode}`,
    cwd: REPO_ROOT,
    model: 'gemini/fake',
  });
  state.status = 'running';

  const events: CliEventV2[] = [];
  let answer = '';
  if (mode === 'approval-allow' || mode === 'approval-deny') {
    const decision: 'allow' | 'deny' = mode === 'approval-allow' ? 'allow' : 'deny';
    const approval = {
      id: `apr_${mode}`,
      sessionId,
      tool: 'fs.write',
      input: { path: 'salida.txt', content: 'x' },
      diff: '--- a/salida.txt\n+++ b/salida.txt\n@@ -0,0 +1 @@\n+x',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    answer = decision === 'allow' ? 'Listo: escritura aprobada.' : 'Listo: escritura denegada.';
    events.push(
      makeEventV2(sessionId, 1, {
        type: 'tool_call',
        tool: 'fs.write',
        input: approval.input,
      }),
      makeEventV2(sessionId, 2, { type: 'approval_request', approval }),
      makeEventV2(sessionId, 3, {
        type: 'approval_result',
        approvalId: approval.id,
        decision,
      }),
      makeEventV2(sessionId, 4, {
        type: 'tool_result',
        tool: 'fs.write',
        ok: decision === 'allow',
        summary: decision === 'allow' ? 'escritura aplicada' : 'ERROR: aprobación denegada',
      }),
      makeEventV2(sessionId, 5, { type: 'answer', text: answer })
    );
  } else if (mode === 'question') {
    const question = {
      id: 'q_e2e',
      header: 'Sigo',
      text: '¿Escribo el archivo?',
      options: ['sí', 'no'],
      allowFreeText: true,
    };
    answer = 'Listo: pregunta respondida.';
    events.push(
      makeEventV2(sessionId, 1, {
        type: 'tool_call',
        tool: 'ask_user',
        input: { question: question.text },
      }),
      makeEventV2(sessionId, 2, { type: 'question', question }),
      makeEventV2(sessionId, 3, {
        type: 'tool_result',
        tool: 'ask_user',
        ok: true,
        summary: 'respuesta: sí',
      }),
      makeEventV2(sessionId, 4, { type: 'answer', text: answer })
    );
  } else {
    answer = 'Listo tras reconectar.';
    events.push(
      makeEventV2(sessionId, 1, { type: 'tool_call', tool: 'fs.read', input: { path: 'README.md' } }),
      makeEventV2(sessionId, 2, {
        type: 'tool_result',
        tool: 'fs.read',
        ok: true,
        summary: 'README leído',
      }),
      makeEventV2(sessionId, 3, { type: 'answer', text: answer })
    );
  }

  const finalSeq = events[events.length - 1]?.seq ?? 1;
  const sendJson = (res: http.ServerResponse, status: number, body: unknown): void => {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(text)),
    });
    res.end(text);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push({ method: req.method ?? '', path: url.pathname, body: null });

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    const streamMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/stream$/);
    if (req.method === 'GET' && streamMatch) {
      if (decodeURIComponent(streamMatch[1]) !== sessionId) {
        sendJson(res, 404, { success: false, error: 'sesión no encontrada' });
        return;
      }
      const after = url.searchParams.get('after');
      const lastEventId =
        typeof req.headers['last-event-id'] === 'string' ? req.headers['last-event-id'] : null;
      connections.push({ after, lastEventId });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      if (mode === 'reconnect' && connections.length === 1) {
        for (const event of events.filter((item) => item.seq <= 2)) {
          res.write(sseFrame(event));
        }
        setTimeout(() => res.destroy(), 50);
        return;
      }

      const from = mode === 'reconnect' ? 2 : 0;
      for (const event of events.filter((item) => item.seq >= from)) {
        res.write(sseFrame(event));
      }
      state.status = 'completed';
      state.answer = answer;
      res.end(sseGone(finalSeq));
      return;
    }

    const sessionMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)$/);
    if (req.method === 'GET' && sessionMatch) {
      if (decodeURIComponent(sessionMatch[1]) !== sessionId) {
        sendJson(res, 404, { success: false, error: 'sesión no encontrada' });
        return;
      }
      sendJson(res, 200, {
        success: true,
        running: state.status === 'running',
        state,
      });
      return;
    }

    sendJson(res, 404, { success: false, error: 'ruta no simulada' });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    sessionId,
    requests,
    connections,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

after(() => {
  console.log(`[cli-e2e] recibos en ${RECEIPTS_DIR}`);
});

describe('CLI E2E con proveedor falso (F1-14)', () => {
  test('corrida feliz: respuesta final sin tools', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const result = await runScenario('final', { serverUrl: fake.baseUrl, stream: false });
    const receipt = writeReceipt('final', 'final', result, fake);
    const events = parseEvents(result.stdout);
    const message = diag(result, receipt);

    assert.equal(result.code, 0, message);
    assert.equal(result.timedOut, false, message);
    assert.equal(events.some((event) => event.type === 'error'), false, message);
    const answer = events.find((event) => event.type === 'answer');
    assert.equal(answer?.text, 'Listo: el faro funciona.', message);
    const done = events.at(-1);
    assert.equal(done?.type, 'done', message);
    assert.equal(done?.answer, 'Listo: el faro funciona.', message);
    assert.equal(done?.steps, 1, message);
  });

  test('tool de lectura: la ejecuta y continúa hasta la respuesta', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const result = await runScenario('tool', { serverUrl: fake.baseUrl, stream: false });
    const receipt = writeReceipt('tool', 'tool', result, fake);
    const events = parseEvents(result.stdout);
    const message = diag(result, receipt);

    assert.equal(result.code, 0, message);
    const call = events.find((event) => event.type === 'tool_call');
    assert.equal(call?.tool, 'fs.read', message);
    const toolResult = events.find((event) => event.type === 'tool_result');
    assert.equal(toolResult?.ok, true, message);
    const request = fake.requests.find((entry) => entry.path === '/api/agent/run-tool');
    assert.equal(request?.body?.toolId, 'fs.read', message);
    const root = request?.body?.input?.root;
    assert.equal(typeof root, 'string', message);
    if (typeof root === 'string') assert.equal(path.isAbsolute(root), true, message);
    const answer = events.find((event) => event.type === 'answer');
    assert.equal(answer?.text, 'Listo: el faro funciona.', message);
  });

  test('tool denegada: reporta el 403 y sigue hasta la respuesta', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const result = await runScenario('tool-denied', { serverUrl: fake.baseUrl, stream: false });
    const receipt = writeReceipt('tool-denied', 'tool-denied', result, fake);
    const events = parseEvents(result.stdout);
    const message = diag(result, receipt);

    assert.equal(result.code, 0, message);
    const toolResult = events.find((event) => event.type === 'tool_result');
    assert.equal(toolResult?.ok, false, message);
    assert.match(String(toolResult?.summary), /Sólo lectura/, message);
    const request = fake.requests.find((entry) => entry.path === '/api/agent/run-tool');
    assert.equal(request?.body?.toolId, 'fs.write', message);
    const answer = events.find((event) => event.type === 'answer');
    assert.equal(answer?.text, 'Listo: el faro funciona.', message);
  });

  test('límite de pasos: corta con error y sale 1', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const result = await runScenario('max-steps', {
      serverUrl: fake.baseUrl,
      stream: false,
      maxSteps: 2,
    });
    const receipt = writeReceipt('max-steps', 'max-steps', result, fake);
    const events = parseEvents(result.stdout);
    const message = diag(result, receipt);

    assert.equal(result.code, 1, message);
    const errors = events
      .filter((event) => event.type === 'error')
      .map((event) => event.text ?? '')
      .join('\n');
    assert.match(errors, /límite de 2 pasos/, message);
    assert.equal(events.filter((event) => event.type === 'tool_call').length, 2, message);
    const done = events.at(-1);
    assert.equal(done?.type, 'done', message);
    assert.equal(done?.answer, '', message);
  });

  test('tool desconocida: error visible y ninguna llamada a run-tool', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const result = await runScenario('unknown-tool', { serverUrl: fake.baseUrl, stream: false });
    const receipt = writeReceipt('unknown-tool', 'unknown-tool', result, fake);
    const events = parseEvents(result.stdout);
    const message = diag(result, receipt);

    assert.equal(result.code, 0, message);
    const errors = events
      .filter((event) => event.type === 'error')
      .map((event) => event.text ?? '')
      .join('\n');
    assert.match(errors, /Tool desconocida devuelta por el modelo: no_existe/, message);
    assert.equal(
      fake.requests.some((entry) => entry.path === '/api/agent/run-tool'),
      false,
      message
    );
    const answer = events.find((event) => event.type === 'answer');
    assert.equal(answer?.text, 'Listo: el faro funciona.', message);
  });

  test('streaming SSE: chunks y respuesta final sin thought duplicado', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const result = await runScenario('stream', { serverUrl: fake.baseUrl });
    const receipt = writeReceipt('stream', 'stream', result, fake);
    const events = parseEvents(result.stdout);
    const message = diag(result, receipt);

    assert.equal(result.code, 0, message);
    const chunks = events
      .filter((event) => event.type === 'chunk')
      .map((event) => event.text ?? '')
      .join('');
    assert.equal(chunks, 'Hola desde el SSE.', message);
    assert.equal(events.some((event) => event.type === 'thought'), false, message);
    const answer = events.find((event) => event.type === 'answer');
    assert.equal(answer?.text, 'Hola desde el SSE.', message);
    assert.equal(
      fake.requests.some((entry) => entry.path === '/api/gemini/stream'),
      true,
      message
    );
    assert.equal(
      fake.requests.some((entry) => entry.path === '/api/gemini/generate'),
      false,
      message
    );
  });

  test('error del proveedor: emite error y termina sin respuesta', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const result = await runScenario('llm-error', { serverUrl: fake.baseUrl, stream: false });
    const receipt = writeReceipt('llm-error', 'llm-error', result, fake);
    const events = parseEvents(result.stdout);
    const message = diag(result, receipt);

    assert.equal(result.code, 1, message);
    const error = events.find((event) => event.type === 'error');
    assert.match(String(error?.text), /LLM HTTP 500/, message);
    const done = events.at(-1);
    assert.equal(done?.type, 'done', message);
    assert.equal(done?.answer, '', message);
  });

  test('servidor caído: falla en el preflight y no emite NDJSON', async () => {
    const serverUrl = await closedPortUrl();
    const result = await runCli([
      'SCENARIO:final Ejecuta el caso E2E.',
      '--json',
      '--server',
      serverUrl,
      '--max-steps',
      '1',
      '--no-stream',
    ]);
    const receipt = writeReceipt('health-down', 'final', result, {
      baseUrl: serverUrl,
      requests: [],
    });
    const message = diag(result, receipt);

    assert.equal(result.code, 1, message);
    assert.match(result.stderr, /Servidor no disponible/, message);
    assert.equal(result.stdout.trim(), '', message);
  });

  test('--resume continúa la sesión persistida sin repetir pasos', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    const first = await runScenario('tool', { serverUrl: fake.baseUrl, stream: false });
    const firstReceipt = writeReceipt('resume-source', 'tool', first, fake);
    const firstEvents = parseEvents(first.stdout);
    const sourceId = firstEvents.find((event) => event.type === 'session')?.session?.id;
    assert.equal(first.code, 0, diag(first, firstReceipt));
    assert.equal(typeof sourceId, 'string', diag(first, firstReceipt));
    const before = await getServerSession(fake.baseUrl, String(sourceId));
    assert.equal(before.status, 200, JSON.stringify(before.state));
    assert.equal(before.state.status, 'completed');
    const toolResultsBefore = before.state.steps.filter(
      (step: any) => step.type === 'tool_result'
    ).length;
    assert.equal(toolResultsBefore, 1, 'la corrida inicial dejó el resultado de la tool');
    const turnsBefore = before.state.turns.length;

    const resumed = await runCli([
      'SCENARIO:final Continúa la sesión guardada.',
      '--json',
      '--server',
      fake.baseUrl,
      '--resume',
      String(sourceId),
      '--max-steps',
      '3',
      '--no-stream',
    ]);
    const receipt = writeReceipt('resume', 'final', resumed, fake);
    const events = parseEvents(resumed.stdout);
    const message = diag(resumed, receipt);
    assertEventEnvelope(events, String(sourceId), message);

    assert.equal(resumed.code, 0, message);
    assert.equal(events.some((event) => event.type === 'error'), false, message);
    assert.equal(
      events.find((event) => event.type === 'session')?.session?.id,
      sourceId,
      message
    );
    assert.equal(
      events.some((event) => event.type === 'tool_result'),
      false,
      'no reemite los pasos históricos de la sesión'
    );
    assert.equal(
      events.find((event) => event.type === 'answer')?.text,
      'Listo: el faro funciona.',
      message
    );

    const after = await getServerSession(fake.baseUrl, String(sourceId));
    assert.equal(after.status, 200, JSON.stringify(after.state));
    assert.equal(after.state.status, 'completed');
    assert.ok(after.state.turns.length > turnsBefore, 'el turno nuevo quedó en el estado');
    assert.ok(
      after.state.turns.some(
        (turn: any) => turn.role === 'user' && /Continúa la sesión guardada/.test(turn.text)
      ),
      'el estado conserva el turno de resume'
    );
    assert.equal(
      after.state.steps.filter((step: any) => step.type === 'tool_result').length,
      toolResultsBefore,
      'resume no duplica el resultado de la tool original'
    );
  });

  test('--resume no repite tres tools ya ejecutadas', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    const first = await runScenario('tool-three', { serverUrl: fake.baseUrl, stream: false });
    const firstReceipt = writeReceipt('resume-three-source', 'tool-three', first, fake);
    const firstEvents = parseEvents(first.stdout);
    const sourceId = String(
      firstEvents.find((event) => event.type === 'session')?.session?.id
    );
    assert.equal(first.code, 0, diag(first, firstReceipt));
    assert.ok(sourceId, diag(first, firstReceipt));

    const before = await getServerSession(fake.baseUrl, sourceId);
    assert.equal(before.status, 200, JSON.stringify(before.state));
    assert.equal(before.state.status, 'completed');
    const toolsBefore = before.state.steps.filter(
      (step: any) => step.type === 'tool_result'
    );
    assert.equal(toolsBefore.length, 3, 'la corrida inicial ejecutó tres tools');
    const callsBefore = fake.requests.filter(
      (request) => request.path === '/api/agent/run-tool'
    );
    assert.equal(callsBefore.length, 3, 'una petición por tool ejecutada');
    assert.deepEqual(
      callsBefore.map((request) => request.body?.input?.path),
      ['README.md', 'package.json', 'AGENTS.md'],
      'las tres tools fueron distintas'
    );

    const resumed = await runCli([
      'SCENARIO:final Continúa sin repetir nada.',
      '--json',
      '--server',
      fake.baseUrl,
      '--resume',
      sourceId,
      '--max-steps',
      '3',
      '--no-stream',
    ]);
    const receipt = writeReceipt('resume-three', 'final', resumed, fake);
    const events = parseEvents(resumed.stdout);
    const message = diag(resumed, receipt);
    assertEventEnvelope(events, sourceId, message);

    assert.equal(resumed.code, 0, message);
    assert.equal(events.some((event) => event.type === 'error'), false, message);
    assert.equal(
      events.some((event) => event.type === 'tool_call' || event.type === 'tool_result'),
      false,
      'no reemite el historial ni vuelve a llamar tools'
    );
    assert.equal(
      fake.requests.filter((request) => request.path === '/api/agent/run-tool').length,
      callsBefore.length,
      'resume no añade ninguna petición a run-tool'
    );
    assert.equal(
      events.find((event) => event.type === 'session')?.session?.id,
      sourceId,
      message
    );
    assert.equal(
      events.find((event) => event.type === 'answer')?.text,
      'Listo: el faro funciona.',
      message
    );

    const after = await getServerSession(fake.baseUrl, sourceId);
    assert.equal(after.status, 200, JSON.stringify(after.state));
    assert.equal(after.state.status, 'completed');
    const toolsAfter = after.state.steps.filter(
      (step: any) => step.type === 'tool_result'
    );
    assert.equal(toolsAfter.length, 3, 'no se duplica ningún tool_result');
    assert.deepEqual(
      toolsAfter.map((step: any) => step.id),
      toolsBefore.map((step: any) => step.id),
      'los tres resultados son los mismos pasos, no copias'
    );
  });

  test('--resume de una sesión cancelada la completa sin resucitarla en segundo plano', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    const id = 'sess_cancelada_e2e';
    const seed = createSessionState({
      id,
      goal: 'Trabajo que quedó a medias',
      cwd: REPO_ROOT,
      model: GEMINI_DEFAULT_MODEL,
    });
    seed.status = 'cancelled';
    seed.error = 'cancelada por el usuario';
    seed.turns.push({ role: 'user', text: 'trabajo previo', ts: Date.now() - 1_000 });
    seed.steps.push({
      id: 'step_cancelado',
      type: 'thought',
      title: 'Razonamiento',
      content: 'quedó a medias',
      status: 'cancelled',
      ts: Date.now() - 1_000,
    });
    fake.seedSession(seed);

    const result = await runCli([
      'SCENARIO:final Retoma el trabajo cancelado.',
      '--json',
      '--server',
      fake.baseUrl,
      '--resume',
      id,
      '--max-steps',
      '2',
      '--no-stream',
    ]);
    const receipt = writeReceipt('resume-cancelled', 'final', result, fake);
    const events = parseEvents(result.stdout);
    const message = diag(result, receipt);
    assertEventEnvelope(events, id, message);

    assert.equal(result.code, 0, message);
    assert.equal(events.some((event) => event.type === 'error'), false, message);
    assert.equal(
      events.find((event) => event.type === 'session')?.session?.id,
      id,
      message
    );
    assert.equal(
      events.find((event) => event.type === 'answer')?.text,
      'Listo: el faro funciona.',
      message
    );

    const after = await getServerSession(fake.baseUrl, id);
    assert.equal(after.status, 200, JSON.stringify(after.state));
    assert.equal(
      after.state.status,
      'completed',
      'el resume termina la sesión, no la deja running'
    );
    assert.equal(
      after.state.error,
      undefined,
      'el error de la cancelación anterior no queda pegado'
    );
    assert.equal(after.state.pendingApproval, null);
    assert.ok(
      after.state.turns.some(
        (turn: any) => turn.role === 'user' && /Retoma el trabajo cancelado/.test(turn.text)
      ),
      'el turno del resume queda en el historial'
    );
    assert.ok(
      after.state.steps.some((step: any) => step.id === 'step_cancelado'),
      'el historial anterior a la cancelación se conserva'
    );
    assert.equal(
      after.state.steps.filter((step: any) => step.type === 'tool_result').length,
      0,
      'el resume no ejecuta tools que el modelo no pidió'
    );
  });

  test('--fork crea una sesión nueva y no muta la original', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    const first = await runScenario('tool', { serverUrl: fake.baseUrl, stream: false });
    const firstReceipt = writeReceipt('fork-source', 'tool', first, fake);
    const firstEvents = parseEvents(first.stdout);
    const sourceId = String(
      firstEvents.find((event) => event.type === 'session')?.session?.id
    );
    assert.equal(first.code, 0, diag(first, firstReceipt));
    assert.ok(sourceId, diag(first, firstReceipt));
    const sourceBefore = await getServerSession(fake.baseUrl, sourceId);
    assert.equal(sourceBefore.status, 200, JSON.stringify(sourceBefore.state));
    const snapshot = JSON.stringify(sourceBefore.state);

    const forked = await runCli([
      'SCENARIO:final Explora la bifurcación.',
      '--json',
      '--server',
      fake.baseUrl,
      '--fork',
      sourceId,
      '--max-steps',
      '3',
      '--no-stream',
    ]);
    const receipt = writeReceipt('fork', 'final', forked, fake);
    const events = parseEvents(forked.stdout);
    const message = diag(forked, receipt);

    assert.equal(forked.code, 0, message);
    const forkId = events.find((event) => event.type === 'session')?.session?.id;
    assert.equal(typeof forkId, 'string', message);
    assert.notEqual(forkId, sourceId, 'el fork tiene id propio');
    assert.equal(
      events.some((event) => event.type === 'tool_result'),
      false,
      'el fork no reemite el historial copiado'
    );

    const sourceAfter = await getServerSession(fake.baseUrl, sourceId);
    assert.equal(sourceAfter.status, 200, JSON.stringify(sourceAfter.state));
    assert.equal(JSON.stringify(sourceAfter.state), snapshot, 'la sesión origen no cambió');

    const forkState = await getServerSession(fake.baseUrl, String(forkId));
    assert.equal(forkState.status, 200, JSON.stringify(forkState.state));
    assert.equal(forkState.state.status, 'completed');
    assert.equal(forkState.state.id, forkId);
    assert.ok(
      forkState.state.steps.some((step: any) => step.type === 'tool_result'),
      'el fork copió el historial de pasos'
    );
    assert.ok(
      forkState.state.turns.some(
        (turn: any) => turn.role === 'user' && /Explora la bifurcación/.test(turn.text)
      ),
      'el fork añadió su propio turno'
    );
  });

  test('--resume de una sesión inexistente falla con error legible', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    const result = await runCli([
      'SCENARIO:final Intento imposible.',
      '--json',
      '--server',
      fake.baseUrl,
      '--resume',
      'sess_no_existe',
      '--no-stream',
    ]);
    const receipt = writeReceipt('resume-missing', 'final', result, fake);
    const events = parseEvents(result.stdout);
    const message = diag(result, receipt);

    assert.equal(result.code, 1, message);
    const error = events.find((event) => event.type === 'error');
    assert.match(String(error?.text), /no encontrada/, message);
  });

  test('approval de escritura: aprobada y denegada', async () => {
    for (const mode of ['approval-allow', 'approval-deny'] as const) {
      const fake = await startSessionStreamFixture(mode);
      try {
        const result = await runAttach(fake.sessionId, ['--server', fake.baseUrl, '--json']);
        const receipt = writeReceipt(`attach-${mode}`, mode, result, fake);
        const events = parseEvents(result.stdout);
        const message = diag(result, receipt);
        assertEventEnvelope(events, fake.sessionId, message);

        assert.equal(result.code, 0, message);
        assert.equal(result.timedOut, false, message);
        assert.equal(events.find((event) => event.type === 'approval_request')?.approval?.tool, 'fs.write', message);
        const decision = mode === 'approval-allow' ? 'allow' : 'deny';
        assert.equal(
          events.find((event) => event.type === 'approval_result')?.decision,
          decision,
          message
        );
        assert.equal(
          events.find((event) => event.type === 'tool_result')?.ok,
          decision === 'allow',
          message
        );
        assert.equal(
          events.at(-1)?.answer,
          decision === 'allow' ? 'Listo: escritura aprobada.' : 'Listo: escritura denegada.',
          message
        );
        assert.equal(events.at(-1)?.type, 'done', message);
      } finally {
        await fake.close();
      }
    }
  });

  test('ask_user en modo --json: pregunta y respuesta sin prompt interactivo', async () => {
    const fake = await startSessionStreamFixture('question');
    try {
      const result = await runAttach(fake.sessionId, ['--server', fake.baseUrl, '--json']);
      const receipt = writeReceipt('attach-question', 'question', result, fake);
      const events = parseEvents(result.stdout);
      const message = diag(result, receipt);
      assertEventEnvelope(events, fake.sessionId, message);

      assert.equal(result.code, 0, message);
      const question = events.find((event) => event.type === 'question')?.question;
      assert.equal(question?.text, '¿Escribo el archivo?', message);
      assert.deepEqual(question?.options, ['sí', 'no'], message);
      assert.equal(question?.allowFreeText, true, message);
      assert.equal(
        events.some((event) => event.type === 'tool_call' && event.tool === 'ask_user'),
        true,
        message
      );
      assert.equal(
        events.some(
          (event) => event.type === 'tool_result' && event.tool === 'ask_user' && event.ok
        ),
        true,
        message
      );
      assert.equal(result.stdout.includes('Permitir una vez'), false, message);
      assert.equal(events.at(-1)?.type, 'done', message);
    } finally {
      await fake.close();
    }
  });

  test('reconexión SSE tras un corte: deduplica y cierra con done', async () => {
    const fake = await startSessionStreamFixture('reconnect');
    try {
      const result = await runAttach(fake.sessionId, ['--server', fake.baseUrl, '--json']);
      const receipt = writeReceipt('attach-reconnect', 'reconnect', result, fake);
      const events = parseEvents(result.stdout);
      const message = diag(result, receipt);
      assertEventEnvelope(events, fake.sessionId, message);

      assert.equal(result.code, 0, message);
      assert.equal(result.timedOut, false, message);
      assert.deepEqual(
        events.map((event) => event.seq),
        [1, 2, 3, 4],
        `el corte no duplica el seq 2: ${message}`
      );
      assert.deepEqual(
        events.map((event) => event.type),
        ['tool_call', 'tool_result', 'answer', 'done'],
        message
      );
      assert.equal(fake.connections.length, 2, message);
      assert.equal(fake.connections[1]?.after, '2', message);
      assert.equal(fake.connections[1]?.lastEventId, '2', message);
    } finally {
      await fake.close();
    }
  });
});
