/**
 * Adaptador de Strata AI (Kronisys).
 *
 * Hay dos despliegues con contratos distintos:
 * - La app local de Strata expone la API OpenAI-compatible:
 *   `GET /v1/models` y `POST /v1/chat/completions`.
 * - El Strata alojado usa `GET /v1/health` y `POST /v1/chat`.
 *
 * Se prueban primero las rutas OpenAI y, sólo si no existen (404/405), se
 * cae al contrato propio. Así la misma integración sirve para ambos sin pedir
 * al usuario que elija un «tipo» de Strata.
 */

export const STRATA_DEFAULT_BASE_URL = 'https://app.strata.kronisys.com/v1';
export const STRATA_DEFAULT_MODEL = 'gpt-5.4';

export interface StrataUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface StrataChatResult {
  content: string;
  model: string;
  usage: StrataUsage | null;
  raw: unknown;
}

export interface StrataChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function normalizeStrataBaseUrl(value?: string): string {
  return (String(value || '').trim() || STRATA_DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/** El host de Strata es configurable; el público es el valor por defecto. */
export function resolveStrataBaseUrl(configBaseUrl?: string): string {
  return normalizeStrataBaseUrl(process.env.STRATA_BASE_URL || configBaseUrl);
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'CommanderAIStudio/2.5',
  };
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const data = JSON.parse(text);
    const detail = data?.title || data?.detail || data?.error;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (detail && typeof detail === 'object') return JSON.stringify(detail);
    return `HTTP ${response.status}`;
  } catch {
    return text.trim() || `HTTP ${response.status}`;
  }
}

function modelIdsFrom(data: any): string[] {
  const list = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : data?.key?.allowed_models ?? data?.allowed_models;

  return Array.isArray(list)
    ? list
        .map((model) => (typeof model === 'string' ? model : model?.id))
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
}

/**
 * Catálogo real de la clave.
 *
 * `/models` es la ruta de la instancia local (OpenAI). El Strata alojado no
 * siempre la expone, así que un 404 se resuelve con `/health`, que devuelve
 * `key.allowed_models`.
 */
export async function fetchStrataModelIds(opts: {
  baseUrl?: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const baseUrl = normalizeStrataBaseUrl(opts.baseUrl);
  const models = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: headers(opts.apiKey),
    signal: opts.signal ?? AbortSignal.timeout(15_000),
  });

  if (models.ok) {
    return modelIdsFrom(await models.json().catch(() => ({})));
  }

  const modelsError = await errorMessage(models);
  if (models.status === 404) {
    const health = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: headers(opts.apiKey),
      signal: opts.signal ?? AbortSignal.timeout(15_000),
    });
    if (health.ok) {
      return modelIdsFrom(await health.json().catch(() => ({})));
    }
    const healthError = await errorMessage(health);
    throw new Error(`Strata health: ${healthError || modelsError}`);
  }

  throw new Error(`Strata models: ${modelsError}`);
}

function normalizeMessages(
  messages: Array<{ role?: string; content?: unknown }> | undefined,
  systemInstruction?: string
): StrataChatMessage[] {
  const normalized: StrataChatMessage[] = (messages || [])
    .filter((message) => message && typeof message === 'object')
    .map((message) => {
      const role: StrataChatMessage['role'] = message.role === 'assistant' || message.role === 'model'
        ? 'assistant'
        : message.role === 'system'
          ? 'system'
          : 'user';
      return { role, content: String(message.content ?? '') };
    })
    .filter((message) => message.content.length > 0);

  if (systemInstruction?.trim() && !normalized.some((message) => message.role === 'system')) {
    normalized.unshift({ role: 'system', content: systemInstruction });
  }
  return normalized;
}

export async function generateStrataChat(opts: {
  baseUrl?: string;
  apiKey: string;
  prompt?: string;
  messages?: Array<{ role?: string; content?: unknown }>;
  systemInstruction?: string;
  model?: string;
  mode?: string;
  signal?: AbortSignal;
}): Promise<StrataChatResult> {
  const baseUrl = normalizeStrataBaseUrl(opts.baseUrl);
  const model = String(opts.model || STRATA_DEFAULT_MODEL).replace(/^strata\//, '');
  const messages = normalizeMessages(opts.messages, opts.systemInstruction);
  if (opts.prompt?.trim() && (!opts.messages || opts.messages.length === 0)) {
    messages.push({ role: 'user', content: opts.prompt });
  }

  // 1) Contrato OpenAI de la app local de Strata.
  const openAi = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(opts.apiKey),
    body: JSON.stringify({ model, messages, stream: false }),
    signal: opts.signal ?? AbortSignal.timeout(120_000),
  });

  if (openAi.ok) {
    const data: any = await openAi.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Strata devolvió una respuesta sin content');
    }
    return {
      content,
      model: typeof data?.model === 'string' ? data.model : model,
      usage: data?.usage && typeof data.usage === 'object' ? data.usage : null,
      raw: data,
    };
  }

  const openAiError = await errorMessage(openAi);
  if (openAi.status !== 404 && openAi.status !== 405) {
    throw new Error(`Strata HTTP ${openAi.status}: ${openAiError}`);
  }

  // 2) Contrato propio del Strata alojado.
  const payload: Record<string, unknown> = { model, messages };
  if (opts.mode === 'auto' || opts.mode === 'technical' || opts.mode === 'simple') {
    payload.mode = opts.mode;
  }

  const custom = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: headers(opts.apiKey),
    body: JSON.stringify(payload),
    signal: opts.signal ?? AbortSignal.timeout(120_000),
  });
  if (!custom.ok) throw new Error(`Strata HTTP ${custom.status}: ${await errorMessage(custom)}`);

  const data: any = await custom.json();
  if (typeof data?.content !== 'string') {
    throw new Error('Strata devolvió una respuesta sin content');
  }
  return {
    content: data.content,
    model: typeof data.model === 'string' ? data.model : model,
    usage: data.usage && typeof data.usage === 'object' ? data.usage : null,
    raw: data,
  };
}
