import type { AIModel, ChatMessage, ParameterConfig } from '../types/studio';

/**
 * Estimación del contexto que ocupa la conversación.
 *
 * No se tokeniza en el cliente (cada proveedor usa su tokenizador y sería caro
 * por mensaje): se usa la aproximación estándar de ~4 caracteres por token, que
 * basta para que el indicador avise antes de llegar al límite del modelo.
 */
const CHARS_PER_TOKEN = 4;

/** Sobrecoste por mensaje: rol y separadores del formato de chat. */
const PER_MESSAGE_OVERHEAD = 4;

export interface ContextStats {
  messages: number;
  /** Instrucciones del sistema + ejemplos few-shot. */
  systemTokens: number;
  /** Lo que ya ocupa la conversación. */
  conversationTokens: number;
  totalTokens: number;
  /** Ventana del modelo, si se conoce. */
  limit: number | null;
  /** Porcentaje usado (puede pasar de 100 si ya no cabe). */
  percent: number | null;
  /** Espacio libre dejando sitio a la respuesta. */
  remainingTokens: number | null;
  /** Tokens reservados para la respuesta (`maxTokens`). */
  reservedTokens: number;
  /** El total más la respuesta ya no cabe en la ventana. */
  overLimit: boolean;
}

/** «1M tokens» → 1 000 000 · «128K tokens» → 128 000 · «Audio» → null. */
export function parseContextWindow(spec?: string | null): number | null {
  if (!spec) return null;
  const match = spec.replace(/[\s_]/g, '').match(/^([\d.]+)([kKmM])?/);
  if (!match) return null;
  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base) || base <= 0) return null;
  const scale = !match[2] ? 1 : match[2].toLowerCase() === 'm' ? 1_000_000 : 1_000;
  return Math.round(base * scale);
}

export function estimateTokens(text?: string | null): number {
  const trimmed = text?.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / CHARS_PER_TOKEN));
}

/** Ventana del modelo: el número si viene calculado, si no el texto («128K tokens»). */
export function modelContextLimit(model?: AIModel | null): number | null {
  const direct = model?.contextLength;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct;
  return parseContextWindow(model?.contextWindow);
}

export function computeContextStats(opts: {
  messages: ChatMessage[];
  parameters?: ParameterConfig | null;
  model?: AIModel | null;
}): ContextStats {
  const { messages, parameters, model } = opts;
  const examples = parameters?.examples ?? [];

  const systemTokens = estimateTokens(parameters?.systemInstruction) +
    examples.reduce((sum, example) => sum + estimateTokens(example.input) + estimateTokens(example.output), 0);

  const conversationTokens = messages.reduce(
    (sum, message) => sum + estimateTokens(message.content) + PER_MESSAGE_OVERHEAD,
    0
  );

  const totalTokens = systemTokens + conversationTokens;
  const limit = modelContextLimit(model);
  const reservedTokens = Math.max(0, parameters?.maxTokens ?? 0);
  const percent = limit ? Math.round((totalTokens / limit) * 100) : null;
  const remainingTokens = limit === null ? null : Math.max(0, limit - totalTokens - reservedTokens);

  return {
    messages: messages.length,
    systemTokens,
    conversationTokens,
    totalTokens,
    limit,
    percent,
    remainingTokens,
    reservedTokens,
    overLimit: limit !== null && totalTokens + reservedTokens > limit,
  };
}

/** 1 500 → «1.5K», 1 000 000 → «1M»; para cifras del indicador. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(value));
}
