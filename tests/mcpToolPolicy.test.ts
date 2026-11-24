import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeAgentTool, handleAgentRunTool } from '../agentTools.js';
import { AgentSession } from '../agentSession.js';
import { setPermissions } from '../permissions.js';
import { resetConfig, writeConfig } from '../src/config/index.js';
import { serializeResults } from '../src/agent/contextBudget.js';
import {
  canonicalMcpServerUrl,
  decideMcpToolPolicy,
  decideMcpToolPolicyForTarget,
  normalizeMcpToolRules,
} from '../src/agent/mcpToolPolicy.js';

/**
 * La política vive en `.commander/permissions.json`, así que cada caso usa un
 * root temporal: no depende de los permisos del repo ni de otra prueba.
 */
const WORK_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tool-policy-'));

let srv: http.Server;
let origin = '';
let hits = 0;
let lastBody: any = null;

before(async () => {
  srv = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      hits += 1;
      try {
        lastBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        lastBody = null;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: lastBody?.id ?? 1,
        result: {
          content: [{ type: 'text', text: `ejecutada ${lastBody?.params?.name ?? ''}` }],
        },
      }));
    });
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  fs.rmSync(WORK_ROOT, { recursive: true, force: true });
});

function setPolicy(mcpToolRules: unknown): void {
  setPermissions(WORK_ROOT, {
    mode: 'build',
    allowedTools: null,
    deniedTools: [],
    files: { read: [], write: [] },
    mcpToolRules,
  });
}

function mockReq(body: any) {
  const input = body?.input && typeof body.input === 'object'
    ? { ...body.input, root: WORK_ROOT }
    : body?.input;
  return { body: { ...body, input }, ip: '127.0.0.1', headers: {} } as any;
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

async function callMcp(input: Record<string, unknown>) {
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'mcp.call', input }), res);
  return res;
}

