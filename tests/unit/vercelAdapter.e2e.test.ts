/**
 * E2E del adaptador Vercel contra un servidor HTTP local que implementa el
 * subconjunto del contrato de Vercel que usa Commander.
 *
 * No es una cuenta Vercel y no se presenta como tal: verifica el camino real
 * del adaptador (subida por SHA, creación, promoción, rollback, logs y descarga
 * del HTML/asset publicados) con red de verdad y sin efectos externos.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VercelDeploymentAdapter } from '../../deploy/vercelAdapter';
import { MemoryRemoteStateStore } from '../../deploy/stateStore';
import type { ProjectDescriptor, ReleaseDescriptor } from '../../deploy/types';

const TOKEN = 'token-e2e-local';

interface LocalDeployment {
  id: string;
  url: string;
  readyState: string;
  createdAt: number;
  target: string | null;
  files: Map<string, Buffer>;
}

let server: http.Server;
let origin = '';
let tmpDir = '';
let projectRoot = '';
let releaseDir = '';
let project: ProjectDescriptor;
let store: MemoryRemoteStateStore;
let uploaded: Array<{ digest: string; size: number }> = [];
const uploadedDigests = new Map<string, Buffer>();
let deployments = new Map<string, LocalDeployment>();
let production = '';
let calls: string[] = [];

function json(res: http.ServerResponse, body: unknown, status = 200): void {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function publicDeployment(deployment: LocalDeployment) {
  return {
    id: deployment.id,
    url: deployment.url,
    readyState: deployment.readyState,
    createdAt: deployment.createdAt,
    target: deployment.target,
  };
}

function contentType(file: string): string {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-vercel-e2e-'));
  projectRoot = path.join(tmpDir, 'vite-demo');
  releaseDir = path.join(projectRoot, 'dist');
  fs.mkdirSync(path.join(releaseDir, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'vite-demo',
        scripts: { build: 'vite build' },
        dependencies: { vite: '^8.3.4' },
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(
    path.join(releaseDir, 'index.html'),
    '<!doctype html><html><body><h1>primera</h1><script src="/assets/app.js"></script></body></html>',
    'utf8'
  );
  fs.writeFileSync(
    path.join(releaseDir, 'assets', 'app.js'),
    'document.body.dataset.publicado = "si";',
    'utf8'
  );

  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', origin || 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      calls.push(`${req.method} ${pathname}`);

      // La API de Vercel exige token; las URLs publicadas son públicas.
      if (pathname.startsWith('/v') && req.headers.authorization !== `Bearer ${TOKEN}`) {
        return json(res, { error: 'token inválido' }, 401);
      }

      if (req.method === 'POST' && pathname === '/v2/files') {
        const data = await readBody(req);
        const digest = String(req.headers['x-vercel-digest'] || '');
        uploadedDigests.set(digest, data);
        uploaded.push({ digest, size: data.byteLength });
        return json(res, {});
      }

      if (req.method === 'POST' && pathname === '/v13/deployments') {
        const body = JSON.parse((await readBody(req)).toString('utf8'));
        const id = `dpl_local_${deployments.size + 1}`;
        const files = new Map<string, Buffer>();
        for (const file of body.files || []) {
          const data = uploadedDigests.get(String(file.sha));
          if (!data) return json(res, { error: 'archivo no encontrado' }, 400);
          files.set(String(file.file), data);
        }
        const deployment: LocalDeployment = {
          id,
          url: `${origin}/sites/${id}`,
          readyState: 'READY',
          createdAt: Date.now(),
          target: body.target || null,
          files,
        };
        deployments.set(id, deployment);
        if (body.target === 'production') production = id;
        return json(res, publicDeployment(deployment));
      }

      if (req.method === 'GET' && /^\/v13\/deployments\/[^/]+$/.test(pathname)) {
        const id = pathname.split('/').pop() || '';
        const deployment = deployments.get(id);
        return deployment
          ? json(res, publicDeployment(deployment))
          : json(res, { error: 'no existe' }, 404);
      }

      if (
        req.method === 'POST' &&
        /^\/v10\/projects\/[^/]+\/promote\/[^/]+$/.test(pathname)
      ) {
        const id = pathname.split('/').pop() || '';
        if (!deployments.has(id)) return json(res, { error: 'no existe' }, 404);
        production = id;
        return json(res, {});
      }

      if (
        req.method === 'POST' &&
        /^\/v1\/projects\/[^/]+\/rollback\/[^/]+$/.test(pathname)
      ) {
        const id = pathname.split('/').pop() || '';
        if (!deployments.has(id)) return json(res, { error: 'no existe' }, 404);
        production = id;
        return json(res, {});
      }

      if (req.method === 'GET' && /^\/v3\/deployments\/[^/]+\/events$/.test(pathname)) {
        return json(res, [{ created: Date.now(), text: 'listo local' }]);
      }

      if (req.method === 'GET' && pathname.startsWith('/sites/')) {
        const [, , id, ...rest] = pathname.split('/');
        const deployment = deployments.get(id);
        if (!deployment) return json(res, { error: 'no existe' }, 404);
        const relative = rest.join('/') || 'index.html';
        const data = deployment.files.get(relative);
        if (!data) return json(res, { error: 'archivo no encontrado' }, 404);
        res.writeHead(200, {
          'Content-Type': contentType(relative),
          'Content-Length': data.byteLength,
        });
        res.end(data);
        return;
      }

      return json(res, { error: 'ruta no implementada' }, 404);
    } catch (error: any) {
      return json(res, { error: error?.message || 'error local' }, 500);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('sin puerto local');
  origin = `http://127.0.0.1:${address.port}`;

  store = new MemoryRemoteStateStore();
  const adapter = new VercelDeploymentAdapter({
    token: TOKEN,
    projectId: 'prj_e2e',
    apiBaseUrl: origin,
    store,
  });
  project = await adapter.detectProject(projectRoot);
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function release(id: string): ReleaseDescriptor {
  return {
    id,
    dir: releaseDir,
    fileCount: 2,
    bytes: 100,
  };
}

function adapter() {
  return new VercelDeploymentAdapter({
    token: TOKEN,
    projectId: 'prj_e2e',
    apiBaseUrl: origin,
    store,
  });
}

describe('despliegue E2E con el contrato HTTP de Vercel', () => {
  it('sube, publica, promueve, sirve y vuelve a la release anterior', async () => {
    const vercel = adapter();
    const first = await vercel.deploy({
      project,
      release: release('20260101-e2e-1'),
      environment: 'preview',
    });

    expect(first.provider).toBe('vercel');
    expect(first.environment).toBe('preview');
    expect(first.status).toBe('ready');
    expect(first.url).toBe(`${origin}/sites/dpl_local_1`);
    expect(uploaded).toHaveLength(2);
    expect(uploaded.every((item) => item.digest.length === 40)).toBe(true);

    const firstHtml = await fetch(first.url);
    expect(firstHtml.status).toBe(200);
    expect(firstHtml.headers.get('content-type')).toContain('text/html');
    expect(await firstHtml.text()).toContain('<h1>primera</h1>');

    const firstAsset = await fetch(`${first.url}/assets/app.js`);
    expect(firstAsset.status).toBe(200);
    expect(firstAsset.headers.get('content-type')).toContain('text/javascript');
    expect(await firstAsset.text()).toContain('dataset.publicado');

    const promotedFirst = await vercel.promote({
      project,
      deploymentId: first.id,
      environment: 'production',
    });
    expect(promotedFirst.environment).toBe('production');
    expect(promotedFirst.url).toBe(first.url);
    expect(production).toBe(first.id);
    const promotedHtml = await fetch(promotedFirst.url);
    expect(await promotedHtml.text()).toContain('<h1>primera</h1>');

    fs.writeFileSync(
      path.join(releaseDir, 'index.html'),
      '<!doctype html><html><body><h1>segunda</h1></body></html>',
      'utf8'
    );
    const second = await vercel.deploy({
      project,
      release: release('20260101-e2e-2'),
      environment: 'preview',
    });
    expect(second.url).toBe(`${origin}/sites/dpl_local_2`);
    const promotedSecond = await vercel.promote({
      project,
      deploymentId: second.id,
      environment: 'production',
    });

    const secondHtml = await fetch(promotedSecond.url);
    expect(await secondHtml.text()).toContain('<h1>segunda</h1>');

    const status = await vercel.status(project);
    expect(status.production?.id).toBe(second.id);
    expect(status.canRollback).toBe(true);

    const rolledBack = await vercel.rollback(project);
    expect(rolledBack.id).toBe(first.id);
    expect(rolledBack.environment).toBe('production');

    const restored = await fetch(rolledBack.url);
    expect(await restored.text()).toContain('<h1>primera</h1>');

    expect(await vercel.logs(first.id)).toContain('listo local');
    expect(calls).toContain('POST /v10/projects/prj_e2e/promote/dpl_local_1');
    expect(calls).toContain('POST /v1/projects/prj_e2e/rollback/dpl_local_1');

    const finalStatus = await vercel.status(project);
    expect(finalStatus.production?.id).toBe(first.id);
    expect(finalStatus.canRollback).toBe(false);
  });
});
