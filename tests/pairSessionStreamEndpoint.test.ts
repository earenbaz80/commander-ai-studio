/**
 * `PairSessionStream` contra el SSE real del server (F3).
 *
 * El unitario (`tests/unit/pairSessionStream.test.ts`) usa lectores falsos: sirve
 * para la máquina de estados, pero no prueba lo que de verdad importa en una
 * reconexión —qué cabecera sale y qué reemite el servidor—. Acá el cliente habla
 * con `server.ts` de verdad: una sesión corrida contra un proveedor falso deja
 * eventos en el buffer, la primera conexión se corta a mitad del stream y el
 * cliente reconecta solo, como cuando se cae la red.
 *
 * El caso del `resync` no espera a que el buffer desaloje 1.000 eventos: abre el
 * stream con un cursor adelantado (`Last-Event-ID` mayor que el último `seq`),
 * que es la otra vía real del servidor para mandar el `SessionStateV2` completo.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';
import {
  PairSessionStream,
  type FetchLike,
  type PairStreamFrame,
  type PairStreamStatus,
} from '../src/pair/pairSessionStream.js';

const FAKE_ANSWER = 'Stream reanudable visto por el cliente.';

interface FakeProvider {
  baseUrl: string;
  close: () => Promise<void>;
}

/** Proveedor OpenAI-compatible local: la sesión termina sin salir a la red. */
async function startFakeProvider(): Promise<FakeProvider> {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const body = JSON.stringify({
        id: 'chatcmpl-pair-stream',
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

/** Sesión con la corrida terminada: sus eventos quedan en el buffer del server. */
async function completedSession(goal: string): Promise<string> {
  const created = await srv.request('POST', '/api/agent/sessions', {
    goal,
    model: 'custom/test',
    maxSteps: 3,
    run: true,
    keys: {
      CUSTOM_BASE_URL: provider.baseUrl,
      CUSTOM_API_KEY: 'clave-falsa',
      CUSTOM_MODEL: 'modelo-falso',
    },
  });
  assert.equal(created.status, 200, created.raw);
  const id = String(created.body.session.id);

  const deadline = Date.now() + 20_000;
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

function streamUrl(id: string): string {
  return `${srv.baseUrl}/api/agent/sessions/${encodeURIComponent(id)}/stream`;
}

/** Espera a que se cumpla una condición sin dormir un tiempo fijo. */
async function waitFor<T>(
  label: string,
  read: () => T | null | undefined | false,
  timeoutMs = 20_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`no se cumplió: ${label}`);
}

/**
 * `fetch` que registra la cabecera de cada conexión y corta la primera después
 * de un frame completo, que es lo que ve el cliente cuando se cae la red.
 */
function cuttingFetch(): {
  fetchImpl: FetchLike;
  headers: () => Array<Record<string, string>>;
} {
  const headers: Array<Record<string, string>> = [];
  let calls = 0;

  const fetchImpl: FetchLike = async (input, init) => {
    calls += 1;
    const sent = (init?.headers ?? {}) as Record<string, string>;
    headers.push({ ...sent });

    const response = await fetch(input, init);
    if (calls > 1 || !response.body) return response;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';
    let forwarded = false;

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const end = buffer.indexOf('\n\n');
        if (!forwarded && end >= 0) {
          forwarded = true;
          controller.enqueue(encoder.encode(buffer.slice(0, end + 2)));
          // El corte va después del frame: el cliente ya tiene un `seq` que
          // mandar como Last-Event-ID cuando reintente.
          controller.error(new Error('corte de red simulado'));
          return;
        }
        controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });

    return new Response(body, { status: response.status, headers: response.headers });
  };

  return { fetchImpl, headers: () => headers };
}

interface Collected {
  frames: PairStreamFrame[];
  statuses: PairStreamStatus[];
  errors: unknown[];
}

describe('PairSessionStream contra el SSE real', () => {
  test('reconecta con Last-Event-ID y reanuda sin repetir eventos', async () => {
    const id = await completedSession('Reanudar el stream por Last-Event-ID (F3)');
    const cut = cuttingFetch();
    const seen: Collected = { frames: [], statuses: [], errors: [] };
    // Un frame del buffer ya alcanza para saber que el server respondió.
    const firstFrame = new Promise<PairStreamFrame>((resolve) => {
      const stream = new PairSessionStream({
        url: streamUrl(id),
        fetchImpl: cut.fetchImpl,
        retryMs: 25,
        maxRetryMs: 50,
        onFrame: (frame) => {
          seen.frames.push(frame);
          resolve(frame);
        },
        onStatus: (status) => seen.statuses.push(status),
        onError: (error) => seen.errors.push(error),
      });
      stream.start();
    });

    const delivered = await firstFrame;
    assert.ok(delivered.id !== null, `el primer frame no traía id: ${JSON.stringify(delivered)}`);

    await waitFor('la reconexión y el cierre por gone', () =>
      seen.frames.some((frame) => frame.event === 'gone')
    );

    const requests = cut.headers();
    assert.equal(requests.length, 2, `se esperaban dos conexiones: ${JSON.stringify(requests)}`);
    // La primera abre sin cursor; la segunda retoma desde el frame ya visto.
    assert.equal(requests[0]['Last-Event-ID'], undefined, JSON.stringify(requests[0]));
    assert.equal(requests[1]['Last-Event-ID'], String(delivered.id), JSON.stringify(requests[1]));
    assert.ok(seen.statuses.includes('reconnecting'), `estados: ${seen.statuses.join(',')}`);
    // `gone` cierra sin reconectar: pasado el margen no debe haber otra petición.
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(cut.headers().length, 2, 'el cliente volvió a conectar después del gone');

    // El server no reemite lo ya entregado: todos los `seq` posteriores son nuevos.
    const afterResume = seen.frames.filter(
      (frame) => frame.id !== null && frame.id > (delivered.id as number)
    );
    assert.ok(afterResume.length > 0, 'la reconexión no trajo frames nuevos');
    // `gone` se sella con el último `seq` a propósito (es cierre, no evento),
    // así que la comprobación de repeticiones mira sólo los eventos.
    const ids = seen.frames
      .filter((frame) => frame.event !== 'gone')
      .map((frame) => frame.id)
      .filter((value): value is number => value !== null);
    const duplicated = ids.filter((value, index) => ids.indexOf(value) !== index);
    assert.deepEqual(
      duplicated,
      [],
      `el server repitió eventos: ${duplicated.join(',')} · ${JSON.stringify(
        seen.frames.map((frame) => [frame.id, frame.event])
      )} · cabeceras ${JSON.stringify(requests)}`
    );
    const answer = seen.frames.find((frame) => frame.event === 'answer');
    assert.ok(answer, 'la reconexión no llegó hasta el answer');
    assert.equal((answer!.data as any).text, FAKE_ANSWER);
  });

  test('aplica el resync completo cuando el cursor quedó adelante', async () => {
    const id = await completedSession('Resync del stream con cursor viejo (F3)');
    const seen: Collected = { frames: [], statuses: [], errors: [] };
    const headers: Array<Record<string, string>> = [];

    const fetchImpl: FetchLike = async (input, init) => {
      headers.push({ ...((init?.headers ?? {}) as Record<string, string>) });
      return fetch(input, init);
    };

    const stream = new PairSessionStream({
      url: streamUrl(id),
      fetchImpl,
      retryMs: 0,
      onFrame: (frame) => seen.frames.push(frame),
      onStatus: (status) => seen.statuses.push(status),
      onError: (error) => seen.errors.push(error),
    });
    // Cursor por delante del último `seq`: el server no puede reemitir, así que
    // manda el estado completo y el cliente lo entrega tal cual.
    stream.lastEventId = 999_999;
    stream.start();

    await waitFor('el resync y el cierre por gone', () =>
      seen.frames.some((frame) => frame.event === 'gone')
    );

    assert.deepEqual(headers[0], {
      Accept: 'text/event-stream',
      'Last-Event-ID': '999999',
    });
    const resync = seen.frames[0];
    assert.equal(resync.event, 'resync', JSON.stringify(seen.frames.map((frame) => frame.event)));
    const state = resync.data as any;
    assert.equal(state.id, id);
    assert.equal(state.schemaVersion, 2);
    assert.ok(Array.isArray(state.steps), 'el resync no traía steps');
    assert.ok(Array.isArray(state.turns), 'el resync no traía turns');
    assert.equal(state.status, 'completed');
    // Con `retryMs: 0` hay un solo intento; el gone no reabre nada.
    assert.equal(headers.length, 1, `conexiones: ${JSON.stringify(headers)}`);
  });
});
