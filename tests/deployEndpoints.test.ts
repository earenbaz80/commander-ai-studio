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
  project = fs.mkdtempSync(path.join(tmpBase, 'deploy-'));
  fs.mkdirSync(path.join(project, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(project, 'dist', 'index.html'),
    '<!doctype html><html><body><h1>primera</h1></body></html>',
    'utf8'
  );
});

after(async () => {
  try {
    if (project) fs.rmSync(project, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  await srv?.stop();
});

test('sin Vercel configurado publica localmente y desactiva el deploy remoto', async () => {
  const initial = await srv.request('GET', `/api/deploy/status?root=${encodeURIComponent(project)}`);
  assert.equal(initial.status, 200, initial.raw);
  assert.equal(initial.body.provider, 'vercel');
  assert.equal(initial.body.configured, false);
  assert.equal(initial.body.status, null);
  assert.deepEqual(initial.body.missingConfig, ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID']);
  assert.doesNotMatch(initial.raw, /fake/i);

  const first = await srv.request('POST', '/api/publish/preview', {
    root: project,
    outputDir: 'dist',
    build: false,
  });
  assert.equal(first.status, 200, first.raw);
  const firstRelease = first.body.status.preview.id;
  const slug = first.body.status.project.slug;

  const published = await srv.request('GET', `/published/${slug}/preview/`);
  assert.equal(published.status, 200, published.raw);
  assert.match(published.raw, /<h1>primera<\/h1>/);

  const remote = await srv.request('POST', '/api/deploy/preview', {
    root: project,
    releaseId: firstRelease,
  });
  assert.equal(remote.status, 400, remote.raw);
  assert.equal(remote.body.success, false);
  assert.match(String(remote.body.error), /VERCEL_TOKEN/);

  const afterRemote = await srv.request(
    'GET',
    `/api/deploy/status?root=${encodeURIComponent(project)}`
  );
  assert.equal(afterRemote.status, 200, afterRemote.raw);
  assert.equal(afterRemote.body.configured, false);
  assert.equal(afterRemote.body.status, null);
});

test('preflight revisa la release sin necesitar credenciales', async () => {
  const unsafeProject = fs.mkdtempSync(
    path.join(process.cwd(), 'tests', 'tmp', 'preflight-')
  );
  try {
    fs.mkdirSync(path.join(unsafeProject, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(unsafeProject, 'dist', 'index.html'),
      '<!doctype html><html><body><h1>insegura</h1></body></html>',
      'utf8'
    );
    fs.writeFileSync(path.join(unsafeProject, 'dist', 'app.js.map'), '{}', 'utf8');

    const local = await srv.request('POST', '/api/publish/preview', {
      root: unsafeProject,
      outputDir: 'dist',
      build: false,
    });
    assert.equal(local.status, 200, local.raw);
    const releaseId = local.body.status.preview.id as string;

    const checked = await srv.request(
      'GET',
      `/api/deploy/preflight?root=${encodeURIComponent(unsafeProject)}&releaseId=${encodeURIComponent(releaseId)}`
    );
    assert.equal(checked.status, 200, checked.raw);
    assert.equal(checked.body.success, true);
    assert.equal(checked.body.provider, 'vercel');
    assert.equal(checked.body.releaseId, releaseId);
    assert.equal(checked.body.preflight.ok, false);
    assert.equal(checked.body.preflight.issues[0].code, 'source-map');
    assert.match(String(checked.body.preflight.issues[0].message), /source map/i);

    const status = await srv.request(
      'GET',
      `/api/deploy/status?root=${encodeURIComponent(unsafeProject)}`
    );
    assert.equal(status.status, 200, status.raw);
    assert.equal(status.body.configured, false);
    assert.equal(status.body.status, null);
  } finally {
    fs.rmSync(unsafeProject, { recursive: true, force: true });
  }
});
