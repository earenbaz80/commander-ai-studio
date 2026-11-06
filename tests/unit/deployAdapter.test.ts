import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeProject } from '../../deploy/adapter';
import { FakeDeploymentAdapter } from '../../deploy/fakeAdapter';
import type { ReleaseDescriptor } from '../../deploy/types';

let tmpDir = '';
let projectRoot = '';

function writeProject() {
  fs.mkdirSync(path.join(projectRoot, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({
      name: 'mi-app',
      scripts: { build: 'vite build' },
      dependencies: { react: '^19.0.0' },
    }),
    'utf8'
  );
  fs.writeFileSync(path.join(projectRoot, 'dist', 'index.html'), '<h1>ok</h1>', 'utf8');
  fs.writeFileSync(
    path.join(projectRoot, 'commander.app.json'),
    JSON.stringify({
      version: 1,
      kind: 'spa',
      build: { outputDir: 'dist' },
      bindings: { auth: true, database: true },
    }),
    'utf8'
  );
}

function release(id: string): ReleaseDescriptor {
  return {
    id,
    dir: path.join(projectRoot, 'dist'),
    fileCount: 1,
    bytes: 4,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-deploy-'));
  projectRoot = path.join(tmpDir, 'mi-app');
  writeProject();
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('deploy adapter contract', () => {
  it('describe el proyecto y lee el manifiesto sin ejecutar build', async () => {
    const project = await describeProject(projectRoot);

    expect(project.id).toMatch(/^mi-app-[a-f0-9]{8}$/);
    expect(project.root).toBe(path.resolve(projectRoot));
    expect(project.kind).toBe('spa');
    expect(project.buildScript).toBe(true);
    expect(project.outputDir).toBe('dist');
    expect(project.manifest?.bindings).toEqual({ auth: true, database: true });
  });

  it('rechaza una ruta que no existe', async () => {
    await expect(describeProject(path.join(tmpDir, 'no-existe'))).rejects.toThrow(
      /No existe el proyecto/
    );
  });

  it('despliega en preview, promueve y hace rollback', async () => {
    const adapter = new FakeDeploymentAdapter({
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const project = await adapter.detectProject(projectRoot);

    const first = await adapter.deploy({
      project,
      release: release('20260101-aaaaaa'),
      environment: 'preview',
    });
    expect(first.provider).toBe('fake');
    expect(first.status).toBe('ready');
    expect(first.url).toContain('deploy.invalid');
    expect(first.url).toContain('/preview/');

    let status = await adapter.status(project);
    expect(status.preview?.id).toBe(first.id);
    expect(status.production).toBeNull();
    expect(status.canRollback).toBe(false);
    expect(await adapter.logs(first.id)).toContain(first.id);

    const promoted = await adapter.promote({
      project,
      deploymentId: first.id,
      environment: 'production',
    });
    expect(promoted.environment).toBe('production');
    expect(promoted.url).toContain('/production/');

    status = await adapter.status(project);
    expect(status.production?.id).toBe(first.id);
    expect(status.preview?.id).toBe(first.id);
    expect(status.canRollback).toBe(false);

    const second = await adapter.deploy({
      project,
      release: release('20260101-bbbbbb'),
      environment: 'preview',
    });
    await adapter.promote({
      project,
      deploymentId: second.id,
      environment: 'production',
    });

    status = await adapter.status(project);
    expect(status.production?.id).toBe(second.id);
    expect(status.preview?.id).toBe(second.id);
    expect(status.canRollback).toBe(true);

    const rolledBack = await adapter.rollback(project);
    expect(rolledBack.id).toBe(first.id);
    expect(rolledBack.environment).toBe('production');

    status = await adapter.status(project);
    expect(status.production?.id).toBe(first.id);
    expect(status.canRollback).toBe(false);
  });

  it('no finge un rollback sin producción anterior', async () => {
    const adapter = new FakeDeploymentAdapter();
    const project = await adapter.detectProject(projectRoot);
    await adapter.deploy({
      project,
      release: release('20260101-cccccc'),
      environment: 'production',
    });

    await expect(adapter.rollback(project)).rejects.toThrow(/producción anterior/);
  });

  it('rechaza promover un deployment que no existe', async () => {
    const adapter = new FakeDeploymentAdapter();
    const project = await adapter.detectProject(projectRoot);

    await expect(
      adapter.promote({
        project,
        deploymentId: 'no-existe',
        environment: 'production',
      })
    ).rejects.toThrow(/no existe/);
  });
});
