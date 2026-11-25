/**
 * `commander pair` (F3): el comando sólo pide la emisión y arma el enlace.
 *
 * Se prueba con un `fetch` inyectado: sin servidor, sin red y sin consola. Lo
 * que importa es el contrato visible al operador —enlace con el token en el
 * fragmento, sesión y minutos— y que los errores no inventen un enlace.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';
import { runPairCommand } from '../src/cli/pairCommand.js';

let srv: ServerHarness;

before(async () => {
  srv = await startServer();
});

after(async () => {
  await srv?.stop();
});

/** Crea una sesión, emite el enlace y canja un dispositivo para el CLI. */
async function pairForCli(goal: string): Promise<{ sessionId: string; deviceId: string }> {
  const created = await srv.request('POST', '/api/agent/sessions', { goal });
  assert.equal(created.status, 200, created.raw);
  const sessionId = String(created.body.session.id);

  const issued = await srv.request('POST', '/api/pair/issue', { sessionId });
  assert.equal(issued.status, 200, issued.raw);
  const redeemed = await srv.request(
    'POST',
    '/api/pair/redeem',
    { token: issued.body.token },
    { headers: { Origin: srv.baseUrl } }
  );
  assert.equal(redeemed.status, 200, redeemed.raw);
  return { sessionId, deviceId: String(redeemed.body.device.id) };
}

