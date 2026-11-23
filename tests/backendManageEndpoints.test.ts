import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

/**
 * Endpoints de gestión del backend de apps publicadas (PL3).
 *
 * El arnés enciende el doble en memoria con `COMMANDER_BACKEND_FAKE=1`, así que
 * aquí se prueba el contrato por HTTP: aprovisionar, consultar y aislar. No hay
 * proveedor elegido ni credenciales: la ruta no puede devolver un secreto.
 *
 * Los ids de proyecto son únicos por corrida porque el servidor es compartido
 * entre archivos de la suite y el doble guarda estado en memoria.
 */

let srv: ServerHarness;
const run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const projectA = `app-pl3-a-${run}`;
const projectB = `app-pl3-b-${run}`;

before(async () => {
  srv = await startServer();
});

after(async () => {
  await srv?.stop();
});

function statusOf(projectId: string) {
  return srv.request(
    'GET',
    `/api/backend/manage/status?projectId=${encodeURIComponent(projectId)}`
  );
}

test('status de un proyecto sin aprovisionar responde vacío y sin secretos', async () => {
  const res = await statusOf(projectA);

  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.success, true);
  assert.equal(res.body.provider, 'fake');
  assert.equal(res.body.configured, true);
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.status.projectId, projectA);
  assert.equal(res.body.status.ready, false);
  assert.deepEqual(res.body.status.bindings, []);
  assert.deepEqual(res.body.status.secretNames, []);
  assert.deepEqual(res.body.status.migrations, { applied: [], pending: [] });
  assert.doesNotMatch(res.raw, /valor-|DATABASE_URL|STORAGE_SECRET|AUTH_SECRET/);
});

test('provision aprovisiona los bindings y deja el backend listo', async () => {
  const res = await srv.request('POST', '/api/backend/manage/provision', {
    projectId: projectA,
    bindings: ['database', 'storage'],
  });

  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.success, true);
  assert.equal(res.body.provider, 'fake');
  assert.equal(res.body.status.ready, true);
  assert.deepEqual(
    res.body.status.bindings.map((binding: { kind: string }) => binding.kind),
    ['database', 'storage']
  );
  const ids = res.body.status.bindings.map((binding: { resourceId: string }) => binding.resourceId);
  assert.equal(new Set(ids).size, 2);
  assert.deepEqual(res.body.status.secretNames, []);
  // Ninguna credencial viaja por la respuesta: sólo nombres de bindings.
  assert.doesNotMatch(res.raw, /valor-|DATABASE_URL|STORAGE_SECRET|AUTH_SECRET/);
});

test('repetir el aprovisionamiento no duplica recursos', async () => {
  const before = await statusOf(projectA);
  const databaseId = before.body.status.bindings.find(
    (binding: { kind: string }) => binding.kind === 'database'
  ).resourceId;

  const res = await srv.request('POST', '/api/backend/manage/provision', {
    projectId: projectA,
    bindings: ['database', 'auth'],
  });

  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.status.bindings.length, 3);
  assert.equal(
    res.body.status.bindings.find((binding: { kind: string }) => binding.kind === 'database')
      .resourceId,
    databaseId
  );
});

test('rechaza un binding desconocido y un proyecto sin id', async () => {
  const unknown = await srv.request('POST', '/api/backend/manage/provision', {
    projectId: projectA,
    bindings: ['realtime'],
  });
  assert.equal(unknown.status, 400, unknown.raw);
  assert.equal(unknown.body.success, false);
  assert.match(String(unknown.body.error), /Binding desconocido/);

  const noId = await srv.request('POST', '/api/backend/manage/provision', {
    projectId: '   ',
    bindings: ['database'],
  });
  assert.equal(noId.status, 400, noId.raw);
  assert.match(String(noId.body.error), /no tiene id/);

  const emptyQuery = await srv.request('GET', '/api/backend/manage/status');
  assert.equal(emptyQuery.status, 400, emptyQuery.raw);
  assert.match(String(emptyQuery.body.error), /no tiene id/);
});

test('aísla bindings y estado entre dos proyectos', async () => {
  const provisioned = await srv.request('POST', '/api/backend/manage/provision', {
    projectId: projectB,
    bindings: ['auth'],
  });
  assert.equal(provisioned.status, 200, provisioned.raw);

  const a = await statusOf(projectA);
  const b = await statusOf(projectB);

  assert.deepEqual(
    a.body.status.bindings.map((binding: { kind: string }) => binding.kind),
    ['database', 'storage', 'auth']
  );
  assert.deepEqual(
    b.body.status.bindings.map((binding: { kind: string }) => binding.kind),
    ['auth']
  );
  assert.notEqual(
    a.body.status.bindings.find((binding: { kind: string }) => binding.kind === 'auth').resourceId,
    b.body.status.bindings[0].resourceId
  );
});

test('la ruta de gestión no tapa al backend multiinquilino de /api/backend', async () => {
  const manage = await srv.request('GET', '/api/backend/manage/rotate');
  assert.equal(manage.status, 404, manage.raw);
  assert.match(String(manage.body.error), /Ruta de backend gestionado no encontrada/);

  const tenant = await srv.request('GET', '/api/backend/no-existe');
  assert.equal(tenant.status, 404, tenant.raw);
  assert.match(String(tenant.body.error), /Ruta no encontrada/);
});
