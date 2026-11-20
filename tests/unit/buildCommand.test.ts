import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  ELECTRON_BUILD_SCRIPT,
  PRODUCTION_BUILD_SCRIPT,
  buildScriptFor,
  buildSpawnArgs,
} from '../../src/cli/buildCommand';

/**
 * `build --electron` prometía empaquetar Electron y terminaba pasándole
 * `--electron` a `vite build`, que lo ignora. Ahora la bandera elige el script
 * real (`build:all`), y esta prueba fija ese contrato.
 */
describe('commander build', () => {
  it('sin la bandera corre el build de producción normal', () => {
    expect(buildScriptFor()).toBe('build');
    expect(buildScriptFor({})).toBe(PRODUCTION_BUILD_SCRIPT);
    expect(buildScriptFor({ electron: false })).toBe('build');
    expect(buildSpawnArgs()).toEqual(['run', 'build']);
  });

  it('con --electron corre el pipeline completo de escritorio', () => {
    expect(buildScriptFor({ electron: true })).toBe('build:all');
    expect(buildSpawnArgs({ electron: true })).toEqual(['run', 'build:all']);
  });

  it('nunca reenvía --electron a vite', () => {
    for (const args of [buildSpawnArgs(), buildSpawnArgs({ electron: true })]) {
      expect(args).not.toContain('--electron');
      expect(args.join(' ')).not.toContain('--');
    }
  });

  it('los scripts elegidos existen y build:all encadena el camino real', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts[PRODUCTION_BUILD_SCRIPT]).toBeTruthy();
    expect(pkg.scripts[ELECTRON_BUILD_SCRIPT]).toBeTruthy();
    expect(ELECTRON_BUILD_SCRIPT).not.toBe(PRODUCTION_BUILD_SCRIPT);

    const electron = pkg.scripts[ELECTRON_BUILD_SCRIPT];
    for (const step of ['npm run build', 'npm run build:server', 'npm run build:updater', 'npm run build:electron']) {
      expect(electron, ELECTRON_BUILD_SCRIPT).toContain(step);
    }
    // `electron-builder` es el último paso: si falta, no hay instalador.
    expect(electron.trimEnd().endsWith('npm run build:electron')).toBe(true);
  });
});
