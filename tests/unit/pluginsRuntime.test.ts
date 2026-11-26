import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  clearPluginCache,
  listPluginFiles,
  parsePluginApiVersion,
  runAfterModelHooks,
  runAfterToolHooks,
  runBeforeModelHooks,
  runBeforeToolHooks,
  runErrorHooks,
  runSessionEndHooks,
  runSessionStartHooks,
  runStopHooks,
  PLUGINS_DIR,
  PLUGIN_MANIFEST_FILE,
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

/** Escribe `<root>/.commander/plugins/<id>/plugin.json`; un string va tal cual. */
function writeManifest(id: string, manifest: unknown): string {
  const dir = path.join(root, PLUGINS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, PLUGIN_MANIFEST_FILE);
  fs.writeFileSync(
    file,
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2),
    'utf8',
  );
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

describe('manifiesto y permisos', () => {
  it('lee la versión mayor de apiVersion', () => {
    expect(parsePluginApiVersion(1)).toBe(1);
    expect(parsePluginApiVersion('1')).toBe(1);
    expect(parsePluginApiVersion('1.4.0')).toBe(1);
    expect(parsePluginApiVersion(2)).toBe(2);
    expect(parsePluginApiVersion('10.1')).toBe(10);
    expect(parsePluginApiVersion('v1')).toBeNull();
    expect(parsePluginApiVersion('')).toBeNull();
    expect(parsePluginApiVersion(null)).toBeNull();
    expect(parsePluginApiVersion(1.5)).toBeNull();
  });

  it('sin plugin.json el plugin se carga como legado', async () => {
    writePlugin('legado', 'export default { beforeTool: () => ({ input: { legado: true } }) };');

    const res = await runBeforeToolHooks(root, 'fs.read', {});

    expect(res.input).toEqual({ legado: true });
    expect(res.ran).toEqual(['legado']);
    expect(res.errors).toEqual([]);
  });

  it('un manifiesto compatible habilita sólo sus permisos', async () => {
    writePlugin('declarado', 'export default { beforeTool: () => ({ input: { ok: true } }) };');
    writeManifest('declarado', { apiVersion: '1.0.0', permissions: ['tools'] });

    const res = await runBeforeToolHooks(root, 'fs.read', {});

    expect(res.input).toEqual({ ok: true });
    expect(res.ran).toEqual(['declarado']);
    expect(res.errors).toEqual([]);
  });

  it('rechaza una apiVersion incompatible sin ejecutar el código del plugin', async () => {
    const ejecutado = path.join(root, 'ejecutado.txt');
    writePlugin(
      'futuro',
      [
        "import fs from 'node:fs';",
        `fs.writeFileSync(${JSON.stringify(ejecutado)}, 'x');`,
        'export default { beforeTool: () => ({ input: { tocado: true } }) };',
      ].join('\n'),
    );
    writeManifest('futuro', { apiVersion: 2, permissions: ['tools'] });

    const res = await runBeforeToolHooks(root, 'fs.read', { path: 'x.txt' });

    expect(fs.existsSync(ejecutado)).toBe(false);
    expect(res.input).toEqual({ path: 'x.txt' });
    expect(res.ran).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatchObject({ plugin: 'futuro', hook: 'manifest' });
    expect(res.errors[0].error).toMatch(/apiVersion 2 incompatible/);
  });

  it('un manifiesto inválido tampoco ejecuta el plugin', async () => {
    const ejecutado = path.join(root, 'ejecutado-roto.txt');
    const code = [
      "import fs from 'node:fs';",
      `fs.writeFileSync(${JSON.stringify(ejecutado)}, 'x');`,
      'export default {};',
    ].join('\n');

    const casos = [
      ['sin-version', { permissions: [] }],
      ['json-roto', '{ "apiVersion": 1,'],
      ['permiso-raro', { apiVersion: 1, permissions: ['shell'] }],
      ['sin-permisos', { apiVersion: 1 }],
    ] as const;
    for (const [id, manifest] of casos) {
      writePlugin(id, code);
      writeManifest(id, manifest);
    }

    const res = await runBeforeToolHooks(root, 'fs.read', {});

    expect(fs.existsSync(ejecutado)).toBe(false);
    expect(res.errors.map((e) => e.plugin).sort()).toEqual([
      'json-roto',
      'permiso-raro',
      'sin-permisos',
      'sin-version',
    ]);
    for (const error of res.errors) expect(error.hook).toBe('manifest');
    expect(res.errors.find((e) => e.plugin === 'sin-version')?.error).toMatch(/apiVersion/);
    expect(res.errors.find((e) => e.plugin === 'json-roto')?.error).toMatch(/JSON/);
    expect(res.errors.find((e) => e.plugin === 'permiso-raro')?.error).toMatch(/permiso desconocido/);
  });

  it('no despacha un hook cuyo permiso no está declarado', async () => {
    writePlugin(
      'solo-sesion',
      'export default { beforeTool: () => ({ input: { tocado: true } }), sessionStart: () => undefined };',
    );
    writeManifest('solo-sesion', { apiVersion: 1, permissions: ['lifecycle'] });

    const tool = await runBeforeToolHooks(root, 'fs.read', { path: 'x.txt' });
    expect(tool.input).toEqual({ path: 'x.txt' });
    expect(tool.ran).toEqual([]);
    expect(tool.errors).toContainEqual(
      expect.objectContaining({ plugin: 'solo-sesion', hook: 'beforeTool' }),
    );
    expect(tool.errors.find((e) => e.hook === 'beforeTool')?.error).toMatch(/permiso "tools"/);

    const start = await runSessionStartHooks(root, {
      sessionId: 'sess_test',
      root,
      goal: 'probar permisos',
      model: 'gemini-2.5-flash',
    });
    expect(start.ran).toEqual(['solo-sesion']);
  });

  it('recarga cuando cambia plugin.json', async () => {
    writePlugin('cambia-manifiesto', 'export default { beforeTool: () => ({ input: { ok: true } }) };');
    const file = writeManifest('cambia-manifiesto', { apiVersion: 1, permissions: ['lifecycle'] });

    const bloqueado = await runBeforeToolHooks(root, 'fs.read', {});
    expect(bloqueado.ran).toEqual([]);

    writeManifest('cambia-manifiesto', { apiVersion: 1, permissions: ['tools'] });
    // Dos escrituras en el mismo milisegundo no invalidarían la caché.
    const futuro = new Date(Date.now() + 5000);
    fs.utimesSync(file, futuro, futuro);

    const permitido = await runBeforeToolHooks(root, 'fs.read', {});
    expect(permitido.input).toEqual({ ok: true });
    expect(permitido.ran).toEqual(['cambia-manifiesto']);
  });
});
