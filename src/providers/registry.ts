/**
 * Registro de proveedores y su catálogo de modelos.
 *
 * El catálogo sale de models.dev. Su API no
 * devuelve una lista plana: es un mapa `proveedor → { env, models }`, así que
 * se normaliza aquí una sola vez. Antes `server.ts` esperaba `data.models` en
 * la raíz, cosa que models.dev no manda: el catálogo "vivo" llegaba vacío y el
 * fallo se tragaba con un `console.warn`.
 *
 * Este módulo es puro salvo `getProviderCatalog`, que hace la petición y la
 * cachea; el resto se puede probar sin red.
 */
import { CUSTOM_MODELS, GEMINI_MODELS, HUGGINGFACE_MODELS, OLLAMA_MODELS } from '../data/models';
import { filterModelIds, isProviderEnabled, modelFilterOf } from '../lib/providerFilters';
import { GEMINI_DEFAULT_MODEL } from '../config/geminiModels';
import { compatibleModelId } from '../lib/openaiCompatibleProviders';

export type ProviderFieldKind = 'secret' | 'url' | 'text';

export interface ProviderField {
  name: string;
  required: boolean;
  kind: ProviderFieldKind;
}

export interface ProviderSpec {
  id: string;
  name: string;
  /** Variables de entorno que también sirven para configurarlo. */
  env: string[];
  fields: ProviderField[];
  defaultModel?: string;
  /** Añadido por el usuario como endpoint OpenAI-compatible. */
  custom?: boolean;
}

/**
 * Los únicos proveedores que el servidor sabe enrutar. models.dev trae 235;
 * ofrecer los otros sería prometer rutas que no existen.
 */
export const PROVIDER_SPECS: ProviderSpec[] = [
  {
    id: 'google',
    name: 'Google Gemini',
    env: ['GEMINI_API_KEY'],
    fields: [{ name: 'apiKey', required: true, kind: 'secret' }],
    defaultModel: GEMINI_DEFAULT_MODEL,
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    env: ['ANTHROPIC_API_KEY'],
    fields: [{ name: 'apiKey', required: true, kind: 'secret' }],
    defaultModel: 'claude-sonnet-4-20250514',
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    env: ['XAI_API_KEY'],
    fields: [{ name: 'apiKey', required: true, kind: 'secret' }],
    defaultModel: 'grok-4',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    env: ['OPENROUTER_API_KEY'],
    fields: [{ name: 'apiKey', required: true, kind: 'secret' }],
    defaultModel: 'deepseek/deepseek-chat-v3-0324:free',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    env: ['OPENAI_API_KEY'],
    fields: [{ name: 'apiKey', required: true, kind: 'secret' }],
    defaultModel: 'gpt-4.1-mini',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    env: ['NVIDIA_API_KEY'],
    fields: [{ name: 'apiKey', required: true, kind: 'secret' }],
    defaultModel: 'meta/llama-3.3-70b-instruct',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    env: ['HF_API_TOKEN'],
    fields: [{ name: 'apiToken', required: true, kind: 'secret' }],
    defaultModel: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    env: ['OLLAMA_HOST'],
    fields: [{ name: 'host', required: false, kind: 'url' }],
    defaultModel: 'llama3.2',
  },
  {
    // LM Studio puede ser el de este equipo (`localHost`) o el de casa
    // (`host`, remoto). En el gestor se nombran así para no confundirlos.
    id: 'lmstudio',
    name: 'LM Studio',
    env: ['LMSTUDIO_HOST'],
    fields: [
      { name: 'host', required: false, kind: 'url' },
      { name: 'localHost', required: false, kind: 'url' },
    ],
  },
  {
    // Endpoint genérico, separado de LM Studio: vLLM, llama.cpp, oMLX, Zen…
    // Conserva el id `custom` para no romper CUSTOM_* ni configuraciones ya
    // guardadas, pero la UI lo presenta como OpenAI-compatible.
    id: 'custom',
    name: 'OpenAI-compatible',
    env: ['CUSTOM_BASE_URL', 'CUSTOM_API_KEY', 'OPENCODE_API_KEY'],
    fields: [
      { name: 'baseUrl', required: true, kind: 'url' },
      { name: 'apiKey', required: false, kind: 'secret' },
      { name: 'defaultModel', required: false, kind: 'text' },
    ],
  },
  {
    id: 'freebuff',
    name: 'Freebuff',
    env: ['FREEBUFF_API_KEY', 'FREEBUFF_BASE_URL'],
    fields: [{ name: 'apiKey', required: true, kind: 'secret' }],
  },
];