function collector() {
  const lines: string[] = [];
  return { lines, out: (line: string) => lines.push(line) };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('commander pair', () => {
  test('pide la emisión e imprime el enlace con el token en el fragmento', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const out = collector();
    const code = await runPairCommand({
      serverUrl: 'http://127.0.0.1:3280/',
      sessionId: 'sess_f3',
      fetchImpl: (async (url: any, init: any) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          success: true,
          token: 'tok_abc-_123',
          sessionId: 'sess_f3',
          expiresAt: Date.now() + 300_000,
          ttlMs: 300_000,
        });
      }) as typeof fetch,
      out: out.out,
      err: () => assert.fail('no debería haber error'),
    });

    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:3280/api/pair/issue');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), { sessionId: 'sess_f3' });

    const text = out.lines.join('\n');
    assert.match(text, /un solo uso/);
    assert.match(text, /caduca en 5 min/);
    assert.match(text, /http:\/\/127\.0\.0\.1:3280\/pair#pair=tok_abc-_123/);
    assert.match(text, /Sesión: sess_f3/);
    // El token no se imprime suelto ni en query.
    assert.equal(text.includes('?pair='), false);
    assert.equal(out.lines.filter((line) => line.trim() === 'tok_abc-_123').length, 0);
  });

  test('--json devuelve sólo enlace, sesión y vencimiento', async () => {
    const out = collector();
    const code = await runPairCommand({
      serverUrl: 'http://127.0.0.1:3280',
      json: true,
      fetchImpl: (async () =>
        jsonResponse({
          success: true,
          token: 'tok_json',
          sessionId: 'sess_json',
          expiresAt: 1_700_000_300_000,
          ttlMs: 300_000,
        })) as typeof fetch,
      out: out.out,
      err: () => assert.fail('sin error'),
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(out.lines.join('\n'));
    assert.deepEqual(Object.keys(parsed).sort(), ['expiresAt', 'link', 'sessionId', 'ttlMs']);
    assert.equal(parsed.link, 'http://127.0.0.1:3280/pair#pair=tok_json');
    assert.equal(JSON.stringify(parsed).includes('"token"'), false);
  });

  test('un 403 del servidor no produce enlace y explica el motivo', async () => {
    const err = collector();
    const code = await runPairCommand({
      serverUrl: 'http://127.0.0.1:3280',
      fetchImpl: (async () =>
        jsonResponse({ success: false, error: 'Origin no permitido' }, 403)) as typeof fetch,
      out: () => assert.fail('no debería imprimir enlace'),
      err: err.out,
    });
    assert.equal(code, 1);
    assert.match(err.lines.join('\n'), /HTTP 403/);
    assert.match(err.lines.join('\n'), /Origin no permitido/);
  });

  test('sin servidor responde con error de conexión y código 1', async () => {
    const err = collector();
    const code = await runPairCommand({
      serverUrl: 'http://127.0.0.1:9',
      fetchImpl: (async () => {
        throw new Error('connect ECONNREFUSED');
      }) as typeof fetch,
      out: () => assert.fail('no debería imprimir enlace'),
      err: err.out,
    });
    assert.equal(code, 1);
    assert.match(err.lines.join('\n'), /ECONNREFUSED/);
    assert.match(err.lines.join('\n'), /commander serve/);
  });

  test('--devices lista el registro y no pide un enlace', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const out = collector();
    const code = await runPairCommand({
      serverUrl: 'http://127.0.0.1:3280/',
      devices: true,
      fetchImpl: (async (url: any, init: any) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          success: true,
          maxDevices: 5,
          devices: [
            { id: 'dev_aaa', createdAt: 1, lastSeenAt: 2, expiresAt: 3, revokedAt: null, userAgent: 'A' },
            { id: 'dev_bbb', createdAt: 1, lastSeenAt: 2, expiresAt: 3, revokedAt: 2, userAgent: 'B' },
          ],
        });
      }) as typeof fetch,
      out: out.out,
      err: () => assert.fail('no debería haber error'),
    });

    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:3280/api/pair/devices');
    assert.equal(calls[0].init.method, 'GET');
    const text = out.lines.join('\n');
    assert.match(text, /2 registrados, 1 activos de 5/);
    assert.match(text, /dev_aaa\s+activo/);
    assert.match(text, /dev_bbb\s+revocado/);
  });

  test('--devices --json devuelve el registro tal cual', async () => {
    const out = collector();
    const code = await runPairCommand({
      serverUrl: 'http://127.0.0.1:3280',
      devices: true,
      json: true,
      fetchImpl: (async () =>
        jsonResponse({
          success: true,
          maxDevices: 5,
          devices: [
            { id: 'dev_json', createdAt: 1, lastSeenAt: 2, expiresAt: 3, revokedAt: null, userAgent: '' },
          ],
        })) as typeof fetch,
      out: out.out,
      err: () => assert.fail('sin error'),
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(out.lines.join('\n'));
    assert.equal(parsed.maxDevices, 5);
    assert.equal(parsed.devices.length, 1);
    assert.equal(parsed.devices[0].id, 'dev_json');
  });

  test('--revoke manda DELETE con el Origin del server y el id codificado', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const out = collector();
    const code = await runPairCommand({
      serverUrl: 'http://127.0.0.1:3280',
      revoke: 'dev_a/b',
      fetchImpl: (async (url: any, init: any) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          success: true,
          device: {
            id: 'dev_a/b',
            createdAt: 1,
            lastSeenAt: 2,
            expiresAt: 3,
            revokedAt: 4,
            userAgent: '',
          },
        });
      }) as typeof fetch,
      out: out.out,
      err: () => assert.fail('no debería haber error'),
    });

    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:3280/api/pair/devices/dev_a%2Fb');
    assert.equal(calls[0].init.method, 'DELETE');
    assert.equal(calls[0].init.headers.Origin, 'http://127.0.0.1:3280');
    assert.match(out.lines.join('\n'), /dev_a\/b revocado/);
  });

  test('--revoke de un id inexistente no inventa una baja', async () => {
    const err = collector();
    const code = await runPairCommand({
      serverUrl: 'http://127.0.0.1:3280',
      revoke: 'dev_nope',
      fetchImpl: (async () =>
        jsonResponse({ success: false, error: 'dispositivo no encontrado' }, 404)) as typeof fetch,
      out: () => assert.fail('no debería imprimir una baja'),
      err: err.out,
    });
    assert.equal(code, 1);
    assert.match(err.lines.join('\n'), /HTTP 404/);
    assert.match(err.lines.join('\n'), /dispositivo no encontrado/);
  });

  test('--devices y --revoke juntos se rechazan sin tocar la red', async () => {
    const err = collector();
    const code = await runPairCommand({
      serverUrl: 'http://127.0.0.1:3280',
      devices: true,
      revoke: 'dev_x',
      fetchImpl: (async () => assert.fail('no debería llamar')) as typeof fetch,
      out: () => assert.fail('no debería imprimir'),
      err: err.out,
    });
    assert.equal(code, 1);
    assert.match(err.lines.join('\n'), /no se combinan/);
  });

  test('un token inutilizable del servidor no se convierte en enlace', async () => {
    const err = collector();
    const code = await runPairCommand({
      serverUrl: 'file:///tmp/x',
      fetchImpl: (async () =>
        jsonResponse({ success: true, token: 'tok', sessionId: 'sess', expiresAt: 1, ttlMs: 1 })) as typeof fetch,
      out: () => assert.fail('no debería imprimir enlace'),
      err: err.out,
    });
    assert.equal(code, 1);
    assert.match(err.lines.join('\n'), /inutilizable/);
  });
});

