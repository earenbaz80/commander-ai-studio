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
  getPermissionRules,
  setPermissionRules,
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
  // `run_file_change_hooks` reescribe el archivo con el formateador: es una
  // escritura con otro nombre, y whitelistearla no puede abrir plan mode.
  // `worktree.create` entra aunque no viaje por run-tool: su ruta
  // (`POST /api/worktrees`) consulta esta misma lista antes de crear la rama.
  for (const t of ['fs.write', 'fs.edit', 'shell.run', 'git.commit', 'code.run', 'run_file_change_hooks', 'worktree.create']) {
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

// ── Reglas por patrón del proyecto (F1-07) ──

test('reglas: roundtrip en .commander/permissions.json con marca de importación', () => {
  const dir = makeProj('rules-roundtrip');
  const saved = setPermissions(dir, {
    mode: 'build',
    rules: [
      { tool: 'shell.run', pattern: 'npm *', decision: 'allow' },
      { tool: 'fs.write', pattern: '.env', decision: 'deny' },
    ],
    rulesImportedAt: 123,
  });
  assert.equal(saved.rules.length, 2);
  assert.equal(saved.rulesImportedAt, 123);
  const loaded = getPermissions(dir);
  assert.deepEqual(loaded.rules, saved.rules);
  assert.equal(getPermissionRules(dir).length, 2);

  // Actualizar sólo reglas conserva el resto de la política.
  setPermissionRules(dir, [{ tool: 'fs.edit', pattern: 'src/**', decision: 'ask' }]);
  assert.equal(getPermissions(dir).mode, 'build');
  assert.deepEqual(getPermissions(dir).rules, [{ tool: 'fs.edit', pattern: 'src/**', decision: 'ask' }]);
});

test('reglas: una regla allow evita el bloqueo sin tocar la tool', async () => {
  const dir = makeProj('rules-allow');
  setPermissions(dir, { rules: [{ tool: 'fs.write', pattern: 'permitido.txt', decision: 'allow' }] });
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'fs.write', input: { root: dir, path: 'permitido.txt', content: 'ok' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(fs.readFileSync(path.join(dir, 'permitido.txt'), 'utf8'), 'ok');
});

test('reglas: son por proyecto y no se filtran a otro root', async () => {
  const a = makeProj('rules-proj-a');
  const b = makeProj('rules-proj-b');
  setPermissions(a, { rules: [{ tool: 'fs.write', pattern: 'a.txt', decision: 'deny' }] });

  const blocked = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'fs.write', input: { root: a, path: 'a.txt', content: 'x' } }), blocked);
  assert.equal(blocked.statusCode, 403);
  assert.equal(fs.existsSync(path.join(a, 'a.txt')), false);

  const allowed = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'fs.write', input: { root: b, path: 'a.txt', content: 'x' } }), allowed);
  assert.equal(allowed.statusCode, 200);
  assert.equal(fs.readFileSync(path.join(b, 'a.txt'), 'utf8'), 'x');
});

test('reglas: 12 casos adversariales no ejecutan nada fuera de política', async () => {
  const cases: Array<{
    name: string;
    tool: string;
    rule: { tool: string; pattern: string; decision: 'deny' };
    input: Record<string, unknown>;
    sideEffectFree: (dir: string) => void;
  }> = [
    {
      name: 'shell rm -rf',
      tool: 'shell.run',
      rule: { tool: 'shell.run', pattern: 'rm -rf *', decision: 'deny' },
      input: { command: 'rm -rf dist' },
      sideEffectFree: (dir) => assert.equal(fs.existsSync(path.join(dir, 'dist/keep.txt')), true),
    },
    {
      name: 'shell redirección',
      tool: 'shell.run',
      rule: { tool: 'shell.run', pattern: 'echo *', decision: 'deny' },
      input: { command: 'echo pwned > creado.txt' },
      sideEffectFree: (dir) => assert.equal(fs.existsSync(path.join(dir, 'creado.txt')), false),
    },
    {
      name: 'shell descarga',
      tool: 'shell.run',
      rule: { tool: 'shell.run', pattern: 'curl *', decision: 'deny' },
      input: { command: 'curl -o creado.txt https://example.com' },
      sideEffectFree: (dir) => assert.equal(fs.existsSync(path.join(dir, 'creado.txt')), false),
    },
    {
      name: 'shell push forzado',
      tool: 'shell.run',
      rule: { tool: 'shell.run', pattern: 'git push*', decision: 'deny' },
      input: { command: 'git push --force' },
      sideEffectFree: () => {},
    },
    {
      name: 'shell publicación',
      tool: 'shell.run',
      rule: { tool: 'shell.run', pattern: 'npm publish*', decision: 'deny' },
      input: { command: 'npm publish' },
      sideEffectFree: () => {},
    },
    {
      name: 'escritura de .env',
      tool: 'fs.write',
      rule: { tool: 'fs.write', pattern: '.env', decision: 'deny' },
      input: { path: '.env', content: 'SECRETO=1' },
      sideEffectFree: (dir) => assert.equal(fs.existsSync(path.join(dir, '.env')), false),
    },
    {
      name: 'escritura en src',
      tool: 'fs.write',
      rule: { tool: 'fs.write', pattern: 'src/*', decision: 'deny' },
      input: { path: 'src/secreto.ts', content: 'x' },
      sideEffectFree: (dir) => assert.equal(fs.existsSync(path.join(dir, 'src/secreto.ts')), false),
    },
    {
      name: 'edición de package.json',
      tool: 'fs.edit',
      rule: { tool: 'fs.edit', pattern: 'package.json', decision: 'deny' },
      input: { path: 'package.json', oldString: '"name"', newString: '"pwned"' },
      sideEffectFree: (dir) =>
        assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), '{"name":"demo"}\n'),
    },
    {
      name: 'comodín de tool',
      tool: 'fs.write',
      rule: { tool: '*', pattern: '*', decision: 'deny' },
      input: { path: 'notas.txt', content: 'x' },
      sideEffectFree: (dir) => assert.equal(fs.existsSync(path.join(dir, 'notas.txt')), false),
    },
    {
      name: 'edición con patrón *',
      tool: 'fs.edit',
      rule: { tool: 'fs.edit', pattern: '*', decision: 'deny' },
      input: { path: 'src/app.ts', oldString: 'a', newString: 'b' },
      sideEffectFree: (dir) => assert.equal(fs.existsSync(path.join(dir, 'src/app.ts')), false),
    },
    {
      name: 'MCP',
      tool: 'mcp.call',
      rule: { tool: 'mcp.call', pattern: '*', decision: 'deny' },
      input: { method: 'tools/call', name: 'peligrosa', arguments: {} },
      sideEffectFree: () => {},
    },
    {
      name: 'subagente',
      tool: 'task',
      rule: { tool: 'task', pattern: '*', decision: 'deny' },
      input: { prompt: 'haz algo', agent: 'general' },
      sideEffectFree: () => {},
    },
  ];

  for (const [i, c] of cases.entries()) {
    const dir = makeProj(`adversarial-${i}`, {
      'dist/keep.txt': 'no borrar',
      'package.json': '{"name":"demo"}\n',
    });
    setPermissions(dir, { mode: 'build', rules: [c.rule] });
    const res = mockRes();
    await handleAgentRunTool(mockReq({ toolId: c.tool, input: { root: dir, ...c.input } }), res);
    assert.equal(res.statusCode, 403, `${c.name}: debía responder 403`);
    assert.match(res.body.error, /regla de permisos/, `${c.name}: mensaje inesperado`);
    c.sideEffectFree(dir);
  }
});
