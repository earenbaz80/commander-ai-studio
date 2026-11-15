import { describe, expect, test } from 'vitest';
import { assessStrataHardware } from '../../src/lib/strataRequirements';

const qwen38 = { id: 'qwen3.8-flash-next-iq3_s', contextWindow: 131_072 };

describe('assessStrataHardware', () => {
  test('recomienda el modelo grande y 128K con hardware holgado', () => {
    const result = assessStrataHardware({
      vramTotalGb: 24,
      ramTotalGb: 64,
      models: [qwen38],
      loadedModel: qwen38.id,
    });

    expect(result.overall).toBe('ok');
    expect(result.checks.map((check) => check.level)).toEqual(['ok', 'ok']);
    expect(result.recommendation).toEqual({
      model: qwen38.id,
      contextTokens: 131_072,
    });
  });

  test('baja el contexto a 32K cuando la VRAM es de 16 GB o menos', () => {
    const result = assessStrataHardware({
      vramTotalGb: 15.9,
      ramTotalGb: 63.9,
      models: [qwen38],
      loadedModel: qwen38.id,
    });

    expect(result.overall).toBe('warn');
    expect(result.recommendation).toEqual({
      model: qwen38.id,
      contextTokens: 32_768,
    });
  });

  test('elige el modelo pequeño cuando la RAM no llega a 48 GB', () => {
    const result = assessStrataHardware({
      vramTotalGb: 12,
      ramTotalGb: 32,
      models: [qwen38],
    });

    expect(result.overall).toBe('warn');
    expect(result.recommendation.model).toBe('Qwen3.6-35B-A3B');
    expect(result.recommendation.contextTokens).toBe(32_768);
  });

  test('respeta el contexto máximo del modelo cargado', () => {
    const result = assessStrataHardware({
      vramTotalGb: 24,
      ramTotalGb: 96,
      models: [{ id: 'modelo-corto', contextWindow: 16_384 }],
      loadedModel: 'modelo-corto',
    });

    expect(result.recommendation.model).toBe('modelo-corto');
    expect(result.recommendation.contextTokens).toBe(16_384);
  });

  test('no recomienda un modelo si la VRAM no alcanza el mínimo', () => {
    const result = assessStrataHardware({ vramTotalGb: 8, ramTotalGb: 64, models: [qwen38] });

    expect(result.overall).toBe('fail');
    expect(result.checks[0].level).toBe('fail');
    expect(result.recommendation).toEqual({});
  });

  test('no inventa una recomendación sin telemetría de hardware', () => {
    const result = assessStrataHardware({ models: [qwen38] });

    expect(result.overall).toBe('unknown');
    expect(result.checks.map((check) => check.level)).toEqual(['unknown', 'unknown']);
    expect(result.recommendation).toEqual({});
  });
});
