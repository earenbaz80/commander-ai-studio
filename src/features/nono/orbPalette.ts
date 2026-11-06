/** Paleta del orbe de Nono: degradado del cuerpo y color de los ojos. */
export interface NonoOrbColors {
  top: string;
  mid: string;
  bottom: string;
  eyes: string;
}

/** Paleta por defecto: la del GIF original (turquesa → verde). */
export const DEFAULT_ORB_COLORS: NonoOrbColors = {
  top: '#2ecbff',
  mid: '#12e6d0',
  bottom: '#00f5a0',
  eyes: '#ffffff',
};

export interface OrbColorPreset {
  id: string;
  label: { es: string; en: string; de: string };
  colors: NonoOrbColors;
}

/** Combinaciones listas para el selector de Configuración. */
export const ORB_COLOR_PRESETS: OrbColorPreset[] = [
  {
    id: 'gif',
    label: { es: 'GIF original', en: 'Original GIF', de: 'Original-GIF' },
    colors: DEFAULT_ORB_COLORS,
  },
  {
    id: 'mint',
    label: { es: 'Menta', en: 'Mint', de: 'Minze' },
    colors: { top: '#5ef2ff', mid: '#22e6b8', bottom: '#00c97a', eyes: '#ffffff' },
  },
  {
    id: 'ocean',
    label: { es: 'Océano', en: 'Ocean', de: 'Ozean' },
    colors: { top: '#3d8bff', mid: '#00c2ff', bottom: '#00f0d0', eyes: '#ffffff' },
  },
  {
    id: 'sunset',
    label: { es: 'Atardecer', en: 'Sunset', de: 'Sonnenuntergang' },
    colors: { top: '#ffb347', mid: '#ff7e5f', bottom: '#c44dff', eyes: '#fff7e6' },
  },
];
