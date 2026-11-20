import { describe, expect, it } from 'vitest';
import {
  BindHostError,
  DEFAULT_BIND_HOST,
  resolveBindHost,
} from '../../src/lib/bindHost';

/**
 * El bind es sólo loopback: la API ejecuta tools sobre el workspace y no tiene
 * autenticación. Estos casos fijan la regla y el error que ve quien intenta
 * abrir el servidor a la red.
 */
describe('host de escucha del servidor', () => {
  it('usa 127.0.0.1 cuando no se pide host', () => {
    expect(resolveBindHost()).toBe('127.0.0.1');
    expect(resolveBindHost(undefined)).toBe(DEFAULT_BIND_HOST);
    expect(resolveBindHost('')).toBe(DEFAULT_BIND_HOST);
    expect(resolveBindHost('   ')).toBe(DEFAULT_BIND_HOST);
    expect(resolveBindHost(null)).toBe(DEFAULT_BIND_HOST);
  });

  it('acepta y normaliza los alias de loopback', () => {
    expect(resolveBindHost('127.0.0.1')).toBe('127.0.0.1');
    expect(resolveBindHost(' 127.0.0.1 ')).toBe('127.0.0.1');
    expect(resolveBindHost('localhost')).toBe('127.0.0.1');
    expect(resolveBindHost('LOCALHOST')).toBe('127.0.0.1');
    expect(resolveBindHost('::1')).toBe('::1');
    expect(resolveBindHost('[::1]')).toBe('::1');
  });

  it('rechaza abrir el servidor a la red con un error explícito', () => {
    for (const host of ['0.0.0.0', '::', '[::]', '192.168.1.20', '10.0.0.5', 'example.com']) {
      expect(() => resolveBindHost(host), host).toThrow(BindHostError);
      expect(() => resolveBindHost(host), host).toThrow(/sólo escucha en loopback/);
      expect(() => resolveBindHost(host), host).toThrow(new RegExp(host.replace(/[.[\]]/g, '\\$&')));
    }
  });

  it('no confunde un host que contiene "localhost" con loopback', () => {
    expect(() => resolveBindHost('localhost.evil.com')).toThrow(BindHostError);
  });
});
