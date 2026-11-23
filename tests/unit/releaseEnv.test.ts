/**
 * Entorno de una release con backend gestionado (PL3), sin servidor.
 *
 * El valor rotado tiene que llegar al archivo de entorno de la release y no
 * aparecer ni en el resultado de la inyección ni en la salida del proceso. El
 * archivo vive fuera de `releases/`, que es lo único que se sirve por HTTP.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectSlug } from '../../publisher';
import { createPendingDeploymentSink, clearPendingDeploymentSecrets } from '../../deploy/backend/secretSink';
import {
  injectBackendEnv,
  loadReleaseEnv,
  releaseEnvFile,
} from '../../deploy/backend/releaseEnv';

const SECRET = 'valor-database-url-rotada';
const secretSinkValue = 'valor-storage-secret-rotada';

let publishDir: string;
let project: string;

beforeEach(() => {
  clearPendingDeploymentSecrets();
  publishDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl3-env-publish-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'pl3-env-app-'));
});

afterEach(() => {
  clearPendingDeploymentSecrets();
  vi.restoreAllMocks();
  fs.rmSync(publishDir, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

function rotate(projectRoot: string): void {
  const sink = createPendingDeploymentSink(projectSlug(projectRoot));
  sink.write('DATABASE_URL', SECRET);
  sink.write('STORAGE_SECRET', secretSinkValue);
}

describe('injectBackendEnv', () => {
  test('escribe las credenciales rotadas en el entorno de la release', async () => {
    rotate(project);

    const result = await injectBackendEnv({
      root: project,
      releaseId: 'rel-1',
      environment: 'preview',
      baseDir: publishDir,
    });

    const slug = projectSlug(project);
    const expected = releaseEnvFile(publishDir, slug, 'rel-1', 'preview');
    expect(result).toEqual({ names: ['DATABASE_URL', 'STORAGE_SECRET'], file: expected });
    // El resultado que viaja por HTTP sólo lleva nombres.
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(secretSinkValue);

    // El archivo guarda los valores para que el runner de la app los lea…
    const env = await loadReleaseEnv({
      root: project,
      releaseId: 'rel-1',
      environment: 'preview',
      baseDir: publishDir,
    });
    expect(env).toEqual({ DATABASE_URL: SECRET, STORAGE_SECRET: secretSinkValue });

    // …pero queda fuera de `releases/`, el único árbol que se sirve por HTTP.
    const releasesDir = path.join(publishDir, slug, 'releases', 'rel-1');
    expect(path.relative(releasesDir, expected).startsWith('..')).toBe(true);

    const written = JSON.parse(fs.readFileSync(expected, 'utf8'));
    expect(written).toMatchObject({ version: 1, releaseId: 'rel-1', environment: 'preview' });
  });

  test('separa entornos y proyectos', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'pl3-env-otro-'));
    try {
      rotate(project);
      rotate(other);

      await injectBackendEnv({
        root: project,
        releaseId: 'rel-1',
        environment: 'preview',
        baseDir: publishDir,
      });
      await injectBackendEnv({
        root: project,
        releaseId: 'rel-1',
        environment: 'production',
        baseDir: publishDir,
      });

      const preview = await loadReleaseEnv({
        root: project,
        releaseId: 'rel-1',
        environment: 'preview',
        baseDir: publishDir,
      });
      const production = await loadReleaseEnv({
        root: project,
        releaseId: 'rel-1',
        environment: 'production',
        baseDir: publishDir,
      });
      expect(preview).toEqual({ DATABASE_URL: SECRET, STORAGE_SECRET: secretSinkValue });
      expect(production).toEqual(preview);

      // El proyecto vecino no comparte archivo: la clave es su propio slug.
      await expect(
        loadReleaseEnv({
          root: other,
          releaseId: 'rel-1',
          environment: 'preview',
          baseDir: publishDir,
        })
      ).rejects.toThrow(/ENOENT/);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test('sin credenciales rotadas no escribe nada', async () => {
    const result = await injectBackendEnv({
      root: project,
      releaseId: 'rel-1',
      environment: 'preview',
      baseDir: publishDir,
    });

    expect(result).toEqual({ names: [], file: null });
    expect(fs.existsSync(path.join(publishDir, projectSlug(project)))).toBe(false);
  });

  test('no escribe en stdout ni en stderr', async () => {
    rotate(project);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await injectBackendEnv({
      root: project,
      releaseId: 'rel-1',
      environment: 'preview',
      baseDir: publishDir,
    });

    const emitted = [
      ...log.mock.calls,
      ...info.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
      ...out.mock.calls,
      ...err.mock.calls,
    ]
      .map((args) => args.map((value) => String(value)).join(' '))
      .join('\n');
    expect(emitted).not.toContain(SECRET);
    expect(emitted).not.toContain(secretSinkValue);
  });

  test('rechaza un id de release con separadores de ruta', async () => {
    rotate(project);

    await expect(
      injectBackendEnv({
        root: project,
        releaseId: '../fuera',
        environment: 'preview',
        baseDir: publishDir,
      })
    ).rejects.toThrow(/id válido/);
  });
});
