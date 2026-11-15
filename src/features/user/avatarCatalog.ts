/**
 * Avatares pixel art integrados en Commander.
 *
 * Cada avatar es una rejilla de 12×12: los caracteres se traducen a colores
 * con su paleta. El tamaño es deliberadamente bajo para que los ojos, las
 * bocas y las orejas sigan leyéndose a 18 px; por eso los rasgos son bloques
 * de 2 celdas o más, no detalles de una sola celda. Estos 12 son el fallback
 * cuando `public/avatars/` no tiene
 * PNGs; los PNGs se resuelven en `pngAvatarCatalog.ts`.
 */
import { getPngAvatar, PNG_AVATARS, type PngAvatarDefinition } from './pngAvatarCatalog';

export interface UserAvatarDefinition {
  readonly id: string;
  readonly label: {
    readonly es: string;
    readonly en: string;
    readonly de: string;
  };
  readonly palette: Readonly<Record<string, string>>;
  readonly rows: readonly string[];
}

export const USER_AVATARS = [
  {
    id: 'cat',
    label: { es: 'Gato', en: 'Cat', de: 'Katze' },
    palette: {
      a: 'rgb(86, 86, 94)',
      b: 'rgb(255, 210, 63)',
      c: 'rgb(255, 107, 157)',
    },
    rows: [
      '............',
      '..aa....aa..',
      '.aaaa..aaaa.',
      '.aaaaaaaaaa.',
      '.aaaaaaaaaa.',
      '.aabbaabbaa.',
      '.aabbaabbaa.',
      '.aaaaaaaaaa.',
      '.aaaaccaaaa.',
      '.aaaaaaaaaa.',
      '..aaaaaaaa..',
      '............',
    ],
  },
  {
    id: 'fox',
    label: { es: 'Zorro', en: 'Fox', de: 'Fuchs' },
    palette: {
      a: 'rgb(242, 140, 40)',
      b: 'rgb(58, 36, 22)',
      c: 'rgb(20, 20, 20)',
      d: 'rgb(255, 244, 230)',
    },
    rows: [
      '............',
      '..bb....bb..',
      '.bbaa..aabb.',
      '.bbbbbbbbbb.',
      '.baaaaaaaab.',
      '.baaccaccab.',
      '.baaccaccab.',
      '.baaaaaaaab.',
      '.baaddddaab.',
      '.baadbbdaab.',
      '..bbbbbbbb..',
      '............',
    ],
  },
  {
    id: 'frog',
    label: { es: 'Rana', en: 'Frog', de: 'Frosch' },
    palette: {
      a: 'rgb(69, 209, 106)',
      b: 'rgb(15, 61, 36)',
    },
    rows: [
      '............',
      '..aa....aa..',
      '.aaaa..aaaa.',
      '.aaaaaaaaaa.',
      '.aaaaaaaaaa.',
      '.aabbaabbaa.',
      '.aabbaabbaa.',
      '.aaaaaaaaaa.',
      '.aabbbbbbaa.',
      '.aaabbbbaaa.',
      '..aaaaaaaa..',
      '............',
    ],
  },
  {
    id: 'robot',
    label: { es: 'Robot', en: 'Robot', de: 'Roboter' },
    palette: {
      a: 'rgb(55, 199, 217)',
      b: 'rgb(10, 35, 52)',
      c: 'rgb(255, 230, 109)',
    },
    rows: [
      '............',
      '.....bb.....',
      '.....bb.....',
      '.aaaaaaaaaa.',
      '.aaaaaaaaaa.',
      '.aabbaabbaa.',
      '.aabbaabbaa.',
      '.aaaaaaaaaa.',
      '.aaccccccaa.',
      '.aaaaaaaaaa.',
      '..aaaaaaaa..',
      '............',
    ],
  },
  {
    id: 'alien',
    label: { es: 'Alien', en: 'Alien', de: 'Alien' },
    palette: {
      a: 'rgb(97, 230, 216)',
      b: 'rgb(16, 43, 58)',
      c: 'rgb(255, 255, 255)',
    },
    rows: [
      '............',
      '....aaaa....',
      '..aaaaaaaa..',
      '.aaaaaaaaaa.',
      '.aaaaaaaaaa.',
      '.aaccaaccaa.',
      '.aaccaaccaa.',
      '.aaaaaaaaaa.',
      '.aaabbbbaaa.',
      '..aaaaaaaa..',
      '...aaaaaa...',
      '............',
    ],
  },
  {
    id: 'panda',
    label: { es: 'Panda', en: 'Panda', de: 'Panda' },
    palette: {
      a: 'rgb(245, 245, 245)',
      b: 'rgb(27, 27, 27)',
    },
    rows: [
      '............',
      '..bb....bb..',
      '.bbbb..bbbb.',
      '.aaaaaaaaaa.',
      '.aabbaabbaa.',
      '.aabbaabbaa.',
      '.aaaaaaaaaa.',
      '.aaaabbaaaa.',
      '.aaaaaaaaaa.',
      '..aaaaaaaa..',
      '...aaaaaa...',
      '............',
    ],
  },
  {
    id: 'bear',
    label: { es: 'Oso', en: 'Bear', de: 'Bär' },
    palette: {
      a: 'rgb(181, 101, 29)',
      b: 'rgb(58, 36, 22)',
      c: 'rgb(245, 192, 122)',
    },
    rows: [
      '............',
      '..aa....aa..',
      '.aaaa..aaaa.',
      '.aaaaaaaaaa.',
      '.aaaaaaaaaa.',
      '.aabbaabbaa.',
      '.aabbaabbaa.',
      '.aaaaaaaaaa.',
      '.aaaccccaaa.',
      '.aaacbbcaaa.',
      '..aaaaaaaa..',
      '............',
    ],
  },
  {
    id: 'bunny',
    label: { es: 'Conejo', en: 'Bunny', de: 'Hase' },
    palette: {
      a: 'rgb(245, 245, 245)',
      b: 'rgb(255, 158, 196)',
      c: 'rgb(27, 27, 27)',
    },
    rows: [
      '.aba....aba.',
      '.aba....aba.',
      '.aba....aba.',
      '.aba....aba.',
      '.aaaaaaaaaa.',
      '.aaaaaaaaaa.',
      '.aaccaaccaa.',
      '.aaccaaccaa.',
      '.aaaabbaaaa.',
      '.aaaaaaaaaa.',
      '..aaaaaaaa..',
      '............',
    ],
  },
  {
    id: 'skull',
    label: { es: 'Calavera', en: 'Skull', de: 'Schädel' },
    palette: {
      a: 'rgb(245, 245, 245)',
      b: 'rgb(27, 27, 27)',
    },
    rows: [
      '............',
      '...aaaaaa...',
      '..aaaaaaaa..',
      '.aaaaaaaaaa.',
      '.aaaaaaaaaa.',
      '.aabbaabbaa.',
      '.aabbaabbaa.',
      '.aaaaaaaaaa.',
      '.aaaabbaaaa.',
      '.aaabbbbaaa.',
      '..aaaaaaaa..',
      '............',
    ],
  },
  {
    id: 'cyclops',
    label: { es: 'Cíclope', en: 'Cyclops', de: 'Zyklop' },
    palette: {
      a: 'rgb(255, 210, 63)',
      b: 'rgb(27, 27, 27)',
    },
    rows: [
      '............',
      '...aaaaaa...',
      '..aaaaaaaa..',
      '.aaaaaaaaaa.',
      '.aaaaaaaaaa.',
      '.aaabbbbaaa.',
      '.aaabbbbaaa.',
      '.aaabbbbaaa.',
      '.aaaaaaaaaa.',
      '.aaabbbbaaa.',
      '..aaaaaaaa..',
      '............',
    ],
  },
  {
    id: 'terminal',
    label: { es: 'Terminal', en: 'Terminal', de: 'Terminal' },
    palette: {
      a: 'rgb(255, 140, 66)',
      b: 'rgb(0, 255, 102)',
      c: 'rgb(255, 255, 255)',
    },
    rows: [
      '............',
      '.aaaaaaaaaa.',
      '.aaaaaaaaaa.',
      '.abbbbbbbba.',
      '.abbbbbbbba.',
      '.abccbbccba.',
      '.abccbbccba.',
      '.abbbbbbbba.',
      '.abbbbbbbba.',
      '.aaaaaaaaaa.',
      '..aaaaaaaa..',
      '............',
    ],
  },
  {
    id: 'slime',
    label: { es: 'Slime', en: 'Slime', de: 'Schleim' },
    palette: {
      a: 'rgb(123, 211, 137)',
      b: 'rgb(27, 27, 27)',
    },
    rows: [
      '............',
      '....aaaa....',
      '..aaaaaaaa..',
      '.aaaaaaaaaa.',
      '.aaaaaaaaaa.',
      '.aabbaabbaa.',
      '.aabbaabbaa.',
      '.aaaaaaaaaa.',
      '.aaabbbbaaa.',
      '.aaaaaaaaaa.',
      '.aaaaaaaaaa.',
      '............',
    ],
  },
] as const satisfies readonly UserAvatarDefinition[];

