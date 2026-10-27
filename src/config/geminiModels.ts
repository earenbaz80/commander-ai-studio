/**
 * Cadena de respaldo de Gemini, verificada contra la API el 2026-10-27.
 *
 * Vivía copiada en tres sitios (generate, stream y el puente local) y las tres
 * copias apuntaban a ids que Google ya no sirve: 2.0-flash, 2.0-flash-lite,
 * 1.5-flash-8b y 2.5-flash devuelven hoy 404 «no longer available». Reintentar
 * cuatro modelos muertos sólo alargaba la espera hasta el error del motor local.
 *
 * El orden va del mismo nivel al más ligero y deja el alias `-latest` al final,
 * que es el que más tarda en quedar obsoleto. Cualquier cambio aquí afecta a las
 * tres cadenas a la vez, que es justo lo que se busca.
 */
export const GEMINI_FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
  'gemini-flash-lite-latest',
];
