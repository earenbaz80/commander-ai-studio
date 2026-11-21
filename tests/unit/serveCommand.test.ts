import path from 'node:path';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  DEV_REQUIRES_CHECKOUT,
  DEV_SCRIPT_PORT,
  devPortNotice,
  planDevServe,
  portFlagRequested,
  resolveDistDir,
  resolveServerEntry,
  serverEntryCandidates,
} from '../../src/cli/serveCommand';

/**
 * `serve --dev` no puede honrar `--port` porque `npm run dev` fija el puerto en
 * su script. La constante tiene que seguir siendo la del script y el aviso sólo
 * aparece cuando el operador pidió un puerto explícito distinto.
 */
describe('serve --dev', () => {
  it('la constante coincide con el PORT del script npm run dev', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.dev).toContain(`PORT=${DEV_SCRIPT_PORT}`);
  });

  it('avisa sólo si se pidió un puerto explícito distinto', () => {
    expect(devPortNotice(3299, true)).toContain('no aplica con --dev');
    expect(devPortNotice('3299', true)).toContain('PORT=3283');
    expect(devPortNotice(DEV_SCRIPT_PORT, true)).toBeNull();
    expect(devPortNotice(3299, false)).toBeNull();
    expect(devPortNotice(undefined, true)).toBeNull();
    expect(devPortNotice('no-es-un-puerto', true)).toBeNull();
  });

  it('reconoce --port/-p explícitos y no el default', () => {
    expect(portFlagRequested(['serve', '--port', '3299'])).toBe(true);
    expect(portFlagRequested(['serve', '-p', '3299'])).toBe(true);
    expect(portFlagRequested(['serve', '--port=3299'])).toBe(true);
    expect(portFlagRequested(['serve', '--dev', '--host', 'localhost'])).toBe(false);
  });
});

/**
 * `serve` importa el servidor por ruta: en el paquete instalado, el bundle de
 * `cli-dist`; en el repo, `server.ts` que carga tsx. Si el orden se invierte o
 * se cae a un candidato inexistente, el paquete vuelve a depender del repo.
 */
describe('serve: entrada del servidor', () => {
  it('prefiere el bundle que viaja en el paquete', () => {
    const candidatos = serverEntryCandidates('/pkg/cli-dist');
    expect(candidatos[0]).toBe(path.join('/pkg/cli-dist', 'server.mjs'));
    expect(resolveServerEntry('/pkg/cli-dist', (file) => file === candidatos[0])).toBe(candidatos[0]);
  });

  it('cae al server.ts del repo cuando no hay bundle', () => {
    const elegido = resolveServerEntry('/repo/bin', (file) => file.endsWith('server.ts'));
    expect(elegido).toBe(path.resolve('/repo', 'server.ts'));
  });

  it('devuelve null si no existe ningún candidato', () => {
    expect(resolveServerEntry('/x/bin', () => false)).toBeNull();
  });

  it('sirve la UI empaquetada desde cli-dist/dist', () => {
    const dir = resolveDistDir({
      cliDir: '/pkg/cli-dist',
      exists: (file) => file.endsWith('index.html'),
    });
    expect(dir).toBe(path.join('/pkg/cli-dist', 'dist'));
  });

  it('en el repo cae al dist de la raíz', () => {
    const rootDist = path.resolve('/repo', 'dist');
    const dir = resolveDistDir({
      cliDir: '/repo/bin',
      exists: (file) => file === path.join(rootDist, 'index.html'),
    });
    expect(dir).toBe(rootDist);
  });

  it('sin index.html devuelve null y el servidor usa su fallback', () => {
    expect(resolveDistDir({ cliDir: '/x/cli-dist', exists: () => false })).toBeNull();
  });
});

/**
 * `--dev` sólo corre desde el checkout del Studio. Fuera de él se corta con el
 * mismo criterio que `build`, en vez de lanzar el `npm run dev` del cwd.
 */
describe('serve --dev: guarda de checkout', () => {
  it('acepta la raíz del Studio y corre allí', () => {
    const plan = planDevServe({
      packageRoot: '/repo',
      exists: () => true,
      readJson: () => ({ name: 'commander-ai-studio' }),
    });
    expect(plan).toEqual({ ok: true, cwd: '/repo', script: 'dev', port: DEV_SCRIPT_PORT });
  });

  it('corta fuera de un checkout con el motivo compartido', () => {
    const plan = planDevServe({
      packageRoot: '/pkg',
      exists: () => true,
      readJson: () => ({ name: 'otro-proyecto' }),
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe(DEV_REQUIRES_CHECKOUT);
    expect(DEV_REQUIRES_CHECKOUT).toMatch(/checkout/);
  });

  it('no acepta un nombre correcto sin fuentes', () => {
    const plan = planDevServe({
      packageRoot: '/pkg',
      exists: (file) => !file.endsWith('src') && !file.endsWith('vite.config.ts'),
      readJson: () => ({ name: 'commander-ai-studio' }),
    });
    expect(plan.ok).toBe(false);
  });

  it('un package.json ilegible también corta', () => {
    const plan = planDevServe({
      packageRoot: '/pkg',
      exists: () => true,
      readJson: () => {
        throw new Error('json inválido');
      },
    });
    expect(plan.ok).toBe(false);
  });
});
