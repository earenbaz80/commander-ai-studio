/**
 * Allowlist de CORS (G2 C6, §6.3 del modelo de amenazas).
 *
 * La lista por defecto son los orígenes locales de Vite; un origen ajeno no
 * recibe `Access-Control-Allow-Origin`, así que el navegador no le deja leer la
 * respuesta aunque la petición llegue.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;

before(async () => {
  srv = await startServer();
});

after(async () => {
  await srv?.stop();
});

describe('allowlist de CORS', () => {
  test('un origen de la lista recibe ACAO y Vary: Origin', async () => {
    const res = await srv.request('GET', '/api/health', undefined, {
      headers: { Origin: 'http://localhost:5173' },
    });

    assert.equal(res.status, 200, res.raw);
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.match(String(res.headers.vary || ''), /Origin/i);
  });

  test('un origen ajeno no recibe la cabecera, ni en preflight', async () => {
    const foreign = await srv.request('GET', '/api/health', undefined, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(foreign.status, 200, foreign.raw);
    assert.equal(foreign.headers['access-control-allow-origin'], undefined);

    const preflight = await srv.request('OPTIONS', '/api/health', undefined, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], undefined);
  });
});
