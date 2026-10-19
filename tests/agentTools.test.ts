import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { handleAgentRunTool } from '../agentTools.js';

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

const TEST_DIR = path.join(process.cwd(), 'tests', 'tmp');
const TEST_FILE = path.join(TEST_DIR, 'test.txt');

before(() => {
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
});

test('fs.read lee un archivo existente', async () => {
  fs.writeFileSync(TEST_FILE, 'Hola mundo', 'utf8');
  const req = mockReq({ toolId: 'fs.read', input: { path: 'tests/tmp/test.txt' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.content, 'Hola mundo');
});

test('fs.read devuelve error si el archivo no existe', async () => {
  const req = mockReq({ toolId: 'fs.read', input: { path: 'tests/tmp/no-existe.txt' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, false);
});

test('fs.write crea un archivo nuevo', async () => {
  const req = mockReq({ toolId: 'fs.write', input: { path: 'tests/tmp/write-test.txt', content: 'Nuevo contenido' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.equal(fs.readFileSync(path.join(TEST_DIR, 'write-test.txt'), 'utf8'), 'Nuevo contenido');
});

test('fs.write sin overwrite falla si el archivo existe', async () => {
  fs.writeFileSync(TEST_FILE, 'Original', 'utf8');
  const req = mockReq({ toolId: 'fs.write', input: { path: 'tests/tmp/test.txt', content: 'Nuevo' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, false);
});

test('fs.edit reemplaza texto exacto', async () => {
  fs.writeFileSync(TEST_FILE, 'Hola mundo', 'utf8');
  const req = mockReq({ toolId: 'fs.edit', input: { path: 'tests/tmp/test.txt', oldString: 'mundo', newString: 'Commander' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.equal(fs.readFileSync(TEST_FILE, 'utf8'), 'Hola Commander');
});

test('fs.edit con replaceAll reemplaza todas las ocurrencias', async () => {
  fs.writeFileSync(TEST_FILE, 'foo bar foo', 'utf8');
  const req = mockReq({ toolId: 'fs.edit', input: { path: 'tests/tmp/test.txt', oldString: 'foo', newString: 'baz', replaceAll: true } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.equal(fs.readFileSync(TEST_FILE, 'utf8'), 'baz bar baz');
});

test('fs.edit no interpreta $& ni $1 en newString', async () => {
  fs.writeFileSync(TEST_FILE, 'valor = X', 'utf8');
  const req = mockReq({ toolId: 'fs.edit', input: { path: 'tests/tmp/test.txt', oldString: 'X', newString: '$& $1 $$' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.equal(fs.readFileSync(TEST_FILE, 'utf8'), 'valor = $& $1 $$');
});

test('fs.glob lista archivos', async () => {
  const req = mockReq({ toolId: 'fs.glob', input: { pattern: '*.txt' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.ok(Array.isArray(res.body.data.files));
});

test('fs.grep encuentra texto en archivos', async () => {
  fs.writeFileSync(TEST_FILE, 'texto_unico_para_grep', 'utf8');
  const req = mockReq({ toolId: 'fs.grep', input: { pattern: 'texto_unico_para_grep' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.data.matches.length > 0);
});

test('shell.run ejecuta comando permitido', async () => {
  const req = mockReq({ toolId: 'shell.run', input: { command: 'echo hola' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.data.stdout.includes('hola'));
});

test('shell.run bloquea comando peligroso', async () => {
  const req = mockReq({ toolId: 'shell.run', input: { command: 'sudo rm -rf /' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.statusCode, 403);
});

test('shell.run bloquea operador de shell', async () => {
  const req = mockReq({ toolId: 'shell.run', input: { command: 'echo hola | cat /etc/passwd' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.statusCode, 403);
});

test('shell.run bloquea $()', async () => {
  const req = mockReq({ toolId: 'shell.run', input: { command: 'echo $(whoami)' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.statusCode, 403);
});

test('shell.run bloquea ejecutores de código (node, npx, python)', async () => {
  for (const command of ['node -e "1"', 'npx cowsay hi', 'python -c "1"']) {
    const res = mockRes();
    await handleAgentRunTool(mockReq({ toolId: 'shell.run', input: { command } }), res);
    assert.equal(res.statusCode, 403, command);
  }
});

test('shell.run bloquea lectura de archivos con type/cat', async () => {
  for (const command of ['type tests\\tmp\\test.txt', 'cat tests/tmp/test.txt']) {
    const res = mockRes();
    await handleAgentRunTool(mockReq({ toolId: 'shell.run', input: { command } }), res);
    assert.equal(res.statusCode, 403, command);
  }
});

test('shell.run bloquea expansión %VAR% de cmd.exe', async () => {
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'shell.run', input: { command: 'echo %GEMINI_API_KEY%' } }), res);
  assert.equal(res.statusCode, 403);
});

test('shell.run bloquea rutas absolutas fuera de los proyectos', async () => {
  const outside = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'shell.run', input: { command: `ls ${outside}` } }), res);
  assert.equal(res.statusCode, 403);
});

test('toolId inválido devuelve error', async () => {
  const req = mockReq({ toolId: 'tool.inexistente', input: {} });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, false);
});

test('fs.read fuera de los proyectos responde 403 (no 500)', async () => {
  const req = mockReq({ toolId: 'fs.read', input: { path: '../../../../Windows/System32/drivers/etc/hosts' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /fuera de los proyectos permitidos/);
});

test('fs.write fuera de los proyectos responde 403', async () => {
  const req = mockReq({ toolId: 'fs.write', input: { path: '../escaped.txt', content: 'x' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.statusCode, 403);
});

after(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
});
