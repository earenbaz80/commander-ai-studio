import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;
let fake: http.Server;
let fakeBase = '';

before(async () => {
  srv = await startServer();
  fake = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/messages/count_tokens') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no encontrado' }));
      return;
    }
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ input_tokens: 42 }));
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const address = fake.address();
  if (!address || typeof address === 'string') throw new Error('el servidor falso no tiene puerto');
  fakeBase = `http://127.0.0.1:${address.port}/v1`;
});

after(async () => {
  await srv?.stop();
  await new Promise<void>((resolve) => fake?.close(() => resolve()));
});

test('POST /api/context/count usa el contador real de Strata local', async () => {
  const res = await srv.request('POST', '/api/context/count', {
    provider: 'strata-local',
    model: 'qwen',
    baseUrl: fakeBase,
    systemInstruction: 'sistema',
    messages: [{ role: 'user', content: 'hola' }],
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.source, 'provider');
  assert.equal(res.body.tokens, 42);
  assert.equal(res.body.tokenizer, 'strata');
});

test('si el contador de Google no responde el endpoint devuelve estimación, no un error', async () => {
  const res = await srv.request('POST', '/api/context/count', {
    provider: 'google',
    model: 'gemini-3.5-flash',
    // El servidor falso responde 404 a countTokens: aunque exista una clave
    // configurada, la medición debe caer a la estimación y no romper el envío.
    baseUrl: fakeBase,
    systemInstruction: 'sistema',
    messages: [{ role: 'user', content: 'hola' }],
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.source, 'estimate');
  assert.ok(res.body.tokens > 0);
});

test('un proveedor sin contador también cae a la estimación', async () => {
  const res = await srv.request('POST', '/api/context/count', {
    provider: 'ollama',
    model: 'llama3.2',
    messages: [{ role: 'user', content: 'hola' }],
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.source, 'estimate');
  assert.equal(res.body.tokenizer, 'heuristic');
});
