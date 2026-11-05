/**
 * Lógica pura del catálogo de modelos (sin React ni DOM).
 *
 * Se encarga de fusionar el catálogo base (`src/data/models.ts`) con las
 * entradas del catálogo estático (`public/models.json`) y del catálogo vivo
 * (`GET /api/models/live`), además de leer el estado de cada proveedor.
 *
 * Mantenerla pura permite probarla con node:test sin montar el DOM.
 */
import type { AIModel } from '../types/studio';

/** Entrada cruda de catálogo (models.json o /api/models/live). */
export interface CatalogEntry {
  id?: string;
  name?: string;
  provider?: AIModel['provider'];
  contextWindow?: string;
  contextLength?: number;
  description?: string;
  badge?: string;
  supportsThinking?: boolean;
  supportsImage?: boolean;
  supportsAudio?: boolean;
  supportsVideo?: boolean;
  supportsTools?: boolean;
  supportsJSONMode?: boolean;
  supportsParallelTools?: boolean;
  isAgent?: boolean;
  sizeMb?: number;
  inputModalities?: ('text' | 'image' | 'audio' | 'video')[];
  outputModalities?: ('text' | 'image' | 'audio')[];
  pricing?: { input: number; output: number };
  license?: string;
  architecture?: string;
  quantization?: string[];
  knowledgeCutoff?: string;
  releaseDate?: string;
  tags?: string[];
  deprecated?: boolean;
  version?: string;
}

/** Estado de un proveedor opcional reportado por /api/models/live. */
export interface LiveProviderStatus {
  available: boolean;
  count?: number;
  host?: string;
  /** `true` si hay credenciales en config o entorno, no sólo modelos listados. */
  configured?: boolean;
  /** De dónde salen las credenciales: `env`, `file`, `local` o `none`. */
  source?: string;
  /** `true` si la lista viene de la caché porque el servidor no respondió. */
  cached?: boolean;
  error?: string;
}

export type ProviderStatus = Record<string, LiveProviderStatus>;

export interface LiveCatalog {
  success?: boolean;
  models?: CatalogEntry[];
  providers?: ProviderStatus;
  errors?: string[];
}

/**
 * Fusiona una entrada cruda sobre el modelo base (mismo id).
 * Los campos ausentes (`undefined`) no pisan el valor existente; los strings
 * vacíos tampoco (se comporta como "no especificado").
 */
export function mergeCatalogEntry(byId: Map<string, AIModel>, entry: CatalogEntry | null | undefined): void {
  if (!entry) return;
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!id) return;
  const base = byId.get(id) ?? ({ id, name: id } as AIModel);
  byId.set(id, {
    ...base,
    ...(entry.name ? { name: entry.name } : {}),
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.badge ? { badge: entry.badge } : {}),
    ...(entry.provider ? { provider: entry.provider } : {}),
    ...(entry.contextWindow ? { contextWindow: entry.contextWindow } : {}),
    ...(entry.contextLength !== undefined ? { contextLength: entry.contextLength } : {}),
    ...(entry.supportsThinking !== undefined ? { supportsThinking: entry.supportsThinking } : {}),
    ...(entry.supportsImage !== undefined ? { supportsImage: entry.supportsImage } : {}),
    ...(entry.supportsAudio !== undefined ? { supportsAudio: entry.supportsAudio } : {}),
    ...(entry.supportsVideo !== undefined ? { supportsVideo: entry.supportsVideo } : {}),
    ...(entry.supportsTools !== undefined ? { supportsTools: entry.supportsTools } : {}),
    ...(entry.supportsJSONMode !== undefined ? { supportsJSONMode: entry.supportsJSONMode } : {}),
    ...(entry.supportsParallelTools !== undefined ? { supportsParallelTools: entry.supportsParallelTools } : {}),
    ...(entry.isAgent !== undefined ? { isAgent: entry.isAgent } : {}),
    ...(entry.sizeMb !== undefined ? { sizeMb: entry.sizeMb } : {}),
    ...(entry.inputModalities ? { inputModalities: entry.inputModalities } : {}),
    ...(entry.outputModalities ? { outputModalities: entry.outputModalities } : {}),
    ...(entry.pricing ? { pricing: entry.pricing } : {}),
    ...(entry.license ? { license: entry.license } : {}),
    ...(entry.architecture ? { architecture: entry.architecture } : {}),
    ...(entry.quantization ? { quantization: entry.quantization } : {}),
    ...(entry.knowledgeCutoff ? { knowledgeCutoff: entry.knowledgeCutoff } : {}),
    ...(entry.releaseDate ? { releaseDate: entry.releaseDate } : {}),
    ...(entry.tags ? { tags: entry.tags } : {}),
    ...(entry.deprecated !== undefined ? { deprecated: entry.deprecated } : {}),
    ...(entry.version ? { version: entry.version } : {}),
  } as AIModel);
}

/** Aplica una o varias fuentes de catálogo sobre la base y devuelve el resultado. */
export function applyCatalog(
  base: AIModel[],
  sources: Array<CatalogEntry[] | undefined | null>,
): AIModel[] {
  const byId = new Map(base.map((m) => [m.id, m] as const));
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) mergeCatalogEntry(byId, entry);
  }
  return [...byId.values()];
}

/** Extrae el mapa de proveedores de la respuesta de /api/models/live. */
export function readProviderStatus(live: LiveCatalog | null | undefined): ProviderStatus {
  const providers = live?.providers;
  return providers && typeof providers === 'object' ? providers : {};
}
