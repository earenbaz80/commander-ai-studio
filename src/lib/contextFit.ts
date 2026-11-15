/**
 * Medición de contexto y decisión de encaje.
 *
 * La cifra de la barra de contexto era siempre una estimación (4 caracteres por
 * token). Cuando el proveedor ofrece un contador real se usa éste; si no está
 * disponible (sin clave, proveedor sin endpoint, timeout) se conserva la
 * estimación como red de seguridad. Nunca se bloquea un envío por un fallo del
 * contador.
 *
 * La decisión sigue la idea de `context-fit` de Strata: enviar, recortar el
 * mensaje nuevo o decir que no cabe. Aquí no se resume el historial: Commander
 * conserva los mensajes y el recorte sólo afecta al borrador que se está
 * enviando.
 */
import { estimateTokens } from './contextStats';
import { STRATA_LOCAL_DEFAULT_BASE_URL } from './strataLocal';

export const MESSAGE_OVERHEAD = 4;
export const MIN_MESSAGE_TOKENS = 128;

export interface ContextMessage {
  role: string;
  content: string;
}

export interface ContextExample {
  input: string;
  output: string;
}

export interface ContextCountInput {
  provider: string;
  model: string;
  messages: ContextMessage[];
  systemInstruction?: string;
  examples?: ContextExample[];
  /** Sólo para el endpoint/servidor; el navegador nunca manda claves. */
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ContextMeasurement {
  tokens: number;
  source: 'provider' | 'estimate';
  tokenizer: string;
  error?: string;
}

export type ContextFitAction = 'send' | 'shorten' | 'drop-history' | 'too-large';

export interface ContextFitDecision {
  action: ContextFitAction;
  /** Tokens disponibles para el mensaje nuevo con el historial actual. */
  availableForMessage: number;
  /** Tokens que ocupa el prompt completo, incluida la respuesta reservada. */
  needs: number;
  /** Tokens libres después de la respuesta reservada (puede ser negativo). */
  room: number;
}

export interface DraftFitInput {
  windowTokens: number | null;
  systemTokens: number;
  historyTokens: number;
  messageText: string;
  reservedTokens?: number;
  /** Esquemas/resultados de herramientas que también hay que dejar libres. */
  toolTokens?: number;
  minimumMessageTokens?: number;
}

export interface DraftFit {
  action: ContextFitAction;
  /** Texto que se debe enviar; sólo cambia cuando la acción es `shorten`. */
  text: string;
  omittedChars: number;
  decision: ContextFitDecision;
}

const TOKENIZER_NAMES: Record<string, string> = {
  google: 'gemini',
  anthropic: 'anthropic',
  openai: 'openai',
  'strata-local': 'strata',
};

const cleanBase = (value: unknown, fallback: string): string =>
  (typeof value === 'string' && value.trim() ? value.trim() : fallback).replace(/\/+$/, '');

const stripProviderPrefix = (provider: string, model: string): string =>
  String(model || '').replace(new RegExp(`^${provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), '');

/** Instrucciones + ejemplos, en el mismo orden que usa el prompt. */
export function systemContextText(systemInstruction = '', examples: ContextExample[] = []): string {
  const parts: string[] = [];
  if (systemInstruction.trim()) parts.push(systemInstruction.trim());
  for (const example of Array.isArray(examples) ? examples : []) {
    if (!example || (!example.input && !example.output)) continue;
    parts.push(`Input: ${example.input}\nOutput: ${example.output}`);
  }
  return parts.join('\n\n');
}

export function estimateMessageTokens(text: string): number {
  return estimateTokens(text) + MESSAGE_OVERHEAD;
}

/**
 * Estimación de respaldo. Incluye el sobrecoste por mensaje y los ejemplos,
 * igual que `computeContextStats`, para que el número no cambie al perder el
 * contador real.
 */
export function estimateContextTokens(input: Pick<ContextCountInput, 'messages' | 'systemInstruction' | 'examples'>): number {
  const system = estimateTokens(systemContextText(input.systemInstruction, input.examples));
  const messages = Array.isArray(input.messages) ? input.messages : [];
  return system + messages.reduce((sum, message) => sum + estimateMessageTokens(message.content), 0);
}

function conversationMessages(messages: ContextMessage[]): ContextMessage[] {
  return (Array.isArray(messages) ? messages : []).filter(
    (message) => message && message.role !== 'system' && String(message.content || '').trim().length > 0
  );
}

function normalizeAnthropicMessages(messages: ContextMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const normalized = conversationMessages(messages).map((message) => ({
    role: message.role === 'model' || message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: String(message.content || ''),
  }));
  return normalized.length > 0 ? normalized : [{ role: 'user', content: '' }];
}

function normalizeOpenAiMessages(messages: ContextMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return normalizeAnthropicMessages(messages);
}

/** Gemini exige roles user/model y acepta contenido vacío. */
function buildGeminiContents(systemText: string, messages: ContextMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  const push = (role: string, text: string) => {
    if (!text.trim()) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n\n${text}`;
    else contents.push({ role, parts: [{ text }] });
  };
  if (systemText.trim()) push('user', systemText);
  for (const message of conversationMessages(messages)) {
    push(message.role === 'model' || message.role === 'assistant' ? 'model' : 'user', String(message.content || ''));
  }
  if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: '' }] });
  return contents;
}

