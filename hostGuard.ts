/**
 * Guardia de `Host` para el server local: defensa contra DNS rebinding.
 *
 * El server escucha en loopback (`HOST=127.0.0.1`) y su API no pide
 * autenticación: quien pueda hablarle, manda. Un sitio ajeno puede hacer que un
 * dominio suyo resuelva a 127.0.0.1 (rebinding) y, desde el navegador del
 * usuario, hablar con este server como si fuera el mismo origen que su página:
 * ni CORS ni la cookie `SameSite=strict` frenan eso, porque la petición sale
 * hacia «su» dominio, no hacia el nuestro.
 *
 * Esa petición llega con `Host: dominio-del-atacante`, así que el filtro mira el
 * nombre del Host y no la IP de origen: loopback e IP literales no se pueden
 * rebindear, porque el navegador manda el hostname de la página que la origina.
 *
 * Escape para quien sirva la app por un nombre propio:
 * `ALLOWED_HOSTS=commander.local,mi-pc.lan`. Falla CERRADO: sin Host o con uno
 * malformado, no pasa.
 */
import net from 'net';

/** `localhost` y cualquier `*.localhost` están reservados por la RFC 6761. */
function isLocalhostName(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost');
}

/** Nombre del header `Host`, sin puerto y en minúsculas (`[::1]:3280` → `::1`). */
export function hostnameFromHostHeader(hostHeader: unknown): string | null {
  if (typeof hostHeader !== 'string') return null;
  const raw = hostHeader.trim().toLowerCase();
  if (!raw) return null;

  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end <= 1) return null; // `[::1` sin cerrar: malformado
    return raw.slice(1, end);
  }
  // Un IPv6 sin corchetes (`::1`) lo mandan algunos clientes que no son navegadores.
  if (net.isIPv6(raw)) return raw;

  const colon = raw.indexOf(':');
  const name = colon === -1 ? raw : raw.slice(0, colon);
  return name || null;
}

/**
 * ¿Se acepta este `Host`? Sí para IP literales (loopback, LAN, `::1`) y
 * `localhost`; también para lo que liste `ALLOWED_HOSTS`. No para el resto de
 * nombres, que es exactamente la firma del rebinding.
 */
export function isAllowedHost(hostHeader: unknown, allow: string[] = []): boolean {
  const host = hostnameFromHostHeader(hostHeader);
  if (!host) return false;
  if (net.isIP(host) !== 0) return true;
  if (isLocalhostName(host)) return true;
  return allow.some((entry) => entry.trim().toLowerCase().replace(/^\[|\]$/g, '') === host);
}

/** `ALLOWED_HOSTS=a,b` → `['a','b']`. Ausente o vacío → sin extras. */
export function allowedHostsFromEnv(value: unknown = process.env.ALLOWED_HOSTS): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
