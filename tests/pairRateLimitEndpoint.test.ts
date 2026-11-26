/**
 * Rate limit del pair en approvals y stream contra el server compartido (F3,
 * T12 del modelo de amenazas remoto).
 *
 * El presupuesto por caller se cuenta por **dispositivo**, y cada caso canjea el
 * suyo: agotar el de este archivo no toca a ningún otro. Los topes los fija el
 * arnés (`COMMANDER_PAIR_RATE_APPROVAL_MAX` / `..._STREAM_MAX`), lo bastante
 * bajos para cortar en pocas peticiones y sin rozar al resto de la suite.
 *
 * El canje tiene su propio archivo (`pairRedeemRateLimitEndpoint.test.ts`)
 * porque su bucket es por IP, compartida por toda la corrida: ahí se levanta un
 * server propio con topes de prueba, igual que la caducidad del enlace.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;
let sessionId: string;

before(async () => {
  srv = await startServer();
  const created = await srv.request('POST', '/api/agent/sessions', { goal: 'Rate limit de pair (F3)' });
  assert.equal(created.status, 200, created.raw);
  sessionId = String(created.body.session.id);
});

after(async () => {
  await srv?.stop();
});

/** Emite un enlace y lo canjea: devuelve sólo la cookie del dispositivo nuevo. */
async function pairedDevice(): Promise<string> {
  const issued = await srv.request('POST', '/api/pair/issue', { sessionId });
  assert.equal(issued.status, 200, issued.raw);
  const redeemed = await srv.request(
    'POST',
    '/api/pair/redeem',
    { token: issued.body.token },
    { headers: { Origin: srv.baseUrl } }
  );
  assert.equal(redeemed.status, 200, redeemed.raw);
  const raw = redeemed.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [String(raw ?? '')];
  const cookie = cookies
    .map((entry) => entry.split(';')[0])
    .find((entry) => entry.startsWith('commander_pair='));
  assert.ok(cookie, 'el canje tiene que devolver la cookie del dispositivo');
  return cookie as string;
}

function approval(cookie: string) {
  return srv.request(
    'POST',
    `/api/agent/sessions/${sessionId}/approvals/apr_inexistente`,
    { decision: 'allow' },
    { headers: { Cookie: cookie } }
  );
}

/**
 * Abre el SSE y resuelve con estado y cabeceras: el 200 se corta en cuanto
 * llegan las cabeceras, y un 429 se lee entero porque es JSON.
 */
function openStream(cookie: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/agent/sessions/${sessionId}/stream`, srv.baseUrl);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        agent: false,
        headers: { Cookie: cookie, Accept: 'text/event-stream' },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const headers = res.headers;
        if (status === 200) {
          resolve({ status, headers, body: null });
          res.destroy();
          req.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: any = null;
          try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
          resolve({ status, headers, body });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('approvals', () => {
  test('un bucle de approvals agota el presupuesto del dispositivo: 429 con Retry-After', async () => {
    const cookie = await pairedDevice();
    let limited: Awaited<ReturnType<typeof approval>> | null = null;

    for (let i = 0; i < 20 && !limited; i++) {
      const res = await approval(cookie);
      if (res.status === 429) limited = res;
      else assert.ok([400, 404, 409].includes(res.status), `estado inesperado: ${res.status} ${res.raw}`);
    }

    assert.ok(limited, 'el rate limit no cortó el bucle dentro de 20 intentos');
    assert.equal(limited.body.code, 'PAIR_RATE_LIMITED');
    assert.equal(limited.body.scope, 'caller');
    assert.equal(limited.body.success, false);

    const retryAfter = Number(limited.headers['retry-after']);
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, `Retry-After inválido: ${limited.headers['retry-after']}`);
    assert.equal(limited.body.retryAfterSec, retryAfter);
    assert.match(String(limited.headers['cache-control']), /no-store/);
  });

  test('el bloqueo es del dispositivo que lo gastó: otro dispositivo sigue entrando', async () => {
    const other = await pairedDevice();
    const res = await approval(other);
    assert.notEqual(res.status, 429, `otro dispositivo heredó el bloqueo: ${res.raw}`);
    assert.equal(res.status, 409, res.raw);
    assert.equal(res.body.code, 'LEASE_HELD');
  });
});

describe('stream', () => {
  test('reconectar en bucle agota el presupuesto del stream antes de abrir el SSE', async () => {
    const cookie = await pairedDevice();
    let limited: Awaited<ReturnType<typeof openStream>> | null = null;

    for (let i = 0; i < 30 && !limited; i++) {
      const opened = await openStream(cookie);
      if (opened.status === 429) limited = opened;
      else assert.equal(opened.status, 200, `el stream debía abrir: ${opened.status}`);
    }

    assert.ok(limited, 'el rate limit del stream no cortó dentro de 30 conexiones');
    assert.equal(limited.body?.code, 'PAIR_RATE_LIMITED');
    assert.equal(limited.body?.scope, 'caller');
    assert.match(String(limited.headers['content-type']), /application\/json/);

    const retryAfter = Number(limited.headers['retry-after']);
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, `Retry-After inválido: ${limited.headers['retry-after']}`);
    assert.equal(limited.body?.retryAfterSec, retryAfter);
  });
});
