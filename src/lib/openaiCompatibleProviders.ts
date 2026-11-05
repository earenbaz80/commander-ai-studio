/**
 * Proveedores añadidos por el usuario como endpoints OpenAI-compatible.
 *
 * models.dev publica cientos de proveedores, pero sólo unos pocos tienen una
 * ruta propia en el servidor. El resto se puede añadir con su URL base y su
 * clave, y sus modelos viajan con el prefijo `openai-compatible/<id>/<modelo>`:
 * así el id dice de dónde salen sin depender de una lista fija de proveedores.
 */

export const COMPATIBLE_MODEL_PREFIX = 'openai-compatible/';

/** Id de modelo que entiende el selector y resuelve `/api/custom/generate`. */
export function compatibleModelId(providerId: string, modelId: string): string {
  return `${COMPATIBLE_MODEL_PREFIX}${providerId}/${modelId}`;
}

/**
 * Separa `openai-compatible/<proveedor>/<modelo>`.
 *
 * El modelo puede llevar barras (`meta-llama/llama-3`), así que sólo se corta
 * el primer segmento después del prefijo.
 */
export function parseCompatibleModelId(value: string): { providerId: string; modelId: string } | null {
  if (typeof value !== 'string' || !value.startsWith(COMPATIBLE_MODEL_PREFIX)) return null;
  const rest = value.slice(COMPATIBLE_MODEL_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  const providerId = rest.slice(0, slash);
  const modelId = rest.slice(slash + 1);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(providerId)) return null;
  return { providerId, modelId };
}

export function isCompatibleModelId(value: string): boolean {
  return parseCompatibleModelId(value) !== null;
}

/** Convierte un nombre visible en el id estable que se guarda en la config. */
export function slugifyProviderId(value: string): string {
  const slug = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return /^[a-z0-9]/.test(slug) ? slug : '';
}
