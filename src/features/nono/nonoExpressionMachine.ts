import type { NonoExpression } from '../../components/nono/content';

/**
 * Expresiones que describen un estado de fondo. Las demás son reacciones
 * transitorias que se superponen al fondo y vuelven a él al terminar.
 */
const REST_EXPRESSIONS = new Set<NonoExpression>(['neutral', 'sleepy', 'watch', 'curious']);

export function isNonoRestExpression(expression: NonoExpression): boolean {
  return REST_EXPRESSIONS.has(expression);
}

/**
 * Capas de expresión, de mayor a menor prioridad:
 * error > procesando > transitoria > reposo.
 *
 * Las capas no se pisan: una transitoria no puede tapar un error o un
 * procesamiento activo; al terminar la capa superior se revela la siguiente.
 */
export interface NonoExpressionState {
  base: NonoExpression;
  transient: NonoExpression | null;
  processing: boolean;
  processingExpression: NonoExpression;
  error: NonoExpression | null;
}

export const INITIAL_NONO_EXPRESSION_STATE: NonoExpressionState = {
  base: 'neutral',
  transient: null,
  processing: false,
  processingExpression: 'thinking',
  error: null,
};

export type NonoExpressionAction =
  | { type: 'base'; expression: NonoExpression }
  | { type: 'transient'; expression: NonoExpression }
  | { type: 'clear-transient' }
  | { type: 'processing'; expression?: NonoExpression }
  | { type: 'clear-processing' }
  | { type: 'finish-processing'; expression?: NonoExpression }
  | { type: 'error'; expression: NonoExpression }
  | { type: 'clear-error' };

export function nonoExpressionReducer(
  state: NonoExpressionState,
  action: NonoExpressionAction
): NonoExpressionState {
  switch (action.type) {
    case 'base':
      return {
        ...state,
        base: action.expression,
        transient: null,
      };
    case 'transient':
      // Error y procesamiento tienen prioridad sobre cualquier transitoria.
      if (state.error || state.processing) return state;
      return state.transient === action.expression
        ? state
        : { ...state, transient: action.expression };
    case 'clear-transient':
      return state.transient === null ? state : { ...state, transient: null };
    case 'processing':
      return {
        ...state,
        transient: null,
        processing: true,
        processingExpression: action.expression ?? 'thinking',
      };
    case 'clear-processing':
      return state.processing ? { ...state, processing: false } : state;
    case 'finish-processing':
      return {
        ...state,
        processing: false,
        // Un error activo no deja una transitoria escondida que reaparezca
        // cuando caduque el error.
        transient: state.error ? null : action.expression ?? null,
      };
    case 'error':
      return {
        ...state,
        transient: null,
        error: action.expression,
      };
    case 'clear-error':
      return state.error === null ? state : { ...state, error: null };
  }
}

/** Expresión visible según la capa activa de mayor prioridad. */
export function visibleNonoExpression(state: NonoExpressionState): NonoExpression {
  if (state.error) return state.error;
  if (state.processing) return state.processingExpression;
  return state.transient ?? state.base;
}
