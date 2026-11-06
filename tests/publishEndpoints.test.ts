import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;
let project = '';

before(async () => {
  srv = await startServer();
  const tmpBase = path.join(process.cwd(), 'tests', 'tmp');
  fs.mkdirSync(tmpBase, { recursive: true });
  project = fs.mkdtempSync(path.join(tmpBase, 'publish-'));
  fs.mkdirSync(path.join(project, 'dist', 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(project, 'dist', 'index.html'),
    '<!doctype html><html><body><h1>release</h1><script src="/assets/app.js"></script></body></html>',
    'utf8'
  );
  fs.writeFileSync(path.join(project, 'dist', 'assets', 'app.js'), 'console.log("release")', 'utf8');
});

after(async () => {
  try {
    if (project) fs.rmSync(project, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  await srv?.stop();
});

test('publica una release, la sirve y la promueve a producción', async () => {
  const created = await srv.request('POST', '/api/publish/preview', {
    root: project,
    outputDir: 'dist',
    build: false,
  });
  assert.equal(created.status, 200, created.raw);
  assert.equal(created.body.success, true);
  const preview = created.body.status.preview;
  assert.ok(preview, 'preview debe apuntar a la release recién creada');
  assert.match(preview.url, /^\/published\/[a-z0-9-]+\/preview\/$/);

  const html = await srv.request('GET', preview.url);
  assert.equal(html.status, 200, html.raw);
  assert.match(html.raw, /<h1>release<\/h1>/);
  assert.match(html.raw, /src="assets\/app.js"/);
  assert.doesNotMatch(html.raw, /src="\/assets\/app.js"/);

  const asset = await srv.request('GET', `${preview.url}assets/app.js`);
  assert.equal(asset.status, 200, asset.raw);
  assert.match(asset.raw, /console\.log\("release"\)/);

  const missing = await srv.request('GET', `${preview.url}assets/no-existe.js`);
  assert.equal(missing.status, 404, missing.raw);

  const promoted = await srv.request('POST', '/api/publish/production', {
    root: project,
    releaseId: preview.id,
  });
  assert.equal(promoted.status, 200, promoted.raw);
  assert.equal(promoted.body.status.production.id, preview.id);

  const prod = await srv.request('GET', promoted.body.status.production.url);
  assert.equal(prod.status, 200, prod.raw);
  assert.match(prod.raw, /<h1>release<\/h1>/);

  const rollback = await srv.request('POST', '/api/publish/rollback', { root: project });
  assert.equal(rollback.status, 400, 'sin producción anterior el rollback no finge éxito');
  assert.match(String(rollback.body.error), /anterior/i);
});