export type UserAvatarId = (typeof USER_AVATARS)[number]['id'];
export type AvatarLanguage = 'es' | 'en' | 'de';

/** Opción visible en el selector, ya sea PNG o integrada. */
export interface AvatarOption {
  readonly id: string;
  readonly label: string;
  readonly source: 'png' | 'builtin';
}

/** Resultado único de resolver un id, para pintar sin volver a ramificar. */
export type ResolvedAvatar =
  | {
      source: 'png';
      id: string;
      label: string;
      png: PngAvatarDefinition;
      /** Fallback si el PNG no carga o desaparece del manifiesto. */
      builtin: UserAvatarDefinition;
    }
  | { source: 'builtin'; id: string; label: string; builtin: UserAvatarDefinition };

const DEFAULT_AVATAR_ID: UserAvatarId = 'cat';
export const AVATAR_VIEWBOX = '0 0 12 12';

function isBuiltinAvatarId(value: unknown): value is UserAvatarId {
  return typeof value === 'string' && USER_AVATARS.some((avatar) => avatar.id === value);
}

function builtinAvatar(id?: string | null): UserAvatarDefinition {
  return USER_AVATARS.find((avatar) => avatar.id === id) ?? USER_AVATARS[0];
}

function builtinLabel(avatar: UserAvatarDefinition, lang: AvatarLanguage): string {
  return avatar.label[lang] || avatar.label.es;
}

