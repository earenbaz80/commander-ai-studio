/**
 * Endpoint del stream reanudable (F1-03), contra el server real.
 *
 * La corrida se ejecuta con un proveedor OpenAI-compatible local. Al terminar,
 * el buffer en memoria permite abrir el SSE con `after=0`, reconectar con
 * `Last-Event-ID` y pedir un `resync` sin que el LLM vuelva a ejecutar nada.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

const FAKE_ANSWER = 'Stream listo desde el proveedor falso.';

interface FakeProvider {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startFakeProvider(): Promise<FakeProvider> {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const body = JSON.stringify({
        id: 'chatcmpl-stream',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: FAKE_ANSWER },
            finish_reason: 'stop',
          },
        ],
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      });
      res.end(body);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

interface SseFrame {
  id: number | null;
  event: string;
  data: string;
}

function parseSse(text: string): SseFrame[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      let id: number | null = null;
      let event = 'message';
      const data: string[] = [];
      for (const raw of block.split('\n')) {
        const line = raw.replace(/\r$/, '');
        if (line.startsWith('id:')) {
          const value = Number(line.slice(3).trim());
          if (Number.isSafeInteger(value)) id = value;
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        }
      }
      return { id, event, data: data.join('\n') };
    });
}

let srv: ServerHarness;
let provider: FakeProvider;

before(async () => {
  srv = await startServer();
  provider = await startFakeProvider();
});

after(async () => {
  await provider?.close();
  await srv?.stop();
});

async function createCompletedSession(): Promise<string> {
  const res = await srv.request('POST', '/api/agent/sessions', {
    goal: 'Prueba del stream reanudable F1-03',
    model: 'custom/test',
    maxSteps: 3,
    run: true,
    keys: {
      CUSTOM_BASE_URL: provider.baseUrl,
      CUSTOM_API_KEY: 'clave-falsa',
      CUSTOM_MODEL: 'modelo-falso',
    },
  });
  assert.equal(res.status, 200, res.raw);
  const id = String(res.body.session.id);
  const deadline = Date.now() + 15_000;
  let last: any = null;
  while (Date.now() < deadline) {
    const state = await srv.request('GET', `/api/agent/sessions/${id}`);
    assert.equal(state.status, 200, state.raw);
    last = state.body.state;
    if (last.status === 'completed' || last.status === 'failed') return id;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`la sesión no terminó: ${JSON.stringify(last)}`);
}

async function getSse(
  id: string,
  after?: number,
  headers: Record<string, string> = {}
): Promise<{ status: number; contentType: string; frames: SseFrame[]; text: string }> {
  const cursor = after === undefined ? '' : `?after=${after}`;
  const res = await fetch(
    `${srv.baseUrl}/api/agent/sessions/${encodeURIComponent(id)}/stream${cursor}`,
    { headers: { Accept: 'text/event-stream', ...headers } }
  );
  const text = await res.text();
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    frames: parseSse(text),
    text,
  };
}

describe('stream de sesión (F1-03)', () => {
  test('reemite la corrida completa con ids crecientes y cierra con gone', async () => {
    const id = await createCompletedSession();
    const stream = await getSse(id, 0);

    assert.equal(stream.status, 200, stream.text);
    assert.match(stream.contentType, /text\/event-stream/);
    const ids = stream.frames
      .filter((frame) => frame.event !== 'gone')
      .map((frame) => frame.id)
      .filter((value): value is number => value !== null);
    assert.ok(ids.length >= 2, stream.text);
    assert.ok(ids.every((value, index) => index === 0 || value > ids[index - 1]), stream.text);
    assert.ok(stream.frames.some((frame) => frame.event === 'status'), stream.text);
    assert.ok(stream.frames.some((frame) => frame.event === 'answer'), stream.text);
    assert.equal(stream.frames.at(-1)?.event, 'gone', stream.text);
    const answer = stream.frames.find((frame) => frame.event === 'answer');
    assert.equal(JSON.parse(answer?.data || '{}').text, FAKE_ANSWER);
  });

  test('Last-Event-ID reanuda sin repetir eventos anteriores', async () => {
    const id = await createCompletedSession();
    const full = await getSse(id, 0);
    const first = full.frames[0];
    assert.ok(first && first.id !== null, full.text);

    const resumed = await getSse(id, undefined, { 'Last-Event-ID': String(first.id) });
    assert.equal(resumed.status, 200, resumed.text);
    const ids = resumed.frames
      .map((frame) => frame.id)
      .filter((value): value is number => value !== null);
    assert.ok(ids.length > 0, resumed.text);
    assert.ok(ids.every((value) => value > (first.id as number)), resumed.text);
    assert.equal(resumed.frames.at(-1)?.event, 'gone', resumed.text);
  });

  test('un cursor desalojado produce resync con SessionStateV2', async () => {
    const id = await createCompletedSession();
    const stream = await getSse(id, 999_999);

    assert.equal(stream.status, 200, stream.text);
    const resync = stream.frames.find((frame) => frame.event === 'resync');
    assert.ok(resync, stream.text);
    const state = JSON.parse(resync.data);
    assert.equal(state.id, id);
    assert.equal(state.schemaVersion, 2);
    assert.equal(stream.frames.at(-1)?.event, 'gone', stream.text);
  });

  test('404 antes de abrir el stream y 400 para ids/cursores inválidos', async () => {
    const missing = await fetch(
      `${srv.baseUrl}/api/agent/sessions/sess_no_existe/stream?after=0`
    );
    assert.equal(missing.status, 404);
    await missing.body?.cancel();

    const traversal = await fetch(
      `${srv.baseUrl}/api/agent/sessions/..%2Fetc/stream?after=0`
    );
    assert.equal(traversal.status, 400);
    await traversal.body?.cancel();

    const id = await createCompletedSession();
    const badCursor = await fetch(
      `${srv.baseUrl}/api/agent/sessions/${encodeURIComponent(id)}/stream?after=abc`
    );
    assert.equal(badCursor.status, 400);
    await badCursor.body?.cancel();
  });
});
