/**
 * `Secure` de la cookie de dispositivo (G2 C3, §6.2 del modelo de amenazas).
 *
 * `req.protocol` no alcanza detrás de un túnel que termina TLS: Express no
 * confía en el proxy por defecto y sigue viendo `http`. El control mira
 * `X-Forwarded-Proto`, pero sólo cuando el peer es el túnel local (loopback).
 */
import { describe, expect, it } from 'vitest';
import { pairCookieSecure } from '../../src/pair/pairOrigin';

describe('cookie Secure del pair', () => {
  it('HTTPS directo siempre es Secure', () => {
    expect(pairCookieSecure({ protocol: 'https', remoteAddress: '192.168.1.9' })).toBe(true);
  });

  it('un túnel en loopback que anuncia https sí lo marca', () => {
    expect(
      pairCookieSecure({ protocol: 'http', forwardedProto: 'https', remoteAddress: '127.0.0.1' })
    ).toBe(true);
    expect(
      pairCookieSecure({ protocol: 'http', forwardedProto: 'https', remoteAddress: '::ffff:127.0.0.1' })
    ).toBe(true);
    expect(
      pairCookieSecure({ protocol: 'http', forwardedProto: 'https', remoteAddress: '::1' })
    ).toBe(true);
  });

  it('X-Forwarded-Proto desde fuera de loopback no se cree', () => {
    expect(
      pairCookieSecure({ protocol: 'http', forwardedProto: 'https', remoteAddress: '192.168.1.9' })
    ).toBe(false);
  });

  it('http local sin cabecera no marca Secure', () => {
    expect(pairCookieSecure({ protocol: 'http', remoteAddress: '127.0.0.1' })).toBe(false);
    expect(pairCookieSecure({})).toBe(false);
  });

  it('con varios proxies vale el primero, que es el del cliente', () => {
    expect(
      pairCookieSecure({ protocol: 'http', forwardedProto: 'https, http', remoteAddress: '::1' })
    ).toBe(true);
    expect(
      pairCookieSecure({ protocol: 'http', forwardedProto: 'http, https', remoteAddress: '::1' })
    ).toBe(false);
    expect(
      pairCookieSecure({ protocol: 'http', forwardedProto: ['https'], remoteAddress: '::1' })
    ).toBe(true);
  });
});
