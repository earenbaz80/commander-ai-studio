/**
 * Strata local, como endpoint OpenAI-compatible.
 *
 * El host de Strata expone `/v1/models`, `/v1/status` y
 * `/v1/chat/completions` en loopback. Esta integración descubre modelos con sus
 * metadatos, comprueba que el host es realmente Strata y prepara los ids del
 * selector; no reimplementa el motor nativo ni habla con Strata Cloud.
 */
import { parseStrataToolCapabilities } from './strataTools';
import { redactStrataSecret } from './strataRedaction';

export const STRATA_LOCAL_PROVIDER_ID = 'strata-local';
export const STRATA_LOCAL_PROVIDER_NAME = 'Strata (local)';
/** Host local por defecto de Strata (`strata serve`), con su prefijo `/v1`. */
export const STRATA_LOCAL_DEFAULT_BASE_URL = 'http://127.0.0.1:8080/v1';

export type StrataLocalStatus = 'ok' | 'auth' | 'unreachable' | 'incompatible';

export interface StrataLocalModelInfo {
  id: string;
  name: string;
  /** Ventana que el host declara para este modelo, si la publica. */
  contextWindow?: number;
  /** Instancia cargada en Strata; permite distinguir modelos con el mismo id. */
  instanceId?: string;
  gpuIds?: string[];
  mode?: string;
  label?: string;
  /** `status.value` que publica Strata (`loaded` o `unloaded`). */
  status?: string;
  aliases?: string[];
  /** El modelo declara tool calling; `undefined` en hosts sin metadatos. */
  supportsTools?: boolean;
  supportsParallelTools?: boolean;
  /** Modalidades de entrada (`architecture.input_modalities`). */
  inputModalities?: string[];
}

export interface StrataLocalStatusInfo {
  /** `true` cuando `/v1/status` dice `service: "strata"`. */
  verified: boolean;
  service?: string;
  loaded?: boolean;
  model?: string;
  contextWindow?: number;
  dialects?: string[];
  engine?: string;
  uptimeSeconds?: number;
  requests?: number;
  inFlight?: number;
  lastRequestAt?: number;
  concurrency?: { serving?: number; requested?: number };
  vision?: boolean;
  vram?: { freeMib?: number; expertCacheMib?: number; elastic?: boolean };
  machine?: {
    gpu?: { name?: string; usedMib?: number; totalMib?: number; utilPct?: number; tempC?: number; powerW?: number };
    ram?: { usedGib?: number; totalGib?: number };
  };
}

export interface StrataLocalProbe {
  ok: boolean;
  status: StrataLocalStatus;
  models: string[];
  /** Modelos vivos; incluye el cargado de `/v1/status` si falta en `/v1/models`. */
  entries: StrataLocalModelInfo[];
  latencyMs: number;
  httpStatus?: number;
  error?: string;
  /** Identidad del endpoint: verificada por `/v1/status` o sólo compatible. */
  identity: 'verified' | 'unverified';
  statusInfo?: StrataLocalStatusInfo;
  /** Estado del modelo cargado, cuando el host lo declara. */
  loaded?: boolean;
  model?: string;
  contextWindow?: number;
  /** El host no está en loopback. */
  remote: boolean;
  /** Host remoto por HTTP: la API key viajaría sin cifrar. */
  insecureRemote: boolean;
  warning?: string;
  /**
   * La URL configurada resulta ser el monitor de Strata, no el servidor del
   * modelo. El monitor publica en `/api/native` las instancias reales; se
   * incluyen aquí para que la UI pueda ofrecer la URL correcta sin adivinar.
   */
  monitor?: StrataMonitorInfo;
}

export interface StrataMonitorInfo {
  /** URLs de los motores listos que publica el monitor. */
  engineUrls: string[];
}

export interface StrataLocalEndpointInfo {
  remote: boolean;
  insecureRemote: boolean;
  hostname: string;
  protocol: string;
  warning?: string;
}

const toPositiveInt = (value: unknown): number | undefined => {
  const number = typeof value === 'string' ? Number(value.replace(/[^0-9.]/g, '')) : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
};

/** `true` para loopback, `localhost` y las formas IPv4/IPv6 locales. */
export function isStrataLoopbackHost(hostname: string): boolean {
  const value = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return (
    value === 'localhost' ||
    value === '::1' ||
    value === '0:0:0:0:0:0:0:1' ||
    /^127(?:\.\d{1,3}){3}$/.test(value)
  );
}

