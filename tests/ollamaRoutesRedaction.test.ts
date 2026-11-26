/**
 * Las rutas de Ollama devuelven el mensaje del fallo de `fetch`, y `fetch`
 * repite la URL entera cuando la rechaza por llevar credenciales
 * (`Request cannot be constructed from a URL that includes credentials`). Un
 * host con clave en `OLLAMA_HOST` o en el cuerpo llegaba al cliente completo.
 * Se comprueba ruta por ruta que la clave no viaja y que host y puerto siguen
 * visibles para diagnosticar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/serverHarness.js';

const PASSWORD = 'clave-de-host-9d3f';
const HOST = `http://usuario:${PASSWORD}@127.0.0.1:9`;

const CASES: Array<{ route: string; method: 'GET' | 'POST'; body?: unknown }> = [
  { route: `/api/ollama/pull?host=${encodeURIComponent(HOST)}`, method: 'POST', body: { model: 'llama3.2' } },
  { route: '/api/ollama/delete', method: 'POST', body: { model: 'llama3.2', host: HOST } },
  { route: `/api/ollama/library?host=${encodeURIComponent(HOST)}`, method: 'GET' },
  { route: `/api/ollama/generate?host=${encodeURIComponent(HOST)}`, method: 'POST', body: { prompt: 'hola' } },
];

test('las rutas de Ollama redactan la credencial de la URL en el error', async () => {
  const srv = await startServer();
  try {
    for (const { route, method, body } of CASES) {
      const res = await srv.request(method, route, body);
      const nombre = route.split('?')[0];

      assert.equal(res.status, 200, `${nombre}: ${res.raw}`);
      assert.equal(res.body.ok, false, `${nombre} informa el fallo`);
      assert.ok(!res.raw.includes(PASSWORD), `${nombre} no debe repetir la clave`);
      assert.ok(!res.raw.includes('usuario'), `${nombre} no debe repetir el usuario`);
      assert.match(String(res.body.error), /\[redactado\]/, `${nombre} marca la parte tapada`);
      assert.match(String(res.body.error), /127\.0\.0\.1:9/, `${nombre} conserva el host del fallo`);
    }
  } finally {
    await srv.stop();
  }
});
