/**
 * Memoria durable de Nono: `GET`/`POST /api/nono/observations`.
 *
 * El hook `useNonoContext` ya consultaba este endpoint (diagnósticos, git,
 * terminal) para sus sugerencias contextuales, pero las rutas no existían: cada
 * refresco daba 404 y Nono se quedaba mudo sin avisar. Aquí se comprueba el
 * contrato que ese hook espera —alta, lectura por proyecto, búsqueda y límite—
 * contra el server real, no contra una copia del handler.
 *
 * La base es compartida entre archivos cuando la suite corre con
 * `npm run test:node`, así que cada caso usa su propio `projectId` y no da por
 * hecho que la tabla esté vacía.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;

before(async () => { srv = await startServer(); });
after(async () => { await srv?.stop(); });

/** Identificador de proyecto único por corrida: la base se comparte. */
const project = (prefix: string) => `/tmp/${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test('una observación se guarda y se lee de vuelta', async () => {
  const projectId = project('nono-rt');

  const saved = await srv.request('POST', '/api/nono/observations', {
    projectId,
    kind: 'diagnostics',
    content: '2 errores TS detectados',
  });
  assert.equal(saved.status, 200, saved.raw);
  assert.equal(saved.body.success, true);
  assert.equal(typeof saved.body.id, 'number', 'el POST devuelve el id insertado');

  const list = await srv.request('GET', `/api/nono/observations?projectId=${encodeURIComponent(projectId)}`);
  assert.equal(list.status, 200, list.raw);
  assert.equal(list.body.observations.length, 1);
  assert.equal(list.body.observations[0].content, '2 errores TS detectados');
  assert.equal(list.body.observations[0].kind, 'diagnostics');
  assert.equal(list.body.observations[0].project_id, projectId);
});

test('las observaciones de un proyecto no se leen desde otro', async () => {
  const mio = project('nono-mio');
  const ajeno = project('nono-ajeno');

  await srv.request('POST', '/api/nono/observations', { projectId: mio, kind: 'git', content: 'cambio en la rama' });

  const delAjeno = await srv.request('GET', `/api/nono/observations?projectId=${encodeURIComponent(ajeno)}`);
  assert.equal(delAjeno.status, 200);
  assert.equal(
    delAjeno.body.observations.length,
    0,
    'la memoria de Nono se consulta por proyecto, no en global'
  );
});

test('la búsqueda filtra por contenido y el límite recorta', async () => {
  const projectId = project('nono-buscar');

  for (const content of ['uno único', 'dos único', 'tres distinto']) {
    const res = await srv.request('POST', '/api/nono/observations', { projectId, kind: 'note', content });
    assert.equal(res.status, 200, res.raw);
  }

  const found = await srv.request('GET', `/api/nono/observations?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent('único')}`);
  assert.equal(found.status, 200, found.raw);
  assert.equal(found.body.observations.length, 2, 'q sólo trae las que contienen el texto');

  const capped = await srv.request('GET', `/api/nono/observations?projectId=${encodeURIComponent(projectId)}&limit=2`);
  assert.equal(capped.body.observations.length, 2, 'limit recorta la respuesta');
});
