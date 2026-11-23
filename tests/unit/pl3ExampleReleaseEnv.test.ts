/**
 * La app de ejemplo de PL3 arranca con el entorno de su release.
 *
 * El publicador deja las credenciales rotadas en
 * `<publish>/<slug>/env/<entorno>-<releaseId>.json`; el runner de la app recibe
 * esa ruta por `--env-file` o `PL3_RELEASE_ENV`. Aquí se levanta la misma ruta
 * de arranque que usa `server.ts` (`startExampleServer`, con `port: 0` en este
 * proceso) y se comprueba que las credenciales llegan a `process.env` y que ni
 * por HTTP ni por los logs se ve su valor.
 *
 * No usa `startServer()`: eso levanta Commander y no monta la app de ejemplo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectSlug } from '../../publisher';
import {
  clearPendingDeploymentSecrets,
  createPendingDeploymentSink,
} from '../../deploy/backend/secretSink';
import { injectBackendEnv } from '../../deploy/backend/releaseEnv';
import { resolveReleaseEnvFile } from '../../examples/pl3-backend-app/releaseEnv';
import { startExampleServer, type ExampleServer } from '../../examples/pl3-backend-app/startup';

const DATABASE_SECRET = 'postgres://pl3:rotada@db.local/app';
const STORAGE_SECRET = 'storage-secret-de-la-release';
const SECRET_NAMES = ['DATABASE_URL', 'STORAGE_SECRET'];

let publishDir = '';
let project = '';
let dataDir = '';
let servers: ExampleServer[] = [];

beforeEach(() => {
  clearPendingDeploymentSecrets();
  publishDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl3-runner-publish-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'pl3-runner-app-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl3-runner-data-'));
  delete process.env.DATABASE_URL;
  delete process.env.STORAGE_SECRET;
});

afterEach(async () => {
  for (const server of servers) await server.close();
  servers = [];
  delete process.env.DATABASE_URL;
  delete process.env.STORAGE_SECRET;
  clearPendingDeploymentSecrets();
  vi.restoreAllMocks();
  for (const dir of [publishDir, project, dataDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Captura lo que la app escribe por consola y por stdout/stderr. */
function captureLogs(): () => string {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(' '));
  };
  vi.spyOn(console, 'log').mockImplementation(record);
  vi.spyOn(console, 'info').mockImplementation(record);
  vi.spyOn(console, 'warn').mockImplementation(record);
  vi.spyOn(console, 'error').mockImplementation(record);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    lines.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
    lines.push(String(chunk));
    return true;
  });
  return () => lines.join('\n');
}

/** Publica con el contrato real: sink → `injectBackendEnv` → archivo. */
async function publishRelease(
  environment: 'preview' | 'production' = 'preview',
  releaseId = 'rel-1'
): Promise<string> {
  const sink = createPendingDeploymentSink(projectSlug(project));
  sink.write('DATABASE_URL', DATABASE_SECRET);
  sink.write('STORAGE_SECRET', STORAGE_SECRET);
  const result = await injectBackendEnv({ root: project, releaseId, environment, baseDir: publishDir });
  if (!result.file) throw new Error('el publicador no escribió el entorno de la release');
  return result.file;
}

function writeReleaseFile(
  name: string,
  vars: Record<string, string>,
  releaseId: string,
  environment: string
): string {
  const file = path.join(publishDir, name);
  fs.writeFileSync(file, JSON.stringify({ version: 1, releaseId, environment, vars }, null, 2));
  return file;
}

async function start(argv: string[], env: NodeJS.ProcessEnv = {}): Promise<ExampleServer> {
  const server = await startExampleServer({
    argv,
    port: 0,
    env: { ...process.env, PL3_RELEASE_ENV: '', PL3_EXAMPLE_DATA_DIR: dataDir, ...env },
  });
  servers.push(server);
  return server;
}

