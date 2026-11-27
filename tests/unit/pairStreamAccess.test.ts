/**
 * Acceso al stream SSE (G2 C6, §6.6 del modelo de amenazas).
 *
 * La decisión se prueba sin socket: un peer que no es loopback y no trae cookie
 * queda fuera, una cookie revocada no entra ni desde loopback y una válida
 * cuenta como su dispositivo para el rate limit y el cupo.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DESKTOP_STREAM_CALLER,
  resolvePairStreamAccess,
} from '../../src/pair/pairStreamAccess';
import {
  issuePairDevice,
  resetPairDevicesForTests,
  revokePairDevice,
} from '../../src/pair/pairDevices';

beforeEach(() => {
  resetPairDevicesForTests();
});

describe('acceso al stream', () => {
  it('sin cookie sólo entra loopback; la LAN queda fuera', () => {
    expect(resolvePairStreamAccess({ remoteAddress: '192.168.1.9' })).toEqual({ ok: false });
    expect(resolvePairStreamAccess({ remoteAddress: '10.0.0.7' })).toEqual({ ok: false });
    expect(resolvePairStreamAccess({ remoteAddress: '' })).toEqual({ ok: false });
    expect(resolvePairStreamAccess({ remoteAddress: '127.0.0.1' })).toEqual({
      ok: true,
      key: DESKTOP_STREAM_CALLER,
    });
  });

  it('una cookie válida entra como su dispositivo, venga de donde venga', () => {
    const issued = issuePairDevice({ userAgent: 'vitest' });
    if (!issued.ok) throw new Error('no se pudo emitir el dispositivo');

    expect(
      resolvePairStreamAccess({ cookie: issued.token, remoteAddress: '192.168.1.9' })
    ).toEqual({ ok: true, key: `device:${issued.device.id}` });
  });

  it('una cookie revocada se rechaza aunque el peer sea loopback', () => {
    const issued = issuePairDevice({});
    if (!issued.ok) throw new Error('no se pudo emitir el dispositivo');
    revokePairDevice(issued.device.id);

    expect(
      resolvePairStreamAccess({ cookie: issued.token, remoteAddress: '127.0.0.1' })
    ).toEqual({ ok: false });
  });

  it('una cookie desconocida no cae al loopback', () => {
    expect(resolvePairStreamAccess({ cookie: 'basura', remoteAddress: '127.0.0.1' })).toEqual({
      ok: false,
    });
    expect(resolvePairStreamAccess({ cookie: '', remoteAddress: '127.0.0.1' })).toEqual({
      ok: true,
      key: DESKTOP_STREAM_CALLER,
    });
  });
});
