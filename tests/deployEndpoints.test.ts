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

test('expone preview, promoción, rollback y logs del adaptador fake', async () => {
  const initial = await srv.request('GET', `/api/deploy/status?root=${encodeURIComponent(project)}`);
  assert.equal(initial.status, 200, initial.raw);
  assert.equal(initial.body.status.provider, 'fake');
  assert.equal(initial.body.status.preview, null);

  const first = await srv.request('POST', '/api/publish/preview', {
    root: project,
    outputDir: 'dist',
    build: false,
  });
  assert.equal(first.status, 200, first.raw);
  const firstRelease = first.body.status.preview.id;

  const firstDeploy = await srv.request('POST', '/api/deploy/preview', {
    root: project,
    releaseId: firstRelease,
  });
  assert.equal(firstDeploy.status, 200, firstDeploy.raw);
  const firstRemote = firstDeploy.body.deployment;
  assert.equal(firstRemote.releaseId, firstRelease);
  assert.equal(firstRemote.environment, 'preview');
  assert.match(firstRemote.url, /^https:\/\/deploy\.invalid\/.+\/preview\/$/);

  const firstPromote = await srv.request('POST', '/api/deploy/production', {
    root: project,
    deploymentId: firstRemote.id,
  });
  assert.equal(firstPromote.status, 200, firstPromote.raw);
  assert.equal(firstPromote.body.status.production.id, firstRemote.id);
  assert.match(firstPromote.body.status.production.url, /\/production\/$/);
  assert.equal(firstPromote.body.status.canRollback, false);

  const slug = first.body.status.project.slug;
  const published = await srv.request('GET', `/published/${slug}/preview/`);
  assert.equal(published.status, 200, published.raw);
  assert.match(published.raw, /<h1>primera<\/h1>/);

  fs.writeFileSync(
    path.join(project, 'dist', 'index.html'),
    '<!doctype html><html><body><h1>segunda</h1></body></html>',
    'utf8'
  );
  const second = await srv.request('POST', '/api/publish/preview', {
    root: project,
    outputDir: 'dist',
    build: false,
  });
  assert.equal(second.status, 200, second.raw);
  const secondRelease = second.body.status.preview.id;

  const secondDeploy = await srv.request('POST', '/api/deploy/preview', {
    root: project,
    releaseId: secondRelease,
  });
  assert.equal(secondDeploy.status, 200, secondDeploy.raw);
  const secondRemote = secondDeploy.body.deployment;

  const secondPromote = await srv.request('POST', '/api/deploy/production', {
    root: project,
    deploymentId: secondRemote.id,
  });
  assert.equal(secondPromote.status, 200, secondPromote.raw);
  assert.equal(secondPromote.body.status.production.id, secondRemote.id);
  assert.equal(secondPromote.body.status.canRollback, true);

  const rollback = await srv.request('POST', '/api/deploy/rollback', { root: project });
  assert.equal(rollback.status, 200, rollback.raw);
  assert.equal(rollback.body.status.production.id, firstRemote.id);
  assert.equal(rollback.body.status.canRollback, false);

  const log = await srv.request(
    'GET',
    `/api/deploy/logs?root=${encodeURIComponent(project)}&deploymentId=${encodeURIComponent(firstRemote.id)}`
  );
  assert.equal(log.status, 200, log.raw);
  assert.match(log.body.log, /fake/);
  assert.match(log.body.log, new RegExp(firstRemote.id));

  const missing = await srv.request('POST', '/api/deploy/production', {
    root: project,
    deploymentId: 'dep-no-existe',
  });
  assert.equal(missing.status, 400);
  assert.match(String(missing.body.error), /no existe/i);
});

test('rechaza con 400 una release con source map sin crear deployment', async () => {
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
    assert.equal(checked.body.provider, 'fake');
    assert.equal(checked.body.releaseId, releaseId);
    assert.equal(checked.body.preflight.ok, false);
    assert.equal(checked.body.preflight.issues[0].code, 'source-map');
    assert.match(String(checked.body.preflight.issues[0].message), /source map/i);

    const rejected = await srv.request('POST', '/api/deploy/preview', {
      root: unsafeProject,
      releaseId,
    });
    assert.equal(rejected.status, 400, rejected.raw);
    assert.match(String(rejected.body.error), /source map/i);

    const status = await srv.request(
      'GET',
      `/api/deploy/status?root=${encodeURIComponent(unsafeProject)}`
    );
    assert.equal(status.status, 200, status.raw);
    assert.equal(status.body.status.preview, null);
    assert.equal(status.body.status.deployments.length, 0);
  } finally {
    fs.rmSync(unsafeProject, { recursive: true, force: true });
  }
});
