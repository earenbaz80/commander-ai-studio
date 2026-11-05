import { describe, expect, test } from 'vitest';
import { mergeDictationText } from '../../src/lib/dictation';

describe('mergeDictationText', () => {
  test('añade el dictado al texto existente con un solo espacio', () => {
    expect(mergeDictationText('Revisa el proyecto', 'y arregla los tests  ')).toBe(
      'Revisa el proyecto y arregla los tests'
    );
  });

  test('sin texto previo devuelve sólo la transcripción recortada', () => {
    expect(mergeDictationText('', '  abre el archivo  ')).toBe('abre el archivo');
    expect(mergeDictationText('   ', 'hola')).toBe('hola');
  });

  test('una transcripción vacía no toca lo que el usuario escribió', () => {
    expect(mergeDictationText('texto', '')).toBe('texto');
    expect(mergeDictationText('texto', '   ')).toBe('texto');
  });
});
