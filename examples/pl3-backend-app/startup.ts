/**
 * Arranque de la app de ejemplo PL3 con el entorno de una release.
 *
 * El loader (`./releaseEnv`) deja las credenciales en `process.env` y devuelve
 * sólo sus nombres; el arranque los publica en `/api/health` y en el banner.
 * Separado de `server.ts` para que el test pueda levantar la misma ruta de
 * arranque con `port: 0` en su propio proceso, sin `spawn` ni puerto fijo.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExampleApp } from './app';
import { applyReleaseEnvFile, resolveReleaseEnvFile, type ReleaseEnvLoad } from './releaseEnv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_EXAMPLE_PORT = 4300;

export interface ExampleServerOptions {
  /** Argumentos de la release; por defecto los del proceso. */
  argv?: readonly string[];
  /** De dónde salen `PORT`, `PL3_EXAMPLE_DATA_DIR` y `PL3_RELEASE_ENV`. */
  env?: NodeJS.ProcessEnv;
  /** 0 pide un puerto efímero; por defecto `PORT` o 4300. */
  port?: number;
  host?: string;
}

export interface ExampleServer {
  url: string;
  port: number;
  dataDir: string;
  /** Entorno de release aplicado, o `null` si arrancó sin archivo. */
  release: ReleaseEnvLoad | null;
  close: () => Promise<void>;
}

export async function startExampleServer(options: ExampleServerOptions = {}): Promise<ExampleServer> {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(2);
  const envFile = resolveReleaseEnvFile(argv, env);
  const release = envFile ? await applyReleaseEnvFile(envFile) : null;

  const dataDir = path.resolve(env.PL3_EXAMPLE_DATA_DIR || path.join(HERE, '.data'));
  const example = createExampleApp({
    dataDir,
    release: release
      ? { id: release.releaseId, environment: release.environment, vars: release.names }
      : undefined,
  });

  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? Number(env.PORT || DEFAULT_EXAMPLE_PORT);
  const server = http.createServer(example.app);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const url = `http://${host}:${address.port}`;
  // Sólo nombres: los valores viven en `process.env`, no en el log.
  const releaseNote = release
    ? ` · release ${release.releaseId ?? 'sin-id'} (${release.environment ?? 'sin-entorno'}): ${
        release.names.length > 0 ? release.names.join(', ') : 'sin credenciales'
      }`
    : '';
  console.log(`[pl3-example] ${url} · datos en ${dataDir}${releaseNote}`);

  return {
    url,
    port: address.port,
    dataDir,
    release,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          example.close();
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
