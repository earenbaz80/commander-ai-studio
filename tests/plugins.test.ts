/**
 * `/api/plugins` arma rutas con el `id` del manifiesto: antes se concatenaba
 * `${id}.zip` directamente bajo `.commander/plugins`, así que un id con `../`
 * escribía el manifiesto y borraba archivos fuera del directorio de plugins.
 *
 * Estos casos fijan el contrato contra el server real: el id es un nombre de
 * archivo y el fichero resuelto no puede salir de `.commander/plugins`. El root
 * es un directorio temporal para no tocar el `.commander` del repo.
 *
 * Las peticiones van por `srv.request` (ver el porqué del keep-alive en
 * `tests/helpers/serverHarness.ts`). Los ids con separador se mandan
 * percent-encoded: si el `..` viajara literal, `new URL` lo normalizaría antes
 * de llegar al server y el test no probaría nada.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';
import { executeAgentTool } from '../agentTools.js';

let srv: ServerHarness;
let root: string;

const PLUGINS_DIR = path.join('.commander', 'plugins');
const pluginsDir = () => path.join(root, PLUGINS_DIR);
const manifestDe = (id: string) => path.join(pluginsDir(), `${id}.manifest.json`);
const zipDe = (id: string) => path.join(pluginsDir(), `${id}.zip`);
const rootQuery = () => `?root=${encodeURIComponent(root)}`;

before(async () => {
  srv = await startServer();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-plugins-'));
  fs.mkdirSync(pluginsDir(), { recursive: true });
});

after(async () => {
  await srv?.stop();
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('POST /api/plugins rechaza ids que salen del directorio de plugins', async () => {
  // Con el id `../escapado` la ruta vieja quedaba en `<root>/.commander/`.
  const fuera = path.join(root, '.commander', 'escapado.manifest.json');

  for (const id of ['../escapado', '..\\escapado', 'sub/dir', 'C:\\Windows\\x', '..']) {
    const res = await srv.request('POST', '/api/plugins', { id, name: id, version: '0.1.0', root });
    assert.equal(res.status, 400, `«${id}» debía rechazarse, llegó ${res.status}: ${res.raw}`);
    assert.equal(res.body.success, false);
  }

  assert.equal(fs.existsSync(fuera), false, 'no debe escribirse nada fuera de .commander/plugins');
});

test('POST /api/plugins instala con un id válido y DELETE lo quita', async () => {
  const id = `plugin-${Date.now()}`;

  const alta = await srv.request('POST', '/api/plugins', { id, name: 'Demo', version: '0.1.0', root });
  assert.equal(alta.status, 200, alta.raw);
  assert.equal(alta.body.success, true);
  assert.equal(fs.existsSync(manifestDe(id)), true, 'el manifiesto vive dentro de .commander/plugins');

  // El zip no lo crea esta ruta; se simula para comprobar que el DELETE lo borra.
  fs.writeFileSync(zipDe(id), 'PK');

  const baja = await srv.request('DELETE', `/api/plugins/${encodeURIComponent(id)}${rootQuery()}`);
  assert.equal(baja.status, 200, baja.raw);
  assert.equal(baja.body.success, true);
  assert.equal(fs.existsSync(zipDe(id)), false, 'el zip se borra');
  assert.equal(fs.existsSync(manifestDe(id)), false, 'el manifiesto se borra');
});

test('un plugin del proyecto ve la tool antes y después de ejecutarse', async () => {
  // El runtime busca `<root>/.commander/plugins/<id>/index.js`, no el manifiesto.
  const dir = path.join(pluginsDir(), 'etiqueta');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'index.js'),
    [
      'export default {',
      '  beforeTool: (ctx) => ({ input: { ...ctx.input, ordenar: true } }),',
      '  afterTool: (ctx) => ({ result: { ...ctx.result, data: { ...ctx.result.data, desdePlugin: true } } }),',
      '};',
    ].join('\n'),
    'utf8'
  );

  const res: any = await executeAgentTool('fs.list', { root, path: '.' });

  assert.equal(res.ok, true, res.error);
  assert.equal(res.data.desdePlugin, true, 'el afterTool anota el resultado');
});

test('un plugin que lanza no rompe la tool: el error queda en data.pluginErrors', async () => {
  const dir = path.join(pluginsDir(), 'falla');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'index.js'),
    'export default { afterTool: () => { throw new Error("plugin roto"); } };',
    'utf8'
  );

  const res: any = await executeAgentTool('fs.list', { root, path: '.' });

  assert.equal(res.ok, true, res.error);
  assert.equal(res.data.pluginErrors[0].plugin, 'falla');
  assert.equal(res.data.pluginErrors[0].error, 'plugin roto');
});

test('DELETE /api/plugins/:id rechaza ids con traversal y no toca el archivo vecino', async () => {
  // `<root>/.commander/plugins/../centinela.zip` cae en `<root>/.commander/`.
  const centinela = path.join(root, '.commander', 'centinela.zip');
  fs.writeFileSync(centinela, 'PK');

  const res = await srv.request('DELETE', `/api/plugins/${encodeURIComponent('../centinela')}${rootQuery()}`);
  assert.equal(res.status, 400, `debía rechazarse, llegó ${res.status}: ${res.raw}`);
  assert.equal(res.body.success, false);
  assert.equal(fs.existsSync(centinela), true, 'el archivo fuera del directorio sigue ahí');
});

test('GET /api/plugins lista los plugins instalados desde un marketplace', async () => {
  // Los instalados por marketplace viven en `<id>.manifest.json`, no en un zip:
  // antes el listado los ignoraba y la UI nunca ofrecía desinstalarlos.
  const id = `market-${Date.now()}`;
  fs.mkdirSync(path.join(pluginsDir(), id, 'files'), { recursive: true });
  fs.writeFileSync(
    manifestDe(id),
    JSON.stringify({
      id,
      name: 'Market Demo',
      version: '1.2.3',
      marketplace: 'anthropics/claude-plugins-official',
      components: { commands: ['commit'], agents: ['helper'], skills: [], mcp: ['demo'] },
      written: [],
      files: 2,
      installedAt: new Date().toISOString(),
    }),
    'utf8'
  );

  const res = await srv.request('GET', `/api/plugins${rootQuery()}`);
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.success, true);

  const found = (res.body.plugins || []).find((plugin: any) => plugin.id === id);
  assert.ok(found, `el plugin ${id} debía aparecer en la lista`);
  assert.equal(found.name, 'Market Demo');
  assert.equal(found.version, '1.2.3');
  assert.equal(found.marketplace, 'anthropics/claude-plugins-official');
  assert.deepEqual(found.components.commands, ['commit']);
});

test('DELETE /api/plugins/:id borra las skills y agentes que copió el plugin', async () => {
  const id = `market-del-${Date.now()}`;
  const commandsDir = path.join(root, 'skills', 'commands');
  const agentsDir = path.join(root, 'skills', 'agents');
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(path.join(pluginsDir(), id, 'files'), { recursive: true });

  const propios = [
    path.join(commandsDir, 'commit.md'),
    path.join(commandsDir, `${id}-commit.md`),
    path.join(agentsDir, 'helper.md'),
  ];
  const ajeno = path.join(commandsDir, 'ajeno.md');
  for (const file of [...propios, ajeno]) fs.writeFileSync(file, 'x');

  fs.writeFileSync(
    manifestDe(id),
    JSON.stringify({
      id,
      name: id,
      components: { commands: ['commit'], agents: ['helper'], skills: [], mcp: [] },
    }),
    'utf8'
  );

  const res = await srv.request('DELETE', `/api/plugins/${encodeURIComponent(id)}${rootQuery()}`);
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.success, true);

  for (const file of propios) {
    assert.equal(fs.existsSync(file), false, `${path.basename(file)} debía borrarse`);
  }
  assert.equal(fs.existsSync(ajeno), true, 'un archivo que no era del plugin se queda');
  assert.equal(fs.existsSync(path.join(pluginsDir(), id)), false, 'la copia del plugin se borra');
  assert.equal(fs.existsSync(manifestDe(id)), false, 'el manifiesto se borra');
  assert.ok((res.body.removed || []).length >= 4, 'la respuesta detalla lo borrado');
});
