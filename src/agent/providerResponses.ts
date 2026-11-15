import { truncatedTurnError } from './providers';

/**
 * Guarda de «turno truncado» por ruta de generación.
 *
 * Cada proveedor nombra el corte a su manera: `finish_reason: "length"` en
 * OpenRouter, LM Studio, custom, OpenAI/NVIDIA y Freebuff; `done_reason:
 * "length"` en Ollama; `finishReason: "MAX_TOKENS"` en Gemini. La regla es la
 * misma en todas: cortado por presupuesto y sin contenido ni tool calls **no es
 * una respuesta**. Sin esta guarda la ruta devolvía `success:true` con
 * `text:''` y el agente lo leía como un cierre sin trabajo (`G1-EMPTY-TURN`).
 *
 * Cada función devuelve el `error` listo para el cliente, o `null` si el turno
 * es utilizable.
 */

function conPresupuesto(motivo: string | null, maxTokens?: number): string | null {
  if (!motivo) return null;
  return typeof maxTokens === 'number' ? `${motivo}; max_tokens=${maxTokens}` : motivo;
}

/** Chat Completions (OpenRouter, LM Studio, custom, OpenAI/NVIDIA, Freebuff). */
export function truncatedChatCompletions(data: any, maxTokens?: number): string | null {
  const choice = data?.choices?.[0];
  return conPresupuesto(
    truncatedTurnError(choice?.finish_reason, choice?.message?.content, choice?.message?.tool_calls),
    maxTokens
  );
}

/** Ollama: el corte llega como `done_reason` y el texto en `response`. */
export function truncatedOllama(data: any, maxTokens?: number): string | null {
  return conPresupuesto(truncatedTurnError(data?.done_reason, data?.response, undefined), maxTokens);
}

/** Gemini: el corte es `finishReason: "MAX_TOKENS"` y el texto en `response.text`. */
export function truncatedGemini(
  finishReason: unknown,
  text: unknown,
  functionCalls: unknown,
  maxTokens?: number
): string | null {
  const corte = String(finishReason ?? '') === 'MAX_TOKENS' ? 'length' : finishReason;
  return conPresupuesto(truncatedTurnError(corte, text, functionCalls), maxTokens);
}
