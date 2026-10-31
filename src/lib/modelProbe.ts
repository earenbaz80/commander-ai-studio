/**
 * Sonda de modelo: una llamada mínima para saber si un modelo responde.
 *
 * Vive en `src/lib` porque la usan dos sitios muy distintos y no conviene que
 * cada uno invente su propia interpretación de la respuesta:
 *   • `evals/preflight.ts` — antes de gastar las tareas de una pasada live;
 *   • el editor de la cadena de respaldo — antes de guardar un modelo.
 *
 * Sin dependencias de Node: sólo `fetch`, para que también corra en el panel.
 *
 * El endpoint es el mismo que usa el chat para ese modelo (`resolveEndpoint`),
 * no uno fijo: preguntar por otra vía mediría algo que el usuario nunca va a
 * ejecutar, y con un id de Freebuff u otro proveedor la sonda ni acertaría el
 * handler.
 */
import { resolveEndpoint } from './aiProviders';

/** Presupuesto de la sonda: un modelo lento no debe colgar la interfaz. */
export const PREFLIGHT_TIMEOUT_MS = 60_000;

/** Texto de la sonda. Corto a propósito: sólo hace falta que el proveedor conteste. */
const PROBE_PROMPT = 'ping';

export interface PreflightProbe {
  /** `ok` mide el modelo pedido; `substituted` midió otro; `failed` no midió nada. */
  status: 'ok' | 'substituted' | 'failed';
  /** Quién contestó, cuando contestó alguien. */
  model?: string;
  fallback?: { from: string; to: string };
  /** Por qué no hubo respuesta (HTTP, timeout, red). */
  error?: string;
}

/**
 * Una llamada mínima al modelo para saber si está vivo.
 *
 * No lanza: un fallo de red es un resultado (`failed`) con su motivo, porque
 * quien decide qué hacer con él es el llamador.
 *
 * `disableFallback` envía `fallbackModels: []`: el servidor no cambia de modelo
 * y un fallo se ve como fallo. Es lo que quiere un botón que dice «probar ESTE
 * modelo»; sin él, «✓» podría significar que respondió otro.
 */
export interface ChainAttempt {
  model: string;
  status: PreflightProbe['status'];
  /** Motivo legible del intento, listo para mostrar. */
  detail: string;
}

export interface ChainProbeResult {
  /** Índice del primero que respondió; -1 si ninguno. */
  answeredIndex: number;
  answeredModel?: string;
  attempts: ChainAttempt[];
}

/**
 * Recorre la cadena EN ORDEN y para en el primero que responde: es lo que hará
 * el servidor con la misma lista, así que probar más allá sería gastar llamadas
 * para saber algo que ya no se va a usar.
 *
 * La sonda se inyecta para poder probar el recorrido sin red. Una sustitución
 * NO cuenta como respuesta: si se pidió un modelo y contestó otro, ese modelo
 * no está sirviendo.
 */
export async function probeFirstResponder(
  models: string[],
  probe: (model: string) => Promise<PreflightProbe>
): Promise<ChainProbeResult> {
  const attempts: ChainAttempt[] = [];
  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    const result = await probe(model);
    const detail =
      result.status === 'ok'
        ? `${model} responde`
        : result.status === 'substituted'
        ? `${result.fallback?.from ?? model} no respondió; contestó ${result.fallback?.to ?? 'otro modelo'}`
        : `${model}: ${result.error || 'sin respuesta'}`;
    attempts.push({ model, status: result.status, detail });
    if (result.status === 'ok') {
      return { answeredIndex: index, answeredModel: result.model || model, attempts };
    }
  }
  return { answeredIndex: -1, attempts };
}

export async function probeModel(opts: {
  /** Origen del servidor; `''` = mismo origen (el propio panel). */
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  disableFallback?: boolean;
  /** Inyectable para las pruebas; por defecto el `fetch` del proceso. */
  fetchImpl?: typeof fetch;
}): Promise<PreflightProbe> {
  const timeoutMs = opts.timeoutMs ?? PREFLIGHT_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(`${opts.baseUrl}${resolveEndpoint(opts.model)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: PROBE_PROMPT,
        model: opts.model,
        maxTokens: 8,
        ...(opts.disableFallback ? { fallbackModels: [] } : {}),
      }),
      signal: controller.signal,
    });
    const body: any = await res.json().catch(() => null);

    if (!res.ok || body?.success !== true) {
      // El servidor ya distingue el caso de la key ausente; se conserva.
      const detail =
        typeof body?.error === 'string' && body.error.trim()
          ? body.error.trim()
          : res.statusText || 'sin detalle';
      return { status: 'failed', error: `HTTP ${res.status}: ${detail}` };
    }

    const from = typeof body?.fallback?.from === 'string' ? body.fallback.from.trim() : '';
    const to = typeof body?.fallback?.to === 'string' ? body.fallback.to.trim() : '';
    if (from && to) return { status: 'substituted', fallback: { from, to }, model: to };

    return { status: 'ok', model: typeof body?.model === 'string' ? body.model : opts.model };
  } catch (e: any) {
    const aborted = e?.name === 'AbortError';
    return {
      status: 'failed',
      error: aborted ? `sin respuesta en ${Math.round(timeoutMs / 1000)}s` : e?.message || String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}
