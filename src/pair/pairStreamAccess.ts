/**
 * Quién puede abrir el stream SSE de una sesión (§6.6 del modelo de amenazas).
 *
 * - Con cookie: manda el registro de dispositivos. Una cookie válida entra con
 *   clave `device:<id>`; una revocada, caducada o desconocida se rechaza **aun
 *   viniendo de loopback**, para que revocar surta efecto sin esperar la
 *   caducidad.
 * - Sin cookie: sólo el escritorio, es decir un peer de loopback (la UI local y
 *   el CLI).
 * - Cualquier otro peer sin cookie queda fuera.
 *
 * La clave es la misma identidad que usa el rate limit y el cupo de conexiones
 * vivas, para que los tres cuenten al mismo caller.
 */
import { resolvePairDevice } from './pairDevices';
import { isLoopbackPeer } from './pairOrigin';

export type PairStreamAccess = { ok: true; key: string } | { ok: false };

export const DESKTOP_STREAM_CALLER = 'desktop';

export function resolvePairStreamAccess(input: {
  cookie?: unknown;
  remoteAddress?: unknown;
}): PairStreamAccess {
  const cookie = typeof input.cookie === 'string' ? input.cookie : '';
  if (cookie) {
    const checked = resolvePairDevice(cookie);
    return checked.ok
      ? { ok: true, key: `device:${checked.device.id}` }
      : { ok: false };
  }
  return isLoopbackPeer(input.remoteAddress)
    ? { ok: true, key: DESKTOP_STREAM_CALLER }
    : { ok: false };
}
