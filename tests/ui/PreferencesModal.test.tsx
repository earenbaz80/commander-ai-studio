import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PreferencesModal } from '../../src/components/PreferencesModal';
import { ATASCO_KEY, PREFERENCIAS_EVENT } from '../../src/components/ServerSubAgents';

/**
 * El umbral de atasco se configura en Preferencias y lo consume el panel de
 * subagentes. Aquí se prueba la mitad de Preferencias: persistir el valor,
 * acotarlo y avisar al panel sin recargar.
 */

const abrir = () =>
  render(<PreferencesModal isOpen onClose={() => {}} />);

afterEach(() => {
  localStorage.removeItem(ATASCO_KEY);
});

describe('PreferencesModal · umbral de atasco', () => {
  test('no guarda nada mientras se escribe: espera a salir del campo', () => {
    abrir();

    const aviso = vi.fn();
    window.addEventListener(PREFERENCIAS_EVENT, aviso);

    try {
      const input = screen.getByTestId('stuck-threshold-input') as HTMLInputElement;
      expect(input.value).toBe('5');

      // Escribir «10» pasa antes por «1»: sin borrador, ese 1 ya se guardaría.
      fireEvent.change(input, { target: { value: '1' } });
      expect(input.value).toBe('1');
      expect(localStorage.getItem(ATASCO_KEY)).toBeNull();
      expect(aviso).not.toHaveBeenCalled();

      fireEvent.change(input, { target: { value: '10' } });
      fireEvent.blur(input);

      expect(localStorage.getItem(ATASCO_KEY)).toBe('10');
      expect(input.value).toBe('10');
      expect(aviso).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(PREFERENCIAS_EVENT, aviso);
    }
  });

  test('acota el valor al salir del campo', () => {
    abrir();
    const input = screen.getByTestId('stuck-threshold-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(localStorage.getItem(ATASCO_KEY)).toBe('1');
    expect(input.value).toBe('1');

    fireEvent.change(input, { target: { value: '9999' } });
    fireEvent.blur(input);
    expect(localStorage.getItem(ATASCO_KEY)).toBe('120');
    expect(input.value).toBe('120');
  });

  test('un campo vacío o con texto no cambia el valor vigente', () => {
    localStorage.setItem(ATASCO_KEY, '15');
    abrir();
    const input = screen.getByTestId('stuck-threshold-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(input.value).toBe('15');
    expect(localStorage.getItem(ATASCO_KEY)).toBe('15');
  });

  test('Enter confirma sin esperar a salir del campo', () => {
    abrir();
    const input = screen.getByTestId('stuck-threshold-input') as HTMLInputElement;

    // Hace falta el foco real: jsdom sólo emite `blur` si el campo lo tenía.
    input.focus();
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(localStorage.getItem(ATASCO_KEY)).toBe('7');
    expect(input.value).toBe('7');
  });

  test('al abrirse arranca con el valor guardado', () => {
    localStorage.setItem(ATASCO_KEY, '15');

    abrir();

    expect((screen.getByTestId('stuck-threshold-input') as HTMLInputElement).value).toBe('15');
  });
});
