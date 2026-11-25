/**
 * Guardas de Origin, Sec-Fetch-Site y peer loopback de `/api/pair` (§6.3).
 *
 * Pieza pura: la lista de orígenes se arma con el puerto del socket y la
 * allowlist de CORS, sin leer `Host` ni confiar en cabeceras que el cliente
 * controla para decidir el origen propio.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackPeer, pairAllowedOrigins, pairOriginRejection } from '../src/pair/pairOrigin.js';

describe('isLoopbackPeer', () => {
  test('acepta loopback IPv4, IPv6 y la forma mapeada', () => {
    for (const address of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', ' ::1 ']) {
      assert.equal(isLoopbackPeer(address), true, address);
    }
  });

  test('rechaza LAN, vacío y basura', () => {
    for (const address of ['192.168.1.10', '10.0.0.1', '::ffff:192.168.1.10', 'localhost', '', null, 7]) {
      assert.equal(isLoopbackPeer(address), false, String(address));
    }
  });
});

describe('pairAllowedOrigins', () => {
  test('incluye los tres nombres de loopback con el puerto real', () => {
    const origins = pairAllowedOrigins(3280);
    assert.deepEqual(origins, [
      'http://127.0.0.1:3280',
      'http://localhost:3280',
      'http://[::1]:3280',
    ]);
  });

  test('suma la allowlist de CORS sin duplicar y sin barra final', () => {
    const origins = pairAllowedOrigins(3000, ['http://127.0.0.1:3000', 'https://tunel.ejemplo/', '']);
    assert.deepEqual(origins, [
      'http://127.0.0.1:3000',
      'http://localhost:3000',
      'http://[::1]:3000',
      'https://tunel.ejemplo',
    ]);
  });

  test('sin puerto válido sólo queda lo extra', () => {
    assert.deepEqual(pairAllowedOrigins(0), []);
    assert.deepEqual(pairAllowedOrigins('no-es-puerto', ['https://x.ejemplo']), ['https://x.ejemplo']);
  });
});

describe('pairOriginRejection', () => {
  const allowedOrigins = ['http://127.0.0.1:3280'];

  test('acepta el origen exacto de la allowlist', () => {
    assert.equal(pairOriginRejection({ origin: 'http://127.0.0.1:3280', allowedOrigins }), null);
  });

  test('rechaza origen ajeno, nulo y parecido', () => {
    for (const origin of ['http://127.0.0.1:3281', 'https://evil.example', 'http://127.0.0.1:3280/evil']) {
      assert.equal(pairOriginRejection({ origin, allowedOrigins }), 'Origin no permitido', origin);
    }
    assert.equal(pairOriginRejection({ origin: 'null', allowedOrigins }), 'Origin nulo no permitido');
  });

  test('sin Origin rechaza en el canje y lo tolera sólo si se pide', () => {
    assert.equal(pairOriginRejection({ allowedOrigins }), 'falta Origin');
    assert.equal(pairOriginRejection({ allowedOrigins, allowMissingOrigin: true }), null);
  });

  test('Sec-Fetch-Site cross-site se rechaza aunque el Origin sea el propio', () => {
    assert.equal(
      pairOriginRejection({
        origin: 'http://127.0.0.1:3280',
        secFetchSite: 'cross-site',
        allowedOrigins,
      }),
      'Sec-Fetch-Site cross-site no permitido'
    );
    assert.equal(
      pairOriginRejection({
        origin: 'http://127.0.0.1:3280',
        secFetchSite: 'same-origin',
        allowedOrigins,
      }),
      null
    );
  });
});
