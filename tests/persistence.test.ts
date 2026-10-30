/**
 * Persistencia SQLite (hilos, mensajes, búsqueda y cola).
 *
 * Corre con `node:test` (`npm run test:node`). La ruta de la base se decide al
 * importar el módulo, así que el import es dinámico: primero se apunta
 * `COMMANDER_DB_PATH` a un directorio temporal y sólo después se carga. Con un
 * import estático los `?` de la migración y los triggers de FTS taparían el
 * fallo real contra la base del repo.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-persist-'));
process.env.COMMANDER_DB_PATH = path.join(dir, 'studio.db');

const p = await import('../persistence.js');

const threadId = 'th-persist';

after(() => {
  // Windows puede mantener el handle abierto; el directorio es temporal.
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('crea un hilo y lo devuelve', () => {
  const t = p.createThread({ id: threadId, title: 'hilo de prueba', projectPath: dir });
  assert.equal(t.id, threadId);
  assert.equal(p.getThread(threadId)?.title, 'hilo de prueba');
});

test('guarda un mensaje y lo lee de vuelta', () => {
  const seq = p.appendMessage({ threadId, role: 'user', parts: { text: 'hola mundo' } });

  // El INSERT dispara el trigger de FTS: si esa tabla falta, appendMessage
  // devuelve null (el catch se traga el error) y el mensaje se pierde.
  assert.equal(typeof seq, 'number', 'appendMessage debe devolver el seq, no null');
  const rows = p.loadMessages(threadId);
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].parts_json).text, 'hola mundo');
});

test('busca en el historial por contenido (FTS)', () => {
  const hits = p.searchConversations('mundo');
  assert.ok(hits.length > 0, 'la búsqueda debe encontrar el mensaje guardado');
  assert.equal(hits[0].thread_id, threadId);
  assert.match(hits[0].snippet, /<b>mundo<\/b>/, 'el snippet debe resaltar el término');
});

test('el mismo request_id no duplica el mensaje', () => {
  const antes = p.loadMessages(threadId).length;
  p.appendMessage({ threadId, requestId: 'req-1', role: 'assistant', parts: { text: 'uno' } });
  const dup = p.appendMessage({ threadId, requestId: 'req-1', role: 'assistant', parts: { text: 'uno' } });

  assert.equal(dup, null, 'el duplicado se rechaza sin lanzar');
  assert.equal(p.loadMessages(threadId).length, antes + 1);
});

test('encola y desencola respetando las columnas', () => {
  const item = p.enqueueItem({ id: 'q-uno', threadId, prompt: 'haz algo', label: 'etiqueta' });

  assert.equal(item.id, 'q-uno');
  assert.equal(item.state, 'pending');
  assert.equal(item.prompt, 'haz algo');
  assert.equal(item.label, 'etiqueta');

  const next = p.dequeueNext(threadId);
  assert.equal(next?.id, 'q-uno');
  assert.equal(next?.state, 'claimed', 'desencolar lo marca como claimed');
  assert.equal(p.dequeueNext(threadId), null, 'ya no queda nada pendiente');
});

test('borra el hilo y sus mensajes sin fallar', () => {
  // Con la tabla FTS ausente, preparar este DELETE ya lanzaba
  // «no such table: main.messages_fts» por los triggers de `messages`.
  p.deleteThread(threadId);

  assert.equal(p.getThread(threadId), null);
  assert.equal(p.loadMessages(threadId).length, 0);
});
