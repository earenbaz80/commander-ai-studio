import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;
const root = process.cwd();

before(async () => {
  srv = await startServer();
});

after(async () => {
  await srv.stop();
});

test('browser: sin sesión no abre Chromium al consultar', async () => {
  const res = await srv.request(
    'GET',
    `/api/browser/session?root=${encodeURIComponent(root)}`,
  );
  assert.equal(res.status, 404);
  assert.equal(res.body?.success, false);
});

test('browser: rechaza una URL no navegable antes de arrancar', async () => {
  const res = await srv.request('POST', '/api/browser/session', {
    root,
    url: 'file:///etc/passwd',
  });
  assert.equal(res.status, 403);
  assert.equal(res.body?.success, false);
  assert.match(String(res.body?.error), /Esquema no permitido/);

  const status = await srv.request(
    'GET',
    `/api/browser/session?root=${encodeURIComponent(root)}`,
  );
  assert.equal(status.status, 404, 'la URL rechazada no debe dejar una sesión abierta');
});

test('browser: lista las sesiones activas para el selector', async () => {
  const res = await srv.request('GET', '/api/browser/sessions');
  assert.equal(res.status, 200);
  assert.equal(res.body?.success, true);
  assert.ok(Array.isArray(res.body?.sessions));
});

test('browser: atrás y adelante reflejan el historial real', async () => {
  const first = `${srv.baseUrl}/api/health`;
  const second = `${srv.baseUrl}/api/health?history=2`;
  const opened = await srv.request('POST', '/api/browser/session', { root, url: first });
  assert.equal(opened.status, 201);
  const id = opened.body?.session?.id;
  assert.ok(id);

  try {
    assert.equal(opened.body.session.page.canGoBack, false);
    assert.equal(opened.body.session.page.canGoForward, false);

    const navigated = await srv.request('POST', `/api/browser/session/${id}/input`, {
      action: 'navigate',
      url: second,
    });
    assert.equal(navigated.status, 200);
    assert.equal(navigated.body.session.page.canGoBack, true);
    assert.equal(navigated.body.session.page.canGoForward, false);

    const backward = await srv.request('POST', `/api/browser/session/${id}/input`, {
      action: 'back',
    });
    assert.equal(backward.status, 200);
    assert.equal(backward.body.session.page.url, first);
    assert.equal(backward.body.session.page.canGoBack, false);
    assert.equal(backward.body.session.page.canGoForward, true);

    const blocked = await srv.request('POST', `/api/browser/session/${id}/input`, {
      action: 'back',
    });
    assert.equal(blocked.status, 409);

    const forward = await srv.request('POST', `/api/browser/session/${id}/input`, {
      action: 'forward',
    });
    assert.equal(forward.status, 200);
    assert.equal(forward.body.session.page.url, second);
  } finally {
    await srv.request('DELETE', `/api/browser/session/${id}`);
  }
});

test('browser: una sesión desconocida devuelve 404/409 coherentes', async () => {
  const logs = await srv.request('GET', '/api/browser/session/b-no-existe/logs');
  assert.equal(logs.status, 404);

  const input = await srv.request('POST', '/api/browser/session/b-no-existe/input', {
    action: 'reload',
  });
  assert.equal(input.status, 409);

  const stream = await srv.request('GET', '/api/browser/session/b-no-existe/stream');
  assert.equal(stream.status, 404);

  const screenshot = await srv.request('POST', '/api/browser/session/b-no-existe/screenshot', {});
  assert.equal(screenshot.status, 404);
});

test('browser: cerrar una sesión inexistente devuelve 404', async () => {
  const res = await srv.request('DELETE', '/api/browser/session/b-no-existe');
  assert.equal(res.status, 404);
});
