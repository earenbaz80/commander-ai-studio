import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { handleAgentRunTool, parseTscOutput } from '../agentTools.js';
import { getTool } from '../src/agent/registry.js';
import { AGENT_TOOLS } from '../security.js';

// ─────────────────────────────────────────────────────────────────────────────
// parseTscOutput (puro)
// ─────────────────────────────────────────────────────────────────────────────

test('parseTscOutput extrae diagnóstico con archivo, línea y columna', () => {
  const out = `src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.`;
  const { diagnostics, errorCount, warningCount } = parseTscOutput(out);
  assert.deepEqual(diagnostics, [
    {
      file: 'src/a.ts',
      line: 3,
      column: 5,
      severity: 'error',
      code: 'TS2322',
      message: "Type 'string' is not assignable to type 'number'.",
    },
  ]);
  assert.equal(errorCount, 1);
  assert.equal(warningCount, 0);
});

test('parseTscOutput normaliza la barra invertida de Windows', () => {
  const { diagnostics } = parseTscOutput('src\\utils\\x.ts(1,1): error TS1005: \';\' expected.');
  assert.equal(diagnostics[0].file, 'src/utils/x.ts');
});

test('parseTscOutput captura errores globales (sin posición) y warnings', () => {
  const out = [
    "error TS18003: No inputs were found in config file 'tsconfig.json'.",
    'src/b.ts(1,1): warning TS9999: aviso de prueba',
  ].join('\n');
  const { diagnostics, errorCount, warningCount } = parseTscOutput(out);
  assert.equal(errorCount, 1);
  assert.equal(warningCount, 1);
  assert.equal(diagnostics[0].file, '');
  assert.equal(diagnostics[0].code, 'TS18003');
  assert.equal(diagnostics[1].severity, 'warning');
});

test('parseTscOutput ignora la línea de resumen "Found N errors"', () => {
  const { diagnostics, errorCount } = parseTscOutput('Found 2 errors in 1 file.\nFound 2 errors.');
  assert.deepEqual(diagnostics, []);
  assert.equal(errorCount, 0);
});

test('parseTscOutput respeta el límite de diagnósticos pero cuenta todos', () => {
  const lines = Array.from({ length: 10 }, (_, i) => `a.ts(${i + 1},1): error TS1000: e${i}`);
  const { diagnostics, errorCount } = parseTscOutput(lines.join('\n'), 3);
  assert.equal(diagnostics.length, 3);
  assert.equal(errorCount, 10);
});

// ─────────────────────────────────────────────────────────────────────────────
// handleAgentRunTool → read_diagnostics (proyecto temporal con tsc simulado)
// ─────────────────────────────────────────────────────────────────────────────

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdr-diag-'));

/** Crea un "proyecto" con un tsc simulado que imprime diagnósticos fijos. */
function makeFakeProject(name: string, opts: { tsconfig?: boolean; fake?: boolean } = {}): string {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  if (opts.tsconfig !== false) fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}', 'utf8');
  if (opts.fake !== false) {
    const binDir = path.join(dir, 'node_modules', 'typescript', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(
      path.join(binDir, 'tsc'),
      [
        "process.stdout.write(\"src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\\n\");",
        'process.stdout.write("src/a.ts(9,1): error TS1005: \';\' expected.\\n");',
        'process.stdout.write("src/b.ts(1,1): warning TS9999: aviso.\\n");',
        'process.stdout.write("Found 2 errors in 1 file.\\n");',
        'process.exit(1);',
      ].join('\n'),
      'utf8'
    );
  }
  return dir;
}

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

before(() => {
  fs.mkdirSync(TMP, { recursive: true });
});

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('read_diagnostics corre tsc y devuelve los diagnósticos del proyecto', async () => {
  const dir = makeFakeProject('proj-ok');
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'read_diagnostics', input: { root: dir } }), res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.errorCount, 2);
  assert.equal(res.body.data.warningCount, 1);
  assert.equal(res.body.data.diagnostics.length, 3);
  assert.equal(res.body.data.diagnostics[0].file, 'src/a.ts');
  assert.equal(res.body.data.exitCode, 1);
});

test('read_diagnostics con path filtra a un único archivo', async () => {
  const dir = makeFakeProject('proj-filter');
  const res = mockRes();
  await handleAgentRunTool(
    mockReq({ toolId: 'read_diagnostics', input: { root: dir, path: 'src/a.ts' } }),
    res
  );
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.filteredTo, 'src/a.ts');
  assert.equal(res.body.data.diagnostics.length, 2);
  assert.ok(res.body.data.diagnostics.every((d: any) => d.file === 'src/a.ts'));
  assert.equal(res.body.data.errorCount, 2);
  assert.equal(res.body.data.warningCount, 0);
});

test('read_diagnostics usa la caché (no vuelve a lanzar tsc)', async () => {
  const dir = makeFakeProject('proj-cache');
  const first = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'read_diagnostics', input: { root: dir } }), first);
  assert.equal(first.body.data.errorCount, 2);

  // Si la caché funciona, borrar el tsc simulado no impide responder de nuevo.
  fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
  const second = mockRes();
  await handleAgentRunTool(
    mockReq({ toolId: 'read_diagnostics', input: { root: dir, path: 'src/b.ts' } }),
    second
  );
  assert.equal(second.body.ok, true);
  assert.equal(second.body.data.diagnostics.length, 1);
  assert.equal(second.body.data.diagnostics[0].severity, 'warning');
});

test('read_diagnostics sin tsconfig.json devuelve una nota, no un error', async () => {
  const dir = makeFakeProject('proj-nots', { tsconfig: false, fake: false });
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'read_diagnostics', input: { root: dir } }), res);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.data.diagnostics, []);
  assert.match(res.body.data.note, /tsconfig\.json/);
});

test('read_diagnostics sin typescript instalado devuelve una nota', async () => {
  const dir = makeFakeProject('proj-nopkg', { fake: false });
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'read_diagnostics', input: { root: dir } }), res);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.data.diagnostics, []);
  assert.match(res.body.data.note, /typescript no está instalado/);
});

test('read_diagnostics está allowlisted en el servidor', () => {
  assert.equal(AGENT_TOOLS.has('read_diagnostics'), true);
});

test('read_diagnostics está registrado en el cliente y no requiere aprobación', () => {
  const tool = getTool('read_diagnostics');
  assert.ok(tool);
  assert.equal(tool!.id, 'read_diagnostics');
  assert.equal(tool!.danger, false);
  assert.equal(tool!.requiresApproval({}, {} as any), false);
});
