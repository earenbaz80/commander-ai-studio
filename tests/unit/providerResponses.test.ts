import { describe, it, expect } from 'vitest';
import { truncatedChatCompletions, truncatedGemini, truncatedOllama } from '../../src/agent/providerResponses';

/**
 * G1-EMPTY-TURN: cada ruta de generación que atiende al agente tenía su propia
 * forma de leer la respuesta y todas devolvían `success:true` con `text:''`
 * cuando el proveedor cortaba por presupuesto. Un turno así no es una
 * respuesta: la guarda de la ruta tiene que devolver un error con el motivo.
 *
 * Un caso por ruta, con el payload real de cada proveedor.
 */

describe('/api/openrouter/generate', () => {
  it('un turno cortado y vacío es error', () => {
    const data = { choices: [{ finish_reason: 'length', message: { content: '' } }] };
    expect(truncatedChatCompletions(data, 2048)).toMatch(/truncada por max_tokens.*max_tokens=2048/);
  });

  it('el texto a medias y el final normal no se tocan', () => {
    expect(truncatedChatCompletions({ choices: [{ finish_reason: 'length', message: { content: 'a medias' } }] }, 2048)).toBe(null);
    expect(truncatedChatCompletions({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }, 2048)).toBe(null);
  });
});

describe('/api/ollama/generate', () => {
  it('Ollama dice el corte en `done_reason`', () => {
    expect(truncatedOllama({ done_reason: 'length', response: '' }, 2048)).toMatch(/truncada por max_tokens/);
  });

  it('un `done_reason: stop` vacío sigue siendo una respuesta legítima', () => {
    expect(truncatedOllama({ done_reason: 'stop', response: '' }, 2048)).toBe(null);
    expect(truncatedOllama({ done_reason: 'length', response: 'algo' }, 2048)).toBe(null);
  });
});

describe('/api/lmstudio/generate', () => {
  it('un turno cortado y vacío es error', () => {
    const data = { choices: [{ finish_reason: 'length', message: { content: '', tool_calls: [] } }] };
    expect(truncatedChatCompletions(data, 2048)).toMatch(/truncada por max_tokens/);
  });

  it('un turno cortado con tool calls sigue siendo accionable', () => {
    const data = {
      choices: [{ finish_reason: 'length', message: { content: '', tool_calls: [{ function: { name: 'fs.read' } }] } }],
    };
    expect(truncatedChatCompletions(data, 2048)).toBe(null);
  });
});

describe('/api/custom/generate', () => {
  it('un turno cortado y vacío es error, no success con texto vacío', () => {
    const data = { choices: [{ finish_reason: 'length', message: { content: null } }] };
    expect(truncatedChatCompletions(data, 4096)).toMatch(/max_tokens=4096/);
  });

  it('sin `finish_reason` (proveedor mudo) no se inventa el error', () => {
    expect(truncatedChatCompletions({ choices: [{ message: { content: '' } }] }, 2048)).toBe(null);
  });
});

describe('/api/openai y /api/nvidia generate', () => {
  it('mismo contrato Chat Completions: cortado y vacío es error', () => {
    const data = { choices: [{ finish_reason: 'length', message: { content: '' } }] };
    expect(truncatedChatCompletions(data, 2048)).toMatch(/truncada por max_tokens/);
  });

  it('un final normal con texto no se toca', () => {
    expect(truncatedChatCompletions({ choices: [{ finish_reason: 'stop', message: { content: 'hola' } }] }, 2048)).toBe(null);
  });
});

describe('/api/freebuff/generate', () => {
  it('un turno cortado y vacío es error', () => {
    const data = { choices: [{ finish_reason: 'length', message: { content: '' } }] };
    expect(truncatedChatCompletions(data, 2048)).toMatch(/truncada por max_tokens/);
  });

  it('cortado pero con tool calls no se marca truncado', () => {
    const data = { choices: [{ finish_reason: 'length', message: { content: '', tool_calls: [{ id: 'a' }] } }] };
    expect(truncatedChatCompletions(data, 2048)).toBe(null);
  });
});

describe('/api/gemini/generate', () => {
  it('Gemini lo llama MAX_TOKENS y también es error', () => {
    expect(truncatedGemini('MAX_TOKENS', '', [], 2048)).toMatch(/truncada por max_tokens/);
    expect(truncatedGemini('MAX_TOKENS', undefined, undefined, 2048)).toMatch(/truncada por max_tokens/);
  });

  it('MAX_TOKENS con texto o con function calls no es un turno vacío', () => {
    expect(truncatedGemini('MAX_TOKENS', 'a medias', [], 2048)).toBe(null);
    expect(truncatedGemini('MAX_TOKENS', '', [{ name: 'fs_read' }], 2048)).toBe(null);
  });

  it('un STOP normal no se toca', () => {
    expect(truncatedGemini('STOP', '', [], 2048)).toBe(null);
  });
});
