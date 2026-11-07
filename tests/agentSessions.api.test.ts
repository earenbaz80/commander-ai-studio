/**
 * Sesión autoritativa en el servidor (F1-02), contra el server de verdad.
 *
 * El LLM se sustituye por un endpoint OpenAI-compatible local (`/v1`) al que
 * apunta la sesión con `model: 'custom/test'` y sus `keys`. Así se ejercita el
 * camino completo —crear, ejecutar, estado, mensaje, cancelar— sin claves ni
 * red externa.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

interface FakeProvider {
  /** Base URL que espera `/api/custom/generate` (le añade `/chat/completions`). */
  baseUrl: string;
  /** Retraso artificial por petición, para forzar solapamiento. */
  delayMs: number;
  requests: number;
  close: () => Promise<void>;
}

const FAKE_ANSWER = 'Listo desde el proveedor falso.';

async function startFakeProvider(): Promise<FakeProvider> {
  const state = { delayMs: 0, requests: 0 };

  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      state.requests += 1;
      const reply = () => {
        const body = JSON.stringify({
          id: 'chatcmpl-fake',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: FAKE_ANSWER },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        });
        res.end(body);
      };
      if (state.delayMs > 0) setTimeout(reply, state.delayMs);
      else reply();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    get delayMs() {
      return state.delayMs;
    },
    set delayMs(value: number) {
      state.delayMs = value;
    },
    get requests() {
      return state.requests;
    },
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

async function createSession(extra: Record<string, unknown> = {}) {
  const res = await srv.request('POST', '/api/agent/sessions', {
    goal: 'Prueba de sesión autoritativa F1-02',
    model: 'custom/test',
    maxSteps: 5,
    keys: {
      CUSTOM_BASE_URL: provider.baseUrl,
      CUSTOM_API_KEY: 'clave-falsa',
      CUSTOM_MODEL: 'modelo-falso',
    },
    ...extra,
  });
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.success, true, res.raw);
  return { id: String(res.body.session.id), body: res.body };
}

