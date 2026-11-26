/**
 * Enlace de emparejamiento: la URL que se abre en el dispositivo nuevo.
 *
 * El token viaja en el **fragmento** (`#pair=…`), no en la query: el navegador
 * no lo manda en la petición inicial ni lo incluye en `Referer`, que es lo que
 * pide el control T3 del modelo de amenazas. El cliente lo canjea por
 * `POST /api/pair/redeem` en el cuerpo.
 *
 * Aquí no hay QR ni generación de imágenes: se devuelve la URL y el operador la
 * pasa al otro dispositivo como prefiera. Un QR sería otra dependencia y no
 * cambia el contrato.
 */

/**
 * Origen normalizado (`protocolo//host:puerto`) de la URL del servidor.
 * `null` si no es http(s): un enlace de pair sobre otro esquema no tiene
 * sentido y no se inventa uno.
 */
export function normalizedOrigin(serverUrl: string): string | null {
  try {
    const url = new URL(String(serverUrl));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * URL con el token en el fragmento. El puerto y el host salen de `serverUrl`;
 * el path del servidor se descarta a propósito (hoy siempre es la raíz) para
 * que el enlace no dependa de por dónde se sirvió el CLI.
 */
export function buildPairLink(serverUrl: string, token: string): string {
  const origin = normalizedOrigin(serverUrl);
  if (!origin) throw new Error(`URL de servidor inválida: ${serverUrl}`);
  if (typeof token !== 'string' || !token) throw new Error('token de emparejamiento vacío');
  return `${origin}/pair#pair=${encodeURIComponent(token)}`;
}
