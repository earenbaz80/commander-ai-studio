import { describe, test, expect } from 'vitest';
import {
  STRATA_COMPACT_AT_RATIO,
  STRATA_TOOL_RESERVE_TOKENS,
  computeStrataContextBudget,
  strataToolReserveTokens,
} from '../../src/lib/strataContextBudget';
import type { AIModel } from '../../src/types/studio';

const strataModel = (patch: Partial<AIModel> = {}): AIModel => ({
  id: 'strata-local/strata-demo',
  name: 'Strata demo',
  provider: 'strata-local',
  description: '',
  contextWindow: '32K tokens',
  contextLength: 32768,
  supportsTools: true,
  ...patch,
});

describe('presupuesto de contexto de Strata', () => {
  test('reserva salida y herramientas sólo para Strata con tools', () => {
    expect(strataToolReserveTokens(strataModel())).toBe(STRATA_TOOL_RESERVE_TOKENS);
    expect(strataToolReserveTokens(strataModel({ supportsTools: false }))).toBe(0);
    expect(
      strataToolReserveTokens({ ...strataModel(), provider: 'google' })
    ).toBe(0);
    expect(strataToolReserveTokens(null)).toBe(0);
  });

  test('calcula el espacio útil y compacta antes del límite', () => {
    const budget = computeStrataContextBudget({
      windowTokens: 32_768,
      outputTokens: 4_096,
      toolTokens: STRATA_TOOL_RESERVE_TOKENS,
      systemTokens: 1_000,
      historyTokens: 21_000,
      draftTokens: 500,
    });

    expect(budget.reservedTokens).toBe(4_096 + STRATA_TOOL_RESERVE_TOKENS);
    expect(budget.usableTokens).toBe(32_768 - 4_096 - STRATA_TOOL_RESERVE_TOKENS);
    expect(budget.compactAtTokens).toBe(
      Math.floor(budget.usableTokens * STRATA_COMPACT_AT_RATIO)
    );
    expect(budget.projectedTokens).toBe(22_500);
    // 22.5K supera el 80 % de 26.6K, pero aún cabe en la ventana.
    expect(budget.projectedTokens).toBeLessThan(32_768);
    expect(budget.shouldCompact).toBe(true);
  });

  test('no compacta si el prompt está por debajo del umbral', () => {
    const budget = computeStrataContextBudget({
      windowTokens: 32_768,
      outputTokens: 4_096,
      toolTokens: STRATA_TOOL_RESERVE_TOKENS,
      systemTokens: 1_000,
      historyTokens: 10_000,
      draftTokens: 500,
    });

    expect(budget.shouldCompact).toBe(false);
    expect(budget.percentOfUsable).toBeLessThan(80);
  });

  test('sin ventana conocida no inventa un umbral', () => {
    const budget = computeStrataContextBudget({
      windowTokens: null,
      outputTokens: 4_096,
      toolTokens: STRATA_TOOL_RESERVE_TOKENS,
      systemTokens: 100,
      historyTokens: 1_000,
    });

    expect(budget.windowTokens).toBeNull();
    expect(budget.usableTokens).toBe(Infinity);
    expect(budget.percentOfUsable).toBeNull();
    expect(budget.shouldCompact).toBe(false);
  });
});
