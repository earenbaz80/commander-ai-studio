import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNonoExpression } from '../../src/features/nono/hooks/useNonoExpression';

/**
 * La expresión de Nono se resuelve por capas:
 * error > procesando > transitoria > reposo.
 * Cada cambio debe cancelar el temporizador anterior para que una respuesta
 * lenta no pise un estado más reciente.
 */
describe('useNonoExpression · prioridades y temporizadores', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('error manda sobre procesamiento y transitorias', () => {
    const { result } = renderHook(() => useNonoExpression());

    act(() => result.current.setExpression('happy'));
    expect(result.current.expression).toBe('happy');

    act(() => result.current.beginProcessing());
    expect(result.current.expression).toBe('thinking');

    act(() => result.current.setExpression('love', 1000));
    expect(result.current.expression).toBe('thinking');

    act(() => result.current.showError('error', 500));
    expect(result.current.expression).toBe('error');

    act(() => result.current.setExpression('angry'));
    expect(result.current.expression).toBe('error');

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.expression).toBe('thinking');
  });

  test('al terminar el procesamiento se revela la transitoria de salida', () => {
    const { result } = renderHook(() => useNonoExpression());

    act(() => result.current.beginProcessing());
    act(() => result.current.setExpression('love', 1000));
    expect(result.current.expression).toBe('thinking');

    act(() => result.current.finishProcessing('cool', 2000));
    expect(result.current.expression).toBe('cool');

    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.expression).toBe('neutral');
  });

  test('una transitoria nueva cancela el temporizador de la anterior', () => {
    const { result } = renderHook(() => useNonoExpression());

    act(() => result.current.setExpression('happy', 1000));
    act(() => result.current.setExpression('love', 2000));

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.expression).toBe('love');

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.expression).toBe('neutral');
  });

  test('el reposo cancela la transitoria y vuelve al fondo', () => {
    const { result } = renderHook(() => useNonoExpression());

    act(() => result.current.setExpression('happy'));
    expect(result.current.expression).toBe('happy');

    act(() => result.current.setExpression('watch'));
    expect(result.current.expression).toBe('watch');

    act(() => result.current.setExpression('sleepy'));
    expect(result.current.expression).toBe('sleepy');

    act(() => result.current.setExpression('happy', 100));
    expect(result.current.expression).toBe('happy');

    act(() => vi.advanceTimersByTime(100));
    expect(result.current.expression).toBe('sleepy');
  });

  test('un error no deja una transitoria escondida al caducar', () => {
    const { result } = renderHook(() => useNonoExpression());

    act(() => result.current.beginProcessing());
    act(() => result.current.showError('error', 100));
    act(() => result.current.finishProcessing('cool', 1000));
    expect(result.current.expression).toBe('error');

    act(() => vi.advanceTimersByTime(100));
    expect(result.current.expression).toBe('neutral');
  });

  test('un error nuevo reinicia su temporizador sin que caduque el anterior', () => {
    const { result } = renderHook(() => useNonoExpression());

    act(() => result.current.showError('error', 1000));
    act(() => result.current.setExpression('watch'));
    expect(result.current.expression).toBe('error');

    act(() => result.current.showError('error', 2000));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.expression).toBe('error');

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.expression).toBe('watch');
  });
});
