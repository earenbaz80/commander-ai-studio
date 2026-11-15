/**
 * Errores tipificados del adaptador de Strata local y reintento seguro.
 *
 * El host devuelve errores con formas distintas (OpenAI-compatible, texto
 * plano, 401/429/504...), así que la clasificación se hace por estado y por el
 * mensaje del cuerpo. Un error tipificado permite que el servidor responda con
 * un código estable y que el cliente sepa si reintentar sin repetir un turno
 * que ya se había completado.
 */
import { redactStrataSecret } from './strataRedaction';

export const STRATA_ERROR_CODES = [
  'STRATA_INVALID_API_KEY',
  'STRATA_INSECURE_REMOTE',
  'STRATA_MODEL_NOT_LOADED',
  'STRATA_CONTEXT_EXCEEDED',
  'STRATA_TOOLS_UNSUPPORTED',
  'STRATA_TOOL_ARGUMENTS_INVALID',
  'STRATA_QUEUE_BUSY',
  'STRATA_TIMEOUT',
  'STRATA_MODEL_MISMATCH',
  'STRATA_CANCELLED',
  'STRATA_UNAVAILABLE',
  'STRATA_BAD_REQUEST',
] as const;

export type StrataErrorCode = (typeof STRATA_ERROR_CODES)[number];

interface StrataErrorDefaults {
  status: number;
  retryable: boolean;
  message: string;
  hint?: string;
}

const DEFAULTS: Record<StrataErrorCode, StrataErrorDefaults> = {
  STRATA_INVALID_API_KEY: {
    status: 401,
    retryable: false,
    message: 'Strata rechazó la API key.',
    hint: 'Revisa la clave en el panel de proveedores o define STRATA_API_KEY.',
  },
  STRATA_INSECURE_REMOTE: {
    status: 422,
    retryable: false,
    message: 'Strata remoto usa HTTP sin cifrar y la API key no se enviará.',
    hint: 'Usa HTTPS o confirma explícitamente el host inseguro para esta red.',
  },
  STRATA_MODEL_NOT_LOADED: {
    status: 409,
    retryable: false,
    message: 'Strata no tiene un modelo cargado.',
    hint: 'Carga un modelo desde el panel de Strata antes de enviar mensajes.',
  },
  STRATA_CONTEXT_EXCEEDED: {
    status: 413,
    retryable: false,
    message: 'La petición supera el contexto disponible del modelo.',
    hint: 'Reduce el historial o carga el modelo con un contexto mayor.',
  },
  STRATA_TOOLS_UNSUPPORTED: {
    status: 422,
    retryable: false,
    message: 'El modelo de Strata no soporta tool calling.',
    hint: 'Elige un modelo que publique herramientas o desactiva el modo agente.',
  },
  STRATA_TOOL_ARGUMENTS_INVALID: {
    status: 422,
    retryable: false,
    message: 'El modelo devolvió argumentos de herramienta inválidos.',
    hint: 'No se ejecutó ninguna herramienta; reintenta o usa otro modelo.',
  },
  STRATA_QUEUE_BUSY: {
    status: 429,
    retryable: true,
    message: 'La cola de Strata está ocupada.',
    hint: 'Espera unos segundos; el adaptador reintenta una vez de forma segura.',
  },
  STRATA_TIMEOUT: {
    status: 504,
    retryable: true,
    message: 'Strata no respondió a tiempo.',
    hint: 'El turno puede reintentarse; no se ha devuelto una respuesta parcial.',
  },
  STRATA_MODEL_MISMATCH: {
    status: 409,
    retryable: false,
    message: 'Strata tiene cargado otro modelo.',
    hint: 'Cambia el modelo desde el panel de Strata antes de enviar.',
  },
  STRATA_CANCELLED: {
    status: 499,
    retryable: false,
    message: 'Generación cancelada.',
  },
  STRATA_UNAVAILABLE: {
    status: 502,
    retryable: true,
    message: 'No se pudo conectar con Strata.',
    hint: 'Comprueba que el host local sigue en marcha.',
  },
  STRATA_BAD_REQUEST: {
    status: 400,
    retryable: false,
    message: 'Strata rechazó la petición.',
  },
};

