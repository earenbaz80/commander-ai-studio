import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

/**
 * Rutas de integraciones contra el server real. No se conecta ni se desconecta
 * nada: `authorize` sólo construye la URL y el callback inválido no toca el
 * vault. Así el test no borra un token real si la máquina ya tiene Linear.
 */
let srv: ServerHarness;

before(async () => { srv = await startServer(); });
after(async () => { await srv?.stop(); });

test('GET /api/integrations lista Linear con callback y estado', async () => {
  const res = await srv.request('GET', '/api/integrations');
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body?.success, true);

  const linear = res.body.providers.find((p: any) => p.id === 'linear');
  assert.ok(linear, 'Linear debe estar en el catálogo de conectores');
  assert.equal(linear.label, 'Linear');
  assert.equal(typeof linear.configured, 'boolean');
  assert.equal(typeof linear.connected, 'boolean');
  assert.match(linear.redirectUri, /\/api\/integrations\/linear\/callback$/);

  const github = res.body.providers.find((p: any) => p.id === 'github');
  assert.ok(github, 'GitHub debe estar en el catálogo de conectores');
  assert.equal(github.label, 'GitHub');
  assert.equal(github.requiresClientSecret, true);
  assert.match(github.redirectUri, /\/api\/integrations\/github\/callback$/);
});

test('GET /api/integrations/github/status responde con su callback', async () => {
  const res = await srv.request('GET', '/api/integrations/github/status');
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body?.success, true);
  assert.equal(res.body?.id, 'github');
  assert.equal(typeof res.body?.configured, 'boolean');
  assert.match(res.body?.redirectUri, /\/api\/integrations\/github\/callback$/);
});

test('GET /api/integrations/:provider/status responde para Linear y 404 para desconocidos', async () => {
  const res = await srv.request('GET', '/api/integrations/linear/status');
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body?.success, true);
  assert.equal(res.body?.id, 'linear');
  assert.equal(typeof res.body?.connected, 'boolean');

  const missing = await srv.request('GET', '/api/integrations/no-existe/status');
  assert.equal(missing.status, 404);
  assert.equal(missing.body?.success, false);
});

test('POST authorize exige LINEAR_CLIENT_ID o devuelve una URL PKCE', async () => {
  const status = await srv.request('GET', '/api/integrations/linear/status');
  const res = await srv.request('POST', '/api/integrations/linear/authorize');
  if (status.body?.configured) {
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body?.success, true);
    const url = new URL(res.body.authorizeUrl);
    assert.equal(url.origin, 'https://linear.app');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.match(res.body.redirectUri, /\/api\/integrations\/linear\/callback$/);
  } else {
    assert.equal(res.status, 400, res.raw);
    assert.match(String(res.body?.error), /LINEAR_CLIENT_ID/);
  }
});

test('un callback con state inválido no crea token y devuelve HTML de error', async () => {
  const res = await srv.request('GET', '/api/integrations/linear/callback?code=abc&state=no-existe');
  assert.equal(res.status, 400);
  assert.match(res.raw, /NO SE PUDO CONECTAR/);
  assert.doesNotMatch(res.raw, /access_token/i);
});
