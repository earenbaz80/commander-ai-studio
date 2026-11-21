import { describe, it, expect } from 'vitest';
import {
  AGENT_MAX_OUTPUT_TOKENS,
  AGENT_RETRY_MAX_OUTPUT_TOKENS,
  TRUNCATED_TURN_MESSAGE,
  isTruncatedTurn,
  isTruncationError,
  truncatedTurnFailure,
} from '../../src/agent/outputBudget';

/**
 * G1-EMPTY-TURN: con `max_tokens: 2048` el proveedor cortaba razonando y
 * devolvía `content: ""` con `finish_reason: "length"`. El CLI lo leía como
 * respuesta final y cerraba la sesión como completada.
 *
 * El presupuesto sube y el corte se reintenta una vez con más salida; si
 * persiste, es un fallo explícito, nunca un turno vacío.
 */
describe('presupuesto de salida del agente', () => {
  it('no vuelve a 2 048 y el reintento tiene más margen', () => {
    expect(AGENT_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(8192);
    expect(AGENT_RETRY_MAX_OUTPUT_TOKENS).toBeGreaterThan(AGENT_MAX_OUTPUT_TOKENS);
  });

  it('reconoce el corte de cada ruta', () => {
    expect(isTruncatedTurn({ finishReason: 'length' })).toBe(true);
    expect(isTruncatedTurn({ finishReason: 'MAX_TOKENS' })).toBe(true);
    expect(
      isTruncatedTurn({
        success: false,
        error: 'respuesta truncada por max_tokens (finish_reason: length); max_tokens=8192',
      })
    ).toBe(true);
    expect(
      isTruncatedTurn({ success: false, error: 'respuesta truncada por max_tokens (done_reason: length)' })
    ).toBe(true);
  });

  it('un turno normal no se toca', () => {
    expect(isTruncatedTurn({ finishReason: 'stop', text: '' })).toBe(false);
    expect(isTruncatedTurn({ text: 'listo', functionCalls: [] })).toBe(false);
    expect(isTruncatedTurn({ error: 'LLM HTTP 500' })).toBe(false);
    expect(isTruncatedTurn(null)).toBe(false);
  });

  it('un corte con texto o tool calls a medias sigue siendo utilizable', () => {
    expect(isTruncatedTurn({ finishReason: 'length', text: 'a medias' })).toBe(false);
    expect(isTruncatedTurn({ finishReason: 'length', toolCalls: [{ name: 'fs_read' }] })).toBe(false);
    expect(isTruncatedTurn({ finishReason: 'length', functionCalls: [{ name: 'fs_read' }] })).toBe(false);
  });

  it('el mensaje de fallo no se confunde con una respuesta', () => {
    expect(TRUNCATED_TURN_MESSAGE).toMatch(/presupuesto de salida/);
    expect(isTruncationError(new Error(TRUNCATED_TURN_MESSAGE))).toBe(true);
    expect(isTruncationError(new Error('LLM HTTP 429'))).toBe(false);
  });

  it('el fallo tras el reintento deja el presupuesto aplicado en el motivo', () => {
    const motivo = truncatedTurnFailure(AGENT_RETRY_MAX_OUTPUT_TOKENS);
    expect(motivo).toMatch(/truncada por max_tokens/);
    expect(motivo).toContain(`max_tokens=${AGENT_RETRY_MAX_OUTPUT_TOKENS}`);
    expect(isTruncationError(new Error(motivo))).toBe(true);
  });
});
