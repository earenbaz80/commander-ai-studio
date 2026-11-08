/**
 * Backend multiinquilino contra el server real.
 *
 * Cubre el contrato que importa para el aislamiento: sin bearer no se entra,
 * dos cuentas no ven ni tocan registros/archivos ajenos, el `tenant_id` que
 * mande el cliente se ignora y las sesiones se pueden cerrar.
 *
 * El server es el compartido del arnés (`npm run test:node`); la base y el
 * storage son temporales, así que estos datos no tocan `.commander`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;
let alice: any;
let bob: any;

function freshEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

function auth(token: string): { headers: Record<string, string> } {
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function register(label: string) {
  const email = freshEmail(label);
  const res = await srv.request('POST', '/api/backend/auth/register', {
    email,
    password: 'correct-horse-battery',
    name: label,
    tenantName: `${label} tenant`,
  });
  assert.equal(res.status, 201, res.raw);
  assert.equal(res.body?.success, true);
  assert.equal(res.body?.user?.email, email);
  assert.ok(res.body?.token, 'el registro debe devolver una sesión');
  return res.body;
}

before(async () => {
  srv = await startServer();
  alice = await register('alice');
  bob = await register('bob');
});

after(async () => { await srv?.stop(); });

test('sin bearer, el backend de datos responde 401 y no filtra recursos', async () => {
  for (const path of [
    '/api/backend/auth/me',
    '/api/backend/records',
    '/api/backend/files',
  ]) {
    const res = await srv.request('GET', path);
    assert.equal(res.status, 401, `${path}: ${res.raw}`);
    assert.equal(res.body?.success, false);
  }

  const created = await srv.request('POST', '/api/backend/records', { title: 'sin sesión' });
  assert.equal(created.status, 401, created.raw);

  const invalid = await srv.request('GET', '/api/backend/records', undefined, {
    headers: { Authorization: 'Bearer token-que-no-existe' },
  });
  assert.equal(invalid.status, 401, invalid.raw);
});

test('registro, duplicado, login y logout gestionan la sesión', async () => {
  const email = freshEmail('carol');
  const registered = await srv.request('POST', '/api/backend/auth/register', {
    email,
    password: 'correct-horse-battery',
    name: 'Carol',
    tenantName: 'Carol tenant',
  });
  assert.equal(registered.status, 201, registered.raw);

  const duplicate = await srv.request('POST', '/api/backend/auth/register', {
    email: email.toUpperCase(),
    password: 'correct-horse-battery',
    name: 'Carol bis',
    tenantName: 'Carol bis tenant',
  });
  assert.equal(duplicate.status, 409, duplicate.raw);
  assert.equal(duplicate.body?.success, false);

  const shortPassword = await srv.request('POST', '/api/backend/auth/register', {
    email: freshEmail('short'),
    password: 'corta',
    name: 'Short',
  });
  assert.equal(shortPassword.status, 400, shortPassword.raw);

  const wrong = await srv.request('POST', '/api/backend/auth/login', {
    email,
    password: 'no-es-la-contraseña',
  });
  assert.equal(wrong.status, 401, wrong.raw);

  const login = await srv.request('POST', '/api/backend/auth/login', {
    email: email.toUpperCase(),
    password: 'correct-horse-battery',
  });
  assert.equal(login.status, 200, login.raw);
  assert.ok(login.body?.token);
  assert.equal(login.body?.user?.email, email);

  const me = await srv.request('GET', '/api/backend/auth/me', undefined, auth(login.body.token));
  assert.equal(me.status, 200, me.raw);
  assert.equal(me.body?.user?.email, email);
  assert.equal(me.body?.tenant?.name, 'Carol tenant');

  const out = await srv.request('POST', '/api/backend/auth/logout', undefined, auth(login.body.token));
  assert.equal(out.status, 200, out.raw);

  const afterLogout = await srv.request('GET', '/api/backend/auth/me', undefined, auth(login.body.token));
  assert.equal(afterLogout.status, 401, afterLogout.raw);
});

test('los registros están filtrados por inquilino y el tenantId del cliente se ignora', async () => {
  const created = await srv.request('POST', '/api/backend/records', {
    title: 'nota privada de Alice',
    body: 'sólo Alice debe verla',
    // Basura deliberada: el servidor debe usar el tenant de la sesión.
    tenantId: bob.tenant.id,
  }, auth(alice.token));
  assert.equal(created.status, 201, created.raw);
  assert.ok(created.body?.record?.id);
  assert.equal(created.body.record.title, 'nota privada de Alice');
  assert.equal('tenantId' in created.body.record, false, 'el tenant no se expone en el recurso');

  const id = created.body.record.id;

  const aliceList = await srv.request('GET', '/api/backend/records', undefined, auth(alice.token));
  assert.equal(aliceList.status, 200, aliceList.raw);
  assert.equal(aliceList.body.records.some((r: any) => r.id === id), true);

  const bobList = await srv.request('GET', '/api/backend/records', undefined, auth(bob.token));
  assert.equal(bobList.status, 200, bobList.raw);
  assert.equal(bobList.body.records.some((r: any) => r.id === id), false);

  const bobRead = await srv.request('GET', `/api/backend/records/${id}`, undefined, auth(bob.token));
  assert.equal(bobRead.status, 403, bobRead.raw);
  assert.doesNotMatch(bobRead.raw, /sólo Alice/);

  const bobPatch = await srv.request('PATCH', `/api/backend/records/${id}`, {
    title: 'secuestrada',
  }, auth(bob.token));
  assert.equal(bobPatch.status, 403, bobPatch.raw);

  const bobDelete = await srv.request('DELETE', `/api/backend/records/${id}`, undefined, auth(bob.token));
  assert.equal(bobDelete.status, 403, bobDelete.raw);

  const owned = await srv.request('GET', `/api/backend/records/${id}`, undefined, auth(alice.token));
  assert.equal(owned.status, 200, owned.raw);
  assert.equal(owned.body.record.title, 'nota privada de Alice');

  const patched = await srv.request('PATCH', `/api/backend/records/${id}`, {
    title: 'nota actualizada',
    body: 'sigue siendo de Alice',
  }, auth(alice.token));
  assert.equal(patched.status, 200, patched.raw);
  assert.equal(patched.body.record.title, 'nota actualizada');

  const deleted = await srv.request('DELETE', `/api/backend/records/${id}`, undefined, auth(alice.token));
  assert.equal(deleted.status, 204, deleted.raw);

  const gone = await srv.request('GET', `/api/backend/records/${id}`, undefined, auth(alice.token));
  assert.equal(gone.status, 404, gone.raw);

  const bobGone = await srv.request('GET', `/api/backend/records/${id}`, undefined, auth(bob.token));
  assert.equal(bobGone.status, 404, bobGone.raw);
});

test('los archivos se guardan por id y sólo los ve su inquilino', async () => {
  const content = Buffer.from('contenido privado de Alice\n', 'utf8');
  const uploaded = await srv.request('POST', '/api/backend/files', undefined, {
    headers: {
      ...auth(alice.token).headers,
      'Content-Type': 'application/octet-stream',
      // El nombre original es sólo metadato: no debe escapar del storage.
      'X-Commander-File-Name': '../../plan.txt',
    },
    rawBody: content,
  });
  assert.equal(uploaded.status, 201, uploaded.raw);
  assert.ok(uploaded.body?.file?.id);
  assert.equal(uploaded.body.file.name, 'plan.txt');
  assert.equal(uploaded.body.file.size, content.byteLength);

  const id = uploaded.body.file.id;

  const read = await srv.request('GET', `/api/backend/files/${id}`, undefined, auth(alice.token));
  assert.equal(read.status, 200, read.raw);
  assert.equal(read.raw, content.toString('utf8'));

  const bobList = await srv.request('GET', '/api/backend/files', undefined, auth(bob.token));
  assert.equal(bobList.status, 200, bobList.raw);
  assert.equal(bobList.body.files.some((f: any) => f.id === id), false);

  const bobRead = await srv.request('GET', `/api/backend/files/${id}`, undefined, auth(bob.token));
  assert.equal(bobRead.status, 403, bobRead.raw);
  assert.doesNotMatch(bobRead.raw, /contenido privado/);

  const bobDelete = await srv.request('DELETE', `/api/backend/files/${id}`, undefined, auth(bob.token));
  assert.equal(bobDelete.status, 403, bobDelete.raw);

  const stillThere = await srv.request('GET', `/api/backend/files/${id}`, undefined, auth(alice.token));
  assert.equal(stillThere.status, 200, stillThere.raw);

  const deleted = await srv.request('DELETE', `/api/backend/files/${id}`, undefined, auth(alice.token));
  assert.equal(deleted.status, 204, deleted.raw);

  const gone = await srv.request('GET', `/api/backend/files/${id}`, undefined, auth(alice.token));
  assert.equal(gone.status, 404, gone.raw);
});

test('un archivo vacío no crea metadatos y los archivos inexistentes son 404', async () => {
  const empty = await srv.request('POST', '/api/backend/files', undefined, {
    headers: {
      ...auth(alice.token).headers,
      'Content-Type': 'application/octet-stream',
      'X-Commander-File-Name': 'vacio.bin',
    },
    rawBody: Buffer.alloc(0),
  });
  assert.equal(empty.status, 400, empty.raw);
  assert.equal(empty.body?.success, false);

  // El parser raw no ve un cuerpo sin longitud: tampoco debe inventar un archivo.
  const noBody = await srv.request('POST', '/api/backend/files', undefined, {
    headers: {
      ...auth(alice.token).headers,
      'Content-Type': 'application/octet-stream',
    },
  });
  assert.equal(noBody.status, 400, noBody.raw);

  const missing = await srv.request(
    'GET',
    '/api/backend/files/00000000-0000-4000-8000-000000000000',
    undefined,
    auth(alice.token)
  );
  assert.equal(missing.status, 404, missing.raw);
});

test('una ruta desconocida del backend responde JSON 404, no la SPA', async () => {
  const res = await srv.request(
    'GET',
    '/api/backend/no-existe',
    undefined,
    auth(alice.token)
  );
  assert.equal(res.status, 404, res.raw);
  assert.equal(res.body?.success, false);
  assert.match(String(res.body?.error), /no encontrada/i);
});
