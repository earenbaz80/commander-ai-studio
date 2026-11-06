import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

interface SseEvent {
  event: string;
  data: any;
}

interface SseWaiter {
  event: string;
  predicate: (data: any) => boolean;
  resolve: (event: SseEvent) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface BrowserSse {
  waitFor: (event: string, predicate: (data: any) => boolean, timeoutMs?: number) => Promise<SseEvent>;
  received: () => SseEvent[];
  close: () => Promise<void>;
}

interface LocalFixture {
  baseUrl: string;
  close: () => Promise<void>;
}

let srv: ServerHarness;

before(async () => {
  srv = await startServer();
});

after(async () => {
  await srv.stop();
});

/**
 * Cliente SSE mínimo para el test: lee el stream real, separa bloques por la
 * línea vacía y entrega cada evento ya parseado. No usa EventSource porque el
 * runner es Node y queremos ver también el status y el content-type del server.
 */
async function openBrowserSse(
  url: string,
  options: { lastEventId?: number } = {},
): Promise<BrowserSse> {
  const controller = new AbortController();
  const connectTimer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'text/event-stream',
        ...(options.lastEventId ? { 'Last-Event-ID': String(options.lastEventId) } : {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(connectTimer);
  }
  assert.equal(res.status, 200, `SSE respondió HTTP ${res.status}`);
  assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
  const reader = res.body?.getReader();
  assert.ok(reader, 'el SSE debe traer un cuerpo legible');

  const events: SseEvent[] = [];
  const waiters = new Set<SseWaiter>();
  let buffer = '';
  let closed = false;

  const failAll = (error: unknown) => {
    const reason = error instanceof Error ? error : new Error(String(error));
    for (const waiter of [...waiters]) waiter.reject(reason);
  };

  const pump = (async () => {
    const decoder = new TextDecoder();
    try {
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const raw of blocks) {
          const event = /^event:\s*(.+)$/m.exec(raw)?.[1]?.trim() || 'message';
          const dataLines = raw
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart());
          if (dataLines.length === 0) continue;
          let data: any;
          try {
            data = JSON.parse(dataLines.join('\n'));
          } catch {
            continue;
          }
          const parsed: SseEvent = { event, data };
          events.push(parsed);
          for (const waiter of [...waiters]) {
            if (waiter.event === event && waiter.predicate(data)) waiter.resolve(parsed);
          }
        }
      }
    } catch (error) {
      if (!closed) failAll(error);
    }
  })();

  const waitFor = (
    event: string,
    predicate: (data: any) => boolean,
    timeoutMs = 10_000,
  ): Promise<SseEvent> => {
    const existing = events.find((candidate) => candidate.event === event && predicate(candidate.data));
    if (existing) return Promise.resolve(existing);

    return new Promise<SseEvent>((resolve, reject) => {
      const waiter: SseWaiter = {
        event,
        predicate,
        resolve: (value) => {
          if (waiter.timer) clearTimeout(waiter.timer);
          waiters.delete(waiter);
          resolve(value);
        },
        reject: (error) => {
          if (waiter.timer) clearTimeout(waiter.timer);
          waiters.delete(waiter);
          reject(error);
        },
        timer: null,
      };
      waiter.timer = setTimeout(
        () => waiter.reject(new Error(`SSE: no llegó el evento "${event}" en ${timeoutMs}ms`)),
        timeoutMs,
      );
      waiters.add(waiter);
    });
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    for (const waiter of [...waiters]) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiters.delete(waiter);
    }
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      /* el stream ya estaba cerrado */
    }
    await pump.catch(() => {});
  };

  return { waitFor, close, received: () => [...events] };
}