export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  contextWindow?: string;
  supportsTools?: boolean;
  supportsImage?: boolean;
  supportsReasoning?: boolean;
}

export interface CatalogProvider {
  id: string;
  name: string;
  env: string[];
  models: CatalogModel[];
  /** Base OpenAI-compatible que publica models.dev, cuando la trae. */
  api?: string;
  doc?: string;
}

/** Specs de los proveedores añadidos por el usuario (endpoint compatible). */
export function customProviderSpecs(config: Record<string, any> | undefined): ProviderSpec[] {
  const entries = config?.openaiCompatible;
  if (!entries || typeof entries !== 'object') return [];
  return Object.entries(entries as Record<string, any>).flatMap(([id, raw]) => {
    if (!raw || typeof raw !== 'object') return [];
    const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
    if (!baseUrl) return [];
    return [{
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : id,
      env: [],
      fields: [{ name: 'baseUrl', required: true, kind: 'url' as const }],
      defaultModel: typeof raw.defaultModel === 'string' ? raw.defaultModel : undefined,
      custom: true,
    }];
  });
}

export interface ProviderStatus {
  configured: boolean;
  missing: string[];
  source: 'env' | 'file' | 'local' | 'none';
}

export interface ProviderEntry extends ProviderSpec, ProviderStatus {
  /** Modelos visibles tras aplicar whitelist/blacklist. */
  models: CatalogModel[];
  modelCount: number;
  /** Modelos del catálogo antes de filtrar. */
  totalModels: number;
  /** `false` si el gestor lo apagó: no se ofrece en los selectores. */
  enabled: boolean;
  whitelist: string[];
  blacklist: string[];
}

