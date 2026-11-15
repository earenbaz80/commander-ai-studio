/**
 * Presupuesto de contexto de Strata.
 *
 * La ventana publicada por el host no es toda utilizable: la respuesta ocupa
 * `maxTokens` y el tool calling necesita sitio para sus esquemas y resultados.
 * Si sólo se mira el prompt, el historial llega al límite mientras todavía
 * quedan reservas por gastar y el turno falla al final.
 *
 * Este módulo separa esas reservas y calcula el punto en el que conviene
 * compactar, antes de que el prompt completo choque con la ventana.
 */
import type { AIModel } from '../types/studio';

/** Esquemas de tools + un turno de resultados de Strata. */
export const STRATA_TOOL_RESERVE_TOKENS = 2_048;

/** Compactamos al 80 % del espacio que queda después de las reservas. */
export const STRATA_COMPACT_AT_RATIO = 0.8;

/**
 * Reserva de herramientas para un modelo de Strata. Si el host no declara
 * capacidades se reserva igual: es la opción segura para no quedarse sin sitio
 * cuando el modelo empieza a llamar tools.
 */
export function strataToolReserveTokens(model?: AIModel | null): number {
  if (!model || model.provider !== 'strata-local') return 0;
  return model.supportsTools === false ? 0 : STRATA_TOOL_RESERVE_TOKENS;
}

export interface StrataContextBudget {
  windowTokens: number | null;
  /** `maxTokens` de la respuesta. */
  outputTokens: number;
  toolTokens: number;
  reservedTokens: number;
  /** Ventana que puede usar el prompt: ventana - salida - herramientas. */
  usableTokens: number;
  /** Tokens de prompt a partir de los que toca compactar. */
  compactAtTokens: number;
  /** Prompt estimado: sistema + historial + borrador. */
  projectedTokens: number;
  /** Porcentaje del espacio útil ocupado por el prompt. */
  percentOfUsable: number | null;
  shouldCompact: boolean;
}

/**
 * Calcula el presupuesto y el umbral de compactado. `historyTokens` no debe
 * incluir el sistema ni el borrador; se pasan por separado para que el mismo
 * cálculo sirva antes y después de medir con el tokenizador real.
 */
export function computeStrataContextBudget(input: {
  windowTokens: number | null;
  outputTokens?: number;
  toolTokens?: number;
  systemTokens: number;
  historyTokens: number;
  draftTokens?: number;
  compactAtRatio?: number;
}): StrataContextBudget {
  const rawWindow = Number(input.windowTokens);
  const windowTokens = Number.isFinite(rawWindow) && rawWindow > 0 ? Math.floor(rawWindow) : null;
  const outputTokens = Math.max(0, Number(input.outputTokens) || 0);
  const toolTokens = Math.max(0, Number(input.toolTokens) || 0);
  const reservedTokens = outputTokens + toolTokens;
  const systemTokens = Math.max(0, Number(input.systemTokens) || 0);
  const historyTokens = Math.max(0, Number(input.historyTokens) || 0);
  const draftTokens = Math.max(0, Number(input.draftTokens) || 0);
  const projectedTokens = systemTokens + historyTokens + draftTokens;
  const ratio = Math.min(1, Math.max(0.1, Number(input.compactAtRatio) || STRATA_COMPACT_AT_RATIO));

  if (windowTokens === null) {
    return {
      windowTokens: null,
      outputTokens,
      toolTokens,
      reservedTokens,
      usableTokens: Infinity,
      compactAtTokens: Infinity,
      projectedTokens,
      percentOfUsable: null,
      shouldCompact: false,
    };
  }

  const usableTokens = Math.max(0, windowTokens - reservedTokens);
  const compactAtTokens = Math.floor(usableTokens * ratio);
  const percentOfUsable =
    usableTokens > 0 ? Math.round((projectedTokens / usableTokens) * 100) : null;
  return {
    windowTokens,
    outputTokens,
    toolTokens,
    reservedTokens,
    usableTokens,
    compactAtTokens,
    projectedTokens,
    percentOfUsable,
    shouldCompact: usableTokens > 0 && projectedTokens > compactAtTokens,
  };
}
