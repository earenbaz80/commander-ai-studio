/**
 * Filtros de proveedor y de modelos.
 *
 * Mismo criterio que opencode: un proveedor se puede apagar sin borrar sus
 * credenciales, y su catálogo se puede recortar con una lista blanca y otra
 * negra. Las listas admiten un `*` al final (`claude-*`), que es lo que hace
 * usable un catálogo de cientos de modelos.
 *
 * Sin React ni red: lo usan tanto el registro del servidor como los selectores
 * del cliente, y se prueba aparte.
 */

export interface ModelFilter {
  whitelist: string[];
  blacklist: string[];
}

export const EMPTY_FILTER: ModelFilter = { whitelist: [], blacklist: [] };

const asList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
    : [];

/** `true` si el id encaja con el patrón exacto o con el prefijo `algo-*`. */
export function matchesModelPattern(id: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern.endsWith('*')) return id.startsWith(pattern.slice(0, -1));
  return id === pattern;
}

/**
 * Aplica whitelist y blacklist a una lista de modelos.
 *
 * Con whitelist vacía pasan todos; la blacklist siempre gana. Un patrón se
 * compara con el id, no con el nombre visible, para que no dependa del idioma
 * ni de cómo rotule el catálogo cada proveedor.
 */
export function filterModelIds<T extends { id: string }>(models: T[], filter?: Partial<ModelFilter> | null): T[] {
  const white = asList(filter?.whitelist);
  const black = asList(filter?.blacklist);
  if (white.length === 0 && black.length === 0) return models;
  return models.filter((model) => {
    if (black.some((pattern) => matchesModelPattern(model.id, pattern))) return false;
    if (white.length === 0) return true;
    return white.some((pattern) => matchesModelPattern(model.id, pattern));
  });
}

/** Lee los filtros guardados de un proveedor en la config. */
export function modelFilterOf(config: Record<string, any> | undefined, providerId: string): ModelFilter {
  const conf = (config?.[providerId] || {}) as Record<string, unknown>;
  return { whitelist: asList(conf.whitelist), blacklist: asList(conf.blacklist) };
}

/**
 * `false` sólo si el gestor lo apagó de forma explícita.
 *
 * Los proveedores que existen de fábrica (local) y los que llegan por entorno
 * siguen encendidos por defecto: apagar es una decisión del usuario, no el
 * estado inicial.
 */
export function isProviderEnabled(config: Record<string, any> | undefined, providerId: string): boolean {
  const conf = (config?.[providerId] || {}) as Record<string, unknown>;
  return conf.enabled !== false;
}

/** Convierte el texto libre del gestor (`a, b-*`) en la lista que se guarda. */
export function parseFilterList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 500);
}
