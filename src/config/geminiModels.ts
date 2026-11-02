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
 *
 * Verificado otra vez el 2026-11-02 con sonda de un token sobre los 46 ids que
 * aceptan `generateContent`: la cuota de Gemini es POR MODELO y se agota y se
 * recupera en minutos, así que un 429 de los grandes no dice nada del resto.
 * Ese día `gemini-3.5-flash` (el default) devolvía 429 en 154 ms, `gemini-3.8`
 * y `gemini-3.7` daban 503 por demanda, y los lite contestaban en medio segundo.
 *
 * Un lite al final no es un adorno: es el que tiene cuota propia cuando los
 * grandes están agotados, que es el estado normal de una cuenta sin plan. Se
 * probó a sacarlos por un timeout de 15 s y fue un error: el mismo modelo
 * midió 0,46 s dos veces seguidas después. Un solo timeout no demuestra que un
 * modelo esté muerto — el que sí tarda siempre es `gemma-4-31b-it` (15 s), y
 * por eso no está aquí. El alias `-latest` sigue fuera porque caduca sin avisar.
 *
 * `gemma-4-26b-a4b-it` cierra la cadena y es el único que no es un Gemini. Vive
 * en el mismo endpoint (también lo usa el puente local) pero su cuota es otra:
 * ese mismo día, con `gemini-3.5-flash-lite` en 429 y `gemini-3.1-flash-lite`
 * sin responder en 25 s, contestó en 0,6-0,9 s. Acepta `googleSearch` y
 * `codeExecution` pero los ignora, así que como último recurso la respuesta sale
 * sin grounding ni ejecución de código: aun así es mejor que un 503.
 *
 * También fluctúa, y conviene decirlo porque es fácil concluir lo contrario:
 * una medición suelta del mismo día devolvió 500 INTERNAL en 644 ms, y la tanda
 * siguiente contestó 3 de 3 en ~0,8 s. Ningún modelo de esta lista se decide con
 * una sola llamada.
 */
export const GEMINI_FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemma-4-26b-a4b-it',
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