async function requestJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<any> {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(String(message).slice(0, 300));
  }
  return payload;
}

function providerCount(payload: any): number | null {
  const value = Number(payload?.totalTokens ?? payload?.input_tokens);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

async function countGemini(input: ContextCountInput): Promise<number | null> {
  if (!input.apiKey) return null;
  const base = cleanBase(input.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  const model = encodeURIComponent(stripProviderPrefix('google', input.model));
  const body = { contents: buildGeminiContents(systemContextText(input.systemInstruction, input.examples), input.messages) };
  const payload = await requestJson(
    `${base}/models/${model}:countTokens?key=${encodeURIComponent(input.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    input.fetchImpl ?? fetch,
    input.timeoutMs ?? 8_000
  );
  return providerCount(payload);
}

async function countAnthropic(input: ContextCountInput): Promise<number | null> {
  if (!input.apiKey) return null;
  const base = cleanBase(input.baseUrl, 'https://api.anthropic.com');
  const root = base.endsWith('/v1') ? base : `${base}/v1`;
  const system = systemContextText(input.systemInstruction, input.examples);
  const body = {
    model: stripProviderPrefix('anthropic', input.model),
    messages: normalizeAnthropicMessages(input.messages),
    ...(system ? { system } : {}),
  };
  const payload = await requestJson(
    `${root}/messages/count_tokens`,
    {
      method: 'POST',
      headers: {
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    input.fetchImpl ?? fetch,
    input.timeoutMs ?? 8_000
  );
  return providerCount(payload);
}

async function countOpenAi(input: ContextCountInput): Promise<number | null> {
  if (!input.apiKey) return null;
  const base = cleanBase(input.baseUrl, 'https://api.openai.com/v1');
  const root = base.endsWith('/v1') ? base : `${base}/v1`;
  const system = systemContextText(input.systemInstruction, input.examples);
  const payload = await requestJson(
    `${root}/responses/input_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: stripProviderPrefix('openai', input.model),
        input: normalizeOpenAiMessages(input.messages),
        ...(system ? { instructions: system } : {}),
      }),
    },
    input.fetchImpl ?? fetch,
    input.timeoutMs ?? 8_000
  );
  return providerCount(payload);
}

/** Contador Anthropic que expone Strata local (el mismo que usa context-fit). */
async function countStrataLocal(input: ContextCountInput): Promise<number | null> {
  const base = cleanBase(input.baseUrl, STRATA_LOCAL_DEFAULT_BASE_URL);
  const root = base.endsWith('/v1') ? base : `${base}/v1`;
  const system = systemContextText(input.systemInstruction, input.examples);
  const payload = await requestJson(
    `${root}/messages/count_tokens`,
    {
      method: 'POST',
      headers: {
        ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: stripProviderPrefix('strata-local', input.model),
        messages: normalizeAnthropicMessages(input.messages),
        ...(system ? { system } : {}),
      }),
    },
    input.fetchImpl ?? fetch,
    input.timeoutMs ?? 8_000
  );
  return providerCount(payload);
}

/**
 * Pide el conteo al proveedor y cae a la estimación si no hay clave, endpoint o
 * respuesta válida. Un fallo aquí nunca debe impedir enviar.
 */
export async function countProviderTokens(input: ContextCountInput): Promise<ContextMeasurement> {
  const provider = String(input.provider || '').trim().toLowerCase();
  const estimated = () => estimateContextTokens(input);
  const fallback = (error?: string): ContextMeasurement => ({
    tokens: estimated(),
    source: 'estimate',
    tokenizer: 'heuristic',
    ...(error ? { error } : {}),
  });

  if (!provider || !input.model) return fallback('proveedor o modelo no indicado');

  try {
    let tokens: number | null = null;
    if (provider === 'google') tokens = await countGemini(input);
    else if (provider === 'anthropic') tokens = await countAnthropic(input);
    else if (provider === 'openai') tokens = await countOpenAi(input);
    else if (provider === 'strata-local') tokens = await countStrataLocal(input);
    else return fallback();

    if (tokens === null) return fallback(provider === 'google' || provider === 'anthropic' || provider === 'openai' ? 'sin API key' : undefined);
    return { tokens, source: 'provider', tokenizer: TOKENIZER_NAMES[provider] || provider };
  } catch (error: any) {
    return fallback(error?.message || 'no se pudo contar');
  }
}

/**
 * Decide si el prompt cabe. `drop-history` significa que el mensaje nuevo sí
 * cabría sin el historial; una implementación futura puede resumir o recortar
 * mensajes antiguos. El borrador nunca se modifica en esa decisión.
 */
