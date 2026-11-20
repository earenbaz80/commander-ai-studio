/**
 * `commander build` delega en los scripts de npm.
 *
 * `--electron` tiene que recorrer el camino real de escritorio (`build:all`:
 * tipos, Vite, bundles del servidor, updater y `electron-builder`) en vez de
 * colarse como argumento de `vite build`, que lo ignora.
 */
export const PRODUCTION_BUILD_SCRIPT = 'build';
export const ELECTRON_BUILD_SCRIPT = 'build:all';

export function buildScriptFor(options: { electron?: boolean } = {}): string {
  return options.electron ? ELECTRON_BUILD_SCRIPT : PRODUCTION_BUILD_SCRIPT;
}

/** Argumentos de `npm` para el build pedido. */
export function buildSpawnArgs(options: { electron?: boolean } = {}): string[] {
  return ['run', buildScriptFor(options)];
}