/** Fixture HTTP local: una página que emite un error de consola y pide un 404. */
async function startFixture(): Promise<LocalFixture> {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>SSE fixture</title></head>
  <body style="margin:0;background:#0f172a;color:#fff;font:22px monospace">
    <h1>SSE fixture</h1>
    <p>frame, consola y red</p>
    <script>
      console.error('SSE console error');
      fetch('/missing').catch(function () {});
    </script>
  </body>
</html>`);
      return;
    }
    if (req.url === '/missing') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('missing');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

test('browser SSE: emite frame, consola y red reales de un fixture local', async () => {
  const fixture = await startFixture();
  const testRoot = fs.mkdtempSync(path.join(process.cwd(), 'tests', 'tmp-browser-sse-'));
  let sessionId = '';
  let stream: BrowserSse | null = null;

  try {
    // La sesión nace en about:blank: así los eventos del fixture son vivos,
    // posteriores a la conexión SSE, y no sólo el historial retenido.
    const opened = await srv.request('POST', '/api/browser/session', { root: testRoot });
    assert.equal(opened.status, 201, opened.raw);
    sessionId = opened.body?.session?.id;
    assert.ok(sessionId);

    stream = await openBrowserSse(`${srv.baseUrl}/api/browser/session/${sessionId}/stream`);
    const snapshot = await stream.waitFor('snapshot', () => true, 5_000);
    assert.equal(snapshot.data.session.id, sessionId);

    const fixtureUrl = `${fixture.baseUrl}/`;
    const framePromise = stream.waitFor(
      'frame',
      (data) => String(data?.frame?.url || '').startsWith(fixture.baseUrl),
      15_000,
    );
    const consolePromise = stream.waitFor(
      'console',
      (data) => String(data?.entry?.text || '').includes('SSE console error'),
      10_000,
    );
    const networkPromise = stream.waitFor(
      'network',
      (data) =>
        data?.entry?.method === 'GET' &&
        data.entry.url === `${fixture.baseUrl}/missing` &&
        data.entry.status === 404,
      10_000,
    );

    const navigated = await srv.request('POST', `/api/browser/session/${sessionId}/input`, {
      action: 'navigate',
      url: fixtureUrl,
    });
    assert.equal(navigated.status, 200, navigated.raw);
    assert.equal(navigated.body.session.page.url, fixtureUrl);

    const [frameEvent, consoleEvent, networkEvent] = await Promise.all([
      framePromise,
      consolePromise,
      networkPromise,
    ]);

    const frame = frameEvent.data.frame;
    assert.equal(frame.mimeType, 'image/jpeg');
    assert.match(frame.url, new RegExp(`^${fixture.baseUrl}/`));
    assert.ok(frame.data.length > 1_000, `frame demasiado pequeño: ${frame.data.length} caracteres`);
    const jpeg = Buffer.from(frame.data, 'base64');
    assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff], 'el frame debe ser un JPEG real');

    assert.equal(consoleEvent.data.entry.type, 'error');
    assert.match(consoleEvent.data.entry.text, /SSE console error/);

    const network = networkEvent.data.entry;
    assert.equal(network.method, 'GET');
    assert.equal(network.url, `${fixture.baseUrl}/missing`);
    assert.equal(network.status, 404);

    // El frame pump sigue mandando frames mientras el stream está abierto.
    const nextFrame = await stream.waitFor(
      'frame',
      (data) =>
        String(data?.frame?.url || '').startsWith(fixture.baseUrl) &&
        data.frame.seq > frame.seq,
      5_000,
    );
    assert.ok(nextFrame.data.frame.seq > frame.seq, 'debe llegar un segundo frame vivo');
  } finally {
    await stream?.close();
    if (sessionId) await srv.request('DELETE', `/api/browser/session/${sessionId}`);
    fs.rmSync(testRoot, { recursive: true, force: true });
    await fixture.close();
  }
});

test('browser SSE: reconectar con Last-Event-ID reanuda sin duplicar consola/red', async () => {
  const fixture = await startFixture();
  const testRoot = fs.mkdtempSync(path.join(process.cwd(), 'tests', 'tmp-browser-sse-'));
  let sessionId = '';
  let first: BrowserSse | null = null;
  let second: BrowserSse | null = null;

  /** Secuencias del log acumulable: consola y red. Los frames son estado, no log. */
  const logSeqs = (stream: BrowserSse) =>
    stream
      .received()
      .filter((event) => event.event === 'console' || event.event === 'network')
      .map((event) => Number(event.data?.seq ?? event.data?.entry?.seq))
      .filter((value) => Number.isFinite(value));

  try {
    const opened = await srv.request('POST', '/api/browser/session', { root: testRoot });
    assert.equal(opened.status, 201, opened.raw);
    sessionId = opened.body?.session?.id;
    assert.ok(sessionId);

    first = await openBrowserSse(`${srv.baseUrl}/api/browser/session/${sessionId}/stream`);
    await first.waitFor('snapshot', () => true, 5_000);

    const fixtureUrl = `${fixture.baseUrl}/`;
    const firstConsole = first.waitFor(
      'console',
      (data) => String(data?.entry?.text || '').includes('SSE console error'),
      10_000,
    );
    const firstNetwork = first.waitFor(
      'network',
      (data) => data?.entry?.url === `${fixture.baseUrl}/missing`,
      10_000,
    );
    const navigated = await srv.request('POST', `/api/browser/session/${sessionId}/input`, {
      action: 'navigate',
      url: fixtureUrl,
    });
    assert.equal(navigated.status, 200, navigated.raw);
    await Promise.all([firstConsole, firstNetwork]);

    const seenBefore = logSeqs(first);
    assert.ok(
      seenBefore.length >= 2,
      `la primera conexión debe traer consola y red: ${JSON.stringify(seenBefore)}`,
    );
    const cursor = Math.max(...seenBefore);

    await first.close();
    first = null;

    // Sin suscriptores el servidor sigue reteniendo lo que ocurre en la página.
    const missed = await srv.request('POST', `/api/browser/session/${sessionId}/input`, {
      action: 'navigate',
      url: fixtureUrl,
    });
    assert.equal(missed.status, 200, missed.raw);

    second = await openBrowserSse(`${srv.baseUrl}/api/browser/session/${sessionId}/stream`, {
      lastEventId: cursor,
    });
    await second.waitFor('snapshot', () => true, 5_000);

    // El replay posterior al cursor entrega lo que se perdió durante el corte.
    const resumed = await second.waitFor(
      'console',
      (data) => Number(data?.entry?.seq) > cursor,
      10_000,
    );
    assert.ok(Number(resumed.data.entry.seq) > cursor, 'el replay debe reanudar después del cursor');

    // Y no repite nada de lo que el cliente ya tenía.
    const repeated = logSeqs(second).filter((seq) => seq <= cursor);
    assert.deepEqual(
      repeated,
      [],
      `el replay no debe repetir eventos <= ${cursor}: ${JSON.stringify(repeated)}`,
    );

    const all = [...seenBefore, ...logSeqs(second)];
    assert.equal(
      new Set(all).size,
      all.length,
      `eventos duplicados entre conexiones: ${JSON.stringify(all)}`,
    );
  } finally {
    await first?.close();
    await second?.close();
    if (sessionId) await srv.request('DELETE', `/api/browser/session/${sessionId}`);
    fs.rmSync(testRoot, { recursive: true, force: true });
    await fixture.close();
  }
});
