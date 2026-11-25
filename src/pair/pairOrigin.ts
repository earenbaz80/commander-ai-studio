/**
 * Guardas de `Origin` y `Sec-Fetch-Site` para la superficie de pair (§6.3).
 *
 * El servidor sigue escuchando en loopback, pero un navegador puede hablarle
 * desde una página ajena (`127.0.0.1` es alcanzable desde cualquier sitio):
 * CSRF sobre el canje sería una forma de robar el enlace justo cuando el dueño
 * lo abre. Por eso las mutaciones de pair exigen `Origin` **exacto** contra la
 * allowlist del servidor; sin `Origin` se rechazan, salvo el pedido de emisión
 * que hace el CLI desde loopback (un navegador no puede suprimir el `Origin`,
 * así que ese hueco no se puede usar desde una página).
 *
 * `Sec-Fetch-Site: cross-site` se rechaza como segunda barrera independiente.
 */
import net from 'node:net';

/**
 * ¿El socket viene de loopback? Cubre `127.0.0.0/8`, `::1` y la forma mapeada
 * `::ffff:127.0.0.1` que usan algunos stacks en Windows.
 */
export function isLoopbackPeer(address: unknown): boolean {
  if (typeof address !== 'string' || !address.trim()) return false;
  const raw = address.trim().toLowerCase();
  const plain = raw.startsWith('::ffff:') ? raw.slice('::ffff:'.length) : raw;
  if (plain === '::1' || plain === '127.0.0.1') return true;
  return net.isIPv4(plain) && plain.startsWith('127.');
}

/**
 * Orígenes aceptados en modo pair: el propio servidor en los tres nombres de
 * loopback (con el puerto real del socket) más lo que ya permita CORS.
 */
export function pairAllowedOrigins(localPort: unknown, extra: string[] = []): string[] {
  const port = Number(localPort);
  const self =
    Number.isInteger(port) && port > 0
      ? [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]
      : [];
  const normalizedExtra = extra
    .map((origin) => String(origin || '').trim().replace(/\/$/, ''))
    .filter(Boolean);
  return Array.from(new Set([...self, ...normalizedExtra]));
}

export interface PairOriginInput {
  origin?: unknown;
  secFetchSite?: unknown;
  allowedOrigins: string[];
  /**
   * Sólo para la emisión desde el CLI: un proceso local no manda `Origin` y no
   * puede ser víctima de CSRF. En el canje siempre es `false`.
   */
  allowMissingOrigin?: boolean;
}

/**
 * Motivo del rechazo, o `null` si la petición pasa. El texto va tal cual al
 * cliente: no revela si un token existe ni nada del almacén.
 */
export function pairOriginRejection(input: PairOriginInput): string | null {
  const site = typeof input.secFetchSite === 'string' ? input.secFetchSite.trim().toLowerCase() : '';
  if (site === 'cross-site') return 'Sec-Fetch-Site cross-site no permitido';

  const origin = typeof input.origin === 'string' ? input.origin.trim() : '';
  if (!origin) {
    return input.allowMissingOrigin ? null : 'falta Origin';
  }
  if (origin === 'null') return 'Origin nulo no permitido';
  const allowed = input.allowedOrigins.some((entry) => entry === origin);
  return allowed ? null : 'Origin no permitido';
}
