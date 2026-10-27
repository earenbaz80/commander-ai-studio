import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkShellSegments, executeAgentTool, handleAgentRunTool } from '../agentTools.js';
import { addRoot } from '../projects.js';
import { AGENT_TOOLS } from '../security.js';
import { getTool } from '../src/agent/registry.js';
import { AGENT_FUNCTION_DECLARATIONS, mapFunctionCall } from '../src/agent/fnTools.js';
import { browserTool, previewTool } from '../src/agent/tools/browser.js';

/**
 * Root desechable: el proyecto local puede tener `allowedTools` (este repo lo
 * tiene y no incluye browser/preview), y esas reglas no son lo que se prueba
 * aquí. Un directorio temporal arranca con los permisos por defecto.
 */
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-tools-'));
addRoot(testRoot);

function mockReq(body: any) {
  return { body, ip: '127.0.0.1', headers: {} } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
  };
  return res;
}

// ── aprobación ─────────────────────────────────────────────────────────────

test('browser: sólo pide aprobación al salir de la máquina', () => {
  const needs = (input: any) => browserTool.requiresApproval(input, {} as any);

  // Un preview local es el caso de uso: se interactúa sin fricción.
  assert.equal(needs({ action: 'open' }), false);
  assert.equal(needs({ action: 'open', url: 'localhost:5173' }), false);
  assert.equal(needs({ action: 'navigate', url: 'http://127.0.0.1:3000/' }), false);
  assert.equal(needs({ action: 'snapshot' }), false);
  assert.equal(needs({ action: 'click', uid: 'e1' }), false);
  assert.equal(needs({ action: 'type', uid: 'e2', text: 'hola' }), false);
  assert.equal(needs({ action: 'screenshot' }), false);
  assert.equal(needs({ action: 'close' }), false);

  // Salir a internet sí.
  assert.equal(needs({ action: 'navigate', url: 'https://example.com' }), true);
  assert.equal(needs({ action: 'open', url: 'https://example.com' }), true);
  // Una URL inválida no se considera local: también pasa por revisión.
  assert.equal(needs({ action: 'navigate', url: 'file:///etc/passwd' }), true);
});

test('preview: arrancar y parar servidores pide aprobación; consultar no', () => {
  const needs = (input: any) => previewTool.requiresApproval(input, {} as any);

  assert.equal(needs({ action: 'open', command: 'npm run dev' }), true);
  assert.equal(needs({ action: 'stop', jobId: 'job-1' }), true);
  assert.equal(needs({ action: 'check', url: 'http://localhost:5173' }), false);
  assert.equal(needs({ action: 'status' }), false);
});

// ── exposición a los dos caminos del modelo ────────────────────────────────

test('browser y preview están en AGENT_TOOLS, el registro y las declaraciones nativas', () => {
  for (const id of ['browser', 'preview']) {
    assert.equal(AGENT_TOOLS.has(id), true, `${id} debe estar en AGENT_TOOLS`);
    assert.ok(getTool(id), `${id} debe estar en el registro de tools`);
    const decl = AGENT_FUNCTION_DECLARATIONS.find((d) => d.name === id);
    assert.ok(decl, `${id} debe tener declaración de función`);
    assert.deepEqual(decl!.parameters.required, ['action']);
    assert.equal(mapFunctionCall(id, { action: 'status' })?.tool, id);
  }
});

// ── el guard de allowlist es el mismo para shell.run y preview ─────────────

test('checkShellSegments: acepta lo permitido y corta lo demás', () => {
  const ok = checkShellSegments('npm run dev');
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.segments, ['npm run dev']);
    assert.equal(ok.command, 'npm run dev');
  }

  const binarioAjeno = checkShellSegments('node -e "while(1){}"');
  assert.equal(binarioAjeno.ok, false);
  if (!binarioAjeno.ok) assert.equal(binarioAjeno.status, 403);

  const colado = checkShellSegments('npm run dev | sh');
  assert.equal(colado.ok, false, 'una segunda etapa no puede escapar de la allowlist');

  const encadenado = checkShellSegments('vite --version; rm -rf /');
  assert.equal(encadenado.ok, false);
});

test('preview no puede arrancar un comando fuera de la allowlist (misma puerta que shell.run)', async () => {
  const ajeno = await executeAgentTool('preview', { root: testRoot, action: 'open', command: 'node -e "process.exit(1)"' });
  assert.equal(ajeno.ok, false);
  assert.equal((ajeno as any).status, 403);

  const colado = await executeAgentTool('preview', { root: testRoot, action: 'open', command: 'npm run dev | sh' });
  assert.equal(colado.ok, false);
  assert.equal((colado as any).status, 403);
});

// ── acciones del despacho ──────────────────────────────────────────────────

test('preview status sin previews devuelve una lista vacía', async () => {
  const res = await executeAgentTool('preview', { root: testRoot, action: 'status' });
  assert.equal(res.ok, true);
  assert.deepEqual((res as any).data.previews, []);
});

test('preview con acción desconocida lo dice', async () => {
  const res = await executeAgentTool('preview', { root: testRoot, action: 'reload' });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /open, check, status o stop/);
});

test('browser sin sesión abierta pide hacer open primero', async () => {
  const res = await executeAgentTool('browser', { root: testRoot, action: 'snapshot' });
  assert.equal(res.ok, false);
  assert.equal((res as any).status, 409);
  assert.match(String(res.error), /open/);
});

test('browser rechaza un esquema no navegable sin arrancar Chromium', async () => {
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'browser', input: { root: testRoot, action: 'open', url: 'file:///etc/passwd' } }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.match(String(res.body.error), /Esquema no permitido/);
});
