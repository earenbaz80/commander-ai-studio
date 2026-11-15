import { describe, test, expect } from 'vitest';
import {
  applyMeasuredContextTokens,
  computeContextStats,
  estimateTokens,
  formatTokens,
  modelContextLimit,
  parseContextWindow,
} from '../../src/lib/contextStats';
import type { AIModel, ChatMessage, ParameterConfig } from '../../src/types/studio';

const model = (contextWindow: string): AIModel => ({
  id: 'demo',
  name: 'Demo',
  provider: 'google',
  description: '',
  contextWindow,
});

const message = (content: string): ChatMessage => ({
  id: `m-${content.length}`,
  role: 'user',
  content,
  timestamp: '',
});

const parameters = (patch: Partial<ParameterConfig> = {}): ParameterConfig => ({
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  maxTokens: 4096,
  responseFormat: 'text',
  systemInstruction: '',
  examples: [],
  hfQuantization: 'fp16',
  ...patch,
});

describe('contextStats', () => {
  test('traduce la ventana del modelo a tokens', () => {
    expect(parseContextWindow('1M tokens')).toBe(1_000_000);
    expect(parseContextWindow('128K tokens')).toBe(128_000);
    expect(parseContextWindow('2M tokens')).toBe(2_000_000);
    expect(parseContextWindow('512 tokens')).toBe(512);
    // «Audio» no es una ventana: no se inventa un número.
    expect(parseContextWindow('Audio')).toBeNull();
    expect(parseContextWindow(undefined)).toBeNull();
  });

  test('prefiere el número ya calculado del catálogo', () => {
    expect(modelContextLimit({ ...model('128K tokens'), contextLength: 200_000 })).toBe(200_000);
    expect(modelContextLimit(model('128K tokens'))).toBe(128_000);
    expect(modelContextLimit(undefined)).toBeNull();
  });

  test('estima tokens con ~4 caracteres por token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(4000))).toBe(1000);
  });

  test('suma sistema, ejemplos y conversación, y deja sitio a la respuesta', () => {
    const stats = computeContextStats({
      messages: [message('a'.repeat(3600)), message('b'.repeat(400))],
      parameters: parameters({
        systemInstruction: 'c'.repeat(400),
        examples: [{ id: 'e1', input: 'd'.repeat(200), output: 'e'.repeat(200) }],
        maxTokens: 1000,
      }),
      model: model('4K tokens'),
    });

    expect(stats.systemTokens).toBe(200); // 100 de sistema + 50 + 50 de ejemplo
    expect(stats.conversationTokens).toBe(1008); // 900 + 4 y 100 + 4
    expect(stats.totalTokens).toBe(1208);
    expect(stats.limit).toBe(4000);
    expect(stats.percent).toBe(30);
    expect(stats.remainingTokens).toBe(1792);
    expect(stats.overLimit).toBe(false);
  });

  test('descuenta también la reserva de herramientas del espacio libre', () => {
    const stats = computeContextStats({
      messages: [message('a'.repeat(4100))],
      parameters: parameters({ maxTokens: 1000 }),
      model: model('4K tokens'),
      toolTokens: 2048,
    });

    expect(stats.reservedToolTokens).toBe(2048);
    expect(stats.remainingTokens).toBe(0);
    expect(stats.overLimit).toBe(true);
  });

  test('sin ventana conocida informa el total pero no un porcentaje falso', () => {
    const stats = computeContextStats({ messages: [message('hola')], parameters: parameters() });
    expect(stats.limit).toBeNull();
    expect(stats.percent).toBeNull();
    expect(stats.remainingTokens).toBeNull();
  });

  test('la ventana configurada en el compositor manda sobre la del modelo', () => {
    const stats = computeContextStats({
      messages: [message('a'.repeat(3600))],
      parameters: parameters({ contextLength: 8192, maxTokens: 1000 }),
      model: model('32K tokens'),
    });
    expect(stats.limit).toBe(8192);
    expect(stats.percent).toBe(11);
  });

  test('avisa cuando la respuesta reservada ya no cabe', () => {
    const stats = computeContextStats({
      messages: [message('a'.repeat(3700))],
      parameters: parameters({ maxTokens: 500 }),
      model: model('1K tokens'),
    });
    expect(stats.percent).toBeGreaterThan(90);
    expect(stats.overLimit).toBe(true);
  });

  test('aplica el total real sin perder la ventana ni la respuesta reservada', () => {
    const stats = computeContextStats({
      messages: [message('a'.repeat(3600))],
      parameters: parameters({ maxTokens: 1000, systemInstruction: 'c'.repeat(400) }),
      model: model('4K tokens'),
    });
    const measured = applyMeasuredContextTokens(stats, 2000);

    expect(measured.totalTokens).toBe(2000);
    expect(measured.conversationTokens).toBe(1900);
    expect(measured.percent).toBe(50);
    expect(measured.remainingTokens).toBe(1000);
    expect(measured.overLimit).toBe(false);
  });

  test('acorta las cifras del indicador', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1500)).toBe('1.5K');
    expect(formatTokens(128_000)).toBe('128K');
    expect(formatTokens(1_000_000)).toBe('1M');
  });
});
