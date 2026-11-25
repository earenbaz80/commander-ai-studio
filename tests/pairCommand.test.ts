/**
 * `commander pair` (F3): el comando sólo pide la emisión y arma el enlace.
 *
 * Se prueba con un `fetch` inyectado: sin servidor, sin red y sin consola. Lo
 * que importa es el contrato visible al operador —enlace con el token en el
 * fragmento, sesión y minutos— y que los errores no inventen un enlace.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runPairCommand } from '../src/cli/pairCommand.js';

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
