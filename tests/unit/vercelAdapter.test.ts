import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VercelDeploymentAdapter } from '../../deploy/vercelAdapter';
import { createConfiguredDeploymentAdapter } from '../../deploy/configuredAdapter';
import { MemoryRemoteStateStore } from '../../deploy/stateStore';
import type { ProjectDescriptor, ReleaseDescriptor } from '../../deploy/types';

let tmpDir = '';
let projectRoot = '';
let releaseDir = '';
let project: ProjectDescriptor;
let release: ReleaseDescriptor;
let store: MemoryRemoteStateStore;
let calls: Array<{ url: string; init: any }>;
let deployments: Map<string, any>;
let fetchMock: any;

function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

function makeDeployment(id: string, target: 'preview' | 'production' = 'preview') {
  return {
    id,
    url: `demo-${id}.vercel.app`,
    alias: ['demo.vercel.app'],
    readyState: 'READY',
    createdAt: Date.now(),
    target: target === 'production' ? 'production' : null,
  };
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-vercel-'));
  projectRoot = path.join(tmpDir, 'vite-demo');
  releaseDir = path.join(projectRoot, 'dist', 'assets');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ name: 'vite-demo', dependencies: { vite: '^8.3.4' } }),
    'utf8'
  );
  fs.writeFileSync(path.join(projectRoot, 'dist', 'index.html'), '<h1>demo</h1>', 'utf8');
  fs.writeFileSync(path.join(releaseDir, 'app.js'), 'console.log("demo")', 'utf8');

  store = new MemoryRemoteStateStore();
  calls = [];
  deployments = new Map();
  fetchMock = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/v2/files')) return json(undefined);
    if (url.includes('/v13/deployments') && init.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const id = `dpl_${deployments.size + 1}`;
      const deployment = makeDeployment(
        id,
        body.target === 'production' ? 'production' : 'preview'
      );
      deployments.set(id, deployment);
      return json(deployment);
    }
    if (/\/v13\/deployments\/[^/?]+/.test(url)) {
      const id = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
      const deployment = deployments.get(id);
      return deployment ? json(deployment) : json({ error: 'not found' }, 404);
    }
    if (url.includes('/v10/projects/') && url.includes('/promote/')) return json(undefined);
    if (url.includes('/v1/projects/') && url.includes('/rollback/')) return json(undefined);
    if (url.includes('/v3/deployments/') && url.includes('/events')) {
      return json([{ created: Date.now(), text: 'build ready' }]);
    }
    return json({ error: 'unexpected request' }, 404);
  });

  const adapter = new VercelDeploymentAdapter({
    token: 'token-de-prueba',
    projectId: 'prj_demo',
    fetchImpl: fetchMock,
    store,
  });
  project = await adapter.detectProject(projectRoot);
  release = {
    id: '20260101-demo',
    dir: path.join(projectRoot, 'dist'),
    fileCount: 2,
    bytes: 32,
  };
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function adapter() {
  return new VercelDeploymentAdapter({
    token: 'token-de-prueba',
    projectId: 'prj_demo',
    fetchImpl: fetchMock,
    store,
  });
}

