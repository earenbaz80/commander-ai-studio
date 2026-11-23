/**
 * Entorno de una release publicada con backend gestionado (PL3).
 *
 * Las credenciales rotadas viven en el sink pendiente bajo el slug del
 * proyecto. Al publicar, se escriben en un archivo de entorno **fuera** del
 * directorio que se sirve por HTTP (`<publish>/<slug>/env/…`), para que el
 * runner de la app las lea al arrancar. Ni la publicación ni el estado las
 * devuelven: el cliente sólo ve nombres por `/api/backend/manage`.
 *
 * El archivo es la frontera: mientras el valor no esté en el entorno del
 * proceso que sirve la app, sigue siendo un pendiente. Por eso publicar falla
 * si no se puede escribir, en vez de fingir que la credencial llegó.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { projectSlug, publishBaseDir } from '../../publisher';
import { readPendingDeploymentSecrets } from './secretSink';

export type ReleaseEnvironment = 'preview' | 'production';

export interface ReleaseEnvInput {
  /** Raíz del proyecto publicado; su slug es la clave del backend. */
  root: string;
  releaseId: string;
  environment: ReleaseEnvironment;
  /** Base de publicación; por defecto `COMMANDER_PUBLISH_DIR`. */
  baseDir?: string;
}

export interface ReleaseEnvResult {
  /** Nombres inyectados, en orden; nunca sus valores. */
  names: string[];
  /** Archivo escrito, o `null` si el proyecto no tenía credenciales rotadas. */
  file: string | null;
}

/** Nombres que el contrato emite; cualquier otra clave no es una credencial. */
const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Ruta del entorno de una release: fuera de `releases/`, nunca servible. */
export function releaseEnvFile(
  publishDir: string,
  slug: string,
  releaseId: string,
  environment: ReleaseEnvironment
): string {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(releaseId)) {
    throw new Error('La release no tiene un id válido');
  }
  return path.join(publishDir, slug, 'env', `${environment}-${releaseId}.json`);
}

/**
 * Escribe el entorno de la release con las credenciales rotadas del proyecto.
 * No registra nada: el valor no debe acabar en stdout ni en stderr.
 */
export async function injectBackendEnv(input: ReleaseEnvInput): Promise<ReleaseEnvResult> {
  const slug = projectSlug(input.root);
  const secrets = readPendingDeploymentSecrets(slug);
  const names = Object.keys(secrets)
    .filter((name) => SECRET_NAME.test(name))
    .sort();
  if (names.length === 0) return { names: [], file: null };

  const vars: Record<string, string> = {};
  for (const name of names) vars[name] = secrets[name];

  const file = releaseEnvFile(
    publishBaseDir(input.baseDir),
    slug,
    input.releaseId,
    input.environment
  );
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(
    file,
    `${JSON.stringify(
      { version: 1, releaseId: input.releaseId, environment: input.environment, vars },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
  return { names, file };
}

/** Lo que el runner de la app lee al arrancar para poblar su entorno. */
export async function loadReleaseEnv(input: ReleaseEnvInput): Promise<Record<string, string>> {
  const slug = projectSlug(input.root);
  const raw = await fsp.readFile(
    releaseEnvFile(publishBaseDir(input.baseDir), slug, input.releaseId, input.environment),
    'utf8'
  );
  const parsed = JSON.parse(raw) as { vars?: Record<string, unknown> };
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed?.vars ?? {})) {
    if (SECRET_NAME.test(name) && typeof value === 'string') vars[name] = value;
  }
  return vars;
}
