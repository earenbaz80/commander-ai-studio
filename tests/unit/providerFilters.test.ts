import { describe, expect, test } from 'vitest';
import {
  filterModelIds,
  isModelDisabledByFilter,
  toggleModelFilter,
} from '../../src/lib/providerFilters';

const models = [{ id: 'lmstudio/a' }, { id: 'lmstudio/b' }, { id: 'lmstudio/c' }];

describe('isModelDisabledByFilter', () => {
  test('sin listas todo está activo', () => {
    expect(isModelDisabledByFilter('lmstudio/a', undefined)).toBe(false);
    expect(isModelDisabledByFilter('lmstudio/a', { whitelist: [], blacklist: [] })).toBe(false);
  });

  test('la lista negra apaga y admite prefijos', () => {
    expect(isModelDisabledByFilter('lmstudio/a', { blacklist: ['lmstudio/a'] })).toBe(true);
    expect(isModelDisabledByFilter('lmstudio/b', { blacklist: ['lmstudio/a'] })).toBe(false);
    expect(isModelDisabledByFilter('lmstudio/a', { blacklist: ['lmstudio/*'] })).toBe(true);
  });

  test('la lista blanca deja fuera lo que no nombra', () => {
    expect(isModelDisabledByFilter('lmstudio/a', { whitelist: ['lmstudio/a'] })).toBe(false);
    expect(isModelDisabledByFilter('lmstudio/b', { whitelist: ['lmstudio/a'] })).toBe(true);
  });

  test('filterModelIds y el marcado deciden lo mismo', () => {
    const filter = { whitelist: ['lmstudio/*'], blacklist: ['lmstudio/b'] };
    expect(filterModelIds(models, filter).map((m) => m.id)).toEqual(['lmstudio/a', 'lmstudio/c']);
    expect(models.filter((m) => isModelDisabledByFilter(m.id, filter)).map((m) => m.id)).toEqual(['lmstudio/b']);
  });
});

describe('toggleModelFilter', () => {
  test('desactivar añade el id a la lista negra sin tocar la blanca', () => {
    expect(toggleModelFilter({ whitelist: [], blacklist: [] }, 'lmstudio/a', false)).toEqual({
      whitelist: [],
      blacklist: ['lmstudio/a'],
    });
  });

  test('activar quita el id y el patrón que lo cubría', () => {
    expect(toggleModelFilter({ whitelist: [], blacklist: ['lmstudio/a', 'lmstudio/*'] }, 'lmstudio/a', true)).toEqual({
      whitelist: [],
      blacklist: [],
    });
  });

  test('con lista blanca restrictiva, activar añade el modelo a la blanca', () => {
    expect(toggleModelFilter({ whitelist: ['lmstudio/a'], blacklist: [] }, 'lmstudio/b', true)).toEqual({
      whitelist: ['lmstudio/a', 'lmstudio/b'],
      blacklist: [],
    });
  });

  test('no duplica ids al desactivar dos veces', () => {
    expect(toggleModelFilter({ whitelist: [], blacklist: ['lmstudio/a'] }, 'lmstudio/a', false)).toEqual({
      whitelist: [],
      blacklist: ['lmstudio/a'],
    });
  });
});