async function waitForApproval(session: AgentSession): Promise<any> {
  for (let i = 0; i < 100; i++) {
    const pending = session.getPendingApprovals();
    if (pending.length > 0) return pending[0];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('la sesión no pidió aprobación');
}

test('normaliza la URL canónica y descarta reglas inválidas', () => {
  const rules = normalizeMcpToolRules([
    { serverUrl: `${origin}/mcp/`, tool: 'borrar', decision: 'deny' },
    { serverUrl: 'file:///etc/passwd', tool: 'x', decision: 'deny' },
    { serverUrl: origin, tool: '', decision: 'deny' },
    { serverUrl: origin, tool: '*', decision: 'quizá' },
  ]);

  assert.deepEqual(rules, [
    { serverUrl: `${origin}/mcp`, tool: 'borrar', decision: 'deny' },
  ]);
  assert.equal(canonicalMcpServerUrl('HTTP://EXAMPLE.COM:80/MCP/'), 'http://example.com/MCP');
});

test('decide por URL y tool, con la última regla que coincide', () => {
  const rules = normalizeMcpToolRules([
    { serverUrl: `${origin}/mcp`, tool: '*', decision: 'deny' },
    { serverUrl: `${origin}/mcp/`, tool: 'suma', decision: 'allow' },
  ]);

  assert.equal(decideMcpToolPolicy(`${origin}/mcp`, 'suma', rules), 'allow');
  assert.equal(decideMcpToolPolicy(`${origin}/mcp/`, 'borrar', rules), 'deny');
  assert.equal(decideMcpToolPolicy(`${origin}/otro`, 'borrar', rules), null);
  // La regla comodín de tool sigue cubriendo las demás tools del servidor.
  assert.equal(decideMcpToolPolicy(`${origin}/mcp`, 'otra', rules), 'deny');
});

test('normaliza y decide también por nombre de servidor stdio', () => {
  const rules = normalizeMcpToolRules([
    { server: 'registro', tool: 'borrar', decision: 'deny' },
    { server: '', tool: 'x', decision: 'deny' },
    { server: 'ambiguo', serverUrl: `${origin}/mcp`, tool: 'x', decision: 'deny' },
  ]);

  assert.deepEqual(rules, [{ server: 'registro', tool: 'borrar', decision: 'deny' }]);
  assert.equal(
    decideMcpToolPolicyForTarget({ kind: 'name', server: 'registro', tool: 'borrar' }, rules),
    'deny',
  );
  assert.equal(
    decideMcpToolPolicyForTarget({ kind: 'name', server: 'otro', tool: 'borrar' }, rules),
    null,
  );
  // Una regla por nombre no alcanza al servidor remoto con la misma tool.
  assert.equal(decideMcpToolPolicy(`${origin}/mcp`, 'borrar', rules), null);
});

test('deny en un servidor stdio no arranca el proceso', async () => {
  const marker = path.join(WORK_ROOT, 'stdio-started.txt');
  const script = path.join(WORK_ROOT, 'fake-stdio.mjs');
  fs.writeFileSync(
    script,
    `import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(marker)}, 'iniciado');\n`,
    'utf8',
  );

  const originalCwd = process.cwd();
  process.chdir(WORK_ROOT);
  try {
    resetConfig();
    writeConfig({
      tools: {
        mcp: {
          enabled: true,
          servers: {
            registro: { command: process.execPath, args: [script] },
          },
        },
      },
    });
    setPolicy([{ server: 'registro', tool: 'borrar', decision: 'deny' }]);

    const result = await executeAgentTool('mcp.call', {
      root: WORK_ROOT,
      server: 'registro',
      tool: 'borrar',
      args: { id: 1 },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'MCP_TOOL_DENIED');
    assert.equal(result.status, 403);
    assert.deepEqual(result.data.mcp, {
      decision: 'deny',
      server: 'registro',
      tool: 'borrar',
      policy: 'mcpToolRules',
    });
    assert.equal(fs.existsSync(marker), false, 'el proceso stdio no debe arrancar');
  } finally {
    process.chdir(originalCwd);
    resetConfig();
  }
});

test('deny no abre la conexión MCP ni ejecuta la tool', async () => {
  setPolicy([{ serverUrl: `${origin}/mcp/`, tool: 'borrar', decision: 'deny' }]);
  hits = 0;
  lastBody = null;

  const res = await callMcp({
    serverUrl: `${origin}/mcp`,
    tool: 'borrar',
    args: { id: 1 },
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'MCP_TOOL_DENIED');
  assert.deepEqual(res.body.data.mcp, {
    decision: 'deny',
    serverUrl: `${origin}/mcp`,
    tool: 'borrar',
    policy: 'mcpToolRules',
  });
  assert.match(res.body.error, /política del proyecto/);
  assert.equal(hits, 0, 'el servidor MCP no debe recibir ni la petición');
  assert.equal(lastBody, null);
});

test('deny también cubre el nombre enviado dentro de params', async () => {
  setPolicy([{ serverUrl: `${origin}/mcp`, tool: 'borrar', decision: 'deny' }]);
  hits = 0;
  lastBody = null;

  const res = await callMcp({
    serverUrl: `${origin}/mcp`,
    method: 'tools/call',
    params: { name: 'borrar', arguments: {} },
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'MCP_TOOL_DENIED');
  assert.equal(hits, 0);
  assert.equal(lastBody, null);
});

test('allow ejecuta la tool y ask exige aprobación antes de ejecutar', async () => {
  setPolicy([{ serverUrl: `${origin}/mcp`, tool: 'suma', decision: 'allow' }]);
  hits = 0;
  const allowed = await callMcp({ serverUrl: `${origin}/mcp`, tool: 'suma', args: { a: 1, b: 2 } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body.ok, true);
  assert.equal(hits, 1);
  assert.equal(lastBody.params.name, 'suma');

  setPolicy([{ serverUrl: `${origin}/mcp`, tool: 'borrar', decision: 'ask' }]);
  hits = 0;
  const session = new AgentSession({
    goal: 'probar ask',
    cwd: WORK_ROOT,
    model: 'gemini-2.5-flash',
    approvalTimeoutMs: 5_000,
  });
  const running = (session as any).runOne({
    tool: 'mcp.call',
    input: { serverUrl: `${origin}/mcp`, tool: 'borrar', args: {} },
  });

  const approval = await waitForApproval(session);
  assert.equal(approval.tool, 'mcp.call');
  assert.equal(hits, 0, 'ask no puede ejecutar antes de la decisión');
  session.resolveApproval(approval.id, 'deny', 'prueba de política');
  const denied = await running;
  assert.equal(denied.ok, false);
  assert.equal(denied.approval?.decision, 'deny');
  assert.equal(hits, 0);
});

test('allow evita la aprobación de mcp.call en el bucle', async () => {
  setPolicy([{ serverUrl: `${origin}/mcp`, tool: 'suma', decision: 'allow' }]);
  hits = 0;
  const session = new AgentSession({
    goal: 'probar allow',
    cwd: WORK_ROOT,
    model: 'gemini-2.5-flash',
  });
  const result = await (session as any).runOne({
    tool: 'mcp.call',
    input: { serverUrl: `${origin}/mcp`, tool: 'suma', args: { a: 2, b: 3 } },
  });

  assert.equal(result.ok, true);
  assert.equal(result.approval, undefined);
  assert.equal(hits, 1);
});

test('el modelo recibe code y hint del error estructurado', () => {
  const serialized = serializeResults([
    {
      tool: 'mcp.call',
      ok: false,
      error: 'MCP tool denegada',
      code: 'MCP_TOOL_DENIED',
      hint: 'Ajusta la política',
      data: { mcp: { decision: 'deny' } },
    },
  ]);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed[0].code, 'MCP_TOOL_DENIED');
  assert.equal(parsed[0].hint, 'Ajusta la política');
  assert.deepEqual(parsed[0].data, { mcp: { decision: 'deny' } });
});
