import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  isPathAllowed,
  enforceTool,
  enforcePath,
  getPermissions,
  setPermissions,
  normalizePermissions,
  DEFAULT_PERMISSIONS,
} from '../permissions.js';
import { handleAgentRunTool } from '../agentTools.js';

// ── isPathAllowed (globs) ──

test('isPathAllowed: glob vacío permite todo', () => {
  assert.equal(isPathAllowed([], 'cualquier/ruta.ts'), true);
  assert.equal(isPathAllowed(undefined as any, 'x'), true);
});

test('isPathAllowed: ** cruza segmentos y * no', () => {
  assert.equal(isPathAllowed(['src/**'], 'src/a/b/c.ts'), true);
  assert.equal(isPathAllowed(['src/**'], 'src/a.ts'), true);
  assert.equal(isPathAllowed(['src/**'], 'lib/a.ts'), false);
  assert.equal(isPathAllowed(['*.ts'], 'a.ts'), true);
  assert.equal(isPathAllowed(['*.ts'], 'src/a.ts'), false);
});

test('isPathAllowed: ? coincide con un carácter y rutas exactas', () => {
  assert.equal(isPathAllowed(['a?.ts'], 'ab.ts'), true);
  assert.equal(isPathAllowed(['a?.ts'], 'abc.ts'), false);
  assert.equal(isPathAllowed(['src/a.ts'], 'src/a.ts'), true);
  assert.equal(isPathAllowed(['src/a.ts'], 'src/b.ts'), false);
});

test('isPathAllowed: normaliza barras y ./', () => {
  assert.equal(isPathAllowed(['src/**'], 'src\\a\\b.ts'), true);
  assert.equal(isPathAllowed(['src/**'], './src/a.ts'), true);
});

// ── enforceTool (modos + listas) ──

test('enforceTool: build permite todo', () => {
  for (const t of ['fs.read', 'fs.write', 'fs.edit', 'shell.run', 'git.commit']) {
    assert.equal(enforceTool(DEFAULT_PERMISSIONS, t), null);
  }
});

test('enforceTool: plan deniega escribir y ejecutar, permite leer', () => {
  const plan = { ...DEFAULT_PERMISSIONS, mode: 'plan' as const };
  for (const t of ['fs.write', 'fs.edit', 'shell.run', 'git.commit', 'code.run']) {
    assert.match(enforceTool(plan, t) || '', /Modo Plan/);
  }
  for (const t of ['fs.read', 'fs.glob', 'fs.grep', 'read_diagnostics']) {
    assert.equal(enforceTool(plan, t), null);
  }
});

test('enforceTool: readonly deniega escribir y ejecutar', () => {
  const ro = { ...DEFAULT_PERMISSIONS, mode: 'readonly' as const };
  for (const t of ['fs.write', 'fs.edit', 'shell.run']) {
    assert.match(enforceTool(ro, t) || '', /Sólo lectura/);
  }
  assert.equal(enforceTool(ro, 'fs.read'), null);
});

test('enforceTool: readOnly es de la llamada, no de la tool', () => {
  const ro = { ...DEFAULT_PERMISSIONS, mode: 'readonly' as const };

  // Una variante que sólo consulta atraviesa el modo (git.worktree list, la
  // inspección de git.conflict), pero la tool sigue bloqueada si escribe.
  assert.match(enforceTool(ro, 'git.conflict') || '', /Sólo lectura/);
  assert.equal(enforceTool(ro, 'git.conflict', { readOnly: true }), null);

  // Y `readOnly` no abre un agujero en las listas: denegar la tool la deniega
  // también en su variante de consulta.
  const denied = { ...ro, deniedTools: ['git.conflict'] };
  assert.match(enforceTool(denied, 'git.conflict', { readOnly: true }) || '', /denegada/);
  const whitelist = { ...ro, allowedTools: ['fs.read'] };
  assert.match(enforceTool(whitelist, 'git.conflict', { readOnly: true }) || '', /deshabilitada/);
});

test('enforceTool: allowedTools restringe y deniedTools deniega', () => {
  const perms = { ...DEFAULT_PERMISSIONS, allowedTools: ['fs.read'] };
  assert.equal(enforceTool(perms, 'fs.read'), null);
  assert.match(enforceTool(perms, 'fs.write') || '', /deshabilitada/);

  const denied = { ...DEFAULT_PERMISSIONS, deniedTools: ['shell.run'] };
  assert.match(enforceTool(denied, 'shell.run') || '', /denegada/);
  assert.equal(enforceTool(denied, 'fs.read'), null);
});

