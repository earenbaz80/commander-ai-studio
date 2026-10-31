/**
 * Modelo de Gemini que usa la app cuando nadie especifica otro.
 *
 * Verificado en vivo el 2026-10-27 con la API real: responde en ~2 s. Se
 * descartaron `gemini-flash-latest` (la petición se cuelga) y los `gemini-3.7/3.8`
 * (503 por alta demanda ese día).
 */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash';

/**
 * Modelo de la gama pro, para mapeos explícitos. El id existe hoy; el 429 que
 * devuelve depende del plan de la cuenta, no de que esté retirado. Con agotar
 * cuota aquí, la cadena de respaldo baja a un flash automáticamente.
 */
export const GEMINI_PRO_MODEL = 'gemini-3.1-pro-preview';

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

/**
 * Todo lo que el proveedor puede servir, sin repetidos: el default primero, la
 * gama pro y luego las alternativas. Es la lista que anuncia el router.
 */
export const GEMINI_MODEL_CHAIN = Array.from(
  new Set([GEMINI_DEFAULT_MODEL, GEMINI_PRO_MODEL, ...GEMINI_FALLBACK_MODELS])
);

/** Tope de modelos en una cadena explícita: más que esto es una lista de deseos. */
export const MAX_FALLBACK_MODELS = 5;

/**
 * Normaliza la cadena de respaldo que pide el cliente.
 *
 * `null` = no pidió nada y se usa la de por defecto. Un array —incluso vacío—
 * es una decisión explícita: vacío significa "sin respaldo", fallar en voz
 * alta, en vez de cambiar de modelo a espaldas de quien llama.
 */
export function normalizeFallbackChain(input: unknown): string[] | null {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || id.length > 80 || seen.has(id)) continue;
    seen.add(id);
    chain.push(id);
    if (chain.length >= MAX_FALLBACK_MODELS) break;
  }
  return chain;
}
