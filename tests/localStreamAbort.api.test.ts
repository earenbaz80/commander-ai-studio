/**
 * Un cliente que abandona el stream tiene que cortar la generación en
 * llama-server y liberar el slot único.
 *
 * El doble imita al runtime real: `--parallel 1`, así que mientras una
 * generación sigue viva cualquier petición nueva recibe 503. Si el proxy no
 * propaga el cierre del socket, la segunda petición se queda sin slot y el
 * test falla.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;
let fake: http.Server;
let modelsDir: string;

/** Generaciones vivas en el doble: el slot único del runtime. */
let active = 0;
/** Veces que el cliente del proxy cortó una generación en curso. */
let abortedStreams = 0;

const TOKEN_INTERVAL_MS = 20;

const messages = [{ role: 'user', content: 'Escribe algo largo, por favor.' }];

const body = () => JSON.stringify({ model: 'modelo.gguf', messages, maxTokens: 256 });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(50);
  }
  return predicate();
}

before(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const payload = JSON.parse(raw || '{}');
      if (!payload.stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
        return;
      }
      if (active > 0) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'slot busy' }));
        return;
      }
      active += 1;
      let released = false;
      const release = (why: 'closed' | 'error') => {
        if (released) return;
        released = true;
        active -= 1;
        if (why === 'closed') abortedStreams += 1;
      };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const timer = setInterval(() => {
        if (res.destroyed || res.writableEnded) {
          clearInterval(timer);
          return;
        }
        try {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'tok ' } }] })}\n\n`);
        } catch {
          clearInterval(timer);
        }
      }, TOKEN_INTERVAL_MS);
      // Al cortarse el socket del proxy, el runtime real cancela y libera el slot.
      res.on('close', () => {
        clearInterval(timer);
        release('closed');
      });
      res.on('error', () => {
        clearInterval(timer);
        release('error');
      });
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const address = fake.address();
  if (!address || typeof address === 'string') throw new Error('el doble no tomó puerto');

  modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-abort-'));
  fs.writeFileSync(path.join(modelsDir, 'modelo.gguf'), 'GGUF');
  process.env.COMMANDER_LOCAL_MODELS_DIR = modelsDir;
  process.env.COMMANDER_LOCAL_RUNTIME_URL = `http://127.0.0.1:${address.port}`;

  srv = await spawnServer();
});

after(async () => {
  await srv?.stop();
  await new Promise<void>((resolve) => fake?.close(() => resolve()));
  fs.rmSync(modelsDir, { recursive: true, force: true });
  delete process.env.COMMANDER_LOCAL_MODELS_DIR;
  delete process.env.COMMANDER_LOCAL_RUNTIME_URL;
});

test('cerrar el socket a mitad del stream corta la generación y libera el slot', async () => {
  const controller = new AbortController();
  const res = await fetch(`${srv.baseUrl}/api/local-models/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body(),
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  assert.ok(res.body, 'el stream debe traer cuerpo');

  const reader = res.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false, 'debe llegar al menos un chunk antes de abortar');
  assert.equal(active, 1, 'el doble debería tener la generación en curso');

  controller.abort(new Error('el usuario cerró el chat'));
  await reader.cancel().catch(() => {});

  const released = await waitFor(() => active === 0);
  assert.ok(released, 'el runtime siguió generando después de cerrar el socket');
  assert.ok(abortedStreams > 0, 'el corte tiene que haber llegado al upstream');
});

test('después del abort el siguiente turno entra sin esperar el slot', async () => {
  const started = Date.now();
  const res = await fetch(`${srv.baseUrl}/api/local-models/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body(),
  });

  assert.equal(res.status, 200, 'el slot tenía que estar libre');
  const text = await (async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let out = '';
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
      if (out.includes('"type":"chunk"')) break;
    }
    await reader.cancel().catch(() => {});
    return out;
  })();

  assert.match(text, /"type":"chunk"/);
  assert.ok(Date.now() - started < 5_000, 'el turno siguiente no debería esperar a la generación abandonada');
});
