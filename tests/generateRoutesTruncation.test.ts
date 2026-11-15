/**
 * El turno truncado, contra las rutas reales de generación.
 *
 * `tests/unit/providerResponses.test.ts` fija el mapeo de cada proveedor, pero
 * no lo que la ruta responde. Aquí se piden `/api/ollama/generate` y
 * `/api/custom/generate` al server del arnés —el mismo de `npm run dev`— con
 * `host`/`baseURL` apuntando a un upstream falso local, así que se comprueba el
 * cuerpo `{success:false, error}` que viaja de verdad al agente y no un parser.
 *
 * Son las dos rutas del agente cuyo upstream se puede redirigir desde la
 * petición; OpenRouter, OpenAI/NVIDIA, Freebuff y Gemini lo tienen fijado (o
 * van por SDK) y su mapeo queda cubierto por los tests unitarios.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;
/** Upstream falso: el test decide qué devuelve cada ruta. */
let upstream: http.Server;
let upstreamBase = '';
const respuestas = new Map<string, any>();

before(async () => {
  upstream = http.createServer((req, res) => {
    const path = String(req.url || '').split('?')[0];
    // Se drena el cuerpo: el server cierra la conexión y sin esto el fetch de la
    // ruta puede quedarse esperando.
    req.resume();
    let payload = respuestas.get(path);
    // LM Studio sondea `/v1/models` (y `/api/v0/models`) antes de generar: sin
    // catálogo no hay host que resolver. Se sirve uno con el modelo pedido.
    if (!payload && req.method === 'GET' && path.endsWith('/models')) {
      payload = { data: [{ id: 'mi-modelo', state: 'loaded' }] };
    }
    // Gemini arma la URL como `<base>/v1beta/models/<modelo>:generateContent`.
    if (!payload && path.endsWith(':generateContent')) payload = respuestas.get('gemini');
    if (!payload) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `sin fixture para ${path}` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const { port } = upstream.address() as AddressInfo;
  upstreamBase = `http://127.0.0.1:${port}`;
  srv = await startServer();
});

after(async () => {
  await srv?.stop();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${srv.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, body: await res.json() };
}

test('/api/ollama/generate: un turno cortado y vacío responde error, no success con texto vacío', async () => {
  respuestas.set('/api/generate', { done_reason: 'length', response: '', eval_count: 2048 });

  const res = await post(`/api/ollama/generate?host=${encodeURIComponent(upstreamBase)}`, {
    prompt: 'hola',
    model: 'llama3.2',
    maxTokens: 2048,
  });

  assert.equal(res.body?.success, false, JSON.stringify(res.body));
  assert.equal(res.body?.ok, false);
  assert.match(String(res.body?.error), /truncada por max_tokens/);
  assert.match(String(res.body?.error), /max_tokens=2048/);
  assert.equal(res.body?.text, undefined, 'ni un texto vacío que el agente lea como cierre');
});

test('/api/ollama/generate: un final normal sigue siendo un éxito con su texto', async () => {
  respuestas.set('/api/generate', { done_reason: 'stop', response: 'hola' });

  const res = await post(`/api/ollama/generate?host=${encodeURIComponent(upstreamBase)}`, {
    prompt: 'hola',
    model: 'llama3.2',
  });

  assert.equal(res.body?.success, true, JSON.stringify(res.body));
  assert.equal(res.body?.text, 'hola');
});

test('/api/openrouter/generate: un turno cortado y vacío responde error, no success con texto vacío', async () => {
  respuestas.set('/chat/completions', {
    choices: [{ finish_reason: 'length', message: { content: '' } }],
    usage: { completion_tokens: 2048 },
  });

  // `baseURL` en el cuerpo redirige la ruta al upstream falso, igual que en custom.
  const res = await post('/api/openrouter/generate', {
    prompt: 'hola',
    model: 'openai/gpt-4o-mini',
    baseURL: upstreamBase,
    apiKey: 'clave-de-prueba',
    maxTokens: 2048,
  });

  assert.equal(res.body?.success, false, JSON.stringify(res.body));
  assert.equal(res.body?.ok, false);
  assert.match(String(res.body?.error), /truncada por max_tokens/);
  assert.match(String(res.body?.error), /max_tokens=2048/);
  assert.equal(res.body?.text, undefined, 'ni un texto vacío que el agente lea como cierre');
});

test('/api/openai/generate y /api/nvidia/generate: un turno cortado y vacío responde error, no success con texto vacío', async () => {
  respuestas.set('/chat/completions', {
    choices: [{ finish_reason: 'length', message: { content: '' } }],
    usage: { completion_tokens: 2048 },
  });

  // Las dos rutas comparten handler; `baseURL` en el cuerpo las manda al falso.
  for (const provider of ['openai', 'nvidia']) {
    const res = await post(`/api/${provider}/generate`, {
      prompt: 'hola',
      baseURL: upstreamBase,
      apiKey: 'clave-de-prueba',
      maxTokens: 2048,
    });

    assert.equal(res.body?.success, false, `${provider}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body?.ok, false, provider);
    assert.match(String(res.body?.error), /truncada por max_tokens/, provider);
    assert.equal(res.body?.text, undefined, `${provider}: ni un texto vacío que el agente lea como cierre`);
  }
});

test('/api/lmstudio/generate: un turno cortado y vacío responde error, no success con texto vacío', async () => {
  respuestas.set('/v1/chat/completions', {
    choices: [{ finish_reason: 'length', message: { content: '' } }],
    usage: { completion_tokens: 2048 },
  });

  // `host` en el cuerpo manda la ruta a nuestro LM Studio falso, que también
  // sirve `/v1/models` para que la sonda y la carga del modelo no fallen.
  const res = await post('/api/lmstudio/generate', {
    prompt: 'hola',
    model: 'mi-modelo',
    host: upstreamBase,
    maxTokens: 2048,
  });

  assert.equal(res.body?.success, false, JSON.stringify(res.body));
  assert.equal(res.body?.ok, false);
  assert.match(String(res.body?.error), /truncada por max_tokens/);
  assert.match(String(res.body?.error), /max_tokens=2048/);
  assert.equal(res.body?.text, undefined, 'ni un texto vacío que el agente lea como cierre');
});

test('/api/lmstudio/generate: el final normal conserva texto y finishReason', async () => {
  respuestas.set('/v1/chat/completions', {
    choices: [{ finish_reason: 'stop', message: { content: 'hola' } }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  });

  const res = await post('/api/lmstudio/generate', { prompt: 'hola', model: 'mi-modelo', host: upstreamBase });

  assert.equal(res.body?.success, true, JSON.stringify(res.body));
  assert.equal(res.body?.text, 'hola');
  assert.equal(res.body?.finishReason, 'stop');
});

test('/api/gemini/generate: MAX_TOKENS vacío responde error, no success con texto vacío', async () => {
  respuestas.set('gemini', { candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'MAX_TOKENS' }] });

  // `baseUrl` en el cuerpo apunta el cliente de Google a nuestro upstream falso.
  const res = await post('/api/gemini/generate', {
    contents: 'hola',
    model: 'gemini-2.5-flash',
    apiKey: 'clave-de-prueba',
    baseUrl: upstreamBase,
    maxTokens: 2048,
  });

  assert.equal(res.body?.success, false, JSON.stringify(res.body));
  assert.equal(res.body?.ok, false);
  assert.match(String(res.body?.error), /truncada por max_tokens/);
  assert.equal(res.body?.text, undefined, 'ni un texto vacío que el agente lea como cierre');
});

test('/api/custom/generate: un turno cortado y vacío responde error, no success con texto vacío', async () => {
  respuestas.set('/chat/completions', {
    choices: [{ finish_reason: 'length', message: { content: '' } }],
    usage: { completion_tokens: 4096 },
  });

  const res = await post('/api/custom/generate', {
    prompt: 'hola',
    model: 'mi-modelo',
    baseURL: upstreamBase,
    apiKey: 'clave-de-prueba',
    maxTokens: 4096,
  });

  assert.equal(res.body?.success, false, JSON.stringify(res.body));
  assert.equal(res.body?.ok, false);
  assert.match(String(res.body?.error), /truncada por max_tokens/);
  assert.match(String(res.body?.error), /max_tokens=4096/);
  assert.equal(res.body?.text, undefined);
});

test('/api/custom/generate: el final normal conserva texto, toolCalls y finishReason', async () => {
  respuestas.set('/chat/completions', {
    choices: [{ finish_reason: 'stop', message: { content: 'hola' } }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  });

  const res = await post('/api/custom/generate', {
    prompt: 'hola',
    model: 'mi-modelo',
    baseURL: upstreamBase,
    apiKey: 'clave-de-prueba',
  });

  assert.equal(res.body?.success, true, JSON.stringify(res.body));
  assert.equal(res.body?.text, 'hola');
  assert.equal(res.body?.finishReason, 'stop');
});

test('/api/custom/generate: cortado pero con tool calls sigue siendo accionable', async () => {
  respuestas.set('/chat/completions', {
    choices: [
      {
        finish_reason: 'length',
        message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'fs_read', arguments: '{"path":"a.txt"}' } }] },
      },
    ],
  });

  const res = await post('/api/custom/generate', {
    prompt: 'hola',
    model: 'mi-modelo',
    baseURL: upstreamBase,
    apiKey: 'clave-de-prueba',
  });

  assert.equal(res.body?.success, true, JSON.stringify(res.body));
  assert.equal(res.body?.toolCalls?.[0]?.name, 'fs_read', 'la llamada llega normalizada');
});
