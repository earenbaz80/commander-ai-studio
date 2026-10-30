/**
 * Endpoints HTTP contra el server real, en un puerto efímero.
 *
 * Cubre los contratos que hasta ahora sólo se probaban a mano con curl:
 *   • `POST /api/threads` exige id (antes nacía un hilo llamado `"undefined"`);
 *   • `POST /api/queue/:threadId` responde 404 si el hilo no existe (antes un
 *     400 con el texto crudo `FOREIGN KEY constraint failed`);
 *   • las rutas autónomas validan su cuerpo antes de gastar una llamada al
 *     LLM: sin `goal` (plan) o sin `parentSessionId` (run) son 400.
 *
 * Los dos últimos casos se paran en la validación a propósito: pasar de ahí
 * significa hablar con el modelo de verdad, y eso no puede vivir en la suite.
 *
 * La gracia del arnés es que ejercita las rutas reales de `server.ts`, no una
 * copia del handler: si alguien vuelve a quitar el guard, esto se pone rojo.
 *
 * Con `npm run test:node` el server es UNO para toda la suite y lo arranca
 * `scripts/test-node.ts` la primera vez que un archivo lo pide (este, vía el
 * canal de control del arnés); con `tsx --test tests/serverEndpoints.test.ts`
 * este archivo arranca el suyo. Los ids son únicos por corrida porque en modo
 * compartido la base también es compartida entre archivos.
 *
 * Las peticiones van por `srv.request`, no por `fetch`: ver el porqué del
 * keep-alive en `tests/helpers/serverHarness.ts`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;

before(async () => { srv = await startServer(); });
after(async () => { await srv?.stop(); });

const uniqueId = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test('la base del arnés es temporal: los tests no tocan la del proyecto', () => {
  assert.ok(srv.dbPath, 'el arnés debe declarar la base que está usando');
  assert.ok(
    srv.dbPath.startsWith(os.tmpdir()),
    `la base debe vivir en el temporal, no en el proyecto: ${srv.dbPath}`
  );
  assert.notEqual(path.resolve(srv.dbPath), path.resolve('.commander', 'studio.db'));
});

test('POST /api/threads sin id responde 400 y no crea un hilo "undefined"', async () => {
  const res = await srv.request('POST', '/api/threads', { title: 'sin id' });

  assert.equal(res.status, 400, `se esperaba 400, llegó ${res.status}: ${res.raw}`);
  assert.equal(res.body.success, false);
  assert.match(String(res.body.error), /id de hilo requerido/);

  const all = await srv.request('GET', '/api/threads');
  assert.equal(all.status, 200);
  assert.equal(
    (all.body.threads as any[]).some((t) => t.id === 'undefined'),
    false,
    'ninguna petición sin id debe dejar un hilo con ese nombre'
  );
});

test('un hilo se crea, encola y se borra con su cola en cascada', async () => {
  const id = uniqueId('http-th');

  const created = await srv.request('POST', '/api/threads', { id, title: 'hilo de prueba' });
  assert.equal(created.status, 200, created.raw);
  assert.equal(created.body.thread.id, id);
  assert.equal(created.body.thread.title, 'hilo de prueba');

  const queued = await srv.request('POST', `/api/queue/${id}`, { prompt: 'tarea válida', label: 'ok' });
  assert.equal(queued.status, 200, queued.raw);
  assert.equal(queued.body.item.state, 'pending', 'lo encolado nace pendiente');
  assert.equal(queued.body.item.thread_id, id);

  const list = await srv.request('GET', `/api/queue/${id}`);
  assert.equal(list.body.items.length, 1);

  const removed = await srv.request('DELETE', `/api/threads/${id}`);
  assert.equal(removed.status, 200);

  const after = await srv.request('GET', `/api/queue/${id}`);
  assert.equal(after.body.items.length, 0, 'borrar el hilo se lleva su cola');
});

test('POST /api/autonomous/:threadId/plan sin goal responde 400 sin llamar al modelo', async () => {
  const thread = uniqueId('http-auto-plan');
  const res = await srv.request('POST', `/api/autonomous/${thread}/plan`, { parentSessionId: 'sess-x' });

  assert.equal(res.status, 400, `se esperaba 400, llegó ${res.status}: ${res.raw}`);
  assert.equal(res.body.success, false);
  assert.match(String(res.body.error), /goal requerido/);

  // Un goal de sólo espacios pasa el `if (!goal)` de un string crudo, pero el
  // `trim()` del handler lo deja vacío: mismo 400, sin plan ni tareas.
  const blank = await srv.request('POST', `/api/autonomous/${thread}/plan`, { goal: '   ' });
  assert.equal(blank.status, 400, `un goal en blanco también es 400, llegó ${blank.status}: ${blank.raw}`);
  assert.match(String(blank.body.error), /goal requerido/);

  const queue = await srv.request('GET', `/api/queue/${thread}`);
  assert.equal(queue.body.items.length, 0, 'un rechazo no debe encolar nada');
});

test('POST /api/autonomous/:threadId/run sin parentSessionId responde 400', async () => {
  const thread = uniqueId('http-auto-run');
  const res = await srv.request('POST', `/api/autonomous/${thread}/run`, { goal: 'objetivo' });

  assert.equal(res.status, 400, `se esperaba 400, llegó ${res.status}: ${res.raw}`);
  assert.equal(res.body.success, false);
  assert.match(String(res.body.error), /parentSessionId requerido/);
  // Si el guard faltara, la ruta respondería 200 `started: true` y la campaña
  // correría en segundo plano sin sesión padre: el test no vería el fallo.
  assert.equal(res.body.started, undefined, 'no debe haberse lanzado una campaña');
});

test('POST /api/queue de un hilo inexistente responde 404, no un FOREIGN KEY', async () => {
  const ghost = uniqueId('http-fantasma');
  const res = await srv.request('POST', `/api/queue/${ghost}`, { prompt: 'tarea huérfana' });

  assert.equal(res.status, 404, `se esperaba 404, llegó ${res.status}: ${res.raw}`);
  assert.equal(res.body.success, false);
  assert.match(String(res.body.error), /hilo no encontrado/);
  assert.doesNotMatch(String(res.body.error), /FOREIGN KEY/i);

  const list = await srv.request('GET', `/api/queue/${ghost}`);
  assert.equal(list.body.items.length, 0, 'no debe quedar nada encolado');
});