const kTokens = (n: unknown): string | undefined => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return undefined;
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M tokens`;
  return `${Math.round(n / 1000)}K tokens`;
};

/**
 * Normaliza la respuesta de models.dev.
 *
 * Se ignoran los modelos retirados y los proveedores sin modelos; el orden es
 * estable (por nombre) para que la lista no baile entre recargas.
 */
export function parseModelsDev(payload: unknown): CatalogProvider[] {
  if (!payload || typeof payload !== 'object') return [];
  const out: CatalogProvider[] = [];

  for (const [providerId, raw] of Object.entries(payload as Record<string, any>)) {
    if (!raw || typeof raw !== 'object' || !raw.models || typeof raw.models !== 'object') continue;

    const models: CatalogModel[] = [];
    for (const [modelId, model] of Object.entries(raw.models as Record<string, any>)) {
      if (!model || typeof model !== 'object' || model.deprecated === true) continue;
      models.push({
        id: modelId,
        name: typeof model.name === 'string' && model.name.trim() ? model.name : modelId,
        provider: providerId,
        contextWindow: kTokens(model.context_window ?? model.contextWindow),
        supportsTools: model.tool_call === true,
        supportsImage: Array.isArray(model.input_modalities) && model.input_modalities.includes('image'),
        supportsReasoning: model.reasoning === true,
      });
    }

    if (models.length === 0) continue;
    out.push({
      id: providerId,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : providerId,
      env: Array.isArray(raw.env) ? raw.env.filter((e: unknown): e is string => typeof e === 'string') : [],
      models: models.sort((a, b) => a.name.localeCompare(b.name)),
      ...(typeof raw.api === 'string' && raw.api.trim() ? { api: raw.api.trim() } : {}),
      ...(typeof raw.doc === 'string' && raw.doc.trim() ? { doc: raw.doc.trim() } : {}),
    });
  }

  return out;
}

/**
 * Catálogo mínimo de OpenAI y NVIDIA.
 *
 * models.dev suele publicar ambos, pero el gestor tiene que enseñar algo útil
 * aunque el catálogo vivo falle o tarde. NVIDIA sólo lista los modelos NIM
 * gratuitos más habituales; la lista real se refresca desde su API al probar
 * la clave y en `/api/models/live`.
 */
const OPENAI_FALLBACK_MODELS: CatalogModel[] = [
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', contextWindow: '1M tokens', supportsTools: true, supportsImage: true },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', provider: 'openai', contextWindow: '1M tokens', supportsTools: true, supportsImage: true },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: '128K tokens', supportsTools: true, supportsImage: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai', contextWindow: '128K tokens', supportsTools: true, supportsImage: true },
  { id: 'o4-mini', name: 'o4-mini', provider: 'openai', contextWindow: '200K tokens', supportsTools: true, supportsReasoning: true },
];

const NVIDIA_FALLBACK_MODELS: CatalogModel[] = [
  { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', provider: 'nvidia', contextWindow: '128K tokens', supportsTools: true },
  { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct', provider: 'nvidia', contextWindow: '128K tokens', supportsTools: true },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Llama 3.1 Nemotron 70B', provider: 'nvidia', contextWindow: '128K tokens', supportsTools: true },
  { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1', provider: 'nvidia', contextWindow: '128K tokens', supportsReasoning: true },
  { id: 'qwen/qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B', provider: 'nvidia', contextWindow: '32K tokens' },
  { id: 'mistralai/mistral-7b-instruct-v0.3', name: 'Mistral 7B Instruct', provider: 'nvidia', contextWindow: '32K tokens' },
];

/** Modelos que el catálogo base conoce y models.dev no publica (HF/Ollama/custom). */
function fallbackModels(providerId: string): CatalogModel[] {
  if (providerId === 'openai') return [...OPENAI_FALLBACK_MODELS];
  if (providerId === 'nvidia') return [...NVIDIA_FALLBACK_MODELS];
  const source =
    providerId === 'google'
      ? GEMINI_MODELS
      : providerId === 'huggingface'
        ? HUGGINGFACE_MODELS
        : providerId === 'ollama'
          ? OLLAMA_MODELS
          : providerId === 'custom'
            ? CUSTOM_MODELS
            : [];
  return source
    .map((m) => ({
      id: m.id,
      name: m.name,
      provider: providerId,
      contextWindow: m.contextWindow,
      supportsTools: m.supportsTools,
      supportsImage: m.supportsImage,
      supportsReasoning: m.supportsThinking,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Estado de un proveedor según la config de fichero y las variables de entorno.
 *
 * `ollama` cuenta como configurado con su host por defecto: funciona sin tocar
 * nada si el servidor local está levantado.
 */
export function describeProvider(
  spec: ProviderSpec,
  config: Record<string, any> | undefined,
  envIds: ReadonlySet<string>
): ProviderStatus {
  const conf = (config?.[spec.id] || {}) as Record<string, unknown>;
  const filled = (name: string) => typeof conf[name] === 'string' && (conf[name] as string).trim().length > 0;

  const fromEnv = envIds.has(spec.id);
  // Si la credencial llega por entorno, no falta ningún campo: exigir además
  // que esté en el fichero marcaría como «sin configurar» algo que funciona.
  const missing = fromEnv ? [] : spec.fields.filter((f) => f.required && !filled(f.name)).map((f) => f.name);
  const hasAny = spec.fields.some((f) => filled(f.name));
  const local = spec.id === 'ollama' || spec.id === 'lmstudio';

  return {
    configured: missing.length === 0 && (hasAny || fromEnv || local),
    missing,
    source: fromEnv ? 'env' : hasAny ? 'file' : local ? 'local' : 'none',
  };
}

/** Une specs, estado y catálogo en la lista que consume la UI. */
export function buildProviderList(
  config: Record<string, any> | undefined,
  envIds: ReadonlySet<string>,
  catalog: CatalogProvider[]
): ProviderEntry[] {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const added = customProviderSpecs(config);
  const addedEntries = (config?.openaiCompatible || {}) as Record<string, any>;

  return [...PROVIDER_SPECS, ...added].map((spec) => {
    const cat = byId.get(spec.id);
    const entry = spec.custom ? addedEntries[spec.id] : undefined;
    // Los proveedores añadidos declaran sus modelos al configurarse: no hay
    // catálogo de models.dev que consultar para ellos.
    const allModels: CatalogModel[] = entry
      ? (Array.isArray(entry.models) ? entry.models : []).map((id: string) => ({
          // El id lleva el prefijo para que las listas del proveedor y el
          // selector apaguen/reactiven exactamente el mismo modelo.
          id: compatibleModelId(spec.id, id),
          name: id,
          provider: spec.id,
        }))
      : cat && cat.models.length > 0
        ? cat.models
        : fallbackModels(spec.id);
    const scopedConfig = entry ? { [spec.id]: entry } : config;
    const filter = modelFilterOf(scopedConfig, spec.id);
    // Las listas se aplican aquí y no en la UI: el conteo del gestor, el orden
    // y los selectores tienen que ver exactamente lo mismo.
    const models: CatalogModel[] = filterModelIds(allModels, filter);
    const env = [...new Set([...(cat?.env ?? []), ...spec.env])];
    return {
      ...spec,
      env,
      ...describeProvider(spec, scopedConfig, envIds),
      models,
      modelCount: models.length,
      totalModels: allModels.length,
      enabled: isProviderEnabled(scopedConfig, spec.id),
      whitelist: filter.whitelist,
      blacklist: filter.blacklist,
    };
  }).sort((a, b) =>
    Number(b.configured) - Number(a.configured) ||
    Number(b.enabled) - Number(a.enabled) ||
    a.name.localeCompare(b.name));
}

const CACHE_TTL_MS = 10 * 60 * 1000;
// LM Studio queda fuera del catálogo de models.dev a propósito: sus modelos
// dependen de lo que tenga cargado *tu* servidor, así que sólo entran por la
// consulta en vivo a su host. Si no responde, no hay modelos que ofrecer.
const SUPPORTED = new Set(PROVIDER_SPECS.map((s) => s.id).filter((id) => id !== 'lmstudio'));

let catalogCache: { at: number; data: CatalogProvider[] } | null = null;
let inFlight: Promise<CatalogProvider[]> | null = null;

/**
 * Catálogo de los proveedores soportados, con caché.
 *
 * Si models.dev no responde se devuelve lo último cacheado (o vacío): el
 * registro base sigue sirviendo modelos vía `fallbackModels`.
 */
/** Catálogo completo de models.dev (200+ proveedores), sin filtrar. */
export async function getAllProviderCatalog(): Promise<CatalogProvider[]> {
  if (catalogCache && Date.now() - catalogCache.at < CACHE_TTL_MS) return catalogCache.data;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch('https://models.dev/api.json', {
        headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
        // models.dev pesa varios MB y en conexiones lentas tarda más de un
        // minuto: un timeout corto deja el buscador de proveedores vacío.
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`models.dev HTTP ${res.status}`);
      const data = await res.json();
      const catalog = parseModelsDev(data);
      catalogCache = { at: Date.now(), data: catalog };
      return catalog;
    } catch (e) {
      console.warn('[providers] catálogo models.dev no disponible:', (e as Error).message);
      return catalogCache?.data ?? [];
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export async function getProviderCatalog(): Promise<CatalogProvider[]> {
  return (await getAllProviderCatalog()).filter((p) => SUPPORTED.has(p.id));
}
