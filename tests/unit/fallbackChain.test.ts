import { describe, it, expect } from 'vitest';
import { addModel, moveModel } from '../../src/lib/fallbackChain';
import { MAX_FALLBACK_MODELS } from '../../src/config/geminiModels';

describe('orden de la cadena de respaldo', () => {
  const chain = ['a', 'b', 'c'];

  it('subir intercambia con el anterior y no toca la lista original', () => {
    const moved = moveModel(chain, 1, -1);
    expect(moved).toEqual(['b', 'a', 'c']);
    // El estado de React no se muta: el componente compara referencias.
    expect(chain).toEqual(['a', 'b', 'c']);
  });

  it('bajar intercambia con el siguiente', () => {
    expect(moveModel(chain, 1, 1)).toEqual(['a', 'c', 'b']);
  });

  it('en los extremos no hace nada', () => {
    expect(moveModel(chain, 0, -1)).toEqual(chain);
    expect(moveModel(chain, chain.length - 1, 1)).toEqual(chain);
  });

  it('un índice que no existe no rompe la cadena', () => {
    expect(moveModel(chain, -1, 1)).toEqual(chain);
    expect(moveModel(chain, 9, -1)).toEqual(chain);
    expect(moveModel([], 0, 1)).toEqual([]);
  });

  it('subir y bajar el mismo modelo lo deja donde estaba', () => {
    expect(moveModel(moveModel(chain, 1, -1), 0, 1)).toEqual(chain);
  });
});

describe('añadir un modelo a la cadena', () => {
  it('lo pone al final, sin espacios de sobra', () => {
    expect(addModel(['a'], '  b  ', 5)).toEqual({ rows: ['a', 'b'] });
  });

  it('rechaza repetidos y lo explica', () => {
    const result = addModel(['a', 'b'], 'b', 5);
    expect(result.rows).toEqual(['a', 'b']);
    expect(result.error).toMatch(/ya está en la cadena/);
  });

  it('rechaza pasar del tope', () => {
    const full = Array.from({ length: MAX_FALLBACK_MODELS }, (_, i) => `m${i}`);
    const result = addModel(full, 'otro', MAX_FALLBACK_MODELS);
    expect(result.rows).toEqual(full);
    expect(result.error).toMatch(/como máximo/);
  });

  it('rechaza un identificador desmedido', () => {
    const result = addModel([], 'x'.repeat(81), 5);
    expect(result.rows).toEqual([]);
    expect(result.error).toMatch(/80 caracteres/);
  });

  it('una entrada vacía no añade ni avisa', () => {
    expect(addModel(['a'], '   ', 5)).toEqual({ rows: ['a'] });
  });
});
