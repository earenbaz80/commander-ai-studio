import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleGeminiGenerate, handleGeminiStream, GEMINI_KEY_REQUIRED } from '../gemini.js';

function mockReq(body: any) {
  return {
    body,
    ip: '127.0.0.1',
    headers: {},
    cookies: {},
    socket: { setTimeout() { /* noop */ } },
    on() { /* noop */ },
  } as any;
}

function mockRes() {
  const chunks: string[] = [];
  const res: any = {
    statusCode: 200,
    body: null,
    ended: false,
    chunks,
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) { this.body = data; return this; },
    setHeader() { return this; },
    flushHeaders() { /* noop */ },
    write(chunk: string) { chunks.push(String(chunk)); return true; },
    end() { this.ended = true; return this; },
  };
  return res;
}

/** Ejecuta `fn` con GEMINI_API_KEY garantizado como ausente. */
async function withoutGeminiKey(fn: () => Promise<void>) {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await fn();
  } finally {
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  }
}

test('gemini/generate sin API key responde 400 MISSING_API_KEY (no error de Google)', async () => {
  await withoutGeminiKey(async () => {
    const res = mockRes();
    await handleGeminiGenerate(mockReq({ contents: 'hola', model: 'gemini-2.5-flash' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'MISSING_API_KEY');
    assert.equal(res.body.error, GEMINI_KEY_REQUIRED);
  });
});

test('gemini/stream sin API key emite un evento SSE de error claro y cierra', async () => {
  await withoutGeminiKey(async () => {
    const res = mockRes();
    await handleGeminiStream(mockReq({ contents: 'hola', model: 'gemini-2.5-flash' }), res);
    const payload = res.chunks.join('');
    assert.match(payload, /"type":"error"/);
    assert.match(payload, /MISSING_API_KEY/);
    assert.equal(res.ended, true);
  });
});