describe('entorno de la release en la app de ejemplo PL3', () => {
  it('arranca con PL3_RELEASE_ENV y deja las credenciales en el proceso', async () => {
    const emitted = captureLogs();
    const file = await publishRelease();

    const server = await start([], { PL3_RELEASE_ENV: file });

    // Las credenciales están en el proceso que sirve la app…
    expect(process.env.DATABASE_URL).toBe(DATABASE_SECRET);
    expect(process.env.STORAGE_SECRET).toBe(STORAGE_SECRET);
    expect(server.release).toEqual({
      file: path.resolve(file),
      releaseId: 'rel-1',
      environment: 'preview',
      names: SECRET_NAMES,
    });

    // …y por HTTP sólo se ven sus nombres.
    const health = await fetch(`${server.url}/api/health`, {
      headers: { 'x-project-id': 'app-a' },
    });
    const healthText = await health.text();
    expect(health.status, healthText).toBe(200);
    expect((JSON.parse(healthText) as { release: unknown }).release).toEqual({
      id: 'rel-1',
      environment: 'preview',
      vars: SECRET_NAMES,
    });
    expect(healthText).not.toContain(DATABASE_SECRET);
    expect(healthText).not.toContain(STORAGE_SECRET);

    const privateRoute = await fetch(`${server.url}/api/notes`, {
      headers: { 'x-project-id': 'app-a' },
    });
    const privateText = await privateRoute.text();
    expect(privateRoute.status).toBe(401);
    expect(privateText).not.toContain(DATABASE_SECRET);
    expect(privateText).not.toContain(STORAGE_SECRET);

    // El banner nombra la release, el directorio de datos y las credenciales;
    // nunca sus valores ni la ruta del archivo de entorno.
    const logs = emitted();
    expect(logs).toContain('[pl3-example]');
    expect(logs).toContain('DATABASE_URL');
    expect(logs).not.toContain(DATABASE_SECRET);
    expect(logs).not.toContain(STORAGE_SECRET);
  });

  it('--env-file=<ruta> gana sobre PL3_RELEASE_ENV', async () => {
    const fromEnvVar = await publishRelease();
    const fromArg = writeReleaseFile(
      'production-rel-2.json',
      { DATABASE_URL: 'desde-el-argumento' },
      'rel-2',
      'production'
    );

    const server = await start([`--env-file=${fromArg}`], { PL3_RELEASE_ENV: fromEnvVar });

    expect(process.env.DATABASE_URL).toBe('desde-el-argumento');
    // El archivo elegido manda: la credencial del otro no se aplica.
    expect(process.env.STORAGE_SECRET).toBeUndefined();
    expect(server.release).toMatchObject({
      file: path.resolve(fromArg),
      releaseId: 'rel-2',
      environment: 'production',
      names: ['DATABASE_URL'],
    });
  });

  it('--env-file <ruta> toma el archivo indicado', async () => {
    const file = await publishRelease();
    const server = await start(['--env-file', file]);

    expect(server.release?.file).toBe(path.resolve(file));
    expect(process.env.STORAGE_SECRET).toBe(STORAGE_SECRET);
  });

  it('un archivo malformado falla sin repetir el contenido en el error ni la salida', async () => {
    const emitted = captureLogs();
    // El archivo se corta a mitad de una credencial: si el error repitiera el
    // mensaje del parser, ese trozo acabaría en stderr (el CLI publica
    // `error.message`).
    const file = path.join(publishDir, 'malformado.json');
    fs.writeFileSync(
      file,
      `{"releaseId":"rel-1","vars":{"DATABASE_URL":"${DATABASE_SECRET}"`,
      'utf8'
    );

    const error = await start(['--env-file', file]).then(
      () => null,
      (failure) => failure as Error
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('El archivo de entorno de la release no es JSON válido');
    expect(error?.message).not.toContain(DATABASE_SECRET);
    expect(String(error)).not.toContain(DATABASE_SECRET);
    // No llegó a escuchar ni a escribir el banner, y nada tocó `process.env`.
    expect(emitted()).toBe('');
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.STORAGE_SECRET).toBeUndefined();
  });

  it('falla antes de escuchar si el archivo no existe', async () => {
    await expect(
      start(['--env-file', path.join(publishDir, 'no-existe.json')])
    ).rejects.toThrow(/ENOENT/);
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.STORAGE_SECRET).toBeUndefined();
  });

  it('rechaza --env-file sin ruta', async () => {
    await expect(start(['--env-file'])).rejects.toThrow(/necesita una ruta/);
    expect(() => resolveReleaseEnvFile(['--env-file', '--port', '1'])).toThrow(/necesita una ruta/);
  });

  it('sin archivo arranca sin credenciales y publica release nulo', async () => {
    const server = await start([], { PL3_RELEASE_ENV: '' });

    expect(server.release).toBeNull();
    const health = await fetch(`${server.url}/api/health`, {
      headers: { 'x-project-id': 'app-a' },
    });
    const body = (await health.json()) as { release: unknown };
    expect(health.status).toBe(200);
    expect(body.release).toBeNull();
  });
});
