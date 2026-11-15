import { describe, expect, test } from 'vitest';
import { encodeWav, mergeDictationText } from '../../src/lib/dictation';

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

describe('encodeWav', () => {
  test('genera un WAV PCM mono a la frecuencia pedida', async () => {
    const blob = encodeWav(new Float32Array([0, 1, -1]), 16000);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const text = (start: number, length: number) =>
      String.fromCharCode(...bytes.slice(start, start + length));

    expect(blob.type).toBe('audio/wav');
    expect(bytes.byteLength).toBe(44 + 6);
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
  });
});