export interface StrataErrorOptions {
  message?: string;
  hint?: string;
  /** Clave conocida que se elimina del mensaje antes de exponerlo. */
  secret?: string;
  httpStatus?: number;
  retryable?: boolean;
  retryAfterMs?: number;
  upstreamStatus?: number;
  details?: Record<string, unknown>;
}

export class StrataIntegrationError extends Error {
  readonly code: StrataErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly hint?: string;
  readonly upstreamStatus?: number;
  readonly details?: Record<string, unknown>;

  constructor(code: StrataErrorCode, options: StrataErrorOptions = {}) {
    const defaults = DEFAULTS[code];
    super(redactStrataSecret(options.message || defaults.message || code, options.secret));
    this.name = 'StrataIntegrationError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? defaults.status;
    this.retryable = options.retryable ?? defaults.retryable;
    this.retryAfterMs = options.retryAfterMs;
    this.hint = options.hint ?? defaults.hint;
    this.upstreamStatus = options.upstreamStatus;
    this.details = options.details;
  }
}

export function strataError(code: StrataErrorCode, options: StrataErrorOptions = {}): StrataIntegrationError {
  return new StrataIntegrationError(code, options);
}

export function isStrataIntegrationError(value: unknown): value is StrataIntegrationError {
  return value instanceof StrataIntegrationError;
}

