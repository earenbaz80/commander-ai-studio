/**
 * Utilidades de LM Studio compartidas por el servidor y los tests.
 *
 * El host puede venir de un equipo de la LAN y escribirse de varias formas
 * (`192.168.1.20:1234`, `http://IP:1234`, `http://IP:1234/v1`). La API OpenAI
 * de LM Studio siempre vive en `/v1`; pedir `/models` en la raíz devolvía 404
 * aunque el servidor estuviera conectado, que era el fallo remoto reportado.
 */

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
