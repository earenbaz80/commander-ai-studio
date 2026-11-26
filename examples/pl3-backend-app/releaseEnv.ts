/**
 * Entorno de la release para la app de ejemplo (PL3).
 *
 * El publicador escribe `<publish>/<slug>/env/<entorno>-<releaseId>.json` con
 * las credenciales rotadas, fuera del árbol que se sirve por HTTP. El runner de
 * la app recibe esa ruta por `--env-file <ruta>` o por `PL3_RELEASE_ENV` y las
 * deja en `process.env` antes de abrir la base: la app lee credenciales del
 * proceso, nunca de un archivo servido.
 *
 * Nada de aquí registra valores: sólo nombres.
 */
import path from 'node:path';
import { readReleaseEnv } from '../../deploy/backend/releaseEnv';

export interface ReleaseEnvLoad {
  /** Archivo leído, resuelto contra el cwd. */
  file: string;
  releaseId: string | null;
  environment: string | null;
  /** Nombres cargados, en orden; nunca sus valores. */
  names: string[];
}

/**
 * Ruta del entorno de la release, o `null` si no se pidió ninguna.
 *
 * `--env-file <ruta>` (o `--env-file=<ruta>`) gana sobre `PL3_RELEASE_ENV`: el
 * argumento es lo que escribe el runner al lanzar la release concreta.
 */
export function resolveReleaseEnvFile(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): string | null {
  let fromArg: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env-file') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--env-file necesita una ruta');
      fromArg = value;
      index += 1;
    } else if (arg.startsWith('--env-file=')) {
      fromArg = arg.slice('--env-file='.length).trim();
      if (!fromArg) throw new Error('--env-file necesita una ruta');
    }
  }
  const chosen = fromArg ?? String(env.PL3_RELEASE_ENV ?? '').trim();
  return chosen ? path.resolve(chosen) : null;
}

/**
 * Carga el archivo en el entorno del proceso.
 *
 * El archivo de la release manda sobre lo heredado del shell: si el runner trae
 * un `DATABASE_URL` viejo, la credencial rotada lo reemplaza. Sólo entran
 * nombres que el contrato acepta; el resto se ignora.
 */
export async function applyReleaseEnvFile(
  file: string,
  target: NodeJS.ProcessEnv = process.env
): Promise<ReleaseEnvLoad> {
  const contents = await readReleaseEnv(file);
  const names = Object.keys(contents.vars).sort();
  for (const name of names) target[name] = contents.vars[name];
  return {
    file,
    releaseId: contents.releaseId,
    environment: contents.environment,
    names,
  };
}
