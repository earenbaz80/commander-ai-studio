import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { handleAgentRunTool } from '../agentTools.js';

// code.run estÃ¡ deshabilitado por defecto (opt-in); estos tests validan el

function mockReq(body: any) {
  return { body, ip: '127.0.0.1', headers: {} } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) { this.body = data; return this; },
    setHeader() { return this; },
    flushHeaders() { return this; },
    write() { return this; },
    end() { return this; },
  };
  return res;
}

let srv: http.Server;
let origin = '';
let lastBody: any = null;
let lastHeaders: Record<string, string | string[] | undefined> = {};

// Servidor que imita un MCP server (JSON-RPC 2.0) y una web de prueba
before(async () => {
  srv = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      lastHeaders = req.headers;
      if (req.url === '/web') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('contenido de prueba 12345');
        return;
      }
      lastBody = raw ? JSON.parse(raw) : null;
      if (lastBody?.method === 'tools/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: lastBody.id, result: { tools: [{ name: 'suma' }, { name: 'saluda' }] } }));
        return;
      }
      if (lastBody?.method === 'tools/call') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: lastBody.id,
          result: { content: [{ type: 'text', text: `llamado ${lastBody.params?.name}` }] },
        }));
        return;
      }
      res.writeHead(400).end('{}');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((r) => srv.close(() => r()));
});

test('mcp.list lista tools del servidor', async () => {
  const req = mockReq({ toolId: 'mcp.list', input: { serverUrl: `${origin}/mcp` } });
  const res = mockRes();
  await handleAgentRunTool(req, res);

  assert.equal(res.body.ok, true);
  assert.equal(lastBody.method, 'tools/list');
  assert.equal(res.body.data.result.tools.length, 2);
  assert.equal(res.body.data.result.tools[0].name, 'suma');
});

test('mcp.call reenvÃ­a tool y argumentos', async () => {
  const req = mockReq({
    toolId: 'mcp.call',
    input: { serverUrl: `${origin}/mcp`, tool: 'suma', args: { a: 1, b: 2 } },
  });
  const res = mockRes();
  await handleAgentRunTool(req, res);

  assert.equal(res.body.ok, true);
  assert.equal(lastBody.method, 'tools/call');
  assert.equal(lastBody.params.name, 'suma');
  assert.deepEqual(lastBody.params.arguments, { a: 1, b: 2 });
  assert.match(res.body.data.result.content[0].text, /llamado suma/);
});

test('mcp: usa JSON-RPC 2.0 con id numÃ©rico', async () => {
  const req = mockReq({ toolId: 'mcp.list', input: { serverUrl: `${origin}/mcp` } });
  await handleAgentRunTool(req, mockRes());
  assert.equal(lastBody.jsonrpc, '2.0');
  assert.equal(typeof lastBody.id, 'number');
});

test('mcp: solo reenvÃ­a headers de auth, descarta el resto', async () => {
  const req = mockReq({
    toolId: 'mcp.call',
    input: {
      serverUrl: `${origin}/mcp`,
      tool: 'saluda',
      args: {},
      headers: { Authorization: 'Bearer tok123', 'X-Api-Key': 'k-abc', 'X-Custom': 'no-debe-pasar' },
    },
  });
  await handleAgentRunTool(req, mockRes());

  assert.equal(lastHeaders.authorization, 'Bearer tok123');
  assert.equal(lastHeaders['x-api-key'], 'k-abc');
  assert.equal(lastHeaders['x-custom'], undefined, 'headers arbitrarios no deben reenviarse');
});

test('mcp: ignora valores de header demasiado largos', async () => {
  const req = mockReq({
    toolId: 'mcp.call',
    input: { serverUrl: `${origin}/mcp`, tool: 'saluda', headers: { Authorization: 'x'.repeat(3000) } },
  });
  await handleAgentRunTool(req, mockRes());
  assert.equal(lastHeaders.authorization, undefined, 'header >2000 chars debe descartarse');
});

test('mcp: bloquea endpoint de metadata de GCP', async () => {
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'mcp.list', input: { serverUrl: 'http://169.254.169.254/latest/meta-data' } }), res);
  assert.equal(res.statusCode, 403);

  const res2 = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'mcp.call', input: { serverUrl: 'http://metadata.google.internal/computeMetadata/v1/' } }), res2);
  assert.equal(res2.statusCode, 403);
});

test('mcp: rechaza URLs que no son http/https', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://x/y', 'not-a-url']) {
    const res = mockRes();
    await handleAgentRunTool(mockReq({ toolId: 'mcp.call', input: { serverUrl: url } }), res);
    assert.equal(res.body.ok, false, `debe rechazar ${url}`);
  }
});

test('mcp: sin serverUrl devuelve error', async () => {
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'mcp.call', input: { tool: 'saluda' } }), res);
  assert.equal(res.body.ok, false);
});

test('mcp: bloquea rangos privados (SSRF)', async () => {
  for (const url of ['http://10.0.0.1:8080/mcp', 'http://192.168.1.10/mcp', 'http://0.0.0.0/mcp']) {
    const res = mockRes();
    await handleAgentRunTool(mockReq({ toolId: 'mcp.list', input: { serverUrl: url } }), res);
    assert.equal(res.statusCode, 403, `debe bloquear ${url}`);
  }
});

test('web.fetch bloquea metadata cloud y privadas (SSRF)', async () => {
  for (const url of ['http://169.254.169.254/latest/meta-data', 'http://10.1.2.3/x']) {
    const res = mockRes();
    await handleAgentRunTool(mockReq({ toolId: 'web.fetch', input: { url } }), res);
    assert.equal(res.statusCode, 403, `debe bloquear ${url}`);
  }
});

test('web.fetch permite loopback (MCP/Ollama locales)', async () => {
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'web.fetch', input: { url: `${origin}/web` } }), res);

  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.status, 200);
  assert.match(res.body.data.content, /contenido de prueba 12345/);
});

test('web.fetch rechaza esquemas no http', async () => {
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'web.fetch', input: { url: 'file:///etc/passwd' } }), res);
  assert.equal(res.body.ok, false);
});

test('web.fetch reporta error de red sin tumbar el handler', async () => {
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'web.fetch', input: { url: 'http://127.0.0.1:1/nada' } }), res);
  assert.equal(res.body.ok, false);
  assert.ok(res.body.error);
});
