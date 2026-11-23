import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';
import { projectSlug } from '../publisher.js';
import { releaseEnvFile } from '../deploy/backend/releaseEnv.js';

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

test('migrate aplica migraciones idempotentes y responde sólo con ids', async () => {
  await srv.request('POST', '/api/backend/manage/provision', {
    projectId: projectB,
    bindings: ['database'],
  });
  const migrations = [
    { id: '001_init', sql: 'create table if not exists notes (id text primary key);' },
    { id: '002_indexes', sql: 'create index if not exists notes_id on notes (id);' },
  ];

  const first = await srv.request('POST', '/api/backend/manage/migrate', {
    projectId: projectB,
    migrations,
  });
  assert.equal(first.status, 200, first.raw);
  assert.deepEqual(first.body.result, {
    applied: ['001_init', '002_indexes'],
    skipped: [],
    failed: [],
  });
  // El SQL no vuelve por HTTP: sólo los ids aplicados.
  assert.doesNotMatch(first.raw, /create table|create index/);

  const second = await srv.request('POST', '/api/backend/manage/migrate', {
    projectId: projectB,
    migrations,
  });
  assert.equal(second.status, 200, second.raw);
  assert.deepEqual(second.body.result, {
    applied: [],
    skipped: ['001_init', '002_indexes'],
    failed: [],
  });

  const bad = await srv.request('POST', '/api/backend/manage/migrate', {
    projectId: projectB,
    migrations: [{ id: '003', sql: '   ' }],
  });
  assert.equal(bad.status, 400, bad.raw);
  assert.match(String(bad.body.error), /no tiene SQL/);
});

test('rotate entrega el valor al sink y la respuesta sólo lleva nombres', async () => {
  const res = await srv.request('POST', '/api/backend/manage/rotate', { projectId: projectA });

  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.rotation.rotated, [
    'DATABASE_URL',
    'STORAGE_SECRET',
    'AUTH_SECRET',
  ]);
  // El valor rotado va al sink del adaptador, nunca al cliente.
  assert.doesNotMatch(res.raw, /valor-/);
  assert.doesNotMatch(res.raw, /fake-(database|storage|auth)-/);
  assert.doesNotMatch(res.raw, /DATABASE_URL=/);

  const after = await statusOf(projectA);
  assert.deepEqual(after.body.status.secretNames, [
    'DATABASE_URL',
    'STORAGE_SECRET',
    'AUTH_SECRET',
  ]);
  assert.doesNotMatch(after.raw, /fake-(database|storage|auth)-/);

  const one = await srv.request('POST', '/api/backend/manage/rotate', {
    projectId: projectA,
    kinds: ['database'],
  });
  assert.equal(one.status, 200, one.raw);
  assert.deepEqual(one.body.rotation.rotated, ['DATABASE_URL']);

  const unknown = await srv.request('POST', '/api/backend/manage/rotate', {
    projectId: projectA,
    kinds: ['realtime'],
  });
  assert.equal(unknown.status, 400, unknown.raw);
  assert.match(String(unknown.body.error), /Binding desconocido/);

  const noBindings = await srv.request('POST', '/api/backend/manage/rotate', {
    projectId: `app-pl3-vacio-${run}`,
  });
  assert.equal(noBindings.status, 400, noBindings.raw);
  assert.match(String(noBindings.body.error), /no tiene un backend aprovisionado/);
});

