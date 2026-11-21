import { describe, it, expect } from 'vitest';
import { agentMaxTokens, isReasoningModel, sessionGenerateRoute, toolDialectForModel, truncatedTurnError } from '../../src/agent/providers';

/**
 * G1-EMPTY-TURN: los modelos que razonan gastan el presupuesto de salida en
 * `reasoning_content` y, con 2 048, el turno se corta en `finish_reason:
 * "length"` con `content: ""`. El servidor lo devolvía como éxito y el agente
 * lo leía como un cierre sin trabajo.
 */
describe('dialecto de tools', () => {
  it('usa Chat Completions para los GGUF nativos del runtime local', () => {
    expect(toolDialectForModel('local/qwen2.5-7b-instruct-q4_k_m.gguf')).toBe('openai');
  });
});

describe('ruta interna de la sesión', () => {
  it('manda el nemotron de NVIDIA por /api/nvidia/generate', () => {
    expect(sessionGenerateRoute('nvidia/nvidia/nemotron-3.5-lightning-30b-a3b')).toBe('/api/nvidia/generate');
  });

  it('resuelve el resto de proveedores por la tabla compartida', () => {
    expect(sessionGenerateRoute('custom/mi-modelo')).toBe('/api/custom/generate');
    expect(sessionGenerateRoute('openrouter/qwen/qwen3-30b-a3b')).toBe('/api/openrouter/generate');
    expect(sessionGenerateRoute('ollama/llama3.2')).toBe('/api/ollama/generate');
    expect(sessionGenerateRoute('lmstudio/qwen2.5-7b')).toBe('/api/lmstudio/generate');
    expect(sessionGenerateRoute(undefined)).toBe('/api/gemini/generate');
  });
});

describe('presupuesto de salida', () => {
  it('da margen de sobra a los modelos que razonan (G1-T10-09)', () => {
    expect(agentMaxTokens('nvidia/nvidia/nemotron-3.5-lightning-30b-a3b')).toBe(8192);
    expect(agentMaxTokens('lmstudio/deepseek-r1-distill')).toBe(8192);
    expect(agentMaxTokens('openrouter/qwen3-30b-a3b')).toBe(8192);
    expect(agentMaxTokens('gpt-oss-120b')).toBe(8192);
    expect(agentMaxTokens('o3-mini')).toBe(8192);
  });

  it('deja el presupuesto normal para los modelos que no razonan', () => {
    expect(agentMaxTokens('gpt-4.1-mini')).toBe(2048);
    expect(agentMaxTokens('gemini-2.5-flash')).toBe(2048);
    expect(agentMaxTokens('claude-sonnet-4')).toBe(2048);
    expect(agentMaxTokens(undefined)).toBe(2048);
    expect(agentMaxTokens('nvidia/meta/llama-3.3-70b-instruct')).toBe(2048);
  });

  it('no confunde un 4o con una o-serie', () => {
    expect(isReasoningModel('gpt-4o')).toBe(false);
    expect(isReasoningModel('gpt-4o-mini')).toBe(false);
    expect(isReasoningModel('o1')).toBe(true);
  });
});

describe('turno truncado', () => {
  it('marca como error un turno cortado por length y vacío', () => {
    expect(truncatedTurnError('length', '', [])).toMatch(/truncada por max_tokens/);
    expect(truncatedTurnError('length', '   ', undefined)).toMatch(/truncada por max_tokens/);
    expect(truncatedTurnError('length', undefined, [])).toMatch(/truncada por max_tokens/);
  });

  it('no inventa un error cuando el turno trae algo o el corte es otro', () => {
    expect(truncatedTurnError('length', 'texto a medias', [])).toBe(null);
    expect(
      truncatedTurnError('length', '', [{ name: 'fs.write', args: {} }]),
      'un turno con tool calls sigue siendo accionable'
    ).toBe(null);
    expect(truncatedTurnError('stop', '', [])).toBe(null);
    expect(truncatedTurnError('tool_calls', '', [])).toBe(null);
    expect(truncatedTurnError(undefined, '', [])).toBe(null);
  });
});
