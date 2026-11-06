import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createRelease,
  getPublishStatus,
  getRemoteDeploymentState,
  projectSlug,
  promoteRelease,
  resolvePublishedFile,
  rewriteRootAbsoluteReferences,
  rollbackProduction,
  saveRemoteDeploymentState,
} from '../../publisher';

let tmpDir = '';
let project = '';
let publishDir = '';

function writeBuild(root: string, body: string) {
  const dist = path.join(root, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'demo', scripts: { build: 'vite build' } }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(dist, 'index.html'),
    `<!doctype html><html><head><link rel="stylesheet" href="/assets/style.css"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script>${body}</body></html>`,
    'utf8'
  );
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), `console.log(${JSON.stringify(body)});`, 'utf8');
  fs.writeFileSync(path.join(dist, 'assets', 'style.css'), 'body{background:url(/assets/font.woff2)}', 'utf8');
  fs.writeFileSync(path.join(dist, '.env'), 'SECRETO=no-publicar', 'utf8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-publish-'));
  project = path.join(tmpDir, 'mi-app');
  publishDir = path.join(tmpDir, 'publish');
  fs.mkdirSync(project, { recursive: true });
  writeBuild(project, 'primera');
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('publisher', () => {
  it('crea una release inmutable y la apunta a preview', async () => {
    const first = await createRelease(project, { outputDir: 'dist' }, publishDir);

    expect(first.release.fileCount).toBe(3);
    expect(first.status.preview?.id).toBe(first.release.id);
    expect(first.status.production).toBeNull();
    expect(first.status.releases[0].isPreview).toBe(true);

    const releaseDir = path.join(publishDir, projectSlug(project), 'releases', first.release.id);
    expect(fs.readFileSync(path.join(releaseDir, 'index.html'), 'utf8')).toContain('src="assets/app.js"');
    expect(fs.readFileSync(path.join(releaseDir, 'index.html'), 'utf8')).not.toContain('src="/assets');
    expect(fs.readFileSync(path.join(releaseDir, 'assets', 'style.css'), 'utf8')).toContain('url(../assets/font.woff2)');
    expect(fs.existsSync(path.join(releaseDir, 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(releaseDir, '.env'))).toBe(false);
  });

  it('promueve una release y hace rollback a la producción anterior', async () => {
    const first = await createRelease(project, { outputDir: 'dist' }, publishDir);
    let status = await promoteRelease(project, first.release.id, 'production', publishDir);
    expect(status.production?.id).toBe(first.release.id);
    expect(status.canRollback).toBe(false);

    writeBuild(project, 'segunda');
    const second = await createRelease(project, { outputDir: 'dist' }, publishDir);
    status = await getPublishStatus(project, publishDir);
    expect(status.preview?.id).toBe(second.release.id);
    expect(status.production?.id).toBe(first.release.id);

    status = await promoteRelease(project, second.release.id, 'production', publishDir);
    expect(status.production?.id).toBe(second.release.id);
    expect(status.canRollback).toBe(true);

    // Promover la release que ya está en producción no borra el histórico.
    status = await promoteRelease(project, second.release.id, 'production', publishDir);
    expect(status.canRollback).toBe(true);

    status = await rollbackProduction(project, publishDir);
    expect(status.production?.id).toBe(first.release.id);
    expect(status.canRollback).toBe(false);

    // La release antigua no se reescribe al publicar la nueva.
    const firstDir = path.join(publishDir, projectSlug(project), 'releases', first.release.id);
    expect(fs.readFileSync(path.join(firstDir, 'assets', 'app.js'), 'utf8')).toContain('primera');
  });

  it('rechaza salidas fuera del proyecto o sin index.html', async () => {
    await expect(createRelease(project, { outputDir: '../fuera' }, publishDir)).rejects.toThrow(
      /dentro del proyecto/
    );
    await expect(createRelease(project, { outputDir: 'no-existe' }, publishDir)).rejects.toThrow(
      /No existe la carpeta/
    );
  });

  it('convierte referencias absolutas en relativas y respeta las externas', () => {
    expect(rewriteRootAbsoluteReferences('<a href="/docs">x</a>', 'sub')).toContain('href="../docs"');
    expect(rewriteRootAbsoluteReferences('<a href="//cdn.example/x">x</a>', '')).toBe(
      '<a href="//cdn.example/x">x</a>'
    );
    expect(rewriteRootAbsoluteReferences('<img srcset="/a.png 1x, /b.png 2x">', '')).toContain(
      'srcset="a.png 1x, b.png 2x"'
    );
  });

  it('no deja que un archivo resuelto escape de la release', () => {
    const releaseDir = path.join(tmpDir, 'release');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(path.join(releaseDir, 'index.html'), 'ok', 'utf8');
    expect(resolvePublishedFile(releaseDir, '/index.html')).toBe(path.join(releaseDir, 'index.html'));
    expect(resolvePublishedFile(releaseDir, '/../fuera.txt')).toBeNull();
  });

  it('persiste IDs remotos de Vercel con guion bajo', async () => {
    const first = await createRelease(project, { outputDir: 'dist' }, publishDir);
    const deploymentId = 'dpl_abc123';
    await saveRemoteDeploymentState(
      project,
      {
        provider: 'vercel',
        preview: deploymentId,
        production: null,
        productionHistory: [deploymentId],
        deployments: [
          {
            id: deploymentId,
            releaseId: first.release.id,
            environment: 'preview',
            url: 'https://demo-dpl_abc123.vercel.app',
            createdAt: new Date().toISOString(),
            status: 'ready',
            provider: 'vercel',
          },
        ],
      },
      publishDir
    );

    const restored = await getRemoteDeploymentState(project, publishDir);
    expect(restored?.preview).toBe(deploymentId);
    expect(restored?.deployments[0].id).toBe(deploymentId);
  });

  it('conserva el bloque remoto al promover y tolera uno corrupto', async () => {
    const first = await createRelease(project, { outputDir: 'dist' }, publishDir);
    const stateFile = path.join(publishDir, projectSlug(project), 'state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    state.remote = {
      provider: 'fake',
      preview: null,
      production: null,
      productionHistory: [],
      deployments: [],
    };
    fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');

    const status = await getPublishStatus(project, publishDir);
    expect(status.preview?.id).toBe(first.release.id);

    await promoteRelease(project, first.release.id, 'production', publishDir);
    const after = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    expect(after.remote.provider).toBe('fake');
    expect(after.remote.deployments).toEqual([]);

    after.remote = { provider: 42, deployments: [null, { id: 'x' }] };
    fs.writeFileSync(stateFile, JSON.stringify(after), 'utf8');

    const stillThere = await getPublishStatus(project, publishDir);
    expect(stillThere.production?.id).toBe(first.release.id);
  });
});
