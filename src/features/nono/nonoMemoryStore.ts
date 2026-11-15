import { DEFAULT_ORB_COLORS, type NonoOrbColors } from './orbPalette';

export interface NonoMemory {
  /** Stack tecnológico detectado/preferido del usuario */
  preferredStack: string[];
  /** Patrones de uso del usuario */
  patterns: {
    usesTests: boolean;
    usesDocker: boolean;
    usesTypeScript: boolean;
    usesGit: boolean;
    preferredProvider?: string;
    preferredModel?: string;
  };
  /** Preferencias de UI */
  ui: {
    showNono: boolean;
    reducedMotion: boolean;
    compactMode: boolean;
    /** Anima a Nono aunque el sistema pida menos movimiento. */
    forceMotion: boolean;
    /** Accesibilidad: desactiva la interpolación y la mirada salta al puntero. */
    instantGaze: boolean;
    /** Variante extra de Nono: esfera turquesa→verde en vez de la cabeza clásica. */
    orbSkin: boolean;
    /** Variante «solo ojos»: dos rectángulos sin cabeza, boca ni antena. */
    eyesOnly: boolean;
    /** Asiente al procesar; manda sobre prefers-reduced-motion. */
    orbRotate: boolean;
    /** Colores del cuerpo del orbe. */
    orbColors: NonoOrbColors;
    /** Color de los ojos de la variante «Ojos». */
    eyesColor: string;
  };
  /** Historial de interacciones para aprendizaje */
  interactionHistory: {
    timestamp: number;
    type: 'command' | 'suggestion' | 'error_fix' | 'git_commit' | 'code_review';
    context: string;
  }[];
}

export const NONO_MEMORY_KEY = 'nono-memory-v1';
/** Las distintas instancias montadas (panel flotante y Configuración) se avisan. */
export const NONO_MEMORY_EVENT = 'nono-memory-changed';
export const MAX_HISTORY = 100;

export const DEFAULT_MEMORY: NonoMemory = {
  preferredStack: [],
  patterns: {
    usesTests: false,
    usesDocker: false,
    usesTypeScript: false,
    usesGit: false,
  },
  ui: {
    showNono: true,
    reducedMotion: false,
    compactMode: false,
    forceMotion: false,
    instantGaze: false,
    orbSkin: false,
    eyesOnly: false,
    orbRotate: true,
    orbColors: DEFAULT_ORB_COLORS,
    eyesColor: '#ffffff',
  },
  interactionHistory: [],
};

/**
 * Lee la memoria guardada mezclando en profundidad. El merge por niveles evita
 * que una memoria vieja (sin `orbColors`, por ejemplo) deje las claves nuevas
 * en `undefined` para siempre.
 */
export function readNonoMemory(): NonoMemory {
  try {
    const stored = localStorage.getItem(NONO_MEMORY_KEY);
    if (!stored) return DEFAULT_MEMORY;
    const parsed = JSON.parse(stored) as Partial<NonoMemory> | null;
    // `classicAccent` era el halo de la antena del GIF. Se migra al color de
    // ojos actual para que una preferencia guardada no cambie de aspecto.
    const parsedUi = (parsed?.ui ?? {}) as Partial<NonoMemory['ui']> & { classicAccent?: unknown };
    const { classicAccent: legacyClassicAccent, ...storedUi } = parsedUi;
    const eyesColor = typeof legacyClassicAccent === 'string' ? legacyClassicAccent : storedUi.eyesColor;
    return {
      ...DEFAULT_MEMORY,
      ...parsed,
      patterns: { ...DEFAULT_MEMORY.patterns, ...(parsed?.patterns || {}) },
      ui: {
        ...DEFAULT_MEMORY.ui,
        ...storedUi,
        eyesColor: eyesColor ?? DEFAULT_MEMORY.ui.eyesColor,
        orbColors: { ...DEFAULT_ORB_COLORS, ...(parsed?.ui?.orbColors || {}) },
      },
      interactionHistory: Array.isArray(parsed?.interactionHistory) ? parsed!.interactionHistory : [],
    };
  } catch {
    return DEFAULT_MEMORY;
  }
}

export type NonoSkin = 'classic' | 'orb' | 'eyes';

/** La variante de ojos manda sobre el orbe, y el orbe sobre el clásico. */
export function resolveNonoSkin(
  ui: Pick<NonoMemory['ui'], 'orbSkin' | 'eyesOnly'>,
): NonoSkin {
  if (ui.eyesOnly) return 'eyes';
  return ui.orbSkin ? 'orb' : 'classic';
}

export function persistNonoMemory(memory: NonoMemory): void {
  try {
    localStorage.setItem(NONO_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    /* sin almacenamiento */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NONO_MEMORY_EVENT));
  }
}

/** Avisa a cualquier instancia montada cuando cambian las preferencias. */
export function subscribeNonoMemory(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === NONO_MEMORY_KEY || event.key === null) listener();
  };
  window.addEventListener(NONO_MEMORY_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(NONO_MEMORY_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
