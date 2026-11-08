/**
 * Utilidades de LM Studio compartidas por el servidor, los clientes y los tests.
 *
 * El host puede venir de un equipo de la LAN y escribirse de varias formas
 * (`192.168.1.20:1234`, `http://IP:1234`, `http://IP:1234/v1`). La API OpenAI
 * de LM Studio siempre vive en `/v1`; pedir `/models` en la raíz devolvía 404
 * aunque el servidor estuviera conectado, que era el fallo remoto reportado.
 */

/**
 * Tiempo máximo que el servidor espera a que LM Studio cargue un modelo antes
 * de empezar a generar. Es la fuente única del presupuesto de carga: los
 * clientes deben derivar de aquí su timeout para no cortar antes que el
 * servidor.
 */
export const LMSTUDIO_LOAD_TIMEOUT_MS = 5 * 60_000;

/** Devuelve un host absoluto y con la base `/v1` que espera LM Studio. */
export function normalizeLmStudioHost(raw: string): string {
  let host = String(raw || '').trim() || 'http://localhost:1234';
  // Sin esquema, `fetch` falla con un error opaco; en la LAN se asume http.
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
  host = host.replace(/\/+$/, '');
  if (!/\/v\d+$/i.test(host)) host += '/v1';
  return host;
}

/**
 * `local` si el host apunta a este equipo y `remoto` si es de la red.
 *
 * Se usa para nombrar cada servidor en la UI: el de casa y el del portátil
 * pueden estar configurados a la vez y no deben aparecer como «LM Studio» a
 * secas, porque no se sabe cuál es cuál.
 */
export function lmStudioHostScope(host: string): 'local' | 'remoto' {
  try {
    const hostname = new URL(normalizeLmStudioHost(host)).hostname.replace(/^\[|\]$/g, '');
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' ? 'local' : 'remoto';
  } catch {
    return 'remoto';
  }
}

/** Convierte el contexto de LM Studio a un entero positivo, o `undefined`. */
export function toLmStudioContextLength(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

/**
 * Contexto real de una entrada de `/api/v0/models` o `/api/v1/models`.
 *
 * Si el modelo está cargado se prefiere el contexto de la instancia; si no,
 * LM Studio sólo publica su máximo (`max_context_length`).
 */
export function lmStudioContextLength(entry: unknown): number | undefined {
  const item = entry as any;
  if (!item || typeof item !== 'object') return undefined;
  const loaded = toLmStudioContextLength(item.loaded_context_length);
  if (loaded) return loaded;
  const instances = Array.isArray(item.loaded_instances) ? item.loaded_instances : [];
  for (const instance of instances) {
    const context = toLmStudioContextLength(instance?.config?.context_length);
    if (context) return context;
  }
  return toLmStudioContextLength(item.max_context_length);
}

/** Mapa id → context_length a partir de cualquiera de las dos respuestas. */
export function parseLmStudioContextLengths(payload: unknown): Record<string, number> {
  const data = payload as any;
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  const out: Record<string, number> = {};
  for (const item of list) {
    const id = typeof item === 'string' ? item : item?.id || item?.key || item?.name;
    const context = lmStudioContextLength(item);
    if (typeof id !== 'string' || !id || !context) continue;
    out[id] = context;
    const variants = [item?.selected_variant, ...(Array.isArray(item?.variants) ? item.variants : [])];
    for (const variant of variants) {
      if (typeof variant === 'string' && variant) out[variant] = context;
    }
  }
  return out;
}

/**
 * Extrae ids de las dos formas de respuesta de LM Studio:
 * OpenAI (`{ data: [{ id }] }`) y nativa (`{ data: [{ id, type }] }` o strings).
 */
export function parseLmStudioModels(payload: unknown): string[] {
  const data = payload as any;
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  const out: string[] = [];
  for (const item of list) {
    const id = typeof item === 'string' ? item : item?.id || item?.name;
    if (typeof id === 'string' && id && !out.includes(id)) out.push(id);
  }
  return out;
}
