import { describe, expect, it } from 'vitest';
import {
  BindHostError,
  DEFAULT_BIND_HOST,
  bindExposureWarning,
  isLoopbackHost,
  resolveBindHost,
} from '../../src/lib/bindHost';

/**
 * `serve --host` y `server.host` llegan de verdad a `server.listen`: cualquier
 * interfaz se pasa tal cual y sólo se normalizan los alias. Fuera de loopback el
 * arranque tiene que avisar, porque la API no autentica.
 */
describe('host de escucha del servidor', () => {
  it('usa 127.0.0.1 cuando no se pide host', () => {
    expect(resolveBindHost()).toBe('127.0.0.1');
    expect(resolveBindHost(undefined)).toBe(DEFAULT_BIND_HOST);
    expect(resolveBindHost('')).toBe(DEFAULT_BIND_HOST);
    expect(resolveBindHost('   ')).toBe(DEFAULT_BIND_HOST);
    expect(resolveBindHost(null)).toBe(DEFAULT_BIND_HOST);
  });

  it('normaliza los alias antes de pasarlos a server.listen', () => {
    expect(resolveBindHost(' 127.0.0.1 ')).toBe('127.0.0.1');
    expect(resolveBindHost('localhost')).toBe('127.0.0.1');
    expect(resolveBindHost('LOCALHOST')).toBe('127.0.0.1');
    expect(resolveBindHost('[::1]')).toBe('::1');
    expect(resolveBindHost('[::]')).toBe('::');
  });

  it('acepta otras interfaces para el bind real', () => {
    expect(resolveBindHost('0.0.0.0')).toBe('0.0.0.0');
    expect(resolveBindHost('::')).toBe('::');
    expect(resolveBindHost('192.168.1.20')).toBe('192.168.1.20');
    expect(resolveBindHost('10.0.0.5')).toBe('10.0.0.5');
    expect(resolveBindHost('dev.local')).toBe('dev.local');
    expect(resolveBindHost('::1')).toBe('::1');
  });

  it('rechaza lo que no es un host', () => {
    for (const value of ['http://localhost:3280', '127.0.0.1/path', 'dos palabras']) {
      expect(() => resolveBindHost(value), value).toThrow(BindHostError);
    }
  });

  it('distingue loopback de una interfaz de red', () => {
    for (const host of ['127.0.0.1', '127.0.0.53', '::1', 'localhost']) {
      expect(isLoopbackHost(host), host).toBe(true);
      expect(bindExposureWarning(host), host).toBeNull();
    }
    for (const host of ['0.0.0.0', '::', '192.168.1.20', 'dev.local']) {
      expect(isLoopbackHost(host), host).toBe(false);
      expect(bindExposureWarning(host), host).toMatch(/no tiene autenticación/);
      expect(bindExposureWarning(host), host).toContain(host);
    }
  });
});