export function decideContextFit(input: {
  windowTokens: number | null;
  systemTokens: number;
  historyTokens: number;
  messageTokens: number;
  reservedTokens?: number;
  toolTokens?: number;
  minimumMessageTokens?: number;
}): ContextFitDecision {
  const windowTokens = Number(input.windowTokens);
  const system = Math.max(0, Number(input.systemTokens) || 0);
  const history = Math.max(0, Number(input.historyTokens) || 0);
  const message = Math.max(0, Number(input.messageTokens) || 0);
  const reserved =
    Math.max(0, Number(input.reservedTokens) || 0) +
    Math.max(0, Number(input.toolTokens) || 0);
  const minimum = Math.max(0, Number(input.minimumMessageTokens) || MIN_MESSAGE_TOKENS);

  if (!(windowTokens > 0)) {
    return { action: 'send', availableForMessage: Infinity, needs: system + history + message + reserved, room: Infinity };
  }

  const needs = system + history + message + reserved;
  const room = windowTokens - needs;
  if (needs <= windowTokens) return { action: 'send', availableForMessage: windowTokens - system - history - reserved, needs, room };

  // El mensaje cabe si se deja fuera el historial: hay algo que resumir antes.
  if (system + message + reserved <= windowTokens) {
    return { action: 'drop-history', availableForMessage: windowTokens - system - history - reserved, needs, room };
  }

  const availableForMessage = windowTokens - system - history - reserved;
  if (availableForMessage >= minimum) {
    return { action: 'shorten', availableForMessage, needs, room };
  }
  return { action: 'too-large', availableForMessage, needs, room };
}

/**
 * Recorta cabeza y cola del mensaje, no sólo el principio: el final suele llevar
 * la pregunta o el error que importa. El marcador queda dentro del presupuesto.
 */
export function shortenMessageToFit(
  text: string,
  availableTokens: number,
  charsPerToken: number
): { text: string; omittedChars: number; keptChars: number; changed: boolean } {
  const value = String(text ?? '');
  const budgetChars = Math.floor(Math.max(0, availableTokens) * Math.max(1, charsPerToken) * 0.9);
  const markerReserve = 120;
  const keep = Math.min(value.length, Math.max(0, budgetChars - markerReserve));
  if (keep >= value.length || keep < 80) {
    return { text: value, omittedChars: 0, keptChars: value.length, changed: false };
  }
  const head = Math.ceil(keep * 0.7);
  const tail = Math.max(0, keep - head);
  const omitted = value.length - head - tail;
  const marker = `\n\n[… ${omitted} caracteres omitidos: el mensaje no cabía en la ventana del modelo …]\n\n`;
  return {
    text: `${value.slice(0, head)}${marker}${tail > 0 ? value.slice(-tail) : ''}`,
    omittedChars: omitted,
    keptChars: head + tail,
    changed: true,
  };
}

/** Aplica la decisión y devuelve el texto listo para enviar. */
export function fitDraft(input: DraftFitInput): DraftFit {
  const messageText = String(input.messageText ?? '');
  const messageTokens = estimateMessageTokens(messageText);
  const decision = decideContextFit({
    windowTokens: input.windowTokens,
    systemTokens: input.systemTokens,
    historyTokens: input.historyTokens,
    messageTokens,
    reservedTokens: input.reservedTokens,
    toolTokens: input.toolTokens,
    minimumMessageTokens: input.minimumMessageTokens,
  });

  if (decision.action !== 'shorten') {
    return { action: decision.action, text: messageText, omittedChars: 0, decision };
  }

  const charsPerToken = messageText.length / Math.max(1, messageTokens);
  const shortened = shortenMessageToFit(messageText, decision.availableForMessage, charsPerToken);
  if (!shortened.changed) {
    return { action: 'too-large', text: messageText, omittedChars: 0, decision };
  }
  return {
    action: 'shorten',
    text: shortened.text,
    omittedChars: shortened.omittedChars,
    decision,
  };
}

/**
 * Versión de navegador: pregunta al endpoint del servidor, que resuelve claves
 * y proveedor. Si no contesta, devuelve la estimación local.
 */
export async function measureContextFromServer(
  input: Pick<ContextCountInput, 'provider' | 'model' | 'messages' | 'systemInstruction' | 'examples'>,
  fetchImpl: typeof fetch = fetch
): Promise<ContextMeasurement> {
  const fallback = (): ContextMeasurement => ({
    tokens: estimateContextTokens(input),
    source: 'estimate',
    tokenizer: 'heuristic',
  });
  try {
    const response = await fetchImpl('/api/context/count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: input.provider,
        model: input.model,
        messages: input.messages,
        systemInstruction: input.systemInstruction || '',
        examples: input.examples || [],
      }),
    });
    if (!response.ok) return fallback();
    const data: any = await response.json().catch(() => null);
    const tokens = Number(data?.tokens);
    if (!Number.isFinite(tokens) || tokens < 0) return fallback();
    return {
      tokens: Math.round(tokens),
      source: data?.source === 'provider' ? 'provider' : 'estimate',
      tokenizer: String(data?.tokenizer || (data?.source === 'provider' ? 'provider' : 'heuristic')),
      ...(data?.error ? { error: String(data.error) } : {}),
    };
  } catch {
    return fallback();
  }
}
