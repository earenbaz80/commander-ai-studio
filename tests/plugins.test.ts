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