describe('VercelDeploymentAdapter', () => {
  it('sube la release ya construida y crea un preview', async () => {
    const first = await adapter().deploy({ project, release, environment: 'preview' });

    expect(first.provider).toBe('vercel');
    expect(first.environment).toBe('preview');
    expect(first.status).toBe('ready');
    expect(first.url).toBe('https://demo-dpl_1.vercel.app');

    const uploads = calls.filter((call) => call.url.includes('/v2/files'));
    expect(uploads).toHaveLength(2);
    expect(uploads.every((call) => call.init.headers.get('x-vercel-digest'))).toBe(true);

    const create = calls.find(
      (call) => call.url.includes('/v13/deployments') && call.init.method === 'POST'
    );
    const body = JSON.parse(String(create?.init.body));
    expect(body.project).toBe('prj_demo');
    expect(body.target).toBeUndefined();
    expect(body.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'index.html' }),
        expect.objectContaining({ file: 'assets/app.js' }),
      ])
    );

    const state = await store.read(project);
    expect(state?.provider).toBe('vercel');
    expect(state?.preview).toBe(first.id);
  });

  it('promueve, conserva historial y hace rollback', async () => {
    const vercel = adapter();
    const first = await vercel.deploy({ project, release, environment: 'preview' });
    const promoted = await vercel.promote({
      project,
      deploymentId: first.id,
      environment: 'production',
    });

    expect(promoted.environment).toBe('production');
    expect(promoted.url).toBe('https://demo.vercel.app');
    expect(calls.some((call) => call.url.includes('/v10/projects/prj_demo/promote/dpl_1'))).toBe(
      true
    );

    const secondRelease: ReleaseDescriptor = {
      ...release,
      id: '20260101-demo-2',
    };
    const second = await vercel.deploy({
      project,
      release: secondRelease,
      environment: 'preview',
    });
    await vercel.promote({
      project,
      deploymentId: second.id,
      environment: 'production',
    });

    const status = await vercel.status(project);
    expect(status.canRollback).toBe(true);

    const rolledBack = await vercel.rollback(project);
    expect(rolledBack.id).toBe(first.id);
    expect(rolledBack.environment).toBe('production');
    expect(
      calls.some((call) => call.url.includes('/v1/projects/prj_demo/rollback/dpl_1'))
    ).toBe(true);
  });

  it('bloquea source maps, secretos y archivos prohibidos antes de subir', async () => {
    const vercel = adapter();

    fs.writeFileSync(path.join(release.dir, 'assets/app.js.map'), '{}', 'utf8');
    await expect(
      vercel.deploy({ project, release: { ...release, id: '20260101-map' }, environment: 'preview' })
    ).rejects.toThrow(/source map/i);
    expect(calls.some((call) => call.url.includes('/v2/files'))).toBe(false);
    fs.rmSync(path.join(release.dir, 'assets/app.js.map'));

    fs.writeFileSync(
      path.join(release.dir, 'assets/config.js'),
      `const token = "ghp_${'a'.repeat(36)}";`,
      'utf8'
    );
    await expect(
      vercel.deploy({ project, release: { ...release, id: '20260101-secret' }, environment: 'preview' })
    ).rejects.toThrow(/secreto/i);
    expect(calls.some((call) => call.url.includes('/v2/files'))).toBe(false);
    fs.rmSync(path.join(release.dir, 'assets/config.js'));

    fs.writeFileSync(path.join(release.dir, 'credentials.json'), '{}', 'utf8');
    await expect(
      vercel.deploy({ project, release: { ...release, id: '20260101-file' }, environment: 'preview' })
    ).rejects.toThrow(/prohibido/i);
    expect(calls.some((call) => call.url.includes('/v2/files'))).toBe(false);
  });

  it('devuelve logs y rechaza archivos prohibidos', async () => {
    const vercel = adapter();
    const first = await vercel.deploy({ project, release, environment: 'preview' });
    expect(await vercel.logs(first.id)).toContain('build ready');

    fs.writeFileSync(path.join(release.dir, '.env.production'), 'SECRET=1', 'utf8');
    await expect(
      vercel.deploy({ project, release: { ...release, id: '20260101-bad' }, environment: 'preview' })
    ).rejects.toThrow(/prohibido/);
  });

  it('explica la falta de token sin filtrarlo', async () => {
    const bare = new VercelDeploymentAdapter({
      token: '',
      projectId: '',
      fetchImpl: fetchMock,
    });
    await expect(
      bare.deploy({ project, release, environment: 'preview' })
    ).rejects.toThrow(/VERCEL_TOKEN/);
  });

  it('siempre usa Vercel y expone si está configurado', () => {
    const empty = createConfiguredDeploymentAdapter({});
    expect(empty.id).toBe('vercel');
    expect(empty.configured).toBe(false);

    const configured = createConfiguredDeploymentAdapter({
      VERCEL_TOKEN: 'token',
      VERCEL_PROJECT_ID: 'prj_demo',
    });
    expect(configured.id).toBe('vercel');
    expect(configured.configured).toBe(true);
  });
});
