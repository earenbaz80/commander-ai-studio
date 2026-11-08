/**
 * Sandbox de code.run (única fuente de verdad de estos tests).
 * code.run está deshabilitado por defecto (opt-in); aquí se prueba con el flag activado.
 * La denegación por defecto se prueba en ssrf.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleAgentRunTool } from '../agentTools.js';
import { setPermissions } from '../permissions.js';

process.env.AGENT_ALLOW_CODE_RUN = '1';

/**
 * Root temporal de la suite.
 *
 * Sin `root`, `code.run` toma los permisos del cwd del repo: un proyecto en
 * readonly bloquea la tool con 403 por el modo y estos tests, que prueban el
 * sandbox con el opt-in activo, fallarían por una configuración local.
 */
const WORK_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'code-run-root-'));
setPermissions(WORK_ROOT, {
  mode: 'build',
  allowedTools: null,
  deniedTools: [],
  files: { read: [], write: [] },
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

const run = async (input: Record<string, unknown>) => {
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'code.run', input: { root: WORK_ROOT, ...input } }), res);
  return res;
};

test('code.run ejecuta y captura console.log', async () => {
  const res = await run({ code: 'console.log("hola"); 6*7' });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.result, '42');
  assert.deepEqual(res.body.data.logs, ['hola']);
});

test('code.run no expone primitivas del host', async () => {
  const res = await run({
    code: 'JSON.stringify({ process: typeof process, require: typeof require, global: typeof global, Buffer: typeof Buffer, Function: typeof Function, eval: typeof eval, fetch: typeof fetch })',
  });

  assert.equal(res.body.ok, true);
  const types = JSON.parse(res.body.data.result);
  assert.equal(types.process, 'undefined');
  assert.equal(types.require, 'undefined');
  assert.equal(types.global, 'undefined', 'global del host no debe ser visible');
  assert.equal(types.Buffer, 'undefined');
  assert.equal(types.Function, 'undefined', 'sin Function no hay generación de código');
  assert.equal(types.eval, 'undefined');
  assert.equal(types.fetch, 'undefined', 'el sandbox no debe tener red por defecto');
});

test('code.run: los intrínsecos son del contexto, no del host', async () => {
  // Si el sandbox recibiera constructores del host, el escape por prototype chain
  // devolvería el process real. Debe devolver undefined.
  const res = await run({ code: 'String(this.constructor.constructor("return typeof process")())' });

  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.result, 'undefined', 'no debe poder generarse código en el realm del host');
});

test('code.run: bloquea escape por la cadena de prototipos', async () => {
  // Vectores que sí escapaban antes: `this` heredaba de Object.prototype del HOST,
  // así que toString/constructor llevaban a la Function del host y de ahí al process real.
  const vectors = [
    'this.constructor.constructor',
    'this.toString.constructor',
    'this.valueOf.constructor',
    'this.hasOwnProperty.constructor',
  ];
  for (const v of vectors) {
    const res = await run({ code: `String(${v}("return typeof process")())` });
    assert.equal(res.body.ok, true, `no debe lanzar: ${v}`);
    assert.equal(res.body.data.result, 'undefined', `escape bloqueado: ${v}`);
  }
});

test('code.run bloquea acceso directo a process/require', async () => {
  for (const code of [
    'process.exit(1)',
    'require("fs")',
    'require("fs").readdirSync(".")',
  ]) {
    const res = await run({ code });
    assert.equal(res.body.ok, false, `debe fallar: ${code}`);
  }
});

test('code.run respeta el timeout', async () => {
  const res = await run({ code: 'while(true){}', timeoutMs: 300 });
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /timed out|Script execution/i);
});

test('code.run mantiene los intrínsecos útiles (Math/JSON/Date)', async () => {
  const res = await run({ code: '[Math.max(1,9), JSON.stringify({a:1}), typeof Date.now(), [1,2,3].map(x=>x*2)]' });
  assert.equal(res.body.ok, true);
  assert.match(res.body.data.result, /9/);
  assert.match(res.body.data.result, /number/);
});
