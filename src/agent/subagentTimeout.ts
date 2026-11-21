/**
 * Timeout de un subagente (`task` / `spawn_agents`).
 *
 * Vivía fijo en 120 s dentro de `agentSession.ts` y cortaba al hijo A de T10 en
 * mitad del cierre (G1-T10-06 y G1-T10-11): razonamiento + tool denegada +
 * escritura + turno de cierre con un modelo que razona no caben en ese
 * presupuesto. 180 s por defecto, configurable por el padre dentro de un rango
 * que no deje al hijo sin reloj.
 *
 * Módulo propio para que un test de lógica pueda importar la regla sin
 * arrastrar `agentSession` (y con él `browserSession`/`mcp`, que tocan el DOM).
 */
export const SUBAGENT_TIMEOUT_MS = 180_000;
export const MIN_SUBAGENT_TIMEOUT_MS = 10_000;
export const MAX_SUBAGENT_TIMEOUT_MS = 300_000;

/** Normaliza el `timeoutMs` pedido; un valor absurdo vuelve al valor por defecto. */
export function resolveSubagentTimeout(value: unknown): number {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return SUBAGENT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(ms), MIN_SUBAGENT_TIMEOUT_MS), MAX_SUBAGENT_TIMEOUT_MS);
}
