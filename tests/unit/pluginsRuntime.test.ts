import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  clearPluginCache,
  listPluginFiles,
  runAfterToolHooks,
  runBeforeToolHooks,
  PLUGINS_DIR,
} from '../../pluginsRuntime';

let root = '';

/** Crea `<root>/.commander/plugins/<id>/index.js` con el contenido dado. */
function writePlugin(id: string, code: string): string {
  const dir = path.join(root, PLUGINS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'index.js');
  fs.writeFileSync(file, code, 'utf8');
  return file;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdr-plugins-rt-'));
  clearPluginCache();
});

afterEach(() => {
  clearPluginCache();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('descubrimiento', () => {
  it('sin directorio de plugins no hay nada cargado', () => {
    expect(listPluginFiles(root)).toEqual([]);
  });

  it('sólo lista directorios con index.js y un id válido', () => {
    writePlugin('demo', 'export default {};');
    // Fichero suelto (manifiesto) y directorio sin entrada: no son plugins.
    fs.writeFileSync(path.join(root, PLUGINS_DIR, 'suelto.manifest.json'), '{}');
    fs.mkdirSync(path.join(root, PLUGINS_DIR, 'vacio'), { recursive: true });

    expect(listPluginFiles(root).map((p) => p.id)).toEqual(['demo']);
  });
});

describe('beforeTool', () => {
  it('puede reemplazar la entrada devolviendo { input }', async () => {
    writePlugin(
      'normaliza',
      'export default { beforeTool: (ctx) => ({ input: { ...ctx.input, path: "normalizado.txt" } }) };',
    );

    const res = await runBeforeToolHooks(root, 'fs.read', { path: 'otro.txt' });

    expect(res.input).toEqual({ path: 'normalizado.txt' });
    expect(res.ran).toEqual(['normaliza']);
    expect(res.errors).toEqual([]);
  });

  it('aplica varios hooks en orden alfabético', async () => {
    writePlugin('a', 'export default { beforeTool: (c) => ({ input: { ...c.input, marca: "a" } }) };');
    writePlugin('b', 'export default { beforeTool: (c) => ({ input: { ...c.input, marca: c.input.marca + "+b" } }) };');

    const res = await runBeforeToolHooks(root, 'fs.read', {});

    expect(res.input).toEqual({ marca: 'a+b' });
  });

  it('devuelve la entrada intacta si el hook no devuelve { input }', async () => {
    writePlugin('mudo', 'export default { beforeTool: () => undefined };');

    const res = await runBeforeToolHooks(root, 'fs.read', { path: 'x.txt' });

    expect(res.input).toEqual({ path: 'x.txt' });
    expect(res.errors).toEqual([]);
  });

  it('recarga el plugin cuando cambia el fichero', async () => {
    const file = writePlugin('cambia', 'export default { beforeTool: () => ({ input: { v: 1 } }) };');
    expect((await runBeforeToolHooks(root, 'fs.read', {})).input).toEqual({ v: 1 });

    fs.writeFileSync(file, 'export default { beforeTool: () => ({ input: { v: 2 } }) };', 'utf8');
    // Fuerza un mtime distinto: dos escrituras en el mismo milisegundo no
    // invalidarían la caché y el test sería intermitente.
    const futuro = new Date(Date.now() + 5000);
    fs.utimesSync(file, futuro, futuro);

    expect((await runBeforeToolHooks(root, 'fs.read', {})).input).toEqual({ v: 2 });
  });
});

describe('afterTool', () => {
  it('puede anotar el resultado sin perder lo que devolvió la tool', async () => {
    writePlugin(
      'anota',
      'export default { afterTool: (ctx) => ({ result: { ...ctx.result, data: { ...ctx.result.data, plugin: ctx.toolId } } }) };',
    );

    const res = await runAfterToolHooks(root, 'fs.list', {}, { ok: true, data: { files: ['a'] } });

    expect(res.result).toEqual({ ok: true, data: { files: ['a'], plugin: 'fs.list' } });
    expect(res.ran).toEqual(['anota']);
  });
});

describe('fallos que no rompen la tool', () => {
  it('un hook que lanza queda anotado y el resultado sigue siendo el original', async () => {
    writePlugin('rompe', 'export default { afterTool: () => { throw new Error("boom"); } };');

    const res = await runAfterToolHooks(root, 'fs.list', {}, { ok: true, data: { a: 1 } });

    expect(res.result).toEqual({ ok: true, data: { a: 1 } });
    expect(res.errors).toEqual([{ plugin: 'rompe', hook: 'afterTool', error: 'boom' }]);
  });

  it('un plugin que no compila no impide cargar los demás', async () => {
    writePlugin('roto', 'export default { beforeTool: (');
    writePlugin('bueno', 'export default { beforeTool: (c) => ({ input: { ...c.input, ok: true } }) };');

    const res = await runBeforeToolHooks(root, 'fs.read', {});

    expect(res.input).toEqual({ ok: true });
    expect(res.errors.map((e) => e.plugin)).toEqual(['roto']);
    expect(res.errors[0].hook).toBe('load');
  });
});
