/**
 * Presupuesto de salida del agente.
 *
 * El bucle pedía 2 048 tokens por turno, razonamiento incluido: el proveedor
 * cortaba en `finish_reason: "length"` con `content: ""` y ese turno vacío se
 * guardaba como respuesta final (`G1-EMPTY-TURN`: `responseTokens === max_tokens`
 * y el CLI cerraba con «el modelo no devolvió respuesta»).
 *
 * 8 192 deja sitio a razonamiento + tool call. Un turno cortado sin texto ni
 * tool calls no es una respuesta: se reintenta una sola vez con 16 384 y, si
 * vuelve cortado, la corrida falla con motivo en vez de cerrarse vacía.
 */
export const AGENT_MAX_OUTPUT_TOKENS = 8192;
export const AGENT_RETRY_MAX_OUTPUT_TOKENS = 16384;

export const TRUNCATED_TURN_MESSAGE =
  'El modelo agotó el presupuesto de salida (finish_reason: length) sin devolver texto ni tool calls. ' +
  'El turno no cuenta como respuesta final: la tarea no se marca como completada.';

/** Marcadores del corte, en el vocabulario de cada ruta. */
const TRUNCATION_TEXT = /truncad|finish_reason:\s*length|done_reason:\s*length|MAX_TOKENS/;

export interface TruncationPayload {
  finishReason?: unknown;
  error?: unknown;
  text?: unknown;
  toolCalls?: unknown;
  functionCalls?: unknown;
}

/**
 * ¿La respuesta de la ruta es un turno cortado por presupuesto?
 *
 * Misma regla que `truncatedTurnError`: un turno con texto o con tool calls a
 * medias sigue siendo utilizable y no se reintenta; el corte sin nada es lo que
 * no puede pasar por respuesta final.
 */
export function isTruncatedTurn(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as TruncationPayload;
  const reason = String(p.finishReason ?? '');
  const cut = reason === 'length' || reason === 'MAX_TOKENS' ||
    (typeof p.error === 'string' && TRUNCATION_TEXT.test(p.error));
  if (!cut) return false;
  const hasText = typeof p.text === 'string' && p.text.trim().length > 0;
  const hasCalls =
    (Array.isArray(p.toolCalls) && p.toolCalls.length > 0) ||
    (Array.isArray(p.functionCalls) && p.functionCalls.length > 0);
  return !hasText && !hasCalls;
}

/** ¿El error que llegó del stream o de la ruta es ese mismo corte? */
export function isTruncationError(error: unknown): boolean {
  if (error instanceof Error) return TRUNCATION_TEXT.test(error.message);
  return typeof error === 'string' && TRUNCATION_TEXT.test(error);
}

/**
 * Motivo del turno que sigue cortado después del único reintento.
 *
 * Lleva el presupuesto aplicado para que el recibo distinga «se cortó con
 * 8 192» de «se cortó incluso con 16 384».
 */
export function truncatedTurnFailure(maxTokens: number): string {
  return `respuesta truncada por max_tokens (finish_reason: length); max_tokens=${maxTokens}`;
}