test('publicar inyecta las credenciales rotadas en el entorno de la release', async () => {
  const tmpBase = path.join(process.cwd(), 'tests', 'tmp');
  fs.mkdirSync(tmpBase, { recursive: true });
  const app = fs.mkdtempSync(path.join(tmpBase, 'pl3-publish-'));

  try {
    fs.mkdirSync(path.join(app, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(app, 'dist', 'index.html'),
      '<!doctype html><html><body><h1>app con backend</h1></body></html>',
      'utf8'
    );

    // El id que usa el panel es el slug de publicación del proyecto.
    const slug = projectSlug(app);
    const provisioned = await srv.request('POST', '/api/backend/manage/provision', {
      projectId: slug,
      bindings: ['database', 'auth'],
    });
    assert.equal(provisioned.status, 200, provisioned.raw);
    const rotated = await srv.request('POST', '/api/backend/manage/rotate', {
      projectId: slug,
    });
    assert.equal(rotated.status, 200, rotated.raw);

    const published = await srv.request('POST', '/api/publish/preview', {
      root: app,
      outputDir: 'dist',
      build: false,
    });
    assert.equal(published.status, 200, published.raw);
    const preview = published.body.status.preview;
    assert.ok(preview, 'preview debe apuntar a la release publicada');
    // La respuesta de publicación no transporta credenciales.
    assert.doesNotMatch(published.raw, /fake-(database|auth)-/);

    // El entorno de la release sí las tiene, listas para el runner de la app.
    const envFile = releaseEnvFile(srv.publishDir, slug, preview.id, 'preview');
    assert.ok(fs.existsSync(envFile), `la release no recibió su entorno: ${envFile}`);
    const env = JSON.parse(fs.readFileSync(envFile, 'utf8'));
    assert.deepEqual(Object.keys(env.vars).sort(), ['AUTH_SECRET', 'DATABASE_URL']);
    for (const value of Object.values(env.vars)) {
      assert.match(String(value), /^fake-(database|auth)-/);
    }

    // Servido por HTTP no se filtra: ni en el HTML ni pedido como archivo.
    const served = await srv.request('GET', preview.url);
    assert.equal(served.status, 200, served.raw);
    assert.match(served.raw, /app con backend/);
    assert.doesNotMatch(served.raw, /fake-(database|auth)-/);
    const leak = await srv.request('GET', `${preview.url}env/preview-${preview.id}.json`);
    assert.equal(leak.status, 404, leak.raw);

    // Producción recibe su propio entorno; no hereda el archivo de preview.
    const promoted = await srv.request('POST', '/api/publish/production', {
      root: app,
      releaseId: preview.id,
    });
    assert.equal(promoted.status, 200, promoted.raw);
    assert.doesNotMatch(promoted.raw, /fake-(database|auth)-/);
    assert.ok(fs.existsSync(releaseEnvFile(srv.publishDir, slug, preview.id, 'production')));

    // El estado de publicación tampoco devuelve valores.
    const status = await srv.request(
      'GET',
      `/api/publish/status?root=${encodeURIComponent(app)}`
    );
    assert.equal(status.status, 200, status.raw);
    assert.doesNotMatch(status.raw, /fake-(database|auth)-/);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
  }
});

test('un estado de publicación corrupto no filtra su contenido por /api/publish', async () => {
  const tmpBase = path.join(process.cwd(), 'tests', 'tmp');
  fs.mkdirSync(tmpBase, { recursive: true });
  const app = fs.mkdtempSync(path.join(tmpBase, 'pl3-publish-corrupt-'));
  const fragment = 'credencial-dentro-del-estado';

  try {
    fs.mkdirSync(path.join(app, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(app, 'dist', 'index.html'),
      '<!doctype html><html><body>app</body></html>',
      'utf8'
    );
    const stateFile = path.join(srv.publishDir, projectSlug(app), 'state.json');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    // JSON roto con el fragmento dentro: el mensaje del parser lo repetiría.
    fs.writeFileSync(stateFile, `{"root":"${fragment}",`, 'utf8');

    const status = await srv.request(
      'GET',
      `/api/publish/status?root=${encodeURIComponent(app)}`
    );
    assert.equal(status.status, 400, status.raw);
    assert.equal(status.body.error, 'El estado de publicación está corrupto');
    assert.doesNotMatch(status.raw, new RegExp(fragment));

    const preview = await srv.request('POST', '/api/publish/preview', {
      root: app,
      outputDir: 'dist',
      build: false,
    });
    assert.equal(preview.status, 400, preview.raw);
    assert.equal(preview.body.error, 'El estado de publicación está corrupto');
    assert.doesNotMatch(preview.raw, new RegExp(fragment));
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
  }
});

test('la ruta de gestión no tapa al backend multiinquilino de /api/backend', async () => {
  const manage = await srv.request('GET', '/api/backend/manage/rotate');
  assert.equal(manage.status, 404, manage.raw);
  assert.match(String(manage.body.error), /Ruta de backend gestionado no encontrada/);

  const tenant = await srv.request('GET', '/api/backend/no-existe');
  assert.equal(tenant.status, 404, tenant.raw);
  assert.match(String(tenant.body.error), /Ruta no encontrada/);
});
