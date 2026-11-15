import { describe, expect, test } from 'vitest';
import { getAvatarPixels, USER_AVATARS } from '../../src/features/user/avatarCatalog';

const RGB_COLOR = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;

describe('avatarCatalog', () => {
  test('los 12 avatares tienen una rejilla 12×12, una paleta completa y colores RGB válidos', () => {
    expect(USER_AVATARS).toHaveLength(12);

    for (const avatar of USER_AVATARS) {
      expect(avatar.rows).toHaveLength(12);

      for (const row of avatar.rows) {
        expect(row).toHaveLength(12);
      }

      const usedKeys = new Set(avatar.rows.join('').replace(/\./g, ''));

      for (const char of usedKeys) {
        expect(avatar.palette).toHaveProperty(char);
      }

      for (const key of Object.keys(avatar.palette)) {
        expect(usedKeys).toContain(key);
      }

      for (const [key, color] of Object.entries(avatar.palette)) {
        const match = RGB_COLOR.exec(color);
        expect(match, `${avatar.id}.${key}: ${color}`).not.toBeNull();
        if (!match) continue;

        for (const channel of match.slice(1)) {
          const value = Number(channel);
          expect(value, `${avatar.id}.${key}: ${color}`).toBeGreaterThanOrEqual(0);
          expect(value, `${avatar.id}.${key}: ${color}`).toBeLessThanOrEqual(255);
        }
      }

      expect(getAvatarPixels(avatar).length).toBeGreaterThan(0);
    }
  });

  test('getAvatarPixels devuelve un píxel por celda no vacía, con coordenadas únicas y el color de la paleta', () => {
    const GRID_SIZE = 12;

    for (const avatar of USER_AVATARS) {
      const palette = avatar.palette as Readonly<Record<string, string>>;
      const expected = new Map<string, string>();

      for (const [y, row] of avatar.rows.entries()) {
        for (const [x, char] of Array.from(row).entries()) {
          if (char !== '.') expected.set(`${x},${y}`, palette[char]);
        }
      }

      const pixels = getAvatarPixels(avatar);

      expect(pixels).toHaveLength(expected.size);
      expect(new Set(pixels.map(({ x, y }) => `${x},${y}`)).size).toBe(pixels.length);

      for (const { x, y, color } of pixels) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(GRID_SIZE);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(GRID_SIZE);
        expect(color).toBe(expected.get(`${x},${y}`));
      }
    }
  });
});