/** Acepta tanto los 12 integrados como los ids del manifiesto PNG. */
export function isAvatarId(value: unknown): value is string {
  return isBuiltinAvatarId(value) || (typeof value === 'string' && Boolean(getPngAvatar(value)));
}

/** Avatar estable para una cuenta que todavía no ha elegido uno. */
export function getDefaultAvatarId(uid?: string | null): UserAvatarId {
  if (!uid) return DEFAULT_AVATAR_ID;
  let hash = 0;
  for (const char of uid) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return USER_AVATARS[hash % USER_AVATARS.length].id;
}

/**
 * Una sola lista para el selector: PNGs si el manifiesto tiene entradas; los
 * 12 integrados si no. Así el componente no repite la misma decisión.
 */
export function getAvatarOptions(lang: AvatarLanguage = 'es'): AvatarOption[] {
  if (PNG_AVATARS.length > 0) {
    return PNG_AVATARS.map(({ id, label }) => ({ id, label, source: 'png' }));
  }
  return USER_AVATARS.map((avatar) => ({
    id: avatar.id,
    label: builtinLabel(avatar, lang),
    source: 'builtin',
  }));
}

/** Resuelve un id a su definición visible, con el fallback integrado incluido. */
export function resolveAvatar(id?: string | null, lang: AvatarLanguage = 'es'): ResolvedAvatar {
  const png = getPngAvatar(id);
  if (png) {
    return {
      source: 'png',
      id: png.id,
      label: png.label,
      png,
      builtin: USER_AVATARS[0],
    };
  }

  const builtin = builtinAvatar(id);
  return {
    source: 'builtin',
    id: builtin.id,
    label: builtinLabel(builtin, lang),
    builtin,
  };
}

export interface AvatarPixel {
  x: number;
  y: number;
  color: string;
}

const pixelCache = new Map<string, AvatarPixel[]>();

/** Convierte la rejilla en rectángulos, una sola vez por avatar. */
export function getAvatarPixels(avatar: UserAvatarDefinition): AvatarPixel[] {
  const cached = pixelCache.get(avatar.id);
  if (cached) return cached;

  const pixels: AvatarPixel[] = [];
  avatar.rows.forEach((row, y) => {
    Array.from(row).forEach((char, x) => {
      const color = avatar.palette[char];
      if (color) pixels.push({ x, y, color });
    });
  });
  pixelCache.set(avatar.id, pixels);
  return pixels;
}
