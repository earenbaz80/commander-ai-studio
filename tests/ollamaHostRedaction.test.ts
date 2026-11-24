/**
 * `/api/ollama/models` y `/api/ollama/health` devuelven el host como dato y, al
 * fallar, el mensaje de `fetch`, que repite la URL entera. Un `OLLAMA_HOST` con
 * credenciales (`https://usuario:clave@host`) llegaba al cliente con la clave
 * en los dos campos. El host sale redactado y el diagnóstico (host y puerto)
 * sigue visible; el cliente sólo lo pinta, nunca lo reescribe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/serverHarness.js';

const PASSWORD = 'clave-de-host-9d3f';
const HOST = `http://usuario:${PASSWORD}@127.0.0.1:9`;

test('las rutas de Ollama redactan la credencial del host', async () => {
  const srv = await startServer();
  try {
    for (const route of ['/api/ollama/models', '/api/ollama/health']) {
      const res = await srv.request('GET', `${route}?host=${encodeURIComponent(HOST)}`);

      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.host, 'http://[redactado]@127.0.0.1:9', `${route} devuelve el host redactado`);
      assert.match(String(res.body.error), /127\.0\.0\.1:9/, `${route} conserva el host del fallo`);
      assert.ok(!res.raw.includes(PASSWORD), `${route} no debe repetir la clave`);
      assert.ok(!res.raw.includes('usuario'), `${route} no debe repetir el usuario`);
    }
  } finally {
    await srv.stop();
  }
});
