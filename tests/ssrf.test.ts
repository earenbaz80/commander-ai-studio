import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { assertSafeOutboundUrl, safeFetch } from '../ssrf.js';
import { handleAgentRunTool } from '../agentTools.js';

test('safeFetch rechaza una redirección hacia metadata cloud', async () => {
  const srv = http.createServer((_req, res) => {
    res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
    res.end();
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as AddressInfo;
  try {
    await assert.rejects(() => safeFetch(`http://127.0.0.1:${port}/`), /bloqueado/);
  } finally {
    srv.close();
  }
});

function mockReq(body: any) {
  return { body, ip: '127.0.0.1', headers: {} } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) { this.body = data; return this; },
  };
  return res;
}

test('rechaza esquemas no http/https', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://x/y', 'gopher://x', 'not-a-url', '']) {
    await assert.rejects(() => assertSafeOutboundUrl(url), `debe rechazar ${url || '(vacío)'}`);
  }
});

test('rechaza URLs con credenciales embebidas', async () => {
  await assert.rejects(() => assertSafeOutboundUrl('http://user:pass@example.com/'));
  await assert.rejects(() => assertSafeOutboundUrl('http://user@127.0.0.1:11434/'));
});

test('bloquea metadata cloud y link-local', async () => {
  await assert.rejects(() => assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data'));
  await assert.rejects(() => assertSafeOutboundUrl('http://metadata.google.internal/computeMetadata/v1/'));
  await assert.rejects(() => assertSafeOutboundUrl('https://metadata.google/'));
});

test('bloquea rangos privados RFC1918 y especiales', async () => {
  for (const url of [
    'http://10.0.0.1/',
    'http://172.16.5.4:8080/x',
    'http://192.168.1.1/',
    'http://0.0.0.0/',
    'http://100.64.0.1/', // CGNAT
    'http://224.0.0.1/', // multicast
  ]) {
    await assert.rejects(() => assertSafeOutboundUrl(url), `debe bloquear ${url}`);
  }
});

test('bloquea IP en forma numérica (ofuscación decimal)', async () => {
  // 167772161 == 10.0.0.1: getaddrinfo lo resuelve sin red, debe bloquearse igual.
  await assert.rejects(() => assertSafeOutboundUrl('http://167772161/'));
});

test('permite loopback por defecto (Ollama/MCP locales y tests)', async () => {
  const out = await assertSafeOutboundUrl('http://127.0.0.1:11434/api/tags');
  assert.equal(out, 'http://127.0.0.1:11434/api/tags');
});

test('permite IP pública literal sin necesidad de DNS', async () => {
  // 93.184.216.34 = example.com: literal IP, no requiere red para validar.
  const out = await assertSafeOutboundUrl('http://93.184.216.34/');
  assert.equal(out, 'http://93.184.216.34/');
});

test('modo estricto bloquea también loopback', async () => {
  const prev = process.env.AGENT_STRICT_NET;
  process.env.AGENT_STRICT_NET = '1';
  try {
    await assert.rejects(() => assertSafeOutboundUrl('http://127.0.0.1:11434/api/tags'));
  } finally {
    if (prev === undefined) delete process.env.AGENT_STRICT_NET;
    else process.env.AGENT_STRICT_NET = prev;
  }
});

test('code.run denegado por defecto (sin opt-in)', async () => {
  const prev = process.env.AGENT_ALLOW_CODE_RUN;
  delete process.env.AGENT_ALLOW_CODE_RUN;
  try {
    const res = mockRes();
    await handleAgentRunTool(mockReq({ toolId: 'code.run', input: { code: '1+1' } }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
  } finally {
    if (prev !== undefined) process.env.AGENT_ALLOW_CODE_RUN = prev;
  }
});
