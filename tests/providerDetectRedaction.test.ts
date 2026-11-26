/**
 * `/api/providers/detect` devuelve el mensaje del fallo de `fetch`, y `fetch`
 * repite la URL completa cuando la rechaza. Un `baseUrl` con credenciales
 * (`https://usuario:clave@host`) llegaba al cliente con la clave dentro.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/serverHarness.js';

const PASSWORD = 'clave-de-host-9d3f';

test('/api/providers/detect no repite la credencial del baseUrl', async () => {
  const srv = await startServer();
  try {
    const res = await srv.request('POST', '/api/providers/detect', {
      baseUrl: `http://usuario:${PASSWORD}@127.0.0.1:9/v1`,
    });

    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body.status, 'unreachable');
    // El diagnóstico sigue: se ve a qué host se intentó conectar.
    assert.match(String(res.body.error), /127\.0\.0\.1:9/);
    assert.match(String(res.body.error), /\[redactado\]/);
    assert.ok(!res.raw.includes(PASSWORD), 'la clave no debe viajar en la respuesta');
  } finally {
    await srv.stop();
  }
});
