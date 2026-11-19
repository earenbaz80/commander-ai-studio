/**
 * Recuperación de un turno que no entra en la ventana, en los dos endpoints.
 *
 * Corre contra un llama-server falso: el server de la app se pide con
 * `spawnServer()` en lugar de `startServer()` porque necesita heredar
 * `COMMANDER_LOCAL_RUNTIME_URL` (upstream de reemplazo) y
 * `COMMANDER_LOCAL_MODELS_DIR` (carpeta con el `.gguf` de prueba) al arrancar.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnServer, type ServerHarness } from './helpers/serverHarness.js';

/** A partir de estos caracteres el doble contesta como llama.cpp sin KV shift. */
const LIMIT_CHARS = 12_000;

const OVERFLOW_TEXT = 'the request exceeds the available context size (n_ctx = 4096)';

let srv: ServerHarness;
let fake: http.Server;
let modelsDir: string;
const attempts: Array<{ messages?: Array<{ role: string; content: string }>; stream?: boolean }> = [];

/** Historial de agente que no entra: ~15.400 caracteres antes de recortar. */
function history(): Array<{ role: string; content: string }> {
  const messages = [{ role: 'system', content: 's'.repeat(400) }];
  for (let index = 0; index < 5; index += 1) {
    messages.push({ role: index % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(3_000) });
  }
  messages.push({ role: 'user', content: 'CONTINUA' });
  return messages;
}

const bodyText = (payload: any) => JSON.stringify(payload.messages ?? []);

before(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const payload = JSON.parse(raw || '{}');
      attempts.push(payload);
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      // 400 que no es de ventana: el recorte no lo arregla y no debe reintentarse.
      if (bodyText(payload).includes('SAMPLING-ERROR')) {
        return json(400, { error: 'invalid sampling parameters: temperature must be >= 0' });
      }
      if (bodyText(payload).length > LIMIT_CHARS) {
        return json(400, { error: { code: 400, message: OVERFLOW_TEXT } });
      }
      if (payload.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hola' } }] })}\n\n`);
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 },
          })}\n\n`
        );
        res.end('data: [DONE]\n\n');
        return;
      }
      return json(200, {
        choices: [{ message: { content: 'listo' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 },
      });
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const address = fake.address();
  if (!address || typeof address === 'string') throw new Error('el doble no tomó puerto');

  modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-models-'));
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

before(() => {
  attempts.length = 0;
});

test('POST /generate recorta el historial y reintenta una sola vez', async () => {
  attempts.length = 0;
  const res = await srv.request('POST', '/api/local-models/generate', {
    model: 'modelo.gguf',
    messages: history(),
    maxTokens: 32,
  });

  assert.equal(res.status, 200, `respuesta: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.success, true);
  assert.equal(res.body.text, 'listo');
  assert.equal(attempts.length, 2, 'debe haber exactamente un reintento');
  assert.ok(bodyText(attempts[0]).length > LIMIT_CHARS);
  assert.ok(
    bodyText(attempts[1]).length <= LIMIT_CHARS,
    `el reintento quedó en ${bodyText(attempts[1]).length} caracteres`
  );
  // El sistema y el último turno sobreviven al recorte.
  assert.equal(attempts[1].messages?.[0].role, 'system');
  assert.equal(attempts[1].messages?.at(-1)?.content, 'CONTINUA');
});

test('POST /stream recorta el historial y reintenta una sola vez', async () => {
  attempts.length = 0;
  const res = await fetch(`${srv.baseUrl}/api/local-models/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'modelo.gguf', messages: history(), maxTokens: 32 }),
  });

  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /"type":"chunk"/);
  assert.match(text, /"type":"done"/);
  assert.equal(attempts.length, 2, 'debe haber exactamente un reintento');
  assert.ok(bodyText(attempts[0]).length > LIMIT_CHARS);
  assert.ok(bodyText(attempts[1]).length <= LIMIT_CHARS);
  assert.equal(attempts[1].stream, true);
});

test('un 400 que no es de contexto no se reintenta en /generate', async () => {
  attempts.length = 0;
  const res = await srv.request('POST', '/api/local-models/generate', {
    model: 'modelo.gguf',
    messages: [{ role: 'user', content: 'SAMPLING-ERROR' }],
    maxTokens: 8,
  });

  assert.equal(res.status, 500);
  assert.equal(res.body.success, false);
  assert.equal(attempts.length, 1);
});

test('un 400 que no es de contexto no se reintenta en /stream', async () => {
  attempts.length = 0;
  const res = await fetch(`${srv.baseUrl}/api/local-models/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'modelo.gguf', messages: [{ role: 'user', content: 'SAMPLING-ERROR' }] }),
  });

  assert.equal(res.status, 502);
  assert.equal(attempts.length, 1);
});