async function waitForState(
  id: string,
  statuses: string[],
  timeoutMs = 15_000
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const res = await srv.request('GET', `/api/agent/sessions/${id}`);
    assert.equal(res.status, 200, res.raw);
    last = res.body.state;
    if (statuses.includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(
    `la sesión ${id} no llegó a ${statuses.join('/')} en ${timeoutMs}ms (último: ${JSON.stringify(last)})`
  );
}

describe('sesiones autoritativas (F1-02)', () => {
  test('run:true avanza hasta completed y message añade un turno', async () => {
    const { id, body } = await createSession({ run: true });
    assert.equal(body.state.schemaVersion, 2);
    assert.equal(body.state.id, id);
    // `start()` marca running antes de responder: no hay ventana de idle falso.
    assert.equal(body.session.status, 'running');

    const first = await waitForState(id, ['completed', 'failed']);
    assert.equal(first.status, 'completed', JSON.stringify(first));
    assert.equal(first.answer, FAKE_ANSWER);
    assert.ok(first.steps.length >= 1, 'el bucle dejó pasos');
    assert.equal(first.turns[0].role, 'user');
    assert.match(first.turns[0].text, /F1-02/);

    const turnsBefore = first.turns.length;
    const message = await srv.request('POST', `/api/agent/sessions/${id}/message`, {
      text: 'Otra vuelta',
    });
    assert.equal(message.status, 202, message.raw);
    assert.equal(message.body.state.status, 'running');

    const second = await waitForState(id, ['completed', 'failed']);
    assert.equal(second.status, 'completed', JSON.stringify(second));
    assert.ok(second.turns.length > turnsBefore, 'el turno nuevo quedó en el historial');
    assert.equal(second.turns.at(-1)?.role, 'assistant');
  });

  test('id inexistente responde 404 y un id con .. responde 400', async () => {
    const missing = await srv.request('GET', '/api/agent/sessions/sess_no_existe');
    assert.equal(missing.status, 404, missing.raw);

    // `%2F` no lo normaliza `new URL` (lo que sí haría con un `..` suelto),
    // así que el `..` llega al handler y la validación responde 400.
    const traversal = await srv.request('GET', '/api/agent/sessions/..%2Fetc');
    assert.equal(traversal.status, 400, traversal.raw);

    const traversalMessage = await srv.request(
      'POST',
      '/api/agent/sessions/..%2Fetc/message',
      { text: 'x' }
    );
    assert.equal(traversalMessage.status, 400, traversalMessage.raw);

    const missingMessage = await srv.request(
      'POST',
      '/api/agent/sessions/sess_no_existe/message',
      { text: 'x' }
    );
    assert.equal(missingMessage.status, 404, missingMessage.raw);

    const missingFork = await srv.request(
      'POST',
      '/api/agent/sessions/sess_no_existe/fork',
      { run: false }
    );
    assert.equal(missingFork.status, 404, missingFork.raw);
  });

  test('dos message concurrentes: una 202 y la otra 409, sin duplicar turnos', async () => {
    const { id } = await createSession();
    provider.delayMs = 1_200;
    try {
      const [a, b] = await Promise.all([
        srv.request('POST', `/api/agent/sessions/${id}/message`, { text: 'primera' }),
        srv.request('POST', `/api/agent/sessions/${id}/message`, { text: 'segunda' }),
      ]);
      const statuses = [a.status, b.status].sort((x, y) => x - y);
      assert.deepEqual(statuses, [202, 409], `${a.raw}\n${b.raw}`);

      const state = await waitForState(id, ['completed', 'failed']);
      assert.equal(state.status, 'completed', JSON.stringify(state));
      const sent = state.turns.filter(
        (turn: any) => turn.role === 'user' && (turn.text === 'primera' || turn.text === 'segunda')
      );
      assert.equal(sent.length, 1, 'sólo la petición aceptada añade turno');
    } finally {
      provider.delayMs = 0;
    }
  });

  test('cancelar corta la corrida y deja el estado en cancelled', async () => {
    provider.delayMs = 5_000;
    try {
      const { id } = await createSession({ run: true });
      const cancel = await srv.request('POST', `/api/agent/sessions/${id}/cancel`);
      assert.equal(cancel.status, 200, cancel.raw);
      assert.equal(cancel.body.parentCancelled, true, cancel.raw);

      const state = await waitForState(
        id,
        ['cancelled', 'failed', 'completed'],
        5_000
      );
      assert.equal(state.status, 'cancelled', JSON.stringify(state));
    } finally {
      provider.delayMs = 0;
    }
  });

  test('fork copia historial y pasos, y no muta la sesión origen', async () => {
    const { id } = await createSession({ run: true });
    const source = await waitForState(id, ['completed', 'failed']);
    assert.equal(source.status, 'completed', JSON.stringify(source));
    const snapshot = JSON.stringify(source);
    const toolResultsBefore = source.steps.filter(
      (step: any) => step.type === 'tool_result'
    ).length;

    const forked = await srv.request('POST', `/api/agent/sessions/${id}/fork`, {
      text: 'Explora la rama nueva',
      run: true,
    });
    assert.equal(forked.status, 201, forked.raw);
    const forkId = String(forked.body.state.id);
    assert.notEqual(forkId, id, 'el fork tiene id propio');
    assert.equal(forked.body.state.status, 'running');
    assert.equal(forked.body.state.answer, undefined, 'el fork no hereda la respuesta final');
    assert.ok(
      forked.body.state.steps.length >= source.steps.length,
      'el fork copió los pasos de la fuente'
    );

    const forkState = await waitForState(forkId, ['completed', 'failed']);
    assert.equal(forkState.status, 'completed', JSON.stringify(forkState));
    assert.equal(forkState.answer, FAKE_ANSWER);
    assert.ok(
      forkState.turns.some(
        (turn: any) => turn.role === 'user' && turn.text === 'Explora la rama nueva'
      ),
      'el fork conserva el turno nuevo'
    );
    assert.equal(
      forkState.steps.filter((step: any) => step.type === 'tool_result').length,
      toolResultsBefore,
      'el fork copió los resultados de tools sin duplicarlos'
    );

    const after = await srv.request('GET', `/api/agent/sessions/${id}`);
    assert.equal(after.status, 200, after.raw);
    assert.equal(JSON.stringify(after.body.state), snapshot, 'la sesión origen no cambió');
  });

  test('PUT /state persiste el checkpoint del CLI y rechaza otro id', async () => {
    const { id } = await createSession();
    const idle = await waitForState(id, ['idle'], 2_000);
    const ts = Date.now();
    const checkpoint = {
      ...idle,
      status: 'completed',
      answer: 'hecho por el cliente',
      turns: [{ role: 'user', text: 'turno del CLI', ts }],
      steps: [
        {
          id: 'step_cli',
          type: 'thought',
          title: 'Finalizado',
          content: 'hecho por el cliente',
          status: 'completed',
          ts,
        },
      ],
    };

    const saved = await srv.request('PUT', `/api/agent/sessions/${id}/state`, {
      state: checkpoint,
    });
    assert.equal(saved.status, 200, saved.raw);
    assert.equal(saved.body.state.status, 'completed');
    assert.equal(saved.body.state.answer, 'hecho por el cliente');
    assert.equal(saved.body.state.steps.at(-1)?.id, 'step_cli');

    const persisted = await srv.request('GET', `/api/agent/sessions/${id}`);
    assert.equal(persisted.status, 200, persisted.raw);
    assert.equal(persisted.body.state.status, 'completed');
    assert.equal(persisted.body.state.answer, 'hecho por el cliente');

    const foreign = await srv.request('PUT', `/api/agent/sessions/${id}/state`, {
      state: { ...checkpoint, id: 'sess_otra' },
    });
    assert.equal(foreign.status, 400, foreign.raw);
  });

  test('crear sin run no arranca nada, y DELETE quita también el estado', async () => {
    const requestsBefore = provider.requests;
    const { id } = await createSession();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const state = await waitForState(id, ['idle'], 2_000);
    assert.equal(state.status, 'idle');
    assert.equal(provider.requests, requestsBefore, 'sin run no se llama al LLM');

    const deleted = await srv.request('DELETE', `/api/agent/sessions/${id}`);
    assert.equal(deleted.status, 200, deleted.raw);
    const gone = await srv.request('GET', `/api/agent/sessions/${id}`);
    assert.equal(gone.status, 404, gone.raw);
  });
});