/** Aviso de seguridad para un host de Strata, sin lanzar por una URL inválida. */
export function strataLocalEndpointInfo(value: string): StrataLocalEndpointInfo {
  try {
    const parsed = new URL(normalizeStrataLocalBaseUrl(value));
    const remote = !isStrataLoopbackHost(parsed.hostname);
    const insecureRemote = remote && parsed.protocol === 'http:';
    return {
      remote,
      insecureRemote,
      hostname: parsed.hostname,
      protocol: parsed.protocol.replace(':', ''),
      ...(insecureRemote
        ? {
            warning:
              'Strata está en otro equipo por HTTP: la API key y los prompts viajan sin cifrar. Usa HTTPS o una red de confianza.',
          }
        : {}),
    };
  } catch {
    return { remote: false, insecureRemote: false, hostname: '', protocol: '' };
  }
}

/**
 * Normaliza la URL base. Un host sin ruta se completa con `/v1`: es la forma
 * que publica Strata y evita que `/models` acabe en la raíz del host.
 */
export function normalizeStrataLocalBaseUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return STRATA_LOCAL_DEFAULT_BASE_URL;
  const withoutSlash = raw.replace(/\/+$/, '');
  try {
    const parsed = new URL(withoutSlash);
    if (!parsed.pathname || parsed.pathname === '/') return `${withoutSlash}/v1`;
  } catch {
    /* se devuelve tal cual; la sonda dará el error de URL */
  }
  return withoutSlash;
}

/**
 * Raíz del monitor a partir de la URL configurada. El monitor sirve su API en
 * `/api/*` en la raíz, mientras que el endpoint OpenAI vive en `/v1`.
 */
