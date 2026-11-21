import { describe, expect, it } from 'vitest';
import {
  MAX_SUBAGENT_TIMEOUT_MS,
  MIN_SUBAGENT_TIMEOUT_MS,
  SUBAGENT_TIMEOUT_MS,
  resolveSubagentTimeout,
} from '../../src/agent/subagentTimeout';

/**
 * El timeout del subagente era 120 s fijos y cortaba al hijo A de T10 durante
 * el cierre. Ahora es configurable por `spawn_agents`/`task`, con 180 s por
 * defecto y límites para que un valor absurdo no deje al hijo sin reloj.
 */
describe('timeout de subagente', () => {
  it('usa 180 s cuando no se pide otro valor', () => {
    expect(SUBAGENT_TIMEOUT_MS).toBe(180_000);
    expect(resolveSubagentTimeout(undefined)).toBe(180_000);
    expect(resolveSubagentTimeout(null)).toBe(180_000);
    expect(resolveSubagentTimeout('')).toBe(180_000);
    expect(resolveSubagentTimeout('abc')).toBe(180_000);
  });

  it('respeta un valor explícito dentro del rango', () => {
    expect(resolveSubagentTimeout(240_000)).toBe(240_000);
    expect(resolveSubagentTimeout('150000')).toBe(150_000);
    expect(resolveSubagentTimeout(180_000.9)).toBe(180_000);
  });

  it('acota los extremos en vez de aceptar un timeout inútil', () => {
    expect(resolveSubagentTimeout(1)).toBe(MIN_SUBAGENT_TIMEOUT_MS);
    expect(resolveSubagentTimeout(-5)).toBe(SUBAGENT_TIMEOUT_MS);
    expect(resolveSubagentTimeout(0)).toBe(SUBAGENT_TIMEOUT_MS);
    expect(resolveSubagentTimeout(999_999)).toBe(MAX_SUBAGENT_TIMEOUT_MS);
  });
});
