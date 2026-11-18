/**
 * Contratos HTTP del gestor GGUF nativo.
 *
 * No descargan nada ni arrancan llama.cpp: comprueban que las rutas existen,
 * responden JSON y validan la entrada antes de tocar disco o red. La descarga
 * real y el runtime se prueban con dobles en `tests/unit/localModelHub.test.ts`
 * y `tests/unit/localLlamaRuntime.test.ts`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;

before(async () => { srv = await startServer(); });
after(async () => { await srv?.stop(); });

test('GET /api/local-models expone biblioteca, trabajos y runtime', async () => {
  const res = await srv.request('GET', '/api/local-models');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.library));
  assert.ok(Array.isArray(res.body.downloads));
  assert.equal(typeof res.body.runtime?.state, 'string');
  assert.equal(typeof res.body.runtimeAvailable?.available, 'boolean');
});

test('GET /api/local-models/runtime informa disponibilidad sin arrancar nada', async () => {
  const res = await srv.request('GET', '/api/local-models/runtime');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(typeof res.body.state, 'string');
  assert.equal(typeof res.body.availability?.available, 'boolean');
});

test('GET /api/local-models/jobs devuelve una lista JSON', async () => {
  const res = await srv.request('GET', '/api/local-models/jobs');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.jobs));
});

test('POST /api/local-models/runtime/start sin modelo responde 404 y no arranca', async () => {
  const res = await srv.request('POST', '/api/local-models/runtime/start', { model: 'no-existe.gguf' });
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('GET /api/local-models/runtime/proposal sin modelo responde 404 y no propone nada', async () => {
  const res = await srv.request('GET', '/api/local-models/runtime/proposal?model=no-existe.gguf');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('POST /api/local-models/hub/download rechaza nombres que no son GGUF', async () => {
  const res = await srv.request('POST', '/api/local-models/hub/download', {
    repoId: 'org/modelo',
    filename: '../modelo.bin',
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});
