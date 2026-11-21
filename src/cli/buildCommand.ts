/**
 * `commander build` delega en los scripts de npm **del checkout del Studio**.
 *
 * `--electron` tiene que recorrer el camino real de escritorio (`build:all`:
 * tipos, Vite, bundles del servidor, updater y `electron-builder`) en vez de
 * colarse como argumento de `vite build`, que lo ignora.
 *
 * Desde un paquete instalado no hay fuentes. Antes se lanzaba `npm run build`
 * en el cwd del usuario, que compilaba **otro proyecto** (o fallaba con un
 * `Missing script` que no explicaba nada): acá se decide si el paquete es un
 * checkout y, si no, se corta con un motivo.
 */
import fs from 'node:fs';
import path from 'node:path';

export const PRODUCTION_BUILD_SCRIPT = 'build';
export const ELECTRON_BUILD_SCRIPT = 'build:all';

/** Nombre con el que se publica el Studio; un clon conserva ese `name`. */
export const STUDIO_PACKAGE_NAME = 'commander-ai-studio';

export function buildScriptFor(options: { electron?: boolean } = {}): string {
  return options.electron ? ELECTRON_BUILD_SCRIPT : PRODUCTION_BUILD_SCRIPT;
}

/** Argumentos de `npm` para el build pedido. */
export function buildSpawnArgs(options: { electron?: boolean } = {}): string[] {
  return ['run', buildScriptFor(options)];
}

export type BuildPlan =
  | { ok: true; cwd: string; script: string }
  | { ok: false; reason: string };

/** Motivo único, para que el CLI y los tests digan lo mismo. */
export const BUILD_REQUIRES_CHECKOUT =
  '`commander build` compila Commander AI Studio desde un checkout del repo; este paquete instalado no trae fuentes. Para tu proyecto usá `npm run build`.';

/**
 * Decide dónde compilar. Sólo acepta la raíz del paquete como checkout:
 * `package.json` con el nombre del Studio, `src/` y `vite.config.ts`. Nunca
 * usa el cwd del operador, que puede ser cualquier proyecto.
 */
export function planStudioBuild(options: {
  electron?: boolean;
  packageRoot: string;
  exists?: (file: string) => boolean;
  readJson?: (file: string) => unknown;
}): BuildPlan {
  const exists = options.exists ?? fs.existsSync;
  const readJson =
    options.readJson ??
    ((file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as unknown);

  const pkgFile = path.join(options.packageRoot, 'package.json');
  if (!exists(pkgFile)) return { ok: false, reason: BUILD_REQUIRES_CHECKOUT };

  let name: unknown;
  try {
    name = (readJson(pkgFile) as { name?: unknown })?.name;
  } catch {
    return { ok: false, reason: BUILD_REQUIRES_CHECKOUT };
  }

  const hasSources =
    name === STUDIO_PACKAGE_NAME &&
    exists(path.join(options.packageRoot, 'src')) &&
    exists(path.join(options.packageRoot, 'vite.config.ts'));
  if (!hasSources) return { ok: false, reason: BUILD_REQUIRES_CHECKOUT };

  return {
    ok: true,
    cwd: options.packageRoot,
    script: buildScriptFor({ electron: options.electron }),
  };
}
