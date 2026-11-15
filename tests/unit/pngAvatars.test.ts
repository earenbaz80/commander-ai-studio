import { describe, expect, test } from 'vitest';
import { normalizePngAvatars } from '../../src/features/user/pngAvatarCatalog';

describe('normalizePngAvatars', () => {
  test('acepta PNGs válidos y conserva id, archivo y etiqueta', () => {
    expect(
      normalizePngAvatars({
        version: 1,
        avatars: [{ id: 'avatar-01', file: 'avatar-01.png', label: 'Gato naranja' }],
      })
    ).toEqual([{ id: 'avatar-01', file: 'avatar-01.png', label: 'Gato naranja' }]);
  });

  test('deriva un id y una etiqueta cuando el manifiesto no los trae', () => {
    expect(normalizePngAvatars({ avatars: [{ file: 'avatar-02.png' }] })).toEqual([
      { id: 'avatar-02', file: 'avatar-02.png', label: 'Avatar 02' },
    ]);
  });

  test('rechaza rutas, archivos que no son PNG e ids duplicados', () => {
    const avatars = normalizePngAvatars({
      avatars: [
        { id: 'traversal', file: '../secreto.png' },
        { id: 'subdir', file: 'subdir/avatar.png' },
        { id: 'texto', file: 'avatar.txt' },
        { id: 'avatar-01', file: 'avatar-01.png' },
        { id: 'avatar-01', file: 'avatar-02.png' },
      ],
    });

    expect(avatars).toEqual([{ id: 'avatar-01', file: 'avatar-01.png', label: 'Avatar 01' }]);
  });

  test('un manifiesto vacío o inválido no rompe el fallback', () => {
    expect(normalizePngAvatars(null)).toEqual([]);
    expect(normalizePngAvatars({ avatars: 'no-es-una-lista' })).toEqual([]);
  });
});