/** Texto útil de un error de Strata sin asumir una forma concreta. */
export function strataErrorMessage(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim();
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const nested = record.error;
  if (typeof nested === 'string') return nested.trim();
  if (nested && typeof nested === 'object') {
    const message = (nested as Record<string, unknown>).message;
    if (typeof message === 'string') return message.trim();
  }
  for (const key of ['message', 'detail', 'error_description']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export interface StrataFailureInput {
  status?: number;
  payload?: unknown;
  message?: string;
  retryAfterMs?: number;
  aborted?: boolean;
  timedOut?: boolean;
  /** API key conocida; se redacta tanto del mensaje como del cuerpo del host. */
  secret?: string;
}

const TIMEOUT_RE = /timed?\s*out|timeout|etimedout|no respondió a tiempo|operation was aborted/i;
const MODEL_NOT_LOADED_RE =
  /model[^.]{0,40}(not loaded|isn't loaded|is not loaded|no cargado|not ready|sin cargar)|no model (?:is )?loaded|model_not_loaded/i;
const CONTEXT_RE =
  /context[^.]{0,40}(length|window|size|limit|exceed|too long)|maximum context|too many tokens|prompt is too long|context_length_exceeded|n_ctx|kv cache|exceeds?[^.]{0,30}context/i;
const QUEUE_RE = /queue|busy|overloaded|over capacity|at capacity|concurr|try again|server is busy/i;
const AUTH_RE = /invalid[^.]{0,20}(api[-_ ]?key|key|token)|api[-_ ]?key[^.]{0,20}(invalid|rejected)|unauthori[sz]ed|authentication|forbidden/i;

/**
 * Convierte un fallo del host (o del transporte) en un error estable.
 * El orden importa: un 400 con «model not loaded» no es un contexto excedido.
 */
export function classifyStrataFailure(input: StrataFailureInput): StrataIntegrationError {
  const status = Number(input.status);
  const text = redactStrataSecret(
    `${input.message || ''} ${strataErrorMessage(input.payload)}`,
    input.secret
  ).trim();
  const lower = text.toLowerCase();

  if (input.timedOut || status === 408 || status === 504 || TIMEOUT_RE.test(lower)) {
    return strataError('STRATA_TIMEOUT', {
      ...(text ? { message: text } : {}),
      upstreamStatus: Number.isFinite(status) ? status : undefined,
    });
  }
  if (input.aborted) {
    return strataError('STRATA_CANCELLED', {
      message: 'Generación cancelada.',
      upstreamStatus: Number.isFinite(status) ? status : undefined,
    });
  }
  if (status === 401 || status === 403 || AUTH_RE.test(lower)) {
    return strataError('STRATA_INVALID_API_KEY', {
      ...(text ? { message: text } : {}),
      upstreamStatus: Number.isFinite(status) ? status : undefined,
    });
  }
  if (MODEL_NOT_LOADED_RE.test(lower)) {
    return strataError('STRATA_MODEL_NOT_LOADED', {
      ...(text ? { message: text } : {}),
      upstreamStatus: Number.isFinite(status) ? status : undefined,
    });
  }
  if (status === 413 || CONTEXT_RE.test(lower)) {
    return strataError('STRATA_CONTEXT_EXCEEDED', {
      ...(text ? { message: text } : {}),
      upstreamStatus: Number.isFinite(status) ? status : undefined,
    });
  }
  if (status === 429 || QUEUE_RE.test(lower)) {
    return strataError('STRATA_QUEUE_BUSY', {
      ...(text ? { message: text } : {}),
      retryAfterMs: input.retryAfterMs,
      upstreamStatus: Number.isFinite(status) ? status : undefined,
    });
  }
  if (status === 400 || status === 422) {
    return strataError('STRATA_BAD_REQUEST', {
      ...(text ? { message: text } : {}),
      upstreamStatus: status,
    });
  }
  return strataError('STRATA_UNAVAILABLE', {
    ...(text ? { message: text } : {}),
    ...(Number.isFinite(status) ? { upstreamStatus: status } : {}),
    // Un 404/500 no se reintenta; una caída de red o un 502/503 sí.
    retryable: !Number.isFinite(status) || status === 502 || status === 503,
  });
}

/** Cuerpo HTTP estable para que la UI y los tests no dependan del texto libre. */
export function strataErrorPayload(error: StrataIntegrationError) {
  return {
    ok: false,
    success: false,
    code: error.code,
    error: error.message,
    retryable: error.retryable,
    ...(error.hint ? { hint: error.hint } : {}),
    ...(error.retryAfterMs != null ? { retryAfterMs: error.retryAfterMs } : {}),
    ...(error.upstreamStatus != null ? { upstreamStatus: error.upstreamStatus } : {}),
    ...(error.details ? error.details : {}),
  };
}

/** `Retry-After` acepta segundos o una fecha HTTP; se limita a un minuto. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), 60_000);
  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(Math.max(0, date - now), 60_000);
}

function errorName(value: unknown): string {
  return value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string'
    ? String((value as { name: string }).name)
    : '';
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value || '');
}

function isTimeoutFailure(value: unknown): boolean {
  const name = errorName(value);
  return name === 'TimeoutError' || TIMEOUT_RE.test(errorMessage(value));
}

async function readFailurePayload(response: Response): Promise<unknown> {
  const text = await response.clone().text().catch(() => '');
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface StrataRetryOptions {
  /** Incluye el primer intento. Por defecto 2 (original + un reintento). */
  maxAttempts?: number;
  /** Espera base cuando el host no manda `Retry-After`. */
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Clave conocida para que ningún error del host la repita. */
  secret?: string;
}

/**
 * Reintenta sólo fallos transitorios (cola ocupada/timeout) y sólo antes de
 * consumir el cuerpo. Para streaming eso significa que nunca se reemiten
 * chunks ya enviados: una vez que el llamador empieza a leer, este helper ya
 * terminó y no vuelve a pedir el turno.
 */
export async function fetchStrataWithRetry(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  options: StrataRetryOptions = {}
): Promise<Response> {
  const maxAttempts = Math.max(1, Math.round(options.maxAttempts ?? 2));
  const baseDelayMs = Math.max(0, Math.round(options.baseDelayMs ?? 250));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let last: StrataIntegrationError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (init.signal?.aborted) {
      const reason = init.signal.reason;
      throw classifyStrataFailure({
        aborted: true,
        timedOut: isTimeoutFailure(reason),
        message: errorMessage(reason),
        secret: options.secret,
      });
    }

    let response: Response;
    try {
      response = await fetchImpl(input, init);
    } catch (error) {
      const failure = classifyStrataFailure({
        aborted: Boolean(init.signal?.aborted),
        timedOut: isTimeoutFailure(error),
        message: errorMessage(error),
        secret: options.secret,
      });
      last = failure;
      if (!failure.retryable || attempt >= maxAttempts) throw failure;
      await sleep(failure.retryAfterMs ?? baseDelayMs * attempt);
      continue;
    }

    if (response.ok) return response;

    const failure = classifyStrataFailure({
      status: response.status,
      payload: await readFailurePayload(response),
      message: response.statusText,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
      secret: options.secret,
    });
    last = failure;
    if (!failure.retryable || attempt >= maxAttempts) throw failure;
    await sleep(failure.retryAfterMs ?? baseDelayMs * attempt);
  }

  throw last ?? strataError('STRATA_UNAVAILABLE');
}
