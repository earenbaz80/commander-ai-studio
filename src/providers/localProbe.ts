/**
 * Sonda de proveedores locales (Ollama, LM Studio, OpenAI-compatible).
 *
 * Un proveedor local puede estar configurado y aun así no responder: el equipo
 * está apagado, en otra red, o el servidor no está levantado. Sin esta sonda la
 * UI sólo sabía «0 modelos», indistinguible de «sin configurar».
 */

export interface LocalProbeResult {
  reachable: boolean;
  /** Motivo cuando no responde (HTTP 503, timeout, conexión rechazada…). */
  error?: string;
}

/** Lo que tarda en caducar una respuesta: el gestor se abre varias veces. */
const TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: LocalProbeResult }>();

/** Endpoint que lista modelos en cada proveedor. */
export function localProbeUrl(id: string, host: string): string {
  const base = host.trim().replace(/\/+$/, '');
  // Ollama usa su API propia; LM Studio y los OpenAI-compatible, `/models`.
  return id === 'ollama' ? `${base}/api/tags` : `${base}/models`;
}

/** Vacía la caché: sólo para tests y diagnósticos. */
export function resetLocalProbeCache(): void {
  cache.clear();
}

export async function probeLocalProvider(
  id: string,
  host: string,
  options: { timeoutMs?: number; fetcher?: typeof fetch; ttlMs?: number } = {}
): Promise<LocalProbeResult> {
  const key = `${id}|${host}`;
  const ttl = options.ttlMs ?? TTL_MS;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;

  const doFetch = options.fetcher ?? fetch;
  let value: LocalProbeResult;
  try {
    const response = await doFetch(localProbeUrl(id, host), {
      headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
      // Corto: un host de otra red puede tardar en fallar y esto va en la
      // respuesta del gestor de proveedores.
      signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
    });
    value = response.ok ? { reachable: true } : { reachable: false, error: `HTTP ${response.status}` };
  } catch (error) {
    value = { reachable: false, error: error instanceof Error ? error.message : 'sin respuesta' };
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}