// ── enforcePath (globs de lectura/escritura) ──

test('enforcePath: aplica globs de lectura y escritura por separado', () => {
  const perms = { ...DEFAULT_PERMISSIONS, files: { read: ['src/**'], write: ['tests/**'] } };
  assert.equal(enforcePath(perms, 'src/a.ts', 'read'), null);
  assert.match(enforcePath(perms, 'lib/a.ts', 'read') || '', /lectura/);
  assert.equal(enforcePath(perms, 'tests/a.ts', 'write'), null);
  assert.match(enforcePath(perms, 'src/a.ts', 'write') || '', /escritura/);
});

test('enforcePath: sin globs no hay restricción', () => {
  assert.equal(enforcePath(DEFAULT_PERMISSIONS, 'cualquiera', 'read'), null);
  assert.equal(enforcePath(DEFAULT_PERMISSIONS, 'cualquiera', 'write'), null);
});

// ── Persistencia ──

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdr-perms-'));

function makeProj(name: string, files: Record<string, string> = {}): string {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

before(() => fs.mkdirSync(TMP, { recursive: true }));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('getPermissions: sin archivo, defaults de build', () => {
  const dir = makeProj('defaults');
  const p = getPermissions(dir);
  assert.equal(p.mode, 'build');
  assert.equal(p.allowedTools, null);
  assert.deepEqual(p.files, { read: [], write: [] });
});

test('setPermissions + getPermissions roundtrip', () => {
  const dir = makeProj('roundtrip');
  const saved = setPermissions(dir, { mode: 'plan', allowedTools: ['fs.read'], files: { read: ['src/**'], write: [] } });
  assert.equal(saved.mode, 'plan');
  // normalizePermissions inyecta CORE_TOOLS (task, read_diagnostics) en la whitelist
  const loaded = getPermissions(dir);
  assert.equal(loaded.mode, 'plan');
  assert.ok(loaded.allowedTools!.includes('fs.read'));
  assert.ok(loaded.allowedTools!.includes('task'));
  assert.ok(loaded.allowedTools!.includes('read_diagnostics'));
  assert.deepEqual(loaded.files.read, ['src/**']);
});

test('normalizePermissions rellena defaults y valida mode', () => {
  const p = normalizePermissions({ mode: 'loquesea', files: { read: 'no-array' } });
  assert.equal(p.mode, 'build');
  assert.deepEqual(p.files.read, []);
  assert.equal(p.allowedTools, null);
});

// ── Integración con handleAgentRunTool ──

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

test('handleAgentRunTool: en modo plan, fs.write responde 403 y fs.read no', async () => {
  const dir = makeProj('handler-plan');
  setPermissions(dir, { mode: 'plan' });

  const w = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'fs.write', input: { root: dir, path: 'a.txt', content: 'x' } }), w);
  assert.equal(w.statusCode, 403);
  assert.match(w.body.error, /Modo Plan/);

  const r = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'fs.read', input: { root: dir, path: 'a.txt' } }), r);
  assert.notEqual(r.statusCode, 403);
});

test('handleAgentRunTool: glob de escritura bloquea fuera de tests/**', async () => {
  const dir = makeProj('handler-globs');
  setPermissions(dir, { mode: 'build', files: { read: [], write: ['tests/**'] } });

  const bad = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'fs.write', input: { root: dir, path: 'src/a.ts', content: 'x' } }), bad);
  assert.equal(bad.statusCode, 403);
  assert.match(bad.body.error, /escritura/);

  const ok = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'fs.write', input: { root: dir, path: 'tests/a.ts', content: 'x' } }), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.ok, true);
});

test('handleAgentRunTool: allowedTools bloquea una tool no listada', async () => {
  const dir = makeProj('handler-tools');
  setPermissions(dir, { mode: 'build', allowedTools: ['fs.read'] });
  const w = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'fs.write', input: { root: dir, path: 'a.txt', content: 'x' } }), w);
  assert.equal(w.statusCode, 403);
  assert.match(w.body.error, /deshabilitada/);
});

test('handleAgentRunTool: sin permisos configurados, todo permitido (build)', async () => {
  const dir = makeProj('handler-default');
  const w = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'fs.write', input: { root: dir, path: 'a.txt', content: 'x' } }), w);
  assert.equal(w.statusCode, 200);
  assert.equal(w.body.ok, true);
});
