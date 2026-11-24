import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  clearPluginCache,
  listPluginFiles,
  runAfterModelHooks,
  runAfterToolHooks,
  runBeforeModelHooks,
  runBeforeToolHooks,
  runErrorHooks,
  runSessionEndHooks,
  runSessionStartHooks,
  runStopHooks,
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

/** Plugin que agrega su id y el hook a un log común, sin tocar la corrida. */
function writeRecorder(id: string): void {
  writePlugin(
    id,
    `import fs from 'node:fs';
import path from 'node:path';
const ID = ${JSON.stringify(id)};
const record = (ctx, hook) => {
  const file = path.join(ctx.root, '.commander', 'lifecycle.log');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, ID + ':' + hook + '\\n', 'utf8');
};
export default {
  sessionStart: (c) => record(c, 'sessionStart'),
  beforeModel: (c) => record(c, 'beforeModel'),
  afterModel: (c) => record(c, 'afterModel'),
  beforeTool: (c) => record(c, 'beforeTool'),
  afterTool: (c) => record(c, 'afterTool'),
  sessionEnd: (c) => record(c, 'sessionEnd'),
  stop: (c) => record(c, 'stop'),
  error: (c) => record(c, 'error'),
};`,
  );
}

function lifecycleLog(): string[] {
  try {
    return fs.readFileSync(path.join(root, '.commander', 'lifecycle.log'), 'utf8')
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

describe('lifecycle', () => {
  const base = {
    sessionId: 'sess_test',
    goal: 'probar hooks',
    model: 'gemini-2.5-flash',
  };

  it('ejecuta todos los hooks en orden alfabético por plugin', async () => {
    writeRecorder('b');
    writeRecorder('a');
    const ctx = { ...base, root };

    await runSessionStartHooks(root, ctx);
    await runBeforeModelHooks(root, { ...ctx, phase: 'before', turn: 1 });
    await runAfterModelHooks(root, { ...ctx, phase: 'after', turn: 1, ok: true });
    await runBeforeToolHooks(root, 'fs.read', {});
    await runAfterToolHooks(root, 'fs.read', {}, { ok: true });
    await runSessionEndHooks(root, { ...ctx, answer: 'listo' });
    await runStopHooks(root, { ...ctx, reason: 'user' });
    await runErrorHooks(root, { ...ctx, error: 'boom' });

    expect(lifecycleLog()).toEqual([
      'a:sessionStart', 'b:sessionStart',
      'a:beforeModel', 'b:beforeModel',
      'a:afterModel', 'b:afterModel',
      'a:beforeTool', 'b:beforeTool',
      'a:afterTool', 'b:afterTool',
      'a:sessionEnd', 'b:sessionEnd',
      'a:stop', 'b:stop',
      'a:error', 'b:error',
    ]);
  });

  it('un hook que lanza no impide los demás ni rompe la corrida', async () => {
    writePlugin('a-rompe', 'export default { afterModel: () => { throw new Error("boom"); } };');
    writePlugin('b-sigue', 'export default { afterModel: () => undefined };');

    const res = await runAfterModelHooks(root, {
      ...base,
      root,
      phase: 'after',
      turn: 1,
      ok: true,
    });

    expect(res.ran).toEqual(['b-sigue']);
    expect(res.errors).toEqual([{ plugin: 'a-rompe', hook: 'afterModel', error: 'boom' }]);
  });

  it('un hook que nunca resuelve se corta por timeout y no rompe la sesión', async () => {
    writePlugin('lento', 'export default { beforeModel: () => new Promise(() => {}) };');

    const res = await runBeforeModelHooks(root, {
      ...base,
      root,
      phase: 'before',
      turn: 1,
    }, { timeoutMs: 25 });

    expect(res.ran).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].plugin).toBe('lento');
    expect(res.errors[0].hook).toBe('beforeModel');
    expect(res.errors[0].error).toMatch(/timeout/);
  });

  it('el timeout también cubre beforeTool y deja la entrada intacta', async () => {
    writePlugin('lento', 'export default { beforeTool: () => new Promise(() => {}) };');

    const res = await runBeforeToolHooks(root, 'fs.read', { path: 'x.txt' }, { timeoutMs: 20 });

    expect(res.input).toEqual({ path: 'x.txt' });
    expect(res.ran).toEqual([]);
    expect(res.errors[0]).toMatchObject({ plugin: 'lento', hook: 'beforeTool' });
    expect(res.errors[0].error).toMatch(/timeout/);
  });
});
