/**
 * Estado de configuración de las claves, sin secretos.
 *
 * El servidor guarda cada clave en una cookie httpOnly y no la devuelve nunca:
 * `GET /api/keys/:key` sólo responde si está configurada. Aquí se cachea ese
 * booleano para que la UI lo consulte sin pedirlo en cada render.
 *
 * Vive en su propio módulo, sin `localStorage` ni `fetch`, para que la lógica
 * que sólo necesita saber si hay clave (p. ej. `nonoAsk`) no arrastre el DOM.
 */
const CONFIGURED: Record<string, boolean> = {};

export function setApiKeyConfigured(key: string, configured: boolean): void {
  CONFIGURED[key] = configured;
}

export function isApiKeyConfigured(key: string): boolean {
  return CONFIGURED[key] === true;
}

/** Sólo para tests: deja el estado como recién arrancado. */
export function resetApiKeyConfigured(): void {
  for (const key of Object.keys(CONFIGURED)) delete CONFIGURED[key];
}
