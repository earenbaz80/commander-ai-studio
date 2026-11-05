import { describe, expect, test } from 'vitest';
import { isDeprecatedGeminiModel } from '../../src/config/geminiModels';

describe('isDeprecatedGeminiModel', () => {
  test('marca los Gemini 2.5 y 3.7 que Google ya retiró', () => {
    expect(isDeprecatedGeminiModel('gemini-2.5-pro')).toBe(true);
    expect(isDeprecatedGeminiModel('gemini-2.5-flash')).toBe(true);
    expect(isDeprecatedGeminiModel('gemini-2.5-flash-lite')).toBe(true);
    expect(isDeprecatedGeminiModel('gemini-3.7-flash')).toBe(true);
    expect(isDeprecatedGeminiModel('google/gemini-2.5-flash')).toBe(true);
  });

  test('deja como actuales los modelos que sí se sirven', () => {
    expect(isDeprecatedGeminiModel('gemini-3.8-flash')).toBe(false);
    expect(isDeprecatedGeminiModel('gemini-3.5-flash')).toBe(false);
    expect(isDeprecatedGeminiModel('gemini-3.1-pro-preview')).toBe(false);
    expect(isDeprecatedGeminiModel('gemini-4-argon')).toBe(false);
    expect(isDeprecatedGeminiModel('')).toBe(false);
  });
});
