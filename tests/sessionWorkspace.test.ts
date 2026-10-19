import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-test-root-'));
const cfgFile = path.join(tmpRoot, 'roots.json');
process.env.AGENT_ROOTS_FILE = cfgFile;
process.env.SESSION_WORKSPACES_DIR = path.join(tmpRoot, 'sessions');
process.env.AGENT_ROOTS = tmpRoot;

const { forkSessionWorkspace, deleteSessionWorkspace, listSessions } = await import('../sessionWorkspace.ts');
const { addRoot, listRoots } = await import('../projects.ts');
try { addRoot(tmpRoot); } catch (e) { /* ignore */ }

test('sessionWorkspace: fork copies project and registers root', async () => {
  const root = listRoots().find((x: string) => x.includes('sw-test-root')) as string;
  const rootFwd = root.replace(/\\/g, '/');
  const src = rootFwd + '/proj';
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'hello', 'utf8');
  fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'world', 'utf8');

  const out = forkSessionWorkspace(src);
  assert.ok(out.id.startsWith('sess-'));
  assert.ok(fs.existsSync(path.join(out.path, 'a.txt')));
  assert.equal(fs.readFileSync(path.join(out.path, 'a.txt'), 'utf8'), 'hello');
  assert.equal(fs.readFileSync(path.join(out.path, 'sub', 'b.txt'), 'utf8'), 'world');
  assert.ok(listSessions().some((s: any) => s.id === out.id));
});

test('sessionWorkspace: delete removes directory and entry', async () => {
  const root = listRoots().find((x: string) => x.includes('sw-test-root')) as string;
  const rootFwd = root.replace(/\\/g, '/');
  const src = rootFwd + '/proj2';
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'x.txt'), 'x', 'utf8');

  const out = forkSessionWorkspace(src);
  const p = out.path;
  assert.ok(fs.existsSync(p));
  deleteSessionWorkspace(out.id);
  assert.ok(!fs.existsSync(p));
  assert.ok(!listSessions().some((s: any) => s.id === out.id));
});

test('sessionWorkspace: fork rejects unregistered source (outside roots)', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
  fs.writeFileSync(path.join(outside, 'y.txt'), 'y', 'utf8');
  assert.throws(() => forkSessionWorkspace(outside.replace(/\\/g, '/')), /Path fuera de los proyectos permitidos|No existe/);
});