function strataMonitorRootUrl(baseUrl: string): string | undefined {
  try {
    const parsed = new URL(normalizeStrataLocalBaseUrl(baseUrl));
    parsed.pathname = parsed.pathname.replace(/\/v1\/?$/i, '') || '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

/** URL del motor a partir del puerto que publica el monitor. */
function strataEngineBaseUrl(monitorRoot: string, port: number): string | undefined {
  try {
    const parsed = new URL(monitorRoot);
    parsed.port = String(port);
    parsed.pathname = '/v1';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

/** Forma de `/api/health` del host/monitor, distinta de `/health` del motor. */
function isStrataMonitorHealth(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Record<string, unknown>;
  return Boolean(
    data.backend &&
      typeof data.backend === 'object' &&
      data.engine &&
      typeof data.engine === 'object'
  );
}

/**
 * Instancias que el monitor conoce. El motor real puede estar en otro puerto
 * (por ejemplo el monitor en 47831 y el motor en 18500). Se descartan las
 * instancias sin puerto y las que no estén listas; nunca se copia su `key`.
 */
function parseStrataMonitorEngineUrls(payload: unknown, monitorRoot: string): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as Record<string, unknown>;
  const instances = Array.isArray(data.instances) ? data.instances : [];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const item of instances) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, any>;
    const status = typeof record.status === 'string' ? record.status.toLowerCase() : '';
    if (status && status !== 'ready' && status !== 'running') continue;
    const port = toPositiveInt(record.port);
    if (!port) continue;
    const baseUrl = strataEngineBaseUrl(monitorRoot, port);
    if (!baseUrl || seen.has(baseUrl)) continue;
    seen.add(baseUrl);
    urls.push(baseUrl);
  }
  return urls;
}

/**
 * Detecta el host de escritorio de Strata por su `/api/health` público y lee
 * las instancias de `/api/native`. Se hace sólo cuando el endpoint OpenAI
 * devuelve 401/403, para no añadir peticiones a un Strata normal.
 */
async function probeStrataMonitor(
  baseUrl: string,
  fetcher: typeof fetch,
  timeoutMs: number
): Promise<StrataMonitorInfo | undefined> {
  const root = strataMonitorRootUrl(baseUrl);
  if (!root) return undefined;
  const monitorTimeout = Math.min(timeoutMs, 1_500);
  try {
    const healthResponse = await fetcher(`${root}/api/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(monitorTimeout),
    });
    if (!healthResponse.ok) return undefined;
    const health = (await readJson(healthResponse)).payload;
    if (!isStrataMonitorHealth(health)) return undefined;
    const nativeResponse = await fetcher(`${root}/api/native`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(monitorTimeout),
    }).catch(() => null);
    const native = nativeResponse?.ok ? (await readJson(nativeResponse)).payload : null;
    return { engineUrls: parseStrataMonitorEngineUrls(native, root) };
  } catch {
    return undefined;
  }
}

/** Mensaje accionable cuando el host configurado es el monitor. */
function strataMonitorErrorMessage(monitor: StrataMonitorInfo): string {
  const engine = monitor.engineUrls[0];
  return engine
    ? `Esa URL es el monitor de Strata, no el servidor del modelo. El motor está en ${engine}; falta la API key o no coincide.`
    : 'Esa URL es el monitor de Strata, no el servidor del modelo. No hay un motor listo; inicia el modelo en Strata y usa la URL que muestre.';
}

/** Lista cruda de `/v1/models`, venga como `data` o como `models`. */
function rawModelList(payload: unknown): unknown[] | null {
  const data = payload as { data?: unknown; models?: unknown } | null;
  return Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : null;
}

/**
 * Metadatos de `/v1/models`.
 *
 * Strata publica `meta.n_ctx`, `status.value`, `architecture` y `aliases`; las
 * versiones antiguas sólo devuelven `id`. Se aceptan también `meta.context` y
 * los nombres planos de contexto de otros endpoints OpenAI-compatibles.
 */
export function parseStrataLocalModelEntries(payload: unknown): StrataLocalModelInfo[] {
  const list = rawModelList(payload);
  if (!list) return [];
  const seen = new Set<string>();
  const entries: StrataLocalModelInfo[] = [];
  for (const item of list) {
    const record = typeof item === 'object' && item ? (item as Record<string, any>) : null;
    const id = String(
      typeof item === 'string' ? item : record?.id || record?.name || ''
    ).trim();
    if (!id || seen.has(id)) continue;
    // Strata lista también cada alias con `alias_of`; el id canónico ya está
    // en la lista y duplicarlo en el selector sólo confunde al usuario.
    if (typeof record?.alias_of === 'string' && record.alias_of) continue;
    seen.add(id);
    const meta = record?.meta && typeof record.meta === 'object' ? record.meta : {};
    const statusValue =
      record?.status && typeof record.status === 'object' && typeof record.status.value === 'string'
        ? record.status.value
        : undefined;
    const contextWindow = toPositiveInt(
      meta.n_ctx ??
        meta.context ??
        record?.context_window ??
        record?.context_length ??
        record?.max_context ??
        record?.contextWindow
    );
    const aliases = Array.isArray(record?.aliases)
      ? record.aliases.map((alias: unknown) => String(alias)).filter(Boolean)
      : undefined;
    const toolCapabilities = parseStrataToolCapabilities(record);
    const inputModalities =
      Array.isArray(record?.architecture?.input_modalities)
        ? record.architecture.input_modalities.map((modality: unknown) => String(modality)).filter(Boolean)
        : undefined;
    const gpuIds = Array.isArray(meta.gpuIds)
      ? meta.gpuIds.map((gpu: unknown) => String(gpu)).filter(Boolean)
      : Array.isArray(meta.gpus)
        ? meta.gpus.map((gpu: unknown) => String(gpu)).filter(Boolean)
        : undefined;
    entries.push({
      id,
      name: String(record?.name || meta.label || id),
      ...(contextWindow ? { contextWindow } : {}),
      ...(typeof meta.instanceId === 'string' && meta.instanceId ? { instanceId: meta.instanceId } : {}),
      ...(gpuIds && gpuIds.length > 0 ? { gpuIds } : {}),
      ...(typeof meta.mode === 'string' && meta.mode ? { mode: meta.mode } : {}),
      ...(typeof meta.label === 'string' && meta.label ? { label: meta.label } : {}),
      ...(statusValue ? { status: statusValue } : {}),
      ...(aliases && aliases.length > 0 ? { aliases } : {}),
      ...(toolCapabilities.supportsTools !== undefined
        ? { supportsTools: toolCapabilities.supportsTools }
        : {}),
      ...(toolCapabilities.supportsParallelTools !== undefined
        ? { supportsParallelTools: toolCapabilities.supportsParallelTools }
        : {}),
      ...(inputModalities && inputModalities.length > 0 ? { inputModalities } : {}),
    });
  }
  return entries;
}

/** Ids planos, conservando la firma histórica que usa el resto de la app. */
export function parseStrataLocalModels(payload: unknown): string[] {
  return parseStrataLocalModelEntries(payload).map((entry) => entry.id);
}

/**
 * Añade el modelo que `/v1/status` declara cargado si `/v1/models` no lo
 * enumera. Algunos hosts sólo listan ahí los modelos descargados, o publican
 * el cargado con un alias; sin esta entrada el selector no puede ofrecerlo
 * aunque Strata ya lo tenga en memoria.
 */
export function includeStrataLoadedModel(
  entries: StrataLocalModelInfo[],
  statusInfo?: StrataLocalStatusInfo
): StrataLocalModelInfo[] {
  const loaded = statusInfo?.model?.trim();
  if (!loaded || statusInfo?.loaded === false) return entries;
  if (
    entries.some(
      (entry) => entry.id === loaded || entry.name === loaded || entry.aliases?.includes(loaded)
    )
  ) {
    return entries;
  }
  const contextWindow = statusInfo?.contextWindow;
  return [
    {
      id: loaded,
      name: loaded,
      status: 'loaded',
      ...(contextWindow ? { contextWindow } : {}),
    },
    ...entries,
  ];
}

/**
 * Normaliza `/v1/status`. Sólo se considera verificado si el host se identifica
 * como Strata (`service: "strata"`); una respuesta con `loaded` y `model` pero
 * sin esa marca se deja como compatible no verificado para no aceptar un
 * servidor ajeno que ocupe el puerto.
 */
export function parseStrataLocalStatus(payload: unknown): StrataLocalStatusInfo | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const data = payload as Record<string, any>;
  const context = data.context && typeof data.context === 'object' ? data.context : {};
  const activity = data.activity && typeof data.activity === 'object' ? data.activity : {};
  const concurrency = data.concurrency && typeof data.concurrency === 'object' ? data.concurrency : {};
  const vram = data.vram && typeof data.vram === 'object' ? data.vram : {};
  const machine = data.machine && typeof data.machine === 'object' ? data.machine : {};
  const gpu = machine.gpu && typeof machine.gpu === 'object' ? machine.gpu : null;
  const ram = machine.ram && typeof machine.ram === 'object' ? machine.ram : null;
  const service = typeof data.service === 'string' ? data.service : undefined;
  const vision = data.vision && typeof data.vision === 'object' ? data.vision.enabled === true : undefined;
  const contextWindow = toPositiveInt(context.native ?? context.max ?? context.maxTokens);
  return {
    verified: String(service || '').trim().toLowerCase() === 'strata',
    ...(service ? { service } : {}),
    ...(typeof data.loaded === 'boolean' ? { loaded: data.loaded } : {}),
    ...(typeof data.model === 'string' && data.model ? { model: data.model } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(Array.isArray(data.dialects) ? { dialects: data.dialects.map(String) } : {}),
    ...(typeof data.engine === 'string' && data.engine ? { engine: data.engine } : {}),
    ...(Number.isFinite(Number(data.uptime_s)) ? { uptimeSeconds: Number(data.uptime_s) } : {}),
    ...(Number.isFinite(Number(activity.requests)) ? { requests: Number(activity.requests) } : {}),
    ...(Number.isFinite(Number(activity.in_flight)) ? { inFlight: Number(activity.in_flight) } : {}),
    ...(Number.isFinite(Number(activity.last_request_at)) ? { lastRequestAt: Number(activity.last_request_at) } : {}),
    ...(Number.isFinite(Number(concurrency.serving)) || Number.isFinite(Number(concurrency.requested))
      ? {
          concurrency: {
            ...(Number.isFinite(Number(concurrency.serving)) ? { serving: Number(concurrency.serving) } : {}),
            ...(Number.isFinite(Number(concurrency.requested)) ? { requested: Number(concurrency.requested) } : {}),
          },
        }
      : {}),
    ...(typeof vision === 'boolean' ? { vision } : {}),
    ...(Object.keys(vram).length > 0
      ? {
          vram: {
            ...(Number.isFinite(Number(vram.vram_free_mib)) ? { freeMib: Number(vram.vram_free_mib) } : {}),
            ...(Number.isFinite(Number(vram.expert_cache_mib)) ? { expertCacheMib: Number(vram.expert_cache_mib) } : {}),
            ...(typeof vram.elastic === 'boolean' ? { elastic: vram.elastic } : {}),
          },
        }
      : {}),
    ...(gpu || ram
      ? {
          machine: {
            ...(gpu
              ? {
                  gpu: {
                    ...(typeof gpu.name === 'string' && gpu.name ? { name: gpu.name } : {}),
                    ...(Number.isFinite(Number(gpu.used_mib)) ? { usedMib: Number(gpu.used_mib) } : {}),
                    ...(Number.isFinite(Number(gpu.total_mib)) ? { totalMib: Number(gpu.total_mib) } : {}),
                    ...(Number.isFinite(Number(gpu.util_pct)) ? { utilPct: Number(gpu.util_pct) } : {}),
                    ...(Number.isFinite(Number(gpu.temp_c)) ? { tempC: Number(gpu.temp_c) } : {}),
                    ...(Number.isFinite(Number(gpu.power_w)) ? { powerW: Number(gpu.power_w) } : {}),
                  },
                }
              : {}),
            ...(ram
              ? {
                  ram: {
                    ...(Number.isFinite(Number(ram.used_gib)) ? { usedGib: Number(ram.used_gib) } : {}),
                    ...(Number.isFinite(Number(ram.total_gib)) ? { totalGib: Number(ram.total_gib) } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

export interface StrataCompactionInput {
  model: string;
  messages: Array<{ role: string; content: string }>;
  keepRecent?: number;
  systemInstruction?: string;
  baseUrl?: string;
  apiKey?: string;
  /** Ventana del modelo para que el servidor recorte también los turnos recientes. */
  contextWindow?: number;
  /** Salida reservada para el siguiente turno. */
  reservedTokens?: number;
  /** Herramientas reservadas para el siguiente turno. */
  toolTokens?: number;
  /** Borrador que se enviará después de compactar. */
  draftTokens?: number;
  fetchImpl?: typeof fetch;
}

export interface StrataCompactionResult {
  summary: string;
  kept: number;
  removed: number;
  /** Estimación del prompt antes de resumir; 0 si el host no la devuelve. */
  beforeTokens: number;
  /** Estimación del prompt que queda después de resumir. */
  afterTokens: number;
  savedTokens: number;
  savedPercent: number;
}

const positiveNumber = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
};

/**
 * Pide al modelo local un resumen de los turnos antiguos. La decisión de qué
 * mensajes se conservan la toma el servidor; el navegador sólo recibe el texto
 * y cuántos turnos quedaron. Nunca se llama sola: la UI la usa cuando el
 * historial impide que el mensaje nuevo quepa.
 */
export async function compactStrataThread(
  input: StrataCompactionInput,
  fetchImpl: typeof fetch = fetch
): Promise<StrataCompactionResult> {
  const response = await fetchImpl('/api/strata-local/compact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      keepRecent: input.keepRecent,
      systemInstruction: input.systemInstruction,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      ...(positiveNumber(input.contextWindow) ? { contextWindow: positiveNumber(input.contextWindow) } : {}),
      ...(positiveNumber(input.reservedTokens) ? { reservedTokens: positiveNumber(input.reservedTokens) } : {}),
      ...(positiveNumber(input.toolTokens) ? { toolTokens: positiveNumber(input.toolTokens) } : {}),
      ...(positiveNumber(input.draftTokens) ? { draftTokens: positiveNumber(input.draftTokens) } : {}),
    }),
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `No se pudo resumir el historial (HTTP ${response.status})`);
  }
  const beforeTokens = Math.max(0, Number(data.beforeTokens) || 0);
  const afterTokens = Math.max(0, Number(data.afterTokens) || 0);
  return {
    summary: String(data.summary || ''),
    kept: Math.max(0, Number(data.kept) || 0),
    removed: Math.max(0, Number(data.removed) || 0),
    beforeTokens,
    afterTokens,
    savedTokens: Math.max(0, Number(data.savedTokens) || beforeTokens - afterTokens),
    savedPercent: Math.max(0, Number(data.savedPercent) || 0),
  };
}

/** Id que entiende el selector: `strata-local/<modelo>`. */
export function strataLocalModelId(modelId: string): string {
  return `${STRATA_LOCAL_PROVIDER_ID}/${modelId}`;
}

/** Quita el prefijo del selector antes de mandar el modelo a Strata. */
export function strataLocalModelName(modelId: string): string {
  return String(modelId || '').replace(new RegExp(`^${STRATA_LOCAL_PROVIDER_ID}/`), '');
}

async function readJson(response: Response): Promise<{ payload: unknown; text: string }> {
  const text = await response.text().catch(() => '');
  try {
    return { payload: text ? JSON.parse(text) : null, text };
  } catch {
    return { payload: null, text };
  }
}

/**
 * Consulta `/v1/models` y `/v1/status` en paralelo. El estado es opcional: un
 * 404 en `/v1/status` deja la integración como compatible no verificada, no la
 * rompe. Un 401/403 significa que Strata responde pero la clave no vale.
 */
export async function probeStrataLocal(
  baseUrl: string,
  apiKey?: string,
  options: { timeoutMs?: number; fetcher?: typeof fetch } = {}
): Promise<StrataLocalProbe> {
  const url = normalizeStrataLocalBaseUrl(baseUrl);
  const endpoint = strataLocalEndpointInfo(url);
  const started = Date.now();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocolo');
  } catch {
    return {
      ok: false,
      status: 'incompatible',
      models: [],
      entries: [],
      latencyMs: 0,
      identity: 'unverified',
      remote: false,
      insecureRemote: false,
      error: 'URL base inválida (http o https)',
    };
  }

  const doFetch = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const headers = {
    ...(apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
    Accept: 'application/json',
  };
  const statusUrl = `${url}/status`;

  try {
    const [modelsResponse, statusResponse] = await Promise.all([
      doFetch(`${url}/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      }),
      doFetch(statusUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => null),
    ]);
    const { payload, text } = await readJson(modelsResponse);
    const statusPayload = statusResponse
      ? await readJson(statusResponse).then((result) => result.payload).catch(() => null)
      : null;
    const statusInfo = statusResponse?.ok ? parseStrataLocalStatus(statusPayload) : undefined;

    if (!modelsResponse.ok) {
      const monitor =
        modelsResponse.status === 401 || modelsResponse.status === 403
          ? await probeStrataMonitor(url, doFetch, timeoutMs)
          : undefined;
      return {
        ok: false,
        status: modelsResponse.status === 401 || modelsResponse.status === 403 ? 'auth' : 'incompatible',
        models: [],
        entries: [],
        latencyMs: Date.now() - started,
        httpStatus: modelsResponse.status,
        identity: statusInfo?.verified ? 'verified' : 'unverified',
        ...(statusInfo ? { statusInfo } : {}),
        ...(monitor ? { monitor } : {}),
        ...endpoint,
        error:
          monitor
            ? strataMonitorErrorMessage(monitor)
            : modelsResponse.status === 401 || modelsResponse.status === 403
              ? 'Strata rechazó la API key'
              : `HTTP ${modelsResponse.status}`,
      };
    }

    if (!rawModelList(payload)) {
      return {
        ok: false,
        status: 'incompatible',
        models: [],
        entries: [],
        latencyMs: Date.now() - started,
        httpStatus: modelsResponse.status,
        identity: statusInfo?.verified ? 'verified' : 'unverified',
        ...(statusInfo ? { statusInfo } : {}),
        ...endpoint,
        error: text.trim().startsWith('<') ? 'respondió HTML en vez de JSON' : 'respuesta sin lista de modelos',
      };
    }

    const entries = includeStrataLoadedModel(parseStrataLocalModelEntries(payload), statusInfo);
    const models = entries.map((entry) => entry.id);
    // Un `/v1/status` antiguo puede no publicar la ventana ni el estado: el
    // modelo cargado los trae en `/v1/models` (`meta.n_ctx`, `status.value`).
    const loadedModel = statusInfo?.model;
    const loadedEntry =
      (loadedModel
        ? entries.find(
            (entry) =>
              entry.id === loadedModel ||
              entry.name === loadedModel ||
              entry.aliases?.includes(loadedModel)
          )
        : undefined) ||
      entries.find((entry) => entry.status?.toLowerCase() === 'loaded') ||
      (entries.length === 1 ? entries[0] : undefined);
    const loaded =
      statusInfo?.loaded ??
      (loadedEntry?.status ? loadedEntry.status !== 'unloaded' : undefined);
    const contextWindow = statusInfo?.contextWindow || loadedEntry?.contextWindow;
    return {
      ok: true,
      status: 'ok',
      models,
      entries,
      latencyMs: Date.now() - started,
      httpStatus: modelsResponse.status,
      identity: statusInfo?.verified ? 'verified' : 'unverified',
      ...(statusInfo ? { statusInfo } : {}),
      ...(typeof loaded === 'boolean' ? { loaded } : {}),
      ...(statusInfo?.model ? { model: statusInfo.model } : {}),
      ...(!statusInfo?.model && loadedEntry ? { model: loadedEntry.id } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...endpoint,
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 'unreachable',
      models: [],
      entries: [],
      latencyMs: Date.now() - started,
      identity: 'unverified',
      ...endpoint,
      error: redactStrataSecret(
        error?.name === 'TimeoutError'
          ? `sin respuesta en ${Math.round(timeoutMs / 1000)} s`
          : error?.message || 'no se pudo conectar',
        apiKey
      ),
    };
  }
}
