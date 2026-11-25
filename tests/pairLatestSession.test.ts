/**
 * `commander pair` sin `--session` contra un server real (F3).
 *
 * El server se levanta vacío: ninguna sesión creada por HTTP, así que su
 * registro en memoria no tiene nada. Las sesiones que sí existen están en el
 * store persistido, como tras reiniciar el proceso. Antes de arreglarlo, la
 * emisión miraba sólo la memoria y respondía 409 con sesiones en disco.
 *
 * No usa el server compartido porque los otros archivos crean sesiones en él y
 * este caso necesita un registro en memoria vacío de verdad.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnServer, type ServerHarness } from './helpers/serverHarness.js';
import { createSessionStore } from '../src/agent/sessionStore.js';
import { createSessionState } from '../src/agent/sessionTypes.js';

let srv: ServerHarness;
let olderId: string;
let newerId: string;

before(async () => {
  srv = await spawnServer();
  // El arnés ya le dio al server su `COMMANDER_AGENT_SESSIONS_DIR` temporal;
  // las sesiones se escriben ahí, sin pasar por HTTP.
  const dir = path.join(path.dirname(srv.dbPath), 'agent-sessions');
  assert.equal(fs.existsSync(path.dirname(srv.dbPath)), true, 'el arnés no anunció su directorio');

  const older = createSessionState({
    id: 'sess_pair_store_older',
    goal: 'Sesión vieja sólo en disco (F3)',
    cwd: process.cwd(),
  });
  older.updatedAt = Date.now() - 120_000;
  const newer = createSessionState({
    id: 'sess_pair_store_newer',
    goal: 'Sesión más reciente sólo en disco (F3)',
    cwd: process.cwd(),
  });
  newer.updatedAt = Date.now() - 60_000;

  const store = createSessionStore(dir);
  store.save(older);
  store.save(newer);
  olderId = older.id;
  newerId = newer.id;
});

after(async () => {
  await srv?.stop();
});

describe('POST /api/pair/issue sin --session', () => {
  test('elige la sesión más reciente del store persistido aunque no haya nada en memoria', async () => {
    // El proceso no creó ninguna sesión: si la lista de memoria estuviera vacía
    // y se mirara sólo ella, esto sería 409.
    const listed = await srv.request('GET', '/api/agent/sessions');
    assert.equal(listed.status, 200, listed.raw);

    const issued = await srv.request('POST', '/api/pair/issue', {});
    assert.equal(issued.status, 200, issued.raw);
    assert.equal(issued.body.success, true, issued.raw);
    assert.equal(issued.body.sessionId, newerId);
    assert.notEqual(issued.body.sessionId, olderId);
    assert.match(String(issued.body.token), /^[A-Za-z0-9_-]{43}$/);

    // Y el canje devuelve esa misma sesión, cargada de disco.
    const redeemed = await srv.request(
      'POST',
      '/api/pair/redeem',
      { token: issued.body.token },
      { headers: { Origin: srv.baseUrl } }
    );
    assert.equal(redeemed.status, 200, redeemed.raw);
    assert.equal(redeemed.body.session.id, newerId);
    assert.equal(redeemed.body.session.goal, 'Sesión más reciente sólo en disco (F3)');
  });
});
