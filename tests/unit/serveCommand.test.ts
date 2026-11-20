import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { DEV_SCRIPT_PORT, devPortNotice, portFlagRequested } from '../../src/cli/serveCommand';

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