describe('commander pair contra el server (F3)', () => {
  test('--devices y --revoke reutilizan las rutas del host', async () => {
    const { deviceId } = await pairForCli('Pair CLI: devices (F3)');

    const listed = collector();
    assert.equal(
      await runPairCommand({ serverUrl: srv.baseUrl, devices: true, out: listed.out, err: listed.out }),
      0
    );
    assert.match(listed.lines.join('\n'), new RegExp(deviceId));
    assert.match(listed.lines.join('\n'), /activo/);

    const revoked = collector();
    assert.equal(
      await runPairCommand({ serverUrl: srv.baseUrl, revoke: deviceId, out: revoked.out, err: revoked.out }),
      0
    );
    assert.match(revoked.lines.join('\n'), new RegExp(`${deviceId} revocado`));

    const after = await srv.request('GET', '/api/pair/devices');
    assert.equal(after.status, 200, after.raw);
    const record = after.body.devices.find((entry: any) => entry.id === deviceId);
    assert.ok(record, 'el dispositivo revocado se conserva para auditoría');
    assert.equal(typeof record.revokedAt, 'number');
  });

  test('--revoke es idempotente: repetir la baja conserva el mismo revokedAt', async () => {
    const { deviceId } = await pairForCli('Pair CLI: baja idempotente (F3)');

    const first = collector();
    assert.equal(
      await runPairCommand({ serverUrl: srv.baseUrl, revoke: deviceId, out: first.out, err: first.out }),
      0
    );
    const before = await srv.request('GET', '/api/pair/devices');
    const firstRow = before.body.devices.find((entry: any) => entry.id === deviceId);
    assert.ok(firstRow, 'la primera baja deja el registro para auditoría');
    assert.equal(typeof firstRow.revokedAt, 'number');

    const second = collector();
    assert.equal(
      await runPairCommand({ serverUrl: srv.baseUrl, revoke: deviceId, out: second.out, err: second.out }),
      0
    );
    assert.match(second.lines.join('\n'), new RegExp(`${deviceId} revocado`));

    const after = await srv.request('GET', '/api/pair/devices');
    const secondRow = after.body.devices.find((entry: any) => entry.id === deviceId);
    assert.ok(secondRow, 'repetir la baja no borra el registro');
    assert.equal(secondRow.revokedAt, firstRow.revokedAt, 'repetir la baja no mueve la marca');

    const listed = collector();
    assert.equal(
      await runPairCommand({ serverUrl: srv.baseUrl, devices: true, out: listed.out, err: listed.out }),
      0
    );
    assert.match(listed.lines.join('\n'), new RegExp(`${deviceId}\\s+revocado`));
  });

  test('--revoke de un id inexistente responde 404 y no crea un registro', async () => {
    const err = collector();
    const code = await runPairCommand({
      serverUrl: srv.baseUrl,
      revoke: 'dev_inexistente_cli',
      out: () => assert.fail('no debería imprimir una baja'),
      err: err.out,
    });
    assert.equal(code, 1);
    assert.match(err.lines.join('\n'), /HTTP 404/);
    assert.match(err.lines.join('\n'), /dispositivo no encontrado/);

    const listed = await srv.request('GET', '/api/pair/devices');
    assert.equal(listed.status, 200, listed.raw);
    assert.equal(
      listed.body.devices.some((entry: any) => entry.id === 'dev_inexistente_cli'),
      false,
      'un id inexistente no se inventa en el registro'
    );
  });
});
