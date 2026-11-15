import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { NonoExpression } from '../../../components/nono/content';
import {
  INITIAL_NONO_EXPRESSION_STATE,
  isNonoRestExpression,
  nonoExpressionReducer,
  visibleNonoExpression,
} from '../nonoExpressionMachine';

export interface NonoExpressionController {
  expression: NonoExpression;
  /**
   * Reacción transitoria. Si la expresión es de reposo, cambia el fondo y
   * cancela la transitoria. Con duración, vuelve sola al fondo.
   */
  setExpression: (expression: NonoExpression, durationMs?: number) => void;
  /** Inicia la capa de procesamiento; tapa cualquier transitoria. */
  beginProcessing: (expression?: NonoExpression) => void;
  /** Termina el procesamiento y, si no hay error, deja una transitoria. */
  finishProcessing: (expression?: NonoExpression, durationMs?: number) => void;
  /** Termina el procesamiento sin expresión de salida. */
  clearProcessing: () => void;
  /** Error de prioridad máxima, con vuelta automática al estado inferior. */
  showError: (expression?: NonoExpression, durationMs?: number) => void;
}

/**
 * Controlador único de la expresión de Nono.
 *
 * Mantiene una sola pila de capas (error > procesando > transitoria > reposo) y
 * un único temporizador por capa temporizada. Cada cambio cancela el anterior,
 * así una respuesta lenta no puede pisar un estado más reciente.
 */
export function useNonoExpression(): NonoExpressionController {
  const [state, dispatch] = useReducer(nonoExpressionReducer, INITIAL_NONO_EXPRESSION_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  const transientTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transientTokenRef = useRef(0);
  const errorTokenRef = useRef(0);

  /** Invalida cualquier temporizador transitorio pendiente. */
  const cancelTransientTimer = useCallback(() => {
    if (transientTimerRef.current !== null) {
      clearTimeout(transientTimerRef.current);
      transientTimerRef.current = null;
    }
    transientTokenRef.current += 1;
  }, []);

  const scheduleTransientClear = useCallback((durationMs?: number) => {
    if (!durationMs || durationMs <= 0) return;
    const token = transientTokenRef.current;
    transientTimerRef.current = setTimeout(() => {
      transientTimerRef.current = null;
      if (token === transientTokenRef.current) {
        dispatch({ type: 'clear-transient' });
      }
    }, durationMs);
  }, []);

  const showBase = useCallback(
    (expression: NonoExpression) => {
      cancelTransientTimer();
      dispatch({ type: 'base', expression });
    },
    [cancelTransientTimer]
  );

  const showTransient = useCallback(
    (expression: NonoExpression, durationMs?: number) => {
      const current = stateRef.current;
      if (current.error || current.processing) return;
      cancelTransientTimer();
      dispatch({ type: 'transient', expression });
      scheduleTransientClear(durationMs);
    },
    [cancelTransientTimer, scheduleTransientClear]
  );

  const showError = useCallback(
    (expression: NonoExpression = 'error', durationMs?: number) => {
      cancelTransientTimer();
      if (errorTimerRef.current !== null) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
      dispatch({ type: 'error', expression });
      if (!durationMs || durationMs <= 0) return;
      const token = ++errorTokenRef.current;
      errorTimerRef.current = setTimeout(() => {
        errorTimerRef.current = null;
        if (token === errorTokenRef.current) {
          dispatch({ type: 'clear-error' });
        }
      }, durationMs);
    },
    [cancelTransientTimer]
  );

  const setExpression = useCallback(
    (expression: NonoExpression, durationMs?: number) => {
      if (isNonoRestExpression(expression)) {
        showBase(expression);
      } else if (expression === 'error') {
        showError(expression, durationMs);
      } else {
        showTransient(expression, durationMs);
      }
    },
    [showBase, showError, showTransient]
  );

  const beginProcessing = useCallback(
    (expression: NonoExpression = 'thinking') => {
      cancelTransientTimer();
      dispatch({ type: 'processing', expression });
    },
    [cancelTransientTimer]
  );

  const finishProcessing = useCallback(
    (expression?: NonoExpression, durationMs?: number) => {
      cancelTransientTimer();
      dispatch({ type: 'finish-processing', expression });
      if (expression && !stateRef.current.error) {
        scheduleTransientClear(durationMs);
      }
    },
    [cancelTransientTimer, scheduleTransientClear]
  );

  const clearProcessing = useCallback(() => {
    dispatch({ type: 'clear-processing' });
  }, []);

  useEffect(() => {
    return () => {
      if (transientTimerRef.current !== null) clearTimeout(transientTimerRef.current);
      if (errorTimerRef.current !== null) clearTimeout(errorTimerRef.current);
    };
  }, []);

  return {
    expression: visibleNonoExpression(state),
    setExpression,
    beginProcessing,
    finishProcessing,
    clearProcessing,
    showError,
  };
}
