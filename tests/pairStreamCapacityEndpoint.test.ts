/**
 * Cupo de streams vivos del endpoint (T12, §6.6).
 *
 * El rate limit por minuto no ve una conexión que se queda abierta: con el cupo
 * lleno el server tiene que responder 429 **antes** de abrir el SSE, y devolver
 * el cupo cuando el socket se cierra, sin esperar a que expire nada. Los topes
 * son parámetros del proceso, así que el caso levanta su propio server con
 * `spawnServer({ env })` (excepción del repo para límites de proceso).
 *
 * El stream sin cookie se acepta desde loopback (la UI local y el CLI), pero una
 * cookie de dispositivo inválida da 401 aunque venga de loopback: así una
 * revocación aplica en el acto.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;
let sessionId = '';

before(async () => {
  srv = await spawnServer({
    env: {
      COMMANDER_PAIR_STREAM_ACTIVE_MAX: '1',
      COMMANDER_PAIR_STREAM_ACTIVE_GLOBAL_MAX: '2',
    },
  });
  const created = await srv.request('POST', '/api/agent/sessions', { goal: 'Cupo de streams (F3)' });
  assert.equal(created.status, 200, created.raw);
  sessionId = String(created.body.session.id);
});

after(async () => {
  await srv?.stop();
});

function streamUrl(): string {
  return `${srv.baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/stream`;
}

interface OpenStream {
  status: number;
  text: () => string;
  close: () => void;
}

/** Abre el SSE y resuelve con las cabeceras: el socket queda vivo. */
function openStream(headers: Record<string, string> = {}): Promise<OpenStream> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const req = http.get(streamUrl(), { agent: false, headers }, (res) => {
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      resolve({
        status: res.statusCode ?? 0,
        text: () => Buffer.concat(chunks).toString('utf8'),
        close: () => {
          res.destroy();
          req.destroy();
        },
      });
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => req.destroy(new Error('el stream no respondió')));
  });
}

/** Petición que termina sola: la usa el 429 y el 401. */
function readShort(headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.get(streamUrl(), { agent: false, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: any = null;
        try {
          body = JSON.parse(raw);
        } catch {
          /* si abrió el SSE no hay JSON: el test falla por timeout, no acá */
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => req.destroy(new Error('el endpoint no respondió con JSON')));
  });
}

/** Reintenta hasta conseguir cupo: el `close` del server llega después del destroy. */
async function waitForSlot(label: string, timeoutMs = 10_000): Promise<OpenStream> {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    const probe = await openStream();
    last = probe.status;
    if (probe.status === 200) return probe;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`${label}: el stream siguió respondiendo ${last}`);
}

describe('cupo de streams vivos', () => {
  test('con el cupo lleno responde 429 y lo devuelve al cerrarse', async () => {
    const first = await openStream();
    assert.equal(first.status, 200);

    const blocked = await readShort();
    assert.equal(blocked.status, 429, JSON.stringify(blocked.body));
    assert.equal(blocked.body.code, 'PAIR_STREAM_LIMITED');
    assert.equal(blocked.body.scope, 'caller');
    assert.equal(blocked.body.max, 1);

    // El cupo vuelve cuando el socket se cierra, sin esperar la ventana.
    first.close();
    const again = await waitForSlot('tras cerrar el primero');
    assert.equal(again.status, 200);
    again.close();
  });

  test('una cookie de dispositivo inválida no abre el stream', async () => {
    const res = await readShort({ cookie: 'commander_pair=basura' });
    assert.equal(res.status, 401);
    assert.equal(res.body?.success, false);
  });
});